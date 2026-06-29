import { describe, it, expect } from 'vitest';
import { markdownToAdf, parseInlineMarks } from '../src/markdown-to-adf.js';

describe('markdownToAdf', () => {
  it('empty string → doc with empty content', () => {
    const result = markdownToAdf('');
    expect(result).toEqual({ version: 1, type: 'doc', content: [] });
  });

  it('plain paragraph', () => {
    const result = markdownToAdf('Hello world');
    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('paragraph');
    expect(result.content[0].content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('heading parsing', () => {
    const result = markdownToAdf('# Main Title');
    expect(result.content).toHaveLength(1);
    const h = result.content[0];
    expect(h.type).toBe('heading');
    expect(h.attrs).toEqual({ level: 1 });
    expect(h.content).toEqual([{ type: 'text', text: 'Main Title' }]);
  });

  it('multiple heading levels', () => {
    const result = markdownToAdf('## Level 2\n\n### Level 3');
    expect(result.content).toHaveLength(2);
    expect(result.content[0].attrs).toEqual({ level: 2 });
    expect(result.content[1].attrs).toEqual({ level: 3 });
  });

  it('bullet list', () => {
    const result = markdownToAdf('- Item A\n- Item B');
    expect(result.content).toHaveLength(1);
    const list = result.content[0];
    expect(list.type).toBe('bulletList');
    expect(list.content).toHaveLength(2);
    expect(list.content![0].type).toBe('listItem');
    expect(list.content![0].content![0].content).toEqual([{ type: 'text', text: 'Item A' }]);
  });

  it('ordered list', () => {
    const result = markdownToAdf('1. First\n2. Second');
    expect(result.content).toHaveLength(1);
    const list = result.content[0];
    expect(list.type).toBe('orderedList');
    expect(list.content).toHaveLength(2);
  });

  it('code block', () => {
    const result = markdownToAdf('```typescript\nconst x = 1;\n```');
    expect(result.content).toHaveLength(1);
    const cb = result.content[0];
    expect(cb.type).toBe('codeBlock');
    expect(cb.attrs).toEqual({ language: 'typescript' });
    expect(cb.content).toEqual([{ type: 'text', text: 'const x = 1;' }]);
  });

  it('code block without language', () => {
    const result = markdownToAdf('```\nhello\n```');
    expect(result.content).toHaveLength(1);
    const cb = result.content[0];
    expect(cb.type).toBe('codeBlock');
    expect(cb.attrs).toBeUndefined();
  });

  it('blockquote', () => {
    const result = markdownToAdf('> Some quote');
    expect(result.content).toHaveLength(1);
    const bq = result.content[0];
    expect(bq.type).toBe('blockquote');
    expect(bq.content![0].type).toBe('paragraph');
  });

  it('horizontal rule', () => {
    const result = markdownToAdf('---');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('rule');
  });

  it('bold and italic inline', () => {
    const result = markdownToAdf('This is **bold** and *italic* text');
    const para = result.content[0];
    expect(para.type).toBe('paragraph');
    const nodes = para.content!;
    expect(nodes).toHaveLength(5);
    expect(nodes[0]).toEqual({ type: 'text', text: 'This is ' });
    expect(nodes[1]).toEqual({
      type: 'text',
      text: 'bold',
      marks: [{ type: 'strong' }],
    });
    expect(nodes[2]).toEqual({ type: 'text', text: ' and ' });
    expect(nodes[3]).toEqual({
      type: 'text',
      text: 'italic',
      marks: [{ type: 'em' }],
    });
    expect(nodes[4]).toEqual({ type: 'text', text: ' text' });
  });

  it('link conversion', () => {
    const result = markdownToAdf('Click [here](https://example.com) now');
    const nodes = result.content[0].content!;
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: 'text', text: 'Click ' });
    expect(nodes[1]).toEqual({
      type: 'text',
      text: 'here',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
    expect(nodes[2]).toEqual({ type: 'text', text: ' now' });
  });

  it('multi-block document', () => {
    const md = `# Title

Some paragraph here.

- Item 1
- Item 2

\`\`\`js
console.log("hi");
\`\`\``;

    const result = markdownToAdf(md);
    expect(result.content.length).toBeGreaterThanOrEqual(4);
    expect(result.content[0].type).toBe('heading');
    expect(result.content[1].type).toBe('paragraph');
    expect(result.content[2].type).toBe('bulletList');
    expect(result.content[3].type).toBe('codeBlock');
  });
});

describe('parseInlineMarks', () => {
  it('plain text returns single text node', () => {
    expect(parseInlineMarks('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('parses bold', () => {
    const result = parseInlineMarks('**bold**');
    expect(result).toEqual([{ type: 'text', text: 'bold', marks: [{ type: 'strong' }] }]);
  });

  it('parses inline code', () => {
    const result = parseInlineMarks('use `foo` here');
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      type: 'text',
      text: 'foo',
      marks: [{ type: 'code' }],
    });
  });

  it('parses strikethrough', () => {
    const result = parseInlineMarks('~~deleted~~');
    expect(result).toEqual([{ type: 'text', text: 'deleted', marks: [{ type: 'strike' }] }]);
  });
});
