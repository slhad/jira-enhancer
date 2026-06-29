import {
  BridgeError,
  buildEnhancementPrompt,
  buildSubtaskGenerationPrompt,
  ErrorCode,
  type HarnessEvent,
  type JiraEnhancementFields,
  type LlmSelection,
  type StructuredEnhancementResult,
  type SubtaskGenerationResult,
} from '@jira-enhancer/shared';
import { debugLog } from '../debug-logger.js';
import type { ProcessManager, SpawnStreamController } from '../process-manager.js';
import {
  parseStructuredEnhancementOutput,
  parseSubtaskGenerationOutput,
} from './structured-output.js';

type HarnessEventEmitter = (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => void;

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { message?: string };
};

export class OpenCodeAdapter {
  constructor(private readonly processManager: ProcessManager) {}

  async refine(
    projectPath: string,
    fields: JiraEnhancementFields,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: HarnessEventEmitter,
  ): Promise<StructuredEnhancementResult> {
    const prompt = buildEnhancementPrompt(fields, customPrompt, selection);
    const assistantText = await this.runPrompt(
      projectPath,
      prompt,
      'OpenCode produced structured enhancement output.',
      timeoutMs,
      selection,
      onEvent,
    );
    return parseStructuredEnhancementOutput(assistantText);
  }

  async generateSubtasks(
    projectPath: string,
    issueKey: string,
    fields: JiraEnhancementFields,
    enhancedFields?: StructuredEnhancementResult,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: HarnessEventEmitter,
  ): Promise<SubtaskGenerationResult> {
    const prompt = buildSubtaskGenerationPrompt(
      issueKey,
      fields,
      enhancedFields,
      customPrompt,
      selection,
    );
    const assistantText = await this.runPrompt(
      projectPath,
      prompt,
      'OpenCode produced structured sub-task output.',
      timeoutMs,
      selection,
      onEvent,
    );
    return parseSubtaskGenerationOutput(issueKey, assistantText, selection?.subtaskTitleOnly);
  }

  private async runPrompt(
    projectPath: string,
    prompt: string,
    finalEventText: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent: HarnessEventEmitter = () => undefined,
  ): Promise<string> {
    debugLog('opencode acp prompt', { projectPath, selection, prompt });

    let lineBuffer = '';
    let sessionId = selection?.reuseSession ? (selection.sessionRef?.id ?? '') : '';
    let assistantText = '';
    let promptDone = false;
    let nextId = 0;
    let controller: SpawnStreamController | undefined;

    const send = (method: string, params: Record<string, unknown>): number => {
      if (!controller) return -1;
      const id = nextId++;
      const message = { jsonrpc: '2.0', id, method, params };
      debugLog('opencode acp stdin', message);
      controller.writeStdin(`${JSON.stringify(message)}\n`);
      return id;
    };

    const sendResponse = (id: number | string, result: Record<string, unknown> | null) => {
      if (!controller) return;
      const message = { jsonrpc: '2.0', id, result };
      debugLog('opencode acp client response', message);
      controller.writeStdin(`${JSON.stringify(message)}\n`);
    };

    let initializeId = -1;
    let sessionNewId = -1;
    let modelConfigId = -1;
    let modeConfigId = -1;
    let promptId = -1;

    const selectedModel =
      selection?.modelProvider && selection?.model
        ? `${selection.modelProvider}/${selection.model}`
        : undefined;

    const sendPrompt = () => {
      if (!sessionId || promptId !== -1) return;
      promptId = send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
      onEvent({ app: 'opencode', kind: 'status', text: 'OpenCode started processing.' });
    };

    const maybeConfigureOrPrompt = (configOptions?: unknown) => {
      if (!sessionId) return;
      const options = Array.isArray(configOptions) ? configOptions : [];
      const hasModel = options.some(
        (option) =>
          isRecord(option) && option.id === 'model' && optionHasValue(option, selectedModel),
      );
      const hasPlanMode = options.some(
        (option) => isRecord(option) && option.id === 'mode' && optionHasValue(option, 'plan'),
      );

      if (selectedModel && hasModel && modelConfigId === -1) {
        modelConfigId = send('session/set_config_option', {
          sessionId,
          configId: 'model',
          value: selectedModel,
        });
        return;
      }

      if (selection?.safetyMode !== 'trust-ai' && hasPlanMode && modeConfigId === -1) {
        modeConfigId = send('session/set_config_option', {
          sessionId,
          configId: 'mode',
          value: 'plan',
        });
        return;
      }

      sendPrompt();
    };

    const handleMessage = (message: JsonRpcMessage): boolean => {
      debugLog('opencode acp stdout', message);
      if (message.error) {
        throw new BridgeError(
          ErrorCode.LLM_PROCESS_ERROR,
          `OpenCode ACP error: ${message.error.message ?? 'unknown error'}`,
        );
      }

      if (message.method === 'session/request_permission' && message.id !== undefined) {
        sendResponse(message.id, { outcome: { outcome: 'cancelled' } });
        return false;
      }

      if (message.id === initializeId) {
        onEvent({ app: 'opencode', kind: 'status', text: 'OpenCode ACP initialized.' });
        if (selection?.reuseSession && sessionId) {
          onEvent({
            app: 'opencode',
            kind: 'status',
            text: 'OpenCode reused existing ACP session.',
          });
          sendPrompt();
        } else {
          sessionNewId = send('session/new', { cwd: projectPath, mcpServers: [] });
        }
        return false;
      }

      if (message.id === sessionNewId && isRecord(message.result)) {
        sessionId = typeof message.result.sessionId === 'string' ? message.result.sessionId : '';
        onEvent({ app: 'opencode', kind: 'status', text: 'OpenCode ACP session created.' });
        maybeConfigureOrPrompt(message.result.configOptions);
        return false;
      }

      if (
        (message.id === modelConfigId || message.id === modeConfigId) &&
        isRecord(message.result)
      ) {
        maybeConfigureOrPrompt(message.result.configOptions);
        return false;
      }

      if (message.method === 'session/update') {
        const update =
          isRecord(message.params) && isRecord(message.params.update) ? message.params.update : {};
        const updateType = String(update.sessionUpdate ?? 'update');
        if (updateType === 'agent_message_chunk') {
          const text = extractContentText(update.content);
          if (text) {
            assistantText += text;
            onEvent({ app: 'opencode', kind: 'message', text });
          }
        } else if (updateType === 'agent_thought_chunk') {
          const text = extractContentText(update.content);
          if (text) onEvent({ app: 'opencode', kind: 'message', text: `Thinking: ${text}` });
        } else if (updateType === 'tool_call') {
          onEvent({
            app: 'opencode',
            kind: 'tool_call',
            text: String(update.title ?? 'OpenCode tool call'),
          });
        } else if (updateType === 'tool_call_update') {
          onEvent({
            app: 'opencode',
            kind: 'tool_result',
            text: `OpenCode tool ${String(update.status ?? 'updated')}`,
          });
        } else if (updateType === 'usage_update') {
          onEvent({ app: 'opencode', kind: 'status', text: 'OpenCode usage updated.' });
        }
        return false;
      }

      if (message.id === promptId && message.result) {
        promptDone = true;
        onEvent({ app: 'opencode', kind: 'final', text: finalEventText });
        return true;
      }

      /* c8 ignore next -- defensive fallback for unrelated ACP messages */
      return false;
    };

    try {
      await this.processManager.spawnWithTimeout(
        'opencode',
        ['acp', '--cwd', projectPath],
        JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: 'jira-enhancer', title: 'Jira Enhancer', version: '0.0.1' },
          },
        }) + '\n',
        timeoutMs,
        selection?.env,
        projectPath,
        {
          keepStdinOpen: true,
          resolveOnStdoutSignal: true,
          onStdout: (chunk, streamController) => {
            controller = streamController;
            initializeId = 0;
            nextId = Math.max(nextId, 1);
            let shouldFinish = false;
            lineBuffer += chunk;
            let newlineIndex = lineBuffer.indexOf('\n');
            while (newlineIndex !== -1) {
              const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, '');
              lineBuffer = lineBuffer.slice(newlineIndex + 1);
              if (line.trim())
                shouldFinish = handleMessage(JSON.parse(line) as JsonRpcMessage) || shouldFinish;
              newlineIndex = lineBuffer.indexOf('\n');
            }
            return shouldFinish;
          },
          onStderr: (chunk) => debugLog('opencode acp stderr', chunk),
        },
      );
    } catch (err) {
      if (lineBuffer.trim()) handleMessage(JSON.parse(lineBuffer) as JsonRpcMessage);
      if (!promptDone && err instanceof BridgeError) throw err;
      if (!promptDone) throw err;
    }

    if (!assistantText.trim()) {
      throw new BridgeError(
        ErrorCode.LLM_PROCESS_ERROR,
        'OpenCode ACP produced no assistant output.',
      );
    }

    return assistantText;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionHasValue(option: Record<string, unknown>, value: string | undefined): boolean {
  if (!value || !Array.isArray(option.options)) return false;
  return option.options.some((entry) => isRecord(entry) && entry.value === value);
}

function extractContentText(content: unknown): string {
  if (isRecord(content) && content.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}
