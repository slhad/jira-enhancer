import type { ProcessManager } from '../process-manager.js';

interface AcpMessage {
  type: 'prompt';
  content: string;
}

export class OpenCodeAdapter {
  constructor(private readonly processManager: ProcessManager) {}

  async refine(
    projectPath: string,
    markdown: string,
    customPrompt?: string,
  ): Promise<string> {
    let prompt = `Refine this Jira ticket description using context from the codebase:\n\n${markdown}`;

    if (customPrompt) {
      prompt += `\n\n${customPrompt}`;
    }

    const acpMessage: AcpMessage = {
      type: 'prompt',
      content: prompt,
    };

    const input = JSON.stringify(acpMessage);

    const result = await this.processManager.spawnWithTimeout(
      'opencode',
      ['acp', '--cwd', projectPath],
      input,
    );

    return result.stdout;
  }
}
