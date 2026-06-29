import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let envLoaded = false;

function loadDotEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = Array.from(
    new Set([
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '../../.env'),
      path.resolve(process.cwd(), '../../../.env'),
      path.resolve(moduleDir, '.env'),
      path.resolve(moduleDir, '../.env'),
      path.resolve(moduleDir, '../../.env'),
      path.resolve(moduleDir, '../../../.env'),
    ]),
  );

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

export function getDebugLogPath(): string | null {
  loadDotEnv();
  const explicitPath = process.env.JIRA_ENHANCER_LOG_FILE;
  if (explicitPath) return explicitPath;

  const enabled = process.env.JIRA_ENHANCER_DEBUG_LOG;
  if (!enabled || enabled === '0' || enabled.toLowerCase() === 'false') return null;
  return path.join('/tmp', 'jira-enhancer-bridge-debug.log');
}

export function getPreviewDebugLogPath(): string | null {
  loadDotEnv();
  const explicitPath = process.env.JIRA_ENHANCER_PREVIEW_LOG_FILE;
  if (explicitPath) return explicitPath;

  const enabled = process.env.JIRA_ENHANCER_PREVIEW_DEBUG_LOG;
  if (!enabled || enabled === '0' || enabled.toLowerCase() === 'false') return null;
  return path.join('/tmp', 'jira-enhancer-preview-debug.log');
}

export function debugLog(message: string, data?: unknown): void {
  const logPath = getDebugLogPath();
  if (!logPath) return;
  const payload = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${payload}\n`);
}
