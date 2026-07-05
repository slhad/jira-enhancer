import { describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../src/llm/opencode-adapter.js';
import { PiAdapter } from '../src/llm/pi-adapter.js';
import { createAdapter } from '../src/llm/index.js';
import type { ProcessManager } from '../src/process-manager.js';

const fields = { description: 'Original', acceptanceCriteria: '', storyPoints: '' };
const structuredJson = JSON.stringify({
  description: 'better',
  acceptanceCriteria: 'criteria',
  storyPoints: '8',
});

function makeProcessManager(stdout = structuredJson): ProcessManager {
  return {
    spawnWithTimeout: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 }),
  } as unknown as ProcessManager;
}

describe('LLM adapters', () => {
  it('creates adapters by harness app', () => {
    const pm = makeProcessManager();

    expect(createAdapter('opencode', pm)).toBeInstanceOf(OpenCodeAdapter);
    expect(createAdapter('pi', pm)).toBeInstanceOf(PiAdapter);
    expect(() => createAdapter('unknown' as never, pm)).toThrow('Unknown LLM provider');
  });

  function makeOpenCodeAcpProcess(
    updateMessages: unknown[],
    options: { noOutput?: boolean; error?: boolean } = {},
  ) {
    return {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          const writes: string[] = [];
          const controller = {
            writeStdin: (input: string) => writes.push(input),
            endStdin: vi.fn(),
          };
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } })}\n`,
            controller,
          );
          const sessionNew = JSON.parse(writes.at(-1) ?? '{}');
          handlers.onStdout(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: sessionNew.id,
              result: { sessionId: 'session-1', configOptions: [] },
            })}\n`,
            controller,
          );
          const prompt = JSON.parse(writes.at(-1) ?? '{}');
          if (options.error) {
            handlers.onStdout(
              `${JSON.stringify({ jsonrpc: '2.0', id: prompt.id, error: { message: 'bad' } })}\n`,
              controller,
            );
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          for (const update of updateMessages) {
            handlers.onStdout(
              `${JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: { sessionId: 'session-1', update },
              })}\n`,
              controller,
            );
          }
          if (!options.noOutput) {
            handlers.onStdout(
              `${JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'session-1',
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: structuredJson },
                  },
                },
              })}\n`,
              controller,
            );
          }
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })}\n`,
            controller,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
  }

  it('runs OpenCode ACP lifecycle with selection and timeout', async () => {
    const writes: string[] = [];
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          const controller = {
            writeStdin: (input: string) => writes.push(input),
            endStdin: vi.fn(),
          };
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } })}\n`,
            controller,
          );
          const sessionNew = JSON.parse(writes.at(-1) ?? '{}');
          expect(sessionNew.method).toBe('session/new');
          handlers.onStdout(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: sessionNew.id,
              result: {
                sessionId: 'session-1',
                configOptions: [
                  {
                    id: 'model',
                    options: [{ value: 'anthropic/claude' }],
                  },
                  { id: 'mode', options: [{ value: 'plan' }] },
                ],
              },
            })}\n`,
            controller,
          );
          const setModel = JSON.parse(writes.at(-1) ?? '{}');
          expect(setModel).toMatchObject({
            method: 'session/set_config_option',
            params: { configId: 'model', value: 'anthropic/claude' },
          });
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: setModel.id, result: { configOptions: [{ id: 'mode', options: [{ value: 'plan' }] }] } })}\n`,
            controller,
          );
          const setMode = JSON.parse(writes.at(-1) ?? '{}');
          expect(setMode).toMatchObject({
            method: 'session/set_config_option',
            params: { configId: 'mode', value: 'plan' },
          });
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: setMode.id, result: { configOptions: [] } })}\n`,
            controller,
          );
          const prompt = JSON.parse(writes.at(-1) ?? '{}');
          expect(prompt).toMatchObject({ method: 'session/prompt' });
          expect(prompt.params.prompt[0].text).toContain('Custom');
          handlers.onStdout(
            `${JSON.stringify({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'session-1',
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: structuredJson },
                },
              },
            })}\n`,
            controller,
          );
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })}\n`,
            controller,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new OpenCodeAdapter(pm);

    const result = await adapter.refine('/repo', fields, 'Custom', 1234, {
      modelProvider: 'anthropic',
      model: 'claude',
    });

    expect(result.description).toBe('better');
    expect(pm.spawnWithTimeout).toHaveBeenCalledWith(
      'opencode',
      ['acp', '--cwd', '/repo'],
      expect.stringContaining('"method":"initialize"'),
      1234,
      undefined,
      '/repo',
      expect.objectContaining({ keepStdinOpen: true, resolveOnStdoutSignal: true }),
    );
  });

  it('maps OpenCode ACP updates and handles permission requests', async () => {
    const events: Array<{ kind?: string; text?: string }> = [];
    const writes: string[] = [];
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          const controller = {
            writeStdin: (input: string) => writes.push(input),
            endStdin: vi.fn(),
          };
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} })}\n`,
            controller,
          );
          const sessionNew = JSON.parse(writes.at(-1) ?? '{}');
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: sessionNew.id, result: { sessionId: 'session-1', configOptions: [] } })}\n`,
            controller,
          );
          const prompt = JSON.parse(writes.at(-1) ?? '{}');
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: {} })}\n`,
            controller,
          );
          for (const update of [
            { sessionUpdate: 'agent_message_chunk', content: { type: 'image', text: 'ignored' } },
            { sessionUpdate: 'agent_thought_chunk', content: { type: 'image', text: 'ignored' } },
            { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'think' } },
            { sessionUpdate: 'tool_call' },
            { sessionUpdate: 'tool_call', title: 'Read file' },
            { sessionUpdate: 'tool_call_update' },
            { sessionUpdate: 'tool_call_update', status: 'completed' },
            { sessionUpdate: 'usage_update' },
            { sessionUpdate: 'unknown' },
            {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: structuredJson },
            },
          ]) {
            handlers.onStdout(
              `${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1', update } })}\n`,
              controller,
            );
          }
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })}\n`,
            controller,
          );
          return { stdout: '', stderr: 'warn', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new OpenCodeAdapter(pm);

    const result = await adapter.refine(
      '/repo',
      fields,
      undefined,
      1000,
      { safetyMode: 'trust-ai' },
      (event) => events.push(event),
    );

    expect(result.description).toBe('better');
    expect(writes.some((write) => write.includes('"outcome":"cancelled"'))).toBe(true);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['message', 'tool_call', 'tool_result', 'status', 'final']),
    );
  });

  it('generates subtasks with an existing OpenCode session', async () => {
    const writes: string[] = [];
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          const controller = {
            writeStdin: (input: string) => writes.push(input),
            endStdin: vi.fn(),
          };
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } })}\n`,
            controller,
          );
          const prompt = JSON.parse(writes.at(-1) ?? '{}');
          handlers.onStdout(
            `${JSON.stringify({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'existing-session',
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: JSON.stringify({
                      subtasks: [
                        {
                          title: 'Pull Request',
                          description: 'Open a PR.',
                          category: 'pullRequest',
                          required: true,
                        },
                      ],
                    }),
                  },
                },
              },
            })}\n`,
            controller,
          );
          handlers.onStdout(
            `${JSON.stringify({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } })}\n`,
            controller,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new OpenCodeAdapter(pm);

    const events: Array<{ kind?: string; text?: string }> = [];
    const result = await adapter.generateSubtasks(
      '/repo',
      'PROJ-1',
      fields,
      { description: 'Enhanced' },
      undefined,
      1234,
      {
        app: 'opencode',
        reuseSession: true,
        sessionRef: {
          id: 'existing-session',
          app: 'opencode',
          issueKey: 'PROJ-1',
          source: 'enhancement',
          createdAt: 1,
        },
      },
      (event) => events.push(event),
    );

    expect(result.subtasks[0].title).toBe('Pull Request');
    expect(events.map((event) => event.text)).toContain('OpenCode reused existing ACP session.');
    expect(writes.some((line) => line.includes('session/new'))).toBe(false);
  });

  it('surfaces OpenCode ACP errors and empty output', async () => {
    const adapterWithError = new OpenCodeAdapter(makeOpenCodeAcpProcess([], { error: true }));
    await expect(adapterWithError.refine('/repo', fields)).rejects.toThrow('OpenCode ACP error');

    const adapterWithoutOutput = new OpenCodeAdapter(
      makeOpenCodeAcpProcess([], { noOutput: true }),
    );
    await expect(adapterWithoutOutput.refine('/repo', fields)).rejects.toThrow(
      'OpenCode ACP produced no assistant output',
    );

    const adapterWithGenericFailure = new OpenCodeAdapter({
      spawnWithTimeout: vi.fn().mockRejectedValue(new Error('spawn boom')),
    } as unknown as ProcessManager);
    await expect(adapterWithGenericFailure.refine('/repo', fields)).rejects.toThrow('spawn boom');
  });

  it('parses Pi RPC events and returns structured output', async () => {
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          handlers.onStdout(`${JSON.stringify({ type: 'agent_start' })}\n`);
          handlers.onStdout(
            `${JSON.stringify({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
            })}\n`,
          );
          handlers.onStdout(
            `${JSON.stringify({
              type: 'tool_execution_start',
              toolName: 'read',
            })}\n`,
          );
          handlers.onStdout(
            `${JSON.stringify({
              type: 'tool_execution_end',
              toolName: 'read',
              isError: false,
            })}\n`,
          );
          handlers.onStdout(
            `${JSON.stringify({
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: structuredJson }] }],
            })}\n`,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);
    const events: unknown[] = [];

    const result = await adapter.refine('/repo', fields, undefined, 5678, undefined, (event) =>
      events.push(event),
    );

    expect(result.description).toBe('better');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'status' }),
        expect.objectContaining({ kind: 'message', text: 'partial' }),
        expect.objectContaining({ kind: 'tool_call' }),
        expect.objectContaining({ kind: 'tool_result' }),
        expect.objectContaining({ kind: 'final' }),
      ]),
    );
  });

  it('records additional Pi RPC activity events', async () => {
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          for (const event of [
            { type: 'response', command: 'prompt', success: true },
            { type: 'message_start', message: { role: 'assistant', content: [] } },
            {
              type: 'message_update',
              assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking' },
            },
            { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start' } },
            { type: 'message_update', assistantMessageEvent: { type: 'toolcall_end' } },
            { type: 'message_update', assistantMessageEvent: { type: 'done', reason: 'stop' } },
            {
              type: 'message_end',
              message: { role: 'assistant', content: [{ type: 'text', text: structuredJson }] },
            },
            {
              type: 'turn_end',
              message: { role: 'assistant', content: [{ type: 'text', text: structuredJson }] },
            },
            {
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: structuredJson }] }],
            },
          ]) {
            handlers.onStdout(`${JSON.stringify(event)}\n`);
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);
    const events: Array<{ text?: string }> = [];

    const result = await adapter.refine('/repo', fields, undefined, 5678, undefined, (event) =>
      events.push(event),
    );

    expect(result.description).toBe('better');
    expect(events.map((event) => event.text).join('\n')).toContain('Thinking: thinking');
    expect(events.map((event) => event.text).join('\n')).toContain('Pi turn produced');
  });

  it('finishes Pi RPC when the final assistant text ends before agent_end', async () => {
    let closeRequested = false;
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          closeRequested = handlers.onStdout(
            `${JSON.stringify({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_end', content: structuredJson },
            })}\n`,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);

    const result = await adapter.refine('/repo', fields, undefined, 5678);

    expect(closeRequested).toBe(true);
    expect(result.description).toBe('better');
  });

  it('shows Pi tool call details when the RPC event includes arguments', async () => {
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          handlers.onStdout(
            `${JSON.stringify({
              type: 'tool_execution_start',
              toolName: 'bash',
              args: { command: 'git status --short' },
            })}\n`,
          );
          handlers.onStdout(
            `${JSON.stringify({
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: structuredJson }] }],
            })}\n`,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);
    const events: Array<{ text?: string }> = [];

    await adapter.refine('/repo', fields, undefined, 5678, undefined, (event) =>
      events.push(event),
    );

    expect(events.map((event) => event.text).join('\n')).toContain('git status --short');
  });

  it('uses captured Pi final output if the process exits after agent_end', async () => {
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          handlers.onStdout(
            `${JSON.stringify({
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: structuredJson }] }],
            })}\n`,
          );
          throw new Error('process closed after final output');
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);

    const result = await adapter.refine('/repo', fields, undefined, 5678);

    expect(result.description).toBe('better');
  });

  it('sends Pi RPC input with selection and timeout', async () => {
    const pm = {
      spawnWithTimeout: vi
        .fn()
        .mockImplementation(async (_command, _args, _input, _timeout, _env, _cwd, handlers) => {
          handlers.onStdout(
            `${JSON.stringify({
              type: 'agent_end',
              messages: [{ role: 'assistant', content: [{ type: 'text', text: structuredJson }] }],
            })}\n`,
          );
          return { stdout: '', stderr: '', exitCode: 0 };
        }),
    } as unknown as ProcessManager;
    const adapter = new PiAdapter(pm);

    const result = await adapter.refine('/repo', fields, 'Custom', 5678, {
      modelProvider: 'github-copilot',
      model: 'gpt',
    });

    expect(result.description).toBe('better');
    expect(pm.spawnWithTimeout).toHaveBeenCalledWith(
      'pi',
      [
        '--mode',
        'rpc',
        '--no-session',
        '--tools',
        'read,grep,find,ls',
        '--provider',
        'github-copilot',
        '--model',
        'gpt',
      ],
      expect.stringContaining('provider=github-copilot, model=gpt'),
      5678,
      undefined,
      '/repo',
      expect.objectContaining({ onStdout: expect.any(Function) }),
    );
    expect(vi.mocked(pm.spawnWithTimeout).mock.calls[0][2]).toContain('Custom');
  });
});
