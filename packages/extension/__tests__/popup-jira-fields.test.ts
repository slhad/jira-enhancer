// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildDescriptionWithIssueFields,
  findFieldByName,
  parseJiraChangelogEntries,
  stringifyJiraFieldValue,
} from '../src/popup/popup.js';

describe('popup Jira custom fields', () => {
  it('finds story points and acceptance criteria by Jira field display names', () => {
    const data = {
      names: {
        customfield_10015: 'Story point estimate',
        customfield_10016: 'Story Points',
        customfield_12345: 'Acceptance Criteria:',
      },
      fields: {
        customfield_10015: null,
        customfield_10016: 8,
        customfield_12345: 'A hotfix can be triggered\nUnit tests cover the flow',
      },
    };

    expect(findFieldByName(data, new Set(['story points', 'story point estimate']))).toBe('8');
    expect(findFieldByName(data, new Set(['acceptance criteria']))).toBe(
      'A hotfix can be triggered\nUnit tests cover the flow',
    );
  });

  it('converts ADF custom-field content to markdown', () => {
    expect(
      stringifyJiraFieldValue({
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'First criterion' }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toContain('First criterion');
  });

  it('parses Jira changelog rollback entries for supported fields', () => {
    const entries = parseJiraChangelogEntries(
      {
        values: [
          {
            id: '101',
            created: '2026-06-27T10:00:00.000+0000',
            author: { displayName: 'Dev User' },
            items: [
              {
                field: 'description',
                fieldId: 'description',
                fromString: 'Old description',
                toString: 'New description',
              },
              {
                field: 'Story Points',
                fieldId: 'customfield_10016',
                fromString: '3',
                toString: '5',
              },
              { field: 'Priority', fromString: 'Low', toString: 'High' },
            ],
          },
        ],
      },
      { storyPoints: 'customfield_10016' },
      { description: 'Current description', storyPoints: '5' },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toContain('Dev User');
    expect(entries[0].fields).toMatchObject({ description: 'Old description', storyPoints: '3' });
    expect(entries[0].changedFields).toEqual(['description', 'storyPoints']);
    expect(entries[0].summary).toContain('Old description');
  });

  it('filters Jira changelog entries that already match current Jira fields', () => {
    const entries = parseJiraChangelogEntries(
      {
        values: [
          {
            id: '102',
            created: '2026-06-27T10:05:00.000+0000',
            author: { displayName: 'Dev User' },
            items: [
              {
                field: 'description',
                fieldId: 'description',
                fromString: 'Current description\r\n',
                toString: 'Newer description',
              },
            ],
          },
        ],
      },
      {},
      { description: 'Current description' },
    );

    expect(entries).toEqual([]);
  });

  it('appends story points and acceptance criteria to the LLM input description', () => {
    expect(
      buildDescriptionWithIssueFields({
        description: 'Original description',
        components: ['API'],
        storyPoints: '8',
        acceptanceCriteria: '- Criterion one\n- Criterion two',
      }),
    ).toBe(
      'Original description\n\nStory Points: 8\n\nAcceptance Criteria:\n- Criterion one\n- Criterion two',
    );
  });
});
