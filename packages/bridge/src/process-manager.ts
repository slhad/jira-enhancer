import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';
import { debugLog } from './debug-logger.js';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnStreamController {
  writeStdin: (input: string) => void;
  endStdin: () => void;
}

export interface SpawnStreamHandlers {
  /** Return true to signal that stdout produced enough data to finish. */
  onStdout?: (chunk: string, controller: SpawnStreamController) => boolean | void;
  onStderr?: (chunk: string) => void;
  keepStdinOpen?: boolean;
  /** Resolve successfully as soon as onStdout returns true, then terminate the child. */
  resolveOnStdoutSignal?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const SIGKILL_DELAY_MS = 5_000;

/* c8 ignore start -- Windows command shim resolution is verified with an installed native-host smoke test. */
function resolveCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; shell: boolean } {
  if (process.platform !== 'win32' || path.extname(command)) return { command, args, shell: false };

  const pathValue = env.PATH ?? env.Path ?? '';
  for (const directory of pathValue.split(path.delimiter)) {
    if (command === 'opencode') {
      const opencodeExe = path.join(directory, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      if (fs.existsSync(opencodeExe)) return { command: opencodeExe, args, shell: false };
    }

    if (command === 'pi') {
      const piCli = path.join(
        directory,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'dist',
        'cli.js',
      );
      if (fs.existsSync(piCli)) return { command: process.execPath, args: [piCli, ...args], shell: false };
    }

    const commandShim = path.join(directory, `${command}.cmd`);
    if (fs.existsSync(commandShim)) return { command: commandShim, args, shell: true };
  }

  return { command, args, shell: false };
}
/* c8 ignore stop */

export class ProcessManager {
  private activeProcesses = new Map<number, ChildProcess>();

  private spawnTracked(
    command: string,
    args: string[],
    input?: string,
    env?: Record<string, string>,
    cwd?: string,
    streamHandlers?: SpawnStreamHandlers,
  ): { child: ChildProcess; promise: Promise<SpawnResult> } {
    const mergedEnv = env ? { ...process.env, ...env } : process.env;
    const resolved = resolveCommand(command, args, mergedEnv);
    debugLog('spawn process', {
      command,
      resolvedCommand: resolved.command,
      args: resolved.args,
      cwd,
      inputBytes: input === undefined ? 0 : Buffer.byteLength(input),
      envOverrideKeys: Object.keys(env ?? {}).sort(),
      path: mergedEnv.PATH ?? mergedEnv.Path,
    });

    const spawnOptions: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
      ...(resolved.shell ? { shell: true } : {}),
      ...(cwd ? { cwd } : {}),
    };

    const child = spawn(resolved.command, resolved.args, spawnOptions);

    if (child.pid !== undefined) {
      this.activeProcesses.set(child.pid, child);
    }

    const promise = new Promise<SpawnResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finishEarly = () => {
        if (settled) return;
        settled = true;
        if (child.pid !== undefined) {
          this.activeProcesses.delete(child.pid);
        }
        child.kill('SIGTERM');
        resolve({ stdout, stderr, exitCode: 0 });
      };

      const streamController: SpawnStreamController = {
        writeStdin: (input: string) => child.stdin?.write(input),
        endStdin: () => child.stdin?.end(),
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (streamHandlers?.onStdout?.(text, streamController) === true) {
          child.stdin?.end();
          if (streamHandlers.resolveOnStdoutSignal) finishEarly();
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        streamHandlers?.onStderr?.(text);
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
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
        if (settled) return;
        settled = true;
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
        if (!streamHandlers?.keepStdinOpen) {
          child.stdin.end();
        }
      }
    });

    return { child, promise };
  }

  spawn(
    command: string,
    args: string[],
    input?: string,
    env?: Record<string, string>,
    cwd?: string,
  ): Promise<SpawnResult> {
    return this.spawnTracked(command, args, input, env, cwd).promise;
  }

  async spawnWithTimeout(
    command: string,
    args: string[],
    input?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    env?: Record<string, string>,
    cwd?: string,
    streamHandlers?: SpawnStreamHandlers,
  ): Promise<SpawnResult> {
    const { child, promise } = this.spawnTracked(command, args, input, env, cwd, streamHandlers);

    return new Promise<SpawnResult>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;

        if (child.pid !== undefined) {
          this.kill(child.pid);
        } else {
          child.kill('SIGTERM');
        }

        reject(
          new BridgeError(
            ErrorCode.LLM_TIMEOUT,
            `Process "${command}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      promise
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
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
