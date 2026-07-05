import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageType, ErrorCode, BridgeError } from '@jira-enhancer/shared';
import type { BridgeMessage } from '@jira-enhancer/shared';
import { RequestHandler } from '../src/request-handler.js';
import type { ConfigManager } from '../src/config-manager.js';
import type { ProcessManager } from '../src/process-manager.js';

vi.mock('../src/llm/index.js', () => ({
  createAdapter: vi.fn(() => ({
    refine: vi.fn().mockResolvedValue({
      description: 'Refined description',
      acceptanceCriteria: 'Refined criteria',
      storyPoints: '8',
    }),
    generateSubtasks: vi.fn().mockResolvedValue({
      issueKey: 'PROJ-123',
      subtasks: [
        {
          id: 'pull-request',
          title: 'Pull Request',
          description: 'Open a PR.',
          category: 'pullRequest',
          required: true,
        },
      ],
    }),
  })),
}));

import { createAdapter } from '../src/llm/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

function makeConfigManager(overrides: Partial<ConfigManager> = {}): ConfigManager {
  return {
    load: vi.fn(),
    getProjectPath: vi.fn().mockReturnValue('/projects/my-project'),
    getConfig: vi.fn().mockReturnValue({
      mappings: { PROJ: '/projects/my-project' },
      defaultProvider: 'opencode',
      timeout: 3210,
    }),
    ...overrides,
  } as unknown as ConfigManager;
}

function makeProcessManager(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    spawnWithTimeout: vi.fn(),
    kill: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  } as unknown as ProcessManager;
}

describe('RequestHandler', () => {
  let configManager: ConfigManager;
  let processManager: ProcessManager;
  let handler: RequestHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JIRA_ENHANCER_PREVIEW_DEBUG_LOG = '0';
    process.env.JIRA_ENHANCER_PREVIEW_LOG_FILE = '';
    configManager = makeConfigManager();
    processManager = makeProcessManager();
    handler = new RequestHandler(configManager, processManager);
  });

  afterEach(() => {
    process.env.JIRA_ENHANCER_PREVIEW_DEBUG_LOG = '0';
    process.env.JIRA_ENHANCER_PREVIEW_LOG_FILE = '';
  });

  it('should return EnhanceResponse for valid ENHANCE_REQUEST', async () => {
    const msg: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-1',
      issueKey: 'PROJ-123',
      description: 'Original description',
      mode: 'default',
      app: 'pi',
      provider: 'opencode',
      modelProvider: 'anthropic',
      model: 'claude-sonnet-4',
    };

    const result = await handler.handleMessage(msg);

    expect(result).toEqual(
      expect.objectContaining({
        type: MessageType.ENHANCE_RESPONSE,
        id: 'req-1',
        refinedDescription: 'Refined description',
        originalDescription: 'Original description',
        originalFields: {
          description: 'Original description',
        },
        enhancedFields: {
          description: 'Refined description',
        },
        sessionRef: expect.objectContaining({
          app: 'pi',
          issueKey: 'PROJ-123',
          source: 'enhancement',
        }),
      }),
    );

    expect(configManager.getProjectPath).toHaveBeenCalledWith('PROJ');
    expect(mockCreateAdapter).toHaveBeenCalledWith('pi', processManager);
    const adapter = mockCreateAdapter.mock.results[0].value;
    expect(adapter.refine).toHaveBeenCalledWith(
      '/projects/my-project',
      {
        description: 'Original description',
      },
      undefined,
      3210,
      expect.objectContaining({
        ...msg,
        sessionRef: expect.objectContaining({ app: 'pi', issueKey: 'PROJ-123' }),
      }),
      expect.any(Function),
    );
  });

  it('uses structured fields, launch path, and forwards harness events', async () => {
    const adapter = {
      refine: vi
        .fn()
        .mockImplementation(async (_path, _fields, _custom, _timeout, _selection, emit) => {
          emit({ app: 'pi', kind: 'status', text: 'working' });
          return {
            description: 'Refined description',
            acceptanceCriteria: 'Refined criteria',
            storyPoints: '8',
            notes: 'changed',
          };
        }),
    };
    mockCreateAdapter.mockReturnValue(adapter);
    const emit = vi.fn();
    const msg: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-structured',
      issueKey: 'PROJ-123',
      description: 'Legacy description',
      fields: { description: 'Original', acceptanceCriteria: 'Criteria', storyPoints: '5' },
      mode: 'custom',
      customPrompt: 'custom',
      launchPath: '/override/path',
      provider: 'pi',
    };

    const result = await handler.handleMessage(msg, emit);

    expect(configManager.getProjectPath).not.toHaveBeenCalled();
    expect(adapter.refine).toHaveBeenCalledWith(
      '/override/path',
      { description: 'Original', acceptanceCriteria: 'Criteria', storyPoints: '5' },
      'custom',
      3210,
      expect.objectContaining({
        ...msg,
        sessionRef: expect.objectContaining({ app: 'pi', issueKey: 'PROJ-123' }),
      }),
      expect.any(Function),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.HARNESS_EVENT,
        id: 'req-structured',
        text: 'working',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        enhancedFields: {
          description: 'Refined description',
          acceptanceCriteria: 'Refined criteria',
          storyPoints: '8',
          notes: 'changed',
        },
      }),
    );
  });

  it('returns INVALID_MESSAGE for malformed issue keys', async () => {
    const result = await handler.handleMessage({
      type: MessageType.ENHANCE_REQUEST,
      id: 'bad-key',
      issueKey: 'NO_DASH',
      description: 'desc',
      mode: 'default',
      provider: 'opencode',
    });

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'bad-key',
      code: ErrorCode.INVALID_MESSAGE,
      message: 'Invalid issue key format: NO_DASH',
    });
  });

  it('should return ErrorResponse with PROJECT_NOT_FOUND for unknown project', async () => {
    configManager = makeConfigManager({
      getProjectPath: vi.fn().mockImplementation(() => {
        throw new BridgeError(ErrorCode.PROJECT_NOT_FOUND, 'Project key not found');
      }),
    });
    handler = new RequestHandler(configManager, processManager);

    const msg: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-2',
      issueKey: 'UNKNOWN-42',
      description: 'Some text',
      mode: 'default',
      provider: 'opencode',
    };

    const result = await handler.handleMessage(msg);

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'req-2',
      code: ErrorCode.PROJECT_NOT_FOUND,
      message: 'Project key not found',
    });
  });

  it('gates preview debug logging behind environment config', async () => {
    const disabled = await handler.handleMessage({
      type: MessageType.DEBUG_LOG_REQUEST,
      id: 'debug-disabled',
      source: 'test-preview',
      payload: { ok: true },
    });
    expect(disabled).toEqual({
      type: MessageType.DEBUG_LOG_RESPONSE,
      id: 'debug-disabled',
      ok: false,
      path: '',
    });

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jira-enhancer-debug-test-'));
    const logPath = path.join(tempDir, 'preview.log');
    process.env.JIRA_ENHANCER_PREVIEW_LOG_FILE = logPath;

    const enabled = await handler.handleMessage({
      type: MessageType.DEBUG_LOG_REQUEST,
      id: 'debug-enabled',
      source: 'test-preview',
      payload: { ok: true },
    });

    expect(enabled).toEqual({
      type: MessageType.DEBUG_LOG_RESPONSE,
      id: 'debug-enabled',
      ok: true,
      path: logPath,
    });
    expect(await fs.readFile(logPath, 'utf8')).toContain('test-preview {"ok":true}');
  });

  it('should cleanup and return StatusUpdate for CANCEL request', async () => {
    const msg: BridgeMessage = {
      type: MessageType.CANCEL,
      id: 'req-3',
    };

    const result = await handler.handleMessage(msg);

    expect(processManager.cleanup).toHaveBeenCalled();
    expect(result).toEqual({
      type: MessageType.STATUS,
      id: 'req-3',
      status: 'complete',
    });
  });

  it('uses fallback id for unknown message types without ids', async () => {
    const result = await handler.handleMessage({ type: 'BOGUS_TYPE' } as unknown as BridgeMessage);

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'unknown',
      code: ErrorCode.INVALID_MESSAGE,
      message: 'Unknown message type: BOGUS_TYPE',
    });
  });

  it('should return ErrorResponse with INVALID_MESSAGE for unknown message type', async () => {
    const msg = {
      type: 'BOGUS_TYPE',
      id: 'req-4',
    } as unknown as BridgeMessage;

    const result = await handler.handleMessage(msg);

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'req-4',
      code: ErrorCode.INVALID_MESSAGE,
      message: expect.stringContaining('Unknown message type'),
    });
  });

  it('generates subtasks and forwards harness events with reused sessions', async () => {
    const adapter = {
      refine: vi.fn(),
      generateSubtasks: vi
        .fn()
        .mockImplementation(
          async (_path, _issue, _fields, _enhanced, _custom, _timeout, _selection, emit) => {
            emit({ app: 'opencode', kind: 'message', text: 'subtask thinking' });
            return {
              issueKey: 'PROJ-123',
              subtasks: [
                {
                  id: 'dev-tests',
                  title: 'Dev Tests',
                  description: 'Run developer tests.',
                  category: 'devTests',
                  required: true,
                },
              ],
            };
          },
        ),
    };
    mockCreateAdapter.mockReturnValue(adapter);
    const emit = vi.fn();
    const sessionRef = {
      id: 'existing-session',
      app: 'opencode' as const,
      issueKey: 'PROJ-123',
      source: 'enhancement' as const,
      createdAt: 1,
      provider: 'anthropic',
      model: 'claude',
    };

    const result = await handler.handleMessage(
      {
        type: MessageType.GENERATE_SUBTASKS_REQUEST,
        id: 'subtasks-1',
        issueKey: 'PROJ-123',
        fields: { description: 'Original' },
        enhancedFields: { description: 'Enhanced' },
        mode: 'default',
        app: 'opencode',
        provider: 'opencode',
        reuseSession: true,
        sessionRef,
      },
      emit,
    );

    expect(adapter.generateSubtasks).toHaveBeenCalledWith(
      '/projects/my-project',
      'PROJ-123',
      { description: 'Original' },
      { description: 'Enhanced' },
      undefined,
      3210,
      expect.objectContaining({ sessionRef, reuseSession: true }),
      expect.any(Function),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.HARNESS_EVENT,
        id: 'subtasks-1',
        text: 'subtask thinking',
        sessionRef,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: MessageType.GENERATE_SUBTASKS_RESPONSE,
        id: 'subtasks-1',
        sessionRef,
        reusedSession: true,
        result: expect.objectContaining({ issueKey: 'PROJ-123' }),
      }),
    );
  });

  it('rejects malformed issue keys for subtask generation', async () => {
    const result = await handler.handleMessage({
      type: MessageType.GENERATE_SUBTASKS_REQUEST,
      id: 'bad-subtasks',
      issueKey: 'BADKEY',
      fields: { description: 'Original' },
      mode: 'default',
      app: 'pi',
      provider: 'pi',
    });

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'bad-subtasks',
      code: ErrorCode.INVALID_MESSAGE,
      message: 'Invalid issue key format: BADKEY',
    });
  });

  it('should return UNKNOWN when an unexpected non-BridgeError is thrown', async () => {
    mockCreateAdapter.mockImplementation(() => {
      throw new Error('factory failed');
    });

    const result = await handler.handleMessage({
      type: MessageType.ENHANCE_REQUEST,
      id: 'unknown-error',
      issueKey: 'PROJ-1',
      description: 'desc',
      mode: 'default',
      provider: 'opencode',
    });

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'unknown-error',
      code: ErrorCode.UNKNOWN,
      message: 'factory failed',
    });
  });

  it('should return ErrorResponse when LLM adapter throws', async () => {
    mockCreateAdapter.mockReturnValue({
      refine: vi
        .fn()
        .mockRejectedValue(new BridgeError(ErrorCode.LLM_PROCESS_ERROR, 'LLM crashed')),
    });

    const msg: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-5',
      issueKey: 'PROJ-99',
      description: 'Some description',
      mode: 'default',
      provider: 'pi',
    };

    const result = await handler.handleMessage(msg);

    expect(result).toEqual({
      type: MessageType.ERROR,
      id: 'req-5',
      code: ErrorCode.LLM_PROCESS_ERROR,
      message: 'LLM crashed',
    });
  });
});
