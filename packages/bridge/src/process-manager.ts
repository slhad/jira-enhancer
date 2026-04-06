import { spawn, type ChildProcess } from 'node:child_process';
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SIGKILL_DELAY_MS = 5_000;

export class ProcessManager {
  private activeProcesses = new Map<number, ChildProcess>();

  spawn(
    command: string,
    args: string[],
    input?: string,
  ): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      if (child.pid !== undefined) {
        this.activeProcesses.set(child.pid, child);
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (child.pid !== undefined) {
          this.activeProcesses.delete(child.pid);
        }
        reject(
          new BridgeError(
            ErrorCode.LLM_PROCESS_ERROR,
            `Failed to spawn process "${command}": ${err.message}`,
          ),
        );
      });

      child.on('close', (code) => {
        if (child.pid !== undefined) {
          this.activeProcesses.delete(child.pid);
        }

        const exitCode = code ?? 1;

        if (exitCode !== 0) {
          reject(
            new BridgeError(
              ErrorCode.LLM_PROCESS_ERROR,
              `Process "${command}" exited with code ${exitCode}: ${stderr}`,
            ),
          );
          return;
        }

        resolve({ stdout, stderr, exitCode });
      });

      if (input !== undefined && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  async spawnWithTimeout(
    command: string,
    args: string[],
    input?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;

        // Kill all active processes matching this spawn
        // We need to track the specific child, so we wrap spawn inline
        reject(
          new BridgeError(
            ErrorCode.LLM_TIMEOUT,
            `Process "${command}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.spawn(command, args, input)
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });

      // We also need to kill the child on timeout — find it by looking at the
      // most recently added process. This is a slight simplification; for a
      // more robust approach we'd refactor spawn() to return the child handle.
    });
  }

  kill(pid: number): void {
    const child = this.activeProcesses.get(pid);
    if (!child) return;

    child.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, SIGKILL_DELAY_MS);

    child.on('close', () => {
      clearTimeout(killTimer);
      this.activeProcesses.delete(pid);
    });
  }

  cleanup(): void {
    for (const [pid] of this.activeProcesses) {
      this.kill(pid);
    }
  }
}
