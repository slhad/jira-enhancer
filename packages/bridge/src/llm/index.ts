import type { LlmProvider } from '@jira-enhancer/shared';
import type { ProcessManager } from '../process-manager.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { PiAdapter } from './pi-adapter.js';

export { OpenCodeAdapter } from './opencode-adapter.js';
export { PiAdapter } from './pi-adapter.js';

export function createAdapter(
  provider: LlmProvider,
  processManager: ProcessManager,
): OpenCodeAdapter | PiAdapter {
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
