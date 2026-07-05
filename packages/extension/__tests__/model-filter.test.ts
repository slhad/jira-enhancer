// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  filterIgnoredModelProviders,
  parseIgnoredModelProviders,
} from '../src/popup/model-filter.js';

describe('model provider filtering', () => {
  it('parses comma-separated ignored provider IDs case-insensitively', () => {
    expect(Array.from(parseIgnoredModelProviders(' openai, Google ,anthropic '))).toEqual([
      'openai',
      'google',
      'anthropic',
    ]);
  });

  it('filters ignored providers from model lists', () => {
    expect(
      filterIgnoredModelProviders(
        [
          { provider: 'openai', model: 'gpt-4.1' },
          { provider: 'anthropic', model: 'claude' },
          { provider: 'Google', model: 'gemini' },
        ],
        parseIgnoredModelProviders('openai,google'),
      ),
    ).toEqual([{ provider: 'anthropic', model: 'claude' }]);
  });
});
