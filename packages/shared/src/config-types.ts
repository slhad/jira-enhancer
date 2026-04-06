import type { LlmProvider } from './protocol.js';

/** Maps Jira project keys to local filesystem paths */
export interface ProjectMapping {
  [projectKey: string]: string;
}

export interface BridgeConfig {
  mappings: ProjectMapping;
  defaultProvider: LlmProvider;
  /** Timeout in milliseconds (default: 120000) */
  timeout: number;
}
