import type { AdfDocument, AdfNode } from './jira-types.js';

export function adfToMarkdown(doc: AdfDocument): string {
  if (!doc.content || doc.content.length === 0) return '';
  return renderNodes(doc.content).trim();
}

function renderNodes(nodes: AdfNode[]): string {
  return nodes.map((node) => renderNode(node)).join('');
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'doc':
      return node.content ? renderNodes(node.content) : '';

    case 'paragraph':
      return renderInlineChildren(node) + '\n\n';

    case 'text':
      return applyMarks(node.text ?? '', node.marks);

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${renderInlineChildren(node)}\n\n`;
    }

    case 'bulletList':
      return renderListItems(node, 'bullet') + '\n';

    case 'orderedList':
      return renderListItems(node, 'ordered') + '\n';

    case 'listItem':
      return node.content ? renderNodes(node.content) : '';

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const text = extractText(node);
      return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }

    case 'blockquote': {
      const inner = node.content ? renderNodes(node.content).trim() : '';
      return (
        inner
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') + '\n\n'
      );
    }

    case 'rule':
      return '---\n\n';

    case 'hardBreak':
      return '\n';

    case 'table':
      return renderTable(node) + '\n\n';

    case 'tableRow':
      return node.content ? renderNodes(node.content) : '';

    case 'tableHeader':
      return renderInlineChildren(node);

    case 'tableCell':
      return renderInlineChildren(node);

    case 'mention': {
      const mentionText = (node.attrs?.text as string) ?? (node.attrs?.id as string) ?? '';
      return `@${mentionText}`;
    }

    case 'inlineCard': {
      const url = (node.attrs?.url as string) ?? '';
      return `[${url}](${url})`;
    }

    case 'mediaSingle':
      return node.content ? renderNodes(node.content) : '';

    case 'media': {
      const mediaUrl = (node.attrs?.url as string) ?? '';
      if (mediaUrl) {
        return `![image](${mediaUrl})\n\n`;
      }
      return '![image](attachment)\n\n';
    }

    case 'status': {
      const statusText = (node.attrs?.text as string) ?? '';
      return `**${statusText}**`;
    }

    default:
      // Unknown node: try rendering children, skip if none
      if (node.content) {
        return renderNodes(node.content);
      }
      return '';
  }
}

function renderInlineChildren(node: AdfNode): string {
  if (!node.content) return node.text ?? '';
  return node.content.map((child) => renderNode(child)).join('');
}

function applyMarks(
  text: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
): string {
  if (!marks || marks.length === 0) return text;

  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) ?? '';
        result = `[${result}](${href})`;
        break;
      }
    }
  }
  return result;
}

function extractText(node: AdfNode): string {
  if (node.text != null) return node.text;
  if (!node.content) return '';
  return node.content.map((child) => extractText(child)).join('');
}

function renderListItems(node: AdfNode, kind: 'bullet' | 'ordered'): string {
  if (!node.content) return '';
  return node.content
    .map((item, index) => {
      const prefix = kind === 'bullet' ? '- ' : `${index + 1}. `;
      const inner = renderInlineChildren(item).replace(/\n\n$/, '');
      return `${prefix}${inner}`;
    })
    .join('\n');
}

function renderTable(node: AdfNode): string {
  if (!node.content) return '';

  const rows: string[][] = [];
  let hasHeader = false;

  for (const row of node.content) {
    if (row.type !== 'tableRow' || !row.content) continue;
    const cells: string[] = [];
    for (const cell of row.content) {
      if (cell.type === 'tableHeader') hasHeader = true;
      cells.push(renderInlineChildren(cell).replace(/\n\n$/, '').trim());
    }
    rows.push(cells);
  }

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const padded = rows[i].concat(Array(colCount - rows[i].length).fill(''));
    lines.push(`| ${padded.join(' | ')} |`);
    if (i === 0 && hasHeader) {
      lines.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
    }
  }

  // If no header row detected, add separator after first row anyway
  if (!hasHeader && rows.length > 0) {
    lines.splice(1, 0, `| ${Array(colCount).fill('---').join(' | ')} |`);
  }

  return lines.join('\n');
}
