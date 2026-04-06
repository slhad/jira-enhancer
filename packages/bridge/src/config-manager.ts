import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { BridgeConfig } from '@jira-enhancer/shared';
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';

export class ConfigManager {
  private readonly configPath: string;
  private config: BridgeConfig | null = null;

  constructor(configPath: string = path.join(process.cwd(), 'config.json')) {
    this.configPath = configPath;
  }

  async load(): Promise<BridgeConfig> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.configPath, 'utf-8');
    } catch {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        `Failed to read config file: ${this.configPath}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        `Invalid JSON in config file: ${this.configPath}`,
      );
    }

    this.config = this.validate(parsed);
    return this.config;
  }

  getProjectPath(projectKey: string): string {
    if (!this.config) {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        'Config not loaded. Call load() first.',
      );
    }

    const projectPath = this.config.mappings[projectKey];
    if (!projectPath) {
      throw new BridgeError(
        ErrorCode.PROJECT_NOT_FOUND,
        `Project key not found in mappings: ${projectKey}`,
      );
    }

    if (!fs.existsSync(projectPath)) {
      throw new BridgeError(
        ErrorCode.PROJECT_NOT_FOUND,
        `Project path does not exist on disk: ${projectPath}`,
      );
    }

    return projectPath;
  }

  getConfig(): BridgeConfig {
    if (!this.config) {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        'Config not loaded. Call load() first.',
      );
    }
    return this.config;
  }

  private validate(data: unknown): BridgeConfig {
    if (typeof data !== 'object' || data === null) {
      throw new BridgeError(ErrorCode.CONFIG_ERROR, 'Config must be a JSON object');
    }

    const obj = data as Record<string, unknown>;

    // Validate mappings
    if (typeof obj.mappings !== 'object' || obj.mappings === null || Array.isArray(obj.mappings)) {
      throw new BridgeError(ErrorCode.CONFIG_ERROR, 'Config "mappings" must be an object');
    }

    // Validate defaultProvider
    if (obj.defaultProvider !== 'opencode' && obj.defaultProvider !== 'pi') {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        'Config "defaultProvider" must be "opencode" or "pi"',
      );
    }

    // Validate timeout
    if (typeof obj.timeout !== 'number' || obj.timeout <= 0) {
      throw new BridgeError(
        ErrorCode.CONFIG_ERROR,
        'Config "timeout" must be a positive number',
      );
    }

    return {
      mappings: obj.mappings as BridgeConfig['mappings'],
      defaultProvider: obj.defaultProvider,
      timeout: obj.timeout,
    };
  }
}
