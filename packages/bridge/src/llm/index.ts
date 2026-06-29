import type {
  HarnessEvent,
  JiraEnhancementFields,
  LlmApp,
  LlmSelection,
  StructuredEnhancementResult,
  SubtaskGenerationResult,
} from '@jira-enhancer/shared';
import type { ProcessManager } from '../process-manager.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { PiAdapter } from './pi-adapter.js';

export { OpenCodeAdapter } from './opencode-adapter.js';
export { PiAdapter } from './pi-adapter.js';

export interface LlmAdapter {
  refine(
    projectPath: string,
    fields: JiraEnhancementFields,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => void,
  ): Promise<StructuredEnhancementResult>;

  generateSubtasks(
    projectPath: string,
    issueKey: string,
    fields: JiraEnhancementFields,
    enhancedFields?: StructuredEnhancementResult,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => void,
  ): Promise<SubtaskGenerationResult>;
}

export function createAdapter(provider: LlmApp, processManager: ProcessManager): LlmAdapter {
  switch (provider) {
    case 'opencode':
      return new OpenCodeAdapter(processManager);
    case 'pi':
      return new PiAdapter(processManager);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${_exhaustive}`);
    }
  }
}
