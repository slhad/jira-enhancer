function convertMarkdownTable(
  lines: string[],
  start: number,
): { markup: string[]; next: number } | null {
  if (start + 1 >= lines.length) return null;
  const header = parseMarkdownTableRow(lines[start]);
  const separator = parseMarkdownTableRow(lines[start + 1]);
  if (!header || !separator || !separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
    return null;
  }

  const output = [
    `||${header.map((cell) => convertInlineMarkdownToJira(cell.trim())).join('||')}||`,
  ];
  let index = start + 2;
  while (index < lines.length) {
    const row = parseMarkdownTableRow(lines[index]);
    if (!row) break;
    output.push(`|${row.map((cell) => convertInlineMarkdownToJira(cell.trim())).join('|')}|`);
    index += 1;
  }
  return { markup: output, next: index };
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|'));
}

export function markdownToJiraMarkup(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];

  const listMarkers: Array<'*' | '#'> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = line.match(/^```([^`]*)\s*$/);
    if (fence) {
      const language = fence[1].trim();
      output.push(language ? `{code:${language}}` : '{code}');
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        output.push(lines[index]);
        index += 1;
      }
      output.push('{code}');
      continue;
    }

    const table = convertMarkdownTable(lines, index);
    if (table) {
      output.push(...table.markup);
      index = table.next - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      output.push(`h${heading[1].length}. ${convertInlineMarkdownToJira(heading[2])}`);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      output.push('----');
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      output.push(`bq. ${convertInlineMarkdownToJira(quote[1])}`);
      continue;
    }

    const unordered = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (unordered) {
      const depth = Math.floor(unordered[1].replace(/\t/g, '  ').length / 2) + 1;
      listMarkers.length = depth - 1;
      listMarkers[depth - 1] = '*';
      output.push(`${listMarkers.join('')} ${convertInlineMarkdownToJira(unordered[2])}`);
      continue;
    }

    const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ordered) {
      const depth = Math.floor(ordered[1].replace(/\t/g, '  ').length / 2) + 1;
      listMarkers.length = depth - 1;
      listMarkers[depth - 1] = '#';
      output.push(`${listMarkers.join('')} ${convertInlineMarkdownToJira(ordered[2])}`);
      continue;
    }

    if (line.trim()) listMarkers.length = 0;
    output.push(convertInlineMarkdownToJira(line));
  }

  return output.join('\n').trim();
}

function convertInlineMarkdownToJira(text: string): string {
  const strong: string[] = [];
  let converted = text.replace(/\*\*([^*]+)\*\*/g, (_match, value: string) => {
    strong.push(`*${value}*`);
    return `@@JIRA_ENHANCER_STRONG_${strong.length - 1}@@`;
  });

  converted = converted
    .replace(
      /<span\s+style=["']color:\s*([^"';]+)[^"']*["']>([\s\S]*?)<\/span>/gi,
      '{color:$1}$2{color}',
    )
    .replace(/<cite>([\s\S]*?)<\/cite>/gi, '??$1??')
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, '^$1^')
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, '~$1~')
    .replace(/<a\s+id=["']([^"']+)["']\s*><\/a>/gi, '{anchor:$1}')
    .replace(/<a\s+name=["']([^"']+)["']\s*><\/a>/gi, '{anchor:$1}')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, alt: string, url: string) =>
      alt ? `!${url}|alt=${alt}!` : `!${url}!`,
    )
    .replace(/\[\^([^\]]+)\]/g, '[^$1]')
    .replace(/\[#([^\]]+)\]\(#[^)]+\)/g, '[#$1]')
    .replace(/<((?:https?|mailto|file):[^>]+)>/g, '[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]')
    .replace(/`([^`]+)`/g, '{{$1}}')
    .replace(/~~([^~]+)~~/g, '-$1-')
    .replace(/<u>([\s\S]*?)<\/u>/g, '+$1+')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1_$2_');

  return converted.replace(
    /@@JIRA_ENHANCER_STRONG_(\d+)@@/g,
    (_match, index: string) => strong[Number(index)] ?? '',
  );
}
