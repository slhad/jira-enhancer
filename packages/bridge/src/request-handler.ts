import {
  MessageType,
  type BridgeMessage,
  type ExtensionMessage,
  type EnhanceRequest,
  BridgeError,
  ErrorCode,
} from '@jira-enhancer/shared';
import type { ConfigManager } from './config-manager.js';
import type { ProcessManager } from './process-manager.js';
import { createAdapter } from './llm/index.js';

export class RequestHandler {
  private readonly configManager: ConfigManager;
  private readonly processManager: ProcessManager;

  constructor(configManager: ConfigManager, processManager: ProcessManager) {
    this.configManager = configManager;
    this.processManager = processManager;
  }

  async handleMessage(msg: BridgeMessage): Promise<ExtensionMessage> {
    try {
      switch (msg.type) {
        case MessageType.ENHANCE_REQUEST:
          return await this.handleEnhance(msg);

        case MessageType.CANCEL:
          this.processManager.cleanup();
          return {
            type: MessageType.STATUS,
            id: msg.id,
            status: 'complete',
          };

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

  private async handleEnhance(msg: EnhanceRequest): Promise<ExtensionMessage> {
    const dashIndex = msg.issueKey.indexOf('-');
    if (dashIndex === -1) {
      throw new BridgeError(
        ErrorCode.INVALID_MESSAGE,
        `Invalid issue key format: ${msg.issueKey}`,
      );
    }
    const projectKey = msg.issueKey.substring(0, dashIndex);

    const projectPath = this.configManager.getProjectPath(projectKey);
    const adapter = createAdapter(msg.provider, this.processManager);
    const refinedDescription = await adapter.refine(
      projectPath,
      msg.description,
      msg.customPrompt,
    );

    return {
      type: MessageType.ENHANCE_RESPONSE,
      id: msg.id,
      refinedDescription,
      originalDescription: msg.description,
    };
  }
}
