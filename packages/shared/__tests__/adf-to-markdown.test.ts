import { describe, it, expect } from 'vitest';
import { adfToMarkdown } from '../src/adf-to-markdown.js';
import type { AdfDocument, AdfNode } from '../src/jira-types.js';

function doc(...content: AdfNode[]): AdfDocument {
  return { version: 1, type: 'doc', content };
}

function paragraph(...content: AdfNode[]): AdfNode {
  return { type: 'paragraph', content };
}

function text(
  value: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
): AdfNode {
  return { type: 'text', text: value, marks };
}

function heading(level: number, ...content: AdfNode[]): AdfNode {
  return { type: 'heading', attrs: { level }, content };
}

describe('adfToMarkdown', () => {
  it('empty document → ""', () => {
    expect(adfToMarkdown(doc())).toBe('');
  });

  it('paragraph with plain text', () => {
    const result = adfToMarkdown(doc(paragraph(text('Hello world'))));
    expect(result).toBe('Hello world');
  });

  it('heading level 1', () => {
    const result = adfToMarkdown(doc(heading(1, text('Title'))));
    expect(result).toBe('# Title');
  });

  it('heading level 2', () => {
    const result = adfToMarkdown(doc(heading(2, text('Subtitle'))));
    expect(result).toBe('## Subtitle');
  });

  it('heading level 3', () => {
    const result = adfToMarkdown(doc(heading(3, text('Section'))));
    expect(result).toBe('### Section');
  });

  it('bold mark', () => {
    const result = adfToMarkdown(doc(paragraph(text('bold', [{ type: 'strong' }]))));
    expect(result).toBe('**bold**');
  });

  it('italic mark', () => {
    const result = adfToMarkdown(doc(paragraph(text('italic', [{ type: 'em' }]))));
    expect(result).toBe('*italic*');
  });

  it('code mark', () => {
    const result = adfToMarkdown(doc(paragraph(text('code', [{ type: 'code' }]))));
    expect(result).toBe('`code`');
  });

  it('link mark', () => {
    const result = adfToMarkdown(
      doc(
        paragraph(text('click here', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
      ),
    );
    expect(result).toBe('[click here](https://example.com)');
  });

  it('bullet list', () => {
    const result = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('Item A'))] },
          { type: 'listItem', content: [paragraph(text('Item B'))] },
        ],
      }),
    );
    expect(result).toBe('- Item A\n- Item B');
  });

  it('ordered list', () => {
    const result = adfToMarkdown(
      doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [paragraph(text('First'))] },
          { type: 'listItem', content: [paragraph(text('Second'))] },
        ],
      }),
    );
    expect(result).toBe('1. First\n2. Second');
  });

  it('code block with language', () => {
    const result = adfToMarkdown(
      doc({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [text('const x = 1;')],
      }),
    );
    expect(result).toBe('```typescript\nconst x = 1;\n```');
  });

  it('blockquote', () => {
    const result = adfToMarkdown(
      doc({
        type: 'blockquote',
        content: [paragraph(text('A quote'))],
      }),
    );
    expect(result).toBe('> A quote');
  });

  it('nested content: heading + paragraph + list', () => {
    const result = adfToMarkdown(
      doc(heading(2, text('Tasks')), paragraph(text('Here are items:')), {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('Do X'))] },
          { type: 'listItem', content: [paragraph(text('Do Y'))] },
        ],
      }),
    );
    expect(result).toBe('## Tasks\n\nHere are items:\n\n- Do X\n- Do Y');
  });

  it('renders miscellaneous Jira nodes and marks', () => {
    const result = adfToMarkdown(
      doc(
        paragraph(
          text('under', [{ type: 'underline' }]),
          text(' strike', [{ type: 'strike' }]),
          text(' plain', [{ type: 'unknown' }]),
          { type: 'hardBreak' },
          { type: 'mention', attrs: { id: 'account-id' } },
          { type: 'inlineCard', attrs: { url: 'https://example.test/card' } },
          { type: 'status', attrs: { text: 'DONE' } },
        ),
        { type: 'rule' },
        {
          type: 'mediaSingle',
          content: [{ type: 'media', attrs: { url: 'https://img.test/a.png' } }],
        },
        { type: 'media', attrs: {} },
        { type: 'unknownNode', content: [paragraph(text('fallback child'))] },
        { type: 'unknownLeaf' },
      ),
    );

    expect(result).toContain('<u>under</u>~~ strike~~ plain');
    expect(result).toContain('@account-id');
    expect(result).toContain('[https://example.test/card](https://example.test/card)');
    expect(result).toContain('**DONE**');
    expect(result).toContain('---');
    expect(result).toContain('![image](https://img.test/a.png)');
    expect(result).toContain('![image](attachment)');
    expect(result).toContain('fallback child');
  });

  it('handles empty and fallback child content', () => {
    expect(adfToMarkdown({ version: 1, type: 'doc' })).toBe('');
    expect(adfToMarkdown(doc({ type: 'doc' }))).toBe('');
    expect(adfToMarkdown(doc({ type: 'listItem' }))).toBe('');
    expect(adfToMarkdown(doc({ type: 'codeBlock' }))).toBe('```\n\n```');
    expect(adfToMarkdown(doc({ type: 'blockquote' }))).toBe('>');
    expect(adfToMarkdown(doc({ type: 'table' }))).toBe('');
  });

  it('renders standalone table row/header/cell fallbacks', () => {
    expect(
      adfToMarkdown(
        doc(
          { type: 'tableRow' },
          { type: 'tableHeader', text: 'Header fallback' },
          { type: 'tableCell', text: 'Cell fallback' },
        ),
      ),
    ).toBe('Header fallbackCell fallback');
  });

  it('prefers mention text, handles empty inline cards, and adds separators to tables without headers', () => {
    const result = adfToMarkdown(
      doc(
        paragraph(
          { type: 'mention', attrs: { text: 'Display Name', id: 'id' } },
          { type: 'inlineCard', attrs: {} },
        ),
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [paragraph(text('A'))] },
                { type: 'tableCell', content: [paragraph(text('B'))] },
              ],
            },
            {
              type: 'notTableRow',
              content: [{ type: 'tableCell', content: [paragraph(text('ignored'))] }],
            },
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [paragraph(text('C'))] }],
            },
          ],
        },
      ),
    );

    expect(result).toContain('@Display Name[]()');
    expect(result).toContain('| A | B |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| C |  |');
    expect(result).not.toContain('ignored');
  });

  it('table rendering', () => {
    const result = adfToMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [paragraph(text('Name'))] },
              { type: 'tableHeader', content: [paragraph(text('Age'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [paragraph(text('Alice'))] },
              { type: 'tableCell', content: [paragraph(text('30'))] },
            ],
          },
        ],
      }),
    );
    expect(result).toBe('| Name | Age |\n| --- | --- |\n| Alice | 30 |');
  });
});
