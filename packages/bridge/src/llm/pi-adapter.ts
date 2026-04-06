import type { ProcessManager } from '../process-manager.js';

export class PiAdapter {
  constructor(private readonly processManager: ProcessManager) {}

  async refine(
    projectPath: string,
    markdown: string,
    customPrompt?: string,
  ): Promise<string> {
    let input = markdown;

    if (customPrompt) {
      input += `\n\n${customPrompt}`;
    }

    const result = await this.processManager.spawnWithTimeout(
      'pi',
      ['--mode', 'rpc', '--cwd', projectPath],
      input,
    );

    return result.stdout;
  }
}
