import { describe, expect, it } from 'vitest';
import {
  parseStructuredEnhancementOutput,
  parseSubtaskGenerationOutput,
} from '../src/llm/structured-output.js';

describe('parseStructuredEnhancementOutput', () => {
  it('parses strict JSON output', () => {
    expect(
      parseStructuredEnhancementOutput(
        JSON.stringify({ description: 'D', acceptanceCriteria: 'A', storyPoints: '3', notes: 'N' }),
      ),
    ).toEqual({ description: 'D', acceptanceCriteria: 'A', storyPoints: '3', notes: 'N' });
  });

  it('parses fenced JSON output', () => {
    expect(
      parseStructuredEnhancementOutput(
        '```json\n{"description":"D","acceptanceCriteria":"A","storyPoints":"5"}\n```',
      ).storyPoints,
    ).toBe('5');
  });

  it('extracts the structured JSON object from prose with other braces', () => {
    const output = 'I checked `{code}` and found enough context. {"description":"D","notes":"N"}';

    expect(parseStructuredEnhancementOutput(output)).toEqual({
      description: 'D',
      acceptanceCriteria: '',
      storyPoints: '',
      notes: 'N',
    });
  });

  it('handles nested braces, escaped strings, missing notes, and non-string fields', () => {
    const payload = JSON.stringify({
      description: ' uses {brace} and "quote" ',
      acceptanceCriteria: 7,
      notes: '   ',
    });
    expect(parseStructuredEnhancementOutput(`prefix ${payload} suffix`)).toEqual({
      description: 'uses {brace} and "quote"',
      acceptanceCriteria: '',
      storyPoints: '',
    });
  });

  it('rejects malformed JSON and non-object JSON', () => {
    expect(() => parseStructuredEnhancementOutput('not-json')).toThrow(/invalid JSON/);
    expect(() => parseStructuredEnhancementOutput('[]')).toThrow(/must be an object/);
    expect(() => parseStructuredEnhancementOutput('null')).toThrow(/must be an object/);
  });
});

describe('parseSubtaskGenerationOutput', () => {
  it('parses, normalizes, and filters generated subtasks', () => {
    const result = parseSubtaskGenerationOutput(
      'PROJ-1',
      JSON.stringify({
        subtasks: [
          {
            title: 'Pull Request',
            description: 'Open and maintain the PR.',
            category: 'pullRequest',
            required: true,
            acceptanceCriteria: ['Reviewed', '', 7],
          },
          {
            id: 'custom-id',
            title: 'Optional docs',
            description: 'Update docs if behavior changes.',
            category: 'unknown',
            required: false,
            rationale: 'Only needed for external behavior.',
          },
          { title: '', description: 'ignored' },
        ],
        notes: 'Generated from context.',
      }),
    );

    expect(result).toEqual({
      issueKey: 'PROJ-1',
      notes: 'Generated from context.',
      subtasks: [
        {
          id: 'pull-request',
          title: 'Pull Request',
          description: 'Open and maintain the PR.',
          category: 'pullRequest',
          required: true,
          acceptanceCriteria: ['Reviewed'],
        },
        {
          id: 'custom-id',
          title: 'Optional docs',
          description: 'Update docs if behavior changes.',
          category: 'unknown',
          required: false,
          rationale: 'Only needed for external behavior.',
        },
      ],
    });
  });

  it('rejects invalid subtask JSON', () => {
    expect(() => parseSubtaskGenerationOutput('PROJ-1', 'not-json')).toThrow(
      /invalid subtask JSON/,
    );
    expect(() => parseSubtaskGenerationOutput('PROJ-1', '[]')).toThrow(/must be an object/);
    expect(() => parseSubtaskGenerationOutput('PROJ-1', '{}')).toThrow(/subtasks array/);
    expect(() => parseSubtaskGenerationOutput('PROJ-1', '{"subtasks":[]}')).toThrow(
      /valid subtasks/,
    );
  });
});
