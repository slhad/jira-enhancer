import { describe, expect, it, vi } from 'vitest';
import { MessageType } from '@jira-enhancer/shared';
import { RequestHandler } from '../src/request-handler.js';
import type { ConfigManager } from '../src/config-manager.js';
import type { ProcessManager } from '../src/process-manager.js';

vi.mock('../src/llm/index.js', () => ({
  createAdapter: vi.fn(),
}));

function makeConfigManager(): ConfigManager {
  return {
    getConfig: vi
      .fn()
      .mockReturnValue({ mappings: {}, defaultProvider: 'opencode', timeout: 120000 }),
    getProjectPath: vi.fn(),
  } as unknown as ConfigManager;
}

function makeProcessManager(stdout: string): ProcessManager {
  return {
    spawnWithTimeout: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 }),
    cleanup: vi.fn(),
  } as unknown as ProcessManager;
}

describe('RequestHandler model and image utility messages', () => {
  it('lists and deduplicates OpenCode slash-separated models', async () => {
    const processManager = makeProcessManager('opencode/claude\nopencode/claude\namazon/model\n');
    const handler = new RequestHandler(makeConfigManager(), processManager);

    const result = await handler.handleMessage({
      type: MessageType.LIST_MODELS_REQUEST,
      id: 'models-1',
      app: 'opencode',
    });

    expect(processManager.spawnWithTimeout).toHaveBeenCalledWith(
      'opencode',
      ['models'],
      undefined,
      30000,
      undefined,
    );
    expect(result).toEqual({
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'models-1',
      app: 'opencode',
      models: [
        { provider: 'opencode', model: 'claude' },
        { provider: 'amazon', model: 'model' },
      ],
    });
  });

  it('lists and deduplicates Pi tabular models', async () => {
    const processManager = makeProcessManager(
      'provider model context max-out thinking images\n' +
        'bedrock claude 200K 64K yes yes\n' +
        'bedrock claude 200K 64K yes yes\n' +
        'local llama 32K 8K no no\n',
    );
    const handler = new RequestHandler(makeConfigManager(), processManager);

    const result = await handler.handleMessage({
      type: MessageType.LIST_MODELS_REQUEST,
      id: 'models-2',
      app: 'pi',
    });

    expect(processManager.spawnWithTimeout).toHaveBeenCalledWith(
      'pi',
      ['--list-models'],
      undefined,
      30000,
      undefined,
    );
    expect(result).toEqual({
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'models-2',
      app: 'pi',
      models: [
        {
          provider: 'bedrock',
          model: 'claude',
          context: '200K',
          maxOut: '64K',
          thinking: true,
          images: true,
        },
        {
          provider: 'local',
          model: 'llama',
          context: '32K',
          maxOut: '8K',
          thinking: false,
          images: false,
        },
      ],
    });
  });

  it('ignores malformed model lines and handles unknown harnesses', async () => {
    const processManager = makeProcessManager('bad-line\nprovider/model/extra\nvalid/model\n');
    const handler = new RequestHandler(makeConfigManager(), processManager);

    await expect(
      handler.handleMessage({
        type: MessageType.LIST_MODELS_REQUEST,
        id: 'unknown',
        app: 'missing' as never,
      }),
    ).resolves.toEqual({
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'unknown',
      app: 'missing',
      models: [],
    });

    const result = await handler.handleMessage({
      type: MessageType.LIST_MODELS_REQUEST,
      id: 'models-extra',
      app: 'opencode',
      env: { AWS_PROFILE: 'dev' },
    });

    expect(processManager.spawnWithTimeout).toHaveBeenCalledWith(
      'opencode',
      ['models'],
      undefined,
      30000,
      { AWS_PROFILE: 'dev' },
    );
    expect(result).toEqual({
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'models-extra',
      app: 'opencode',
      models: [
        { provider: 'provider', model: 'model/extra' },
        { provider: 'valid', model: 'model' },
      ],
    });
  });

  it('handles sparse Pi model rows and shorter configured timeouts', async () => {
    const configManager = makeConfigManager();
    vi.mocked(configManager.getConfig).mockReturnValue({
      mappings: {},
      defaultProvider: 'pi',
      timeout: 1000,
    });
    const processManager = makeProcessManager('only-provider\nprovider model\n');
    const handler = new RequestHandler(configManager, processManager);

    const result = await handler.handleMessage({
      type: MessageType.LIST_MODELS_REQUEST,
      id: 'pi-sparse',
      app: 'pi',
    });

    expect(processManager.spawnWithTimeout).toHaveBeenCalledWith(
      'pi',
      ['--list-models'],
      undefined,
      1000,
      undefined,
    );
    expect(result).toEqual({
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'pi-sparse',
      app: 'pi',
      models: [],
    });
  });

  it('saves image attachments to temporary files', async () => {
    const handler = new RequestHandler(makeConfigManager(), makeProcessManager(''));

    const result = await handler.handleMessage({
      type: MessageType.SAVE_IMAGES_REQUEST,
      id: 'images-1',
      images: [
        {
          originalUrl: 'https://jira.example/image.png',
          mimeType: 'image/png',
          base64: Buffer.from('image-data').toString('base64'),
        },
      ],
    });

    expect(result.type).toBe(MessageType.SAVE_IMAGES_RESPONSE);
    if (result.type !== MessageType.SAVE_IMAGES_RESPONSE) return;
    expect(result.images[0].originalUrl).toBe('https://jira.example/image.png');
    expect(result.images[0].tmpPath).toMatch(/jira-enhancer-images-1-.*image-1\.png$/);
  });
});
