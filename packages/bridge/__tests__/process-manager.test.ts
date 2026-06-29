import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';
import { ProcessManager } from '../src/process-manager.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

function createMockChild(pid = 1234): {
  child: ChildProcess;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  emitClose: (code: number) => void;
  emitError: (err: Error) => void;
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
} {
  const child = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { write: vi.fn(), end: vi.fn() };

  Object.defineProperty(child, 'pid', { value: pid, writable: true });
  Object.defineProperty(child, 'stdout', { value: stdout });
  Object.defineProperty(child, 'stderr', { value: stderr });
  Object.defineProperty(child, 'stdin', { value: stdin });
  const mutableChild = child as ChildProcess & { killed: boolean; kill: ReturnType<typeof vi.fn> };
  mutableChild.killed = false;
  mutableChild.kill = vi.fn(() => {
    mutableChild.killed = true;
    return true;
  });

  return {
    child,
    stdout,
    stderr,
    stdin,
    emitClose: (code: number) => (child as unknown as EventEmitter).emit('close', code),
    emitError: (err: Error) => (child as unknown as EventEmitter).emit('error', err),
    emitStdout: (data: string) => stdout.emit('data', Buffer.from(data)),
    emitStderr: (data: string) => stderr.emit('data', Buffer.from(data)),
  };
}

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('spawn', () => {
    it('returns stdout and stderr on success', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawn('echo', ['hello']);

      mock.emitStdout('hello\n');
      mock.emitStderr('');
      mock.emitClose(0);

      const result = await promise;

      expect(result).toEqual({
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
      });
      expect(mockSpawn).toHaveBeenCalledWith('echo', ['hello'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    });

    it('passes env and cwd options to spawn', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawn('pwd', [], undefined, { EXTRA: '1' }, '/tmp/project');
      mock.emitClose(0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('pwd', [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, EXTRA: '1' },
        cwd: '/tmp/project',
      });
    });

    it('writes input to stdin when provided', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawn('cat', [], 'test input');

      mock.emitStdout('test input');
      mock.emitClose(0);

      await promise;

      expect(mock.stdin.write).toHaveBeenCalledWith('test input');
      expect(mock.stdin.end).toHaveBeenCalled();
    });

    it('rejects with BridgeError on non-zero exit code', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawn('false', []);

      mock.emitStderr('command failed');
      mock.emitClose(1);

      await expect(promise).rejects.toThrow(BridgeError);
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.LLM_PROCESS_ERROR,
      });
    });

    it('rejects with BridgeError on spawn error', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawn('nonexistent', []);

      mock.emitError(new Error('ENOENT'));

      await expect(promise).rejects.toThrow(BridgeError);
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.LLM_PROCESS_ERROR,
      });
    });
  });

  describe('spawnWithTimeout', () => {
    it('resolves if process finishes before timeout', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawnWithTimeout('echo', ['hello'], undefined, 5000);

      mock.emitStdout('hello\n');
      mock.emitClose(0);

      const result = await promise;

      expect(result).toEqual({
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
      });
    });

    it('keeps stdin open and exposes a stream controller', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);
      const chunks: string[] = [];

      const promise = pm.spawnWithTimeout('interactive', [], 'hello', 5000, undefined, undefined, {
        keepStdinOpen: true,
        onStdout: (_chunk, controller) => {
          controller.writeStdin('next');
          controller.endStdin();
          chunks.push(_chunk);
        },
        onStderr: (chunk) => chunks.push(chunk),
      });

      mock.emitStdout('out');
      mock.emitStderr('err');
      mock.emitClose(0);
      await promise;

      expect(mock.stdin.write).toHaveBeenCalledWith('hello');
      expect(mock.stdin.write).toHaveBeenCalledWith('next');
      expect(mock.stdin.end).toHaveBeenCalledTimes(1);
      expect(chunks).toEqual(['out', 'err']);
    });

    it('ends stdin when empty input is provided', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawnWithTimeout('no-input', [], '', 5000);
      mock.emitClose(0);
      await promise;

      expect(mock.stdin.end).toHaveBeenCalled();
    });

    it('resolves early when stdout handler signals completion', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawnWithTimeout('streaming', [], undefined, 5000, undefined, undefined, {
        resolveOnStdoutSignal: true,
        onStdout: (chunk) => chunk.includes('done'),
      });

      mock.emitStdout('done\n');

      const result = await promise;

      expect(result.stdout).toBe('done\n');
      expect(result.exitCode).toBe(0);
      expect(mock.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does not resolve early without resolveOnStdoutSignal', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawnWithTimeout('streaming', [], undefined, 5000, undefined, undefined, {
        onStdout: () => true,
      });

      mock.emitStdout('done');
      expect(mock.child.kill).not.toHaveBeenCalled();
      mock.emitClose(0);
      await expect(promise).resolves.toMatchObject({ stdout: 'done' });
    });

    it('rejects with LLM_TIMEOUT when process exceeds timeout', async () => {
      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);

      const promise = pm.spawnWithTimeout('slow', ['cmd'], undefined, 1000);

      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow(BridgeError);
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.LLM_TIMEOUT,
      });
      expect(mock.child.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('kill', () => {
    it('sends SIGTERM to a tracked process', async () => {
      const mock = createMockChild(5678);
      mockSpawn.mockReturnValue(mock.child);

      // Start a process so it gets tracked
      const promise = pm.spawn('long', ['running']);

      pm.kill(5678);

      expect(mock.child.kill).toHaveBeenCalledWith('SIGTERM');

      // Clean up - emit close so the promise settles
      mock.emitClose(1);
      await promise.catch(() => {});
    });

    it('sends SIGKILL if a process ignores SIGTERM', async () => {
      const mock = createMockChild(7777);
      const mutable = mock.child as ChildProcess & {
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      mutable.kill = vi.fn((signal?: NodeJS.Signals) => {
        if (signal === 'SIGKILL') mutable.killed = true;
        return true;
      });
      mockSpawn.mockReturnValue(mock.child);
      const promise = pm.spawn('stubborn', []);

      pm.kill(7777);
      vi.advanceTimersByTime(5001);

      expect(mutable.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mutable.kill).toHaveBeenCalledWith('SIGKILL');
      mock.emitClose(1);
      await promise.catch(() => {});
    });

    it('does nothing for unknown pid', () => {
      // Should not throw
      pm.kill(9999);
    });
  });

  describe('cleanup', () => {
    it('kills all active processes', async () => {
      const mock1 = createMockChild(100);
      const mock2 = createMockChild(200);

      mockSpawn.mockReturnValueOnce(mock1.child).mockReturnValueOnce(mock2.child);

      const p1 = pm.spawn('proc1', []);
      const p2 = pm.spawn('proc2', []);

      pm.cleanup();

      expect(mock1.child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mock2.child.kill).toHaveBeenCalledWith('SIGTERM');

      // Clean up promises
      mock1.emitClose(1);
      mock2.emitClose(1);
      await Promise.allSettled([p1, p2]);
    });
  });
});
