export function jiraMarkupToMarkdown(markup: string): string {
  const lines = markup.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const codeStart = line.match(
      /^\s*\{code(?::([^}|]+)(?:\|[^}]*)?|:[^}]*language=([^}|]+)[^}]*)?\}\s*$/i,
    );
    if (codeStart) {
      output.push(`\`\`\`${(codeStart[1] ?? codeStart[2] ?? '').trim()}`);
      index += 1;
      while (index < lines.length && !/^\s*\{code\}\s*$/i.test(lines[index])) {
        output.push(lines[index]);
        index += 1;
      }
      output.push('```');
      continue;
    }

    if (/^\s*\{quote\}\s*$/i.test(line)) {
      index += 1;
      while (index < lines.length && !/^\s*\{quote\}\s*$/i.test(lines[index])) {
        output.push(`> ${convertInlineJiraToMarkdown(lines[index])}`.trimEnd());
        index += 1;
      }
      continue;
    }

    const colorStart = line.match(/^\s*\{color:([^}]+)\}\s*$/i);
    if (colorStart) {
      const colorLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*\{color\}\s*$/i.test(lines[index])) {
        colorLines.push(convertInlineJiraToMarkdown(lines[index]));
        index += 1;
      }
      output.push(`<span style="color:${colorStart[1].trim()}">${colorLines.join('\n')}</span>`);
      continue;
    }

    if (/^\s*\{noformat(?:[:|][^}]*)?\}\s*$/i.test(line)) {
      output.push('```');
      index += 1;
      while (index < lines.length && !/^\s*\{noformat\}\s*$/i.test(lines[index])) {
        output.push(lines[index]);
        index += 1;
      }
      output.push('```');
      continue;
    }

    const panel = line.match(/^\s*\{(panel|info|note|warning|tip)(?::([^}]*))?\}\s*$/i);
    if (panel) {
      const title = panel[2]?.match(/(?:^|\|)title=([^|]+)/i)?.[1];
      if (title) output.push(`> **${convertInlineJiraToMarkdown(title.trim())}**`);
      index += 1;
      while (
        index < lines.length &&
        !new RegExp(`^\\s*\\{${panel[1]}\\}\\s*$`, 'i').test(lines[index])
      ) {
        output.push(`> ${convertInlineJiraToMarkdown(lines[index])}`.trimEnd());
        index += 1;
      }
      continue;
    }

    const heading = line.match(/^\s*h([1-6])\.\s+(.+)$/i);
    if (heading) {
      output.push(`${'#'.repeat(Number(heading[1]))} ${convertInlineJiraToMarkdown(heading[2])}`);
      continue;
    }

    const quote = line.match(/^\s*bq\.\s*(.*)$/i);
    if (quote) {
      output.push(`> ${convertInlineJiraToMarkdown(quote[1])}`.trimEnd());
      continue;
    }

    if (/^\s*-{4,}\s*$/.test(line)) {
      output.push('---');
      continue;
    }

    const table = convertJiraTableLine(line);
    if (table) {
      output.push(...table);
      continue;
    }

    const list = line.match(/^([*#]+)\s+(.+)$/);
    if (list) {
      const marker = list[1].endsWith('#') ? '1.' : '-';
      output.push(
        `${'  '.repeat(list[1].length - 1)}${marker} ${convertInlineJiraToMarkdown(list[2])}`,
      );
      continue;
    }

    output.push(convertInlineJiraToMarkdown(line));
  }

  return collapseMarkdownTableSeparators(output).join('\n').trim();
}

function convertJiraTableLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (/^\|\|.*\|\|$/.test(trimmed)) {
    const cells = trimmed
      .slice(2, -2)
      .split('||')
      .map((cell) => convertInlineJiraToMarkdown(cell.trim()));
    return [`| ${cells.join(' | ')} |`, `| ${cells.map(() => '---').join(' | ')} |`];
  }
  if (/^\|.*\|$/.test(trimmed)) {
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => convertInlineJiraToMarkdown(cell.trim()));
    return [`| ${cells.join(' | ')} |`];
  }
  return null;
}

function collapseMarkdownTableSeparators(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    const previous = output.at(-1) ?? '';
    if (/^\|\s*-{3,}/.test(line) && /^\|\s*-{3,}/.test(previous)) continue;
    output.push(line);
  }
  return output;
}

function convertInlineJiraToMarkdown(text: string): string {
  return unescapeJira(text)
    .replace(/\{anchor:([^}]+)\}/gi, '<a id="$1"></a>')
    .replace(/\{color:([^}]+)\}([\s\S]*?)\{color\}/gi, '<span style="color:$1">$2</span>')
    .replace(/!([^!|]+)(?:\|[^!]*)?!/g, (_match, url: string) => `![image](${url})`)
    .replace(/\[~([^\]]+)\]/g, '[~$1]')
    .replace(/\[\^([^\]]+)\]/g, '[^$1]')
    .replace(/\[#([^\]]+)\]/g, '[#$1](#$1)')
    .replace(/\[((?:https?|mailto|file):[^\]]+)\]/g, '<$1>')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    .replace(/\?\?([^?]+)\?\?/g, '<cite>$1</cite>')
    .replace(/\^([^\s^][^^]*?)\^/g, '<sup>$1</sup>')
    .replace(/~([^\s~][^~]*?)~/g, '<sub>$1</sub>')
    .replace(/\+([^+]+)\+/g, '<u>$1</u>')
    .replace(/(^|\s)-([^\s-][^-]*?)-(?=\W|$)/g, '$1~~$2~~')
    .replace(/\*([^*\s][^*]*?)\*/g, '**$1**')
    .replace(/_([^_\s][^_]*?)_/g, '*$1*');
}

function unescapeJira(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}
