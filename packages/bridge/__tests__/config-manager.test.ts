import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../src/config-manager.js';
import { ErrorCode } from '@jira-enhancer/shared';

describe('ConfigManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-config-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(filename: string, content: string): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  function writeValidConfig(): string {
    // Create a real directory for the mapping so getProjectPath validates
    const projectDir = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectDir);

    return writeConfig(
      'config.json',
      JSON.stringify({
        mappings: { PROJ: projectDir },
        defaultProvider: 'opencode',
        timeout: 120000,
      }),
    );
  }

  it('should load a valid config', async () => {
    const configPath = writeValidConfig();
    const manager = new ConfigManager(configPath);

    const config = await manager.load();

    expect(config.defaultProvider).toBe('opencode');
    expect(config.timeout).toBe(120000);
    expect(config.mappings).toHaveProperty('PROJ');
  });

  it('should return correct path for known project key', async () => {
    const configPath = writeValidConfig();
    const manager = new ConfigManager(configPath);
    await manager.load();

    const projectPath = manager.getProjectPath('PROJ');
    expect(projectPath).toBe(path.join(tmpDir, 'my-project'));
    expect(fs.existsSync(projectPath)).toBe(true);
  });

  it('should throw PROJECT_NOT_FOUND for unknown key', async () => {
    const configPath = writeValidConfig();
    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(() => manager.getProjectPath('UNKNOWN')).toThrowError(
      expect.objectContaining({ code: ErrorCode.PROJECT_NOT_FOUND }),
    );
  });

  it('should throw CONFIG_ERROR for missing file', async () => {
    const manager = new ConfigManager(path.join(tmpDir, 'nonexistent.json'));

    await expect(manager.load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });
  });

  it('should throw CONFIG_ERROR for invalid JSON', async () => {
    const configPath = writeConfig('bad.json', '{ not valid json !!!');
    const manager = new ConfigManager(configPath);

    await expect(manager.load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });
  });

  it('should throw CONFIG_ERROR for missing required fields', async () => {
    // Missing mappings
    const configPath1 = writeConfig(
      'no-mappings.json',
      JSON.stringify({ defaultProvider: 'opencode', timeout: 120000 }),
    );
    await expect(new ConfigManager(configPath1).load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });

    // Missing defaultProvider
    const configPath2 = writeConfig(
      'no-provider.json',
      JSON.stringify({ mappings: {}, timeout: 120000 }),
    );
    await expect(new ConfigManager(configPath2).load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });

    // Missing timeout
    const configPath3 = writeConfig(
      'no-timeout.json',
      JSON.stringify({ mappings: {}, defaultProvider: 'opencode' }),
    );
    await expect(new ConfigManager(configPath3).load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });

    // Invalid defaultProvider value
    const configPath4 = writeConfig(
      'bad-provider.json',
      JSON.stringify({ mappings: {}, defaultProvider: 'invalid', timeout: 120000 }),
    );
    await expect(new ConfigManager(configPath4).load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });

    // Negative timeout
    const configPath5 = writeConfig(
      'bad-timeout.json',
      JSON.stringify({ mappings: {}, defaultProvider: 'opencode', timeout: -1 }),
    );
    await expect(new ConfigManager(configPath5).load()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_ERROR,
    });
  });
});
