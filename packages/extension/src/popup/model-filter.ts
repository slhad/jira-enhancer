import type { ModelInfo } from '@jira-enhancer/shared';

const IGNORED_MODEL_PROVIDERS = import.meta.env.VITE_IGNORED_MODEL_PROVIDERS as string | undefined;

export function parseIgnoredModelProviders(value = IGNORED_MODEL_PROVIDERS): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isIgnoredModelProvider(
  provider: string | undefined,
  ignoredProviders = parseIgnoredModelProviders(),
): boolean {
  return Boolean(provider && ignoredProviders.has(provider.trim().toLowerCase()));
}

export function filterIgnoredModelProviders(
  models: ModelInfo[],
  ignoredProviders = parseIgnoredModelProviders(),
): ModelInfo[] {
  if (ignoredProviders.size === 0) return models;
  return models.filter((entry) => !isIgnoredModelProvider(entry.provider, ignoredProviders));
}
