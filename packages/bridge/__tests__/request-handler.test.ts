import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType, ErrorCode, BridgeError } from '@jira-enhancer/shared';
import type { BridgeMessage } from '@jira-enhancer/shared';
import { RequestHandler } from '../src/request-handler.js';
import type { ConfigManager } from '../src/config-manager.js';
import type { ProcessManager } from '../src/process-manager.js';

vi.mock('../src/llm/index.js', () => ({
  createAdapter: vi.fn(() => ({
    refine: vi.fn().mockResolvedValue('Refined description'),
  })),
}));

import { createAdapter } from '../src/llm/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

function makeConfigManager(overrides: Partial<ConfigManager> = {}): ConfigManager {
  return {
    load: vi.fn(),
    getProjectPath: vi.fn().mockReturnValue('/projects/my-project'),
    getConfig: vi.fn(),
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
    configManager = makeConfigManager();
    processManager = makeProcessManager();
    handler = new RequestHandler(configManager, processManager);
  });

  it('should return EnhanceResponse for valid ENHANCE_REQUEST', async () => {
    const msg: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-1',
      issueKey: 'PROJ-123',
      description: 'Original description',
      mode: 'default',
      provider: 'opencode',
    };

    const result = await handler.handleMessage(msg);

    expect(result).toEqual({
      type: MessageType.ENHANCE_RESPONSE,
      id: 'req-1',
      refinedDescription: 'Refined description',
      originalDescription: 'Original description',
    });

    expect(configManager.getProjectPath).toHaveBeenCalledWith('PROJ');
    expect(mockCreateAdapter).toHaveBeenCalledWith('opencode', processManager);
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

  it('should return ErrorResponse when LLM adapter throws', async () => {
    mockCreateAdapter.mockReturnValue({
      refine: vi.fn().mockRejectedValue(
        new BridgeError(ErrorCode.LLM_PROCESS_ERROR, 'LLM crashed'),
      ),
    } as any);

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
