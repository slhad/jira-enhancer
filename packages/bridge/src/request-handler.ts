import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MessageType,
  type BridgeMessage,
  type ExtensionMessage,
  type HarnessEvent,
  type EnhanceRequest,
  type GenerateSubtasksRequest,
  type HarnessSessionRef,
  type ListModelsRequest,
  type ModelInfo,
  type SaveImagesRequest,
  type DebugLogRequest,
  BridgeError,
  ErrorCode,
} from '@jira-enhancer/shared';
import type { ConfigManager } from './config-manager.js';
import type { ProcessManager } from './process-manager.js';
import { debugLog, getPreviewDebugLogPath } from './debug-logger.js';
import { createAdapter } from './llm/index.js';

export class RequestHandler {
  private readonly configManager: ConfigManager;
  private readonly processManager: ProcessManager;

  constructor(configManager: ConfigManager, processManager: ProcessManager) {
    this.configManager = configManager;
    this.processManager = processManager;
  }

  async handleMessage(
    msg: BridgeMessage,
    emit?: (message: ExtensionMessage) => void,
  ): Promise<ExtensionMessage> {
    try {
      switch (msg.type) {
        case MessageType.ENHANCE_REQUEST:
          return await this.handleEnhance(msg, emit);

        case MessageType.GENERATE_SUBTASKS_REQUEST:
          return await this.handleGenerateSubtasks(msg, emit);

        case MessageType.CANCEL:
          this.processManager.cleanup();
          return {
            type: MessageType.STATUS,
            id: msg.id,
            status: 'complete',
          };

        case MessageType.LIST_MODELS_REQUEST:
          return await this.handleListModels(msg);

        case MessageType.SAVE_IMAGES_REQUEST:
          return await this.handleSaveImages(msg);

        case MessageType.DEBUG_LOG_REQUEST:
          return await this.handleDebugLog(msg);

        default: {
          const _exhaustive: never = msg;
          return {
            type: MessageType.ERROR,
            id: (_exhaustive as { id: string }).id ?? 'unknown',
            code: ErrorCode.INVALID_MESSAGE,
            message: `Unknown message type: ${(_exhaustive as { type: string }).type}`,
          };
        }
      }
    } catch (err) {
      if (err instanceof BridgeError) {
        return {
          type: MessageType.ERROR,
          id: msg.id,
          code: err.code,
          message: err.message,
        };
      }
      return {
        type: MessageType.ERROR,
        id: msg.id,
        code: ErrorCode.UNKNOWN,
        message: err instanceof Error ? err.message : 'An unknown error occurred',
      };
    }
  }

  private async handleDebugLog(msg: DebugLogRequest): Promise<ExtensionMessage> {
    const logPath = getPreviewDebugLogPath();
    if (!logPath) {
      return { type: MessageType.DEBUG_LOG_RESPONSE, id: msg.id, ok: false, path: '' };
    }
    await fs.appendFile(
      logPath,
      `[${new Date().toISOString()}] ${msg.source} ${JSON.stringify(msg.payload)}\n`,
      'utf8',
    );
    return { type: MessageType.DEBUG_LOG_RESPONSE, id: msg.id, ok: true, path: logPath };
  }

  private async handleSaveImages(msg: SaveImagesRequest): Promise<ExtensionMessage> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jira-enhancer-${msg.id}-`));
    const images = await Promise.all(
      msg.images.map(async (image, index) => {
        const extension = image.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
        const tmpPath = path.join(dir, `image-${index + 1}.${extension}`);
        await fs.writeFile(tmpPath, Buffer.from(image.base64, 'base64'));
        return { originalUrl: image.originalUrl, tmpPath };
      }),
    );

    return { type: MessageType.SAVE_IMAGES_RESPONSE, id: msg.id, images };
  }

  private async handleListModels(msg: ListModelsRequest): Promise<ExtensionMessage> {
    const { timeout } = this.configManager.getConfig();
    const listTimeout = Math.min(timeout, 30_000);
    debugLog('list models request', {
      id: msg.id,
      app: msg.app,
      timeout: listTimeout,
      envOverrideKeys: Object.keys(msg.env ?? {}).sort(),
    });

    if (msg.app === 'opencode') {
      const result = await this.processManager.spawnWithTimeout(
        'opencode',
        ['models'],
        undefined,
        listTimeout,
        msg.env,
      );
      const models = this.parseSlashSeparatedModels(result.stdout);
      debugLog('list models response', {
        id: msg.id,
        app: msg.app,
        modelCount: models.length,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      return {
        type: MessageType.LIST_MODELS_RESPONSE,
        id: msg.id,
        app: msg.app,
        models,
      };
    }

    if (msg.app === 'pi') {
      const result = await this.processManager.spawnWithTimeout(
        'pi',
        ['--list-models'],
        undefined,
        listTimeout,
        msg.env,
      );
      const models = this.parsePiModels(result.stdout);
      debugLog('list models response', {
        id: msg.id,
        app: msg.app,
        modelCount: models.length,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      return {
        type: MessageType.LIST_MODELS_RESPONSE,
        id: msg.id,
        app: msg.app,
        models,
      };
    }

    return {
      type: MessageType.LIST_MODELS_RESPONSE,
      id: msg.id,
      app: msg.app,
      models: [],
    };
  }

  private parseSlashSeparatedModels(output: string): ModelInfo[] {
    const seen = new Set<string>();

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const slashIndex = line.indexOf('/');
        if (slashIndex === -1) return [];

        const provider = line.substring(0, slashIndex);
        const model = line.substring(slashIndex + 1);
        const key = `${provider}/${model}`;
        if (seen.has(key)) return [];
        seen.add(key);

        return [{ provider, model }];
      });
  }

  private parsePiModels(output: string): ModelInfo[] {
    const seen = new Set<string>();
    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('provider '));

    return lines.flatMap((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(yes|no)\s+(yes|no)$/);
      if (!match) return [];

      const [, provider, model, context, maxOut, thinking, images] = match;
      const key = `${provider}/${model}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          provider,
          model,
          context,
          maxOut,
          thinking: thinking === 'yes',
          images: images === 'yes',
        },
      ];
    });
  }

  private makeSessionRef(
    msg: EnhanceRequest | GenerateSubtasksRequest,
    app: HarnessSessionRef['app'],
    source: HarnessSessionRef['source'],
  ): HarnessSessionRef {
    if (msg.reuseSession && msg.sessionRef?.issueKey === msg.issueKey) return msg.sessionRef;
    return {
      id: `${msg.issueKey.toLowerCase()}-${source}-${msg.id}`.replace(/[^a-z0-9_-]/g, '-'),
      app,
      issueKey: msg.issueKey,
      source,
      createdAt: Date.now(),
      ...(msg.modelProvider ? { provider: msg.modelProvider } : {}),
      ...(msg.model ? { model: msg.model } : {}),
      ...(msg.launchPath ? { launchPath: msg.launchPath } : {}),
      ...(msg.safetyMode ? { safetyMode: msg.safetyMode } : {}),
    };
  }

  private async handleEnhance(
    msg: EnhanceRequest,
    emit?: (message: ExtensionMessage) => void,
  ): Promise<ExtensionMessage> {
    const dashIndex = msg.issueKey.indexOf('-');
    if (dashIndex === -1) {
      throw new BridgeError(ErrorCode.INVALID_MESSAGE, `Invalid issue key format: ${msg.issueKey}`);
    }
    const projectKey = msg.issueKey.substring(0, dashIndex);

    const projectPath = msg.launchPath?.trim() || this.configManager.getProjectPath(projectKey);
    const { timeout } = this.configManager.getConfig();
    const app = msg.app ?? msg.provider;
    const adapter = createAdapter(app, this.processManager);
    const originalFields = msg.fields ?? {
      description: msg.description,
    };
    const sessionRef = this.makeSessionRef(msg, app, 'enhancement');
    const selection = {
      ...msg,
      sessionRef,
      reuseSession: Boolean(msg.reuseSession && msg.sessionRef),
    };
    const parsedFields = await adapter.refine(
      projectPath,
      originalFields,
      msg.customPrompt,
      timeout,
      selection,
      (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => {
        emit?.({
          type: MessageType.HARNESS_EVENT,
          id: msg.id,
          timestamp: Date.now(),
          ...event,
          sessionRef,
        });
      },
    );
    const enhancedFields = {
      description: parsedFields.description,
      ...('acceptanceCriteria' in originalFields
        ? { acceptanceCriteria: parsedFields.acceptanceCriteria ?? '' }
        : {}),
      ...('storyPoints' in originalFields ? { storyPoints: parsedFields.storyPoints ?? '' } : {}),
      ...(parsedFields.notes ? { notes: parsedFields.notes } : {}),
    };

    return {
      type: MessageType.ENHANCE_RESPONSE,
      id: msg.id,
      refinedDescription: enhancedFields.description,
      originalDescription: originalFields.description,
      originalFields,
      enhancedFields,
      sessionRef,
      reusedSession: Boolean(msg.reuseSession && msg.sessionRef),
    };
  }

  private async handleGenerateSubtasks(
    msg: GenerateSubtasksRequest,
    emit?: (message: ExtensionMessage) => void,
  ): Promise<ExtensionMessage> {
    const dashIndex = msg.issueKey.indexOf('-');
    if (dashIndex === -1) {
      throw new BridgeError(ErrorCode.INVALID_MESSAGE, `Invalid issue key format: ${msg.issueKey}`);
    }
    const projectKey = msg.issueKey.substring(0, dashIndex);
    const projectPath = msg.launchPath?.trim() || this.configManager.getProjectPath(projectKey);
    const { timeout } = this.configManager.getConfig();
    const app = msg.app ?? msg.provider;
    const adapter = createAdapter(app, this.processManager);
    const sessionRef = this.makeSessionRef(msg, app, 'subtasks');
    const selection = {
      ...msg,
      sessionRef,
      reuseSession: Boolean(msg.reuseSession && msg.sessionRef),
      subtaskTitleOnly: Boolean(msg.titleOnly),
    };
    const result = await adapter.generateSubtasks(
      projectPath,
      msg.issueKey,
      msg.fields,
      msg.enhancedFields,
      msg.customPrompt,
      timeout,
      selection,
      (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => {
        emit?.({
          type: MessageType.HARNESS_EVENT,
          id: msg.id,
          timestamp: Date.now(),
          ...event,
          sessionRef,
        });
      },
    );
    const responseResult = msg.titleOnly
      ? {
          ...result,
          subtasks: result.subtasks.map(
            ({ acceptanceCriteria: _acceptanceCriteria, ...subtask }) => ({
              ...subtask,
              description: '',
            }),
          ),
        }
      : result;

    return {
      type: MessageType.GENERATE_SUBTASKS_RESPONSE,
      id: msg.id,
      result: responseResult,
      sessionRef,
      reusedSession: Boolean(msg.reuseSession && msg.sessionRef),
    };
  }
}
