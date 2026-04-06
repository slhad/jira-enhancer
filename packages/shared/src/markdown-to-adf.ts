import type { AdfDocument, AdfNode } from './jira-types.js';

export function markdownToAdf(markdown: string): AdfDocument {
  const lines = markdown.split('\n');
  const content = parseBlocks(lines);
  return { version: 1, type: 'doc', content };
}

function parseBlocks(lines: string[]): AdfNode[] {
  const blocks: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)\s*$/);
    if (codeMatch) {
      const language = codeMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const attrs: Record<string, unknown> = {};
      if (language) attrs.language = language;
      blocks.push({
        type: 'codeBlock',
        attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push({
        type: 'heading',
        attrs: { level },
        content: parseInlineMarks(text),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.match(/^>\s?/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const innerBlocks = parseBlocks(quoteLines);
      blocks.push({
        type: 'blockquote',
        content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
      });
      continue;
    }

    // Bullet list
    if (line.match(/^[-*]\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        const itemText = lines[i].replace(/^[-*]\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarks(itemText) }],
        });
        i++;
      }
      blocks.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const itemText = lines[i].replace(/^\d+\.\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarks(itemText) }],
        });
        i++;
      }
      blocks.push({ type: 'orderedList', content: items });
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].match(/^#{1,6}\s/) &&
        !lines[i].match(/^```/) &&
        !lines[i].match(/^>\s?/) &&
        !lines[i].match(/^[-*]\s+/) &&
        !lines[i].match(/^\d+\.\s+/) &&
        !lines[i].match(/^(-{3,}|\*{3,})\s*$/)
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const text = paraLines.join(' ');
      blocks.push({
        type: 'paragraph',
        content: parseInlineMarks(text),
      });
    }
  }

  return blocks;
}

export function parseInlineMarks(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Combined regex for inline patterns
  // Order matters: bold before italic since ** is longer than *
  const inlineRegex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(~~(.+?)~~)|(\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add any plain text before this match
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      // Bold: **text**
      nodes.push({
        type: 'text',
        text: match[2],
        marks: [{ type: 'strong' }],
      });
    } else if (match[3]) {
      // Italic: *text*
      nodes.push({
        type: 'text',
        text: match[4],
        marks: [{ type: 'em' }],
      });
    } else if (match[5]) {
      // Code: `text`
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'code' }],
      });
    } else if (match[7]) {
      // Strikethrough: ~~text~~
      nodes.push({
        type: 'text',
        text: match[8],
        marks: [{ type: 'strike' }],
      });
    } else if (match[9]) {
      // Link: [text](url)
      nodes.push({
        type: 'text',
        text: match[10],
        marks: [{ type: 'link', attrs: { href: match[11] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  // If nothing was parsed, return at least one text node
  if (nodes.length === 0) {
    nodes.push({ type: 'text', text });
  }

  return nodes;
}
