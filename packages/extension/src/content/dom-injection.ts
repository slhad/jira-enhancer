const BUTTON_ID = 'jira-enhancer-btn';

const DESCRIPTION_SELECTORS = [
  '[data-testid="issue-description"]',
  '[data-testid="issue.views.field.rich-text.description"]',
  '#description-val',
  '#descriptionmodule .mod-content',
  '#descriptionmodule',
  '[data-field-id="description"]',
  '[data-fieldtype="textarea"]',
  '.user-content-block',
];

const HEADER_SELECTORS = [
  '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
  '#jira-issue-header',
  '[data-testid="issue-field-heading.ui.title"]',
];

function findHeader(): Element | null {
  for (const selector of HEADER_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function renderDescriptionNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  if (!(node instanceof HTMLElement)) return '';

  const children = Array.from(node.childNodes).map(renderDescriptionNode).join('').trim();

  switch (node.tagName.toLowerCase()) {
    case 'br':
      return '\n';
    case 'p':
      return `${children}\n\n`;
    case 'h1':
      return `# ${children}\n\n`;
    case 'h2':
      return `## ${children}\n\n`;
    case 'h3':
      return `### ${children}\n\n`;
    case 'li':
      return `- ${children}\n`;
    case 'a': {
      const href = node.getAttribute('href');
      return href ? `[${children}](${href})` : children;
    }
    case 'img': {
      const img = node as HTMLImageElement;
      return img.src ? `![${img.alt || img.title || 'Jira image'}](${img.src})` : '';
    }
    case 'ul':
    case 'ol':
      return `${children}\n`;
    default:
      return children;
  }
}

function normalizeMarkdownish(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractEditorText(): string {
  const selectors = [
    '#descriptionmodule textarea',
    'textarea[name="description"]',
    'textarea#description',
    'textarea.wiki-textfield',
    '.wiki-edit textarea',
    '.jira-wiki-editor textarea',
  ];

  for (const selector of selectors) {
    const textarea = document.querySelector(selector) as HTMLTextAreaElement | null;
    if (textarea?.value.trim()) return normalizeMarkdownish(textarea.value);
  }

  return '';
}

function textFromElement(el: Element): string {
  const htmlEl = el as HTMLElement;
  const visibleText = htmlEl.innerText || htmlEl.textContent;
  const rendered = renderDescriptionNode(el);
  return normalizeMarkdownish(rendered || visibleText || '');
}

function findDescriptionByHeading(): Element | null {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, strong, .mod-header'));
  const heading = headings.find((el) => el.textContent?.trim().toLowerCase() === 'description');
  return (
    heading?.parentElement?.querySelector('.mod-content, .field-content, .user-content-block') ??
    null
  );
}

export function extractJiraDescription(): string {
  const editorText = extractEditorText();
  if (editorText) return editorText;

  for (const selector of DESCRIPTION_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) {
      const text = textFromElement(el);
      if (text) return text;
    }
  }

  const headingDescription = findDescriptionByHeading();
  if (headingDescription) return textFromElement(headingDescription);

  return '';
}

function hasOpenDescriptionEditor(): boolean {
  const editorSelectors = [
    '#descriptionmodule textarea',
    'textarea[name="description"]',
    'textarea#description',
    '#descriptionmodule .wiki-edit textarea',
    '#descriptionmodule .jira-wiki-editor textarea',
    '#descriptionmodule [contenteditable="true"]',
  ];
  return editorSelectors.some((selector) => document.querySelector(selector));
}

const EMOTICON_EMOJI: Record<string, string> = {
  ':)': '🙂',
  ':(': '☹️',
  ':P': '😛',
  ':D': '😀',
  ';)': '😉',
  '(y)': '👍',
  '(n)': '👎',
  '(i)': 'ℹ️',
  '(/)': '✅',
  '(x)': '❌',
  '(!)': '⚠️',
  '(*)': '⭐',
  '(+)': '➕',
  '(-)': '⛔',
  '(?)': '❓',
  '(flag)': '🚩',
  '(flagoff)': '⚐',
};

function formatJiraUserMention(accountName: string): string {
  return accountName
    .replace(/^~+/, '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function createAttachmentImagePreview(filename: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'jira-enhancer-attachment-image-preview';
  wrapper.title = filename;
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', filename);
  Object.assign(wrapper.style, {
    display: 'inline-flex',
    width: '32px',
    height: '32px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '2px',
    background: '#3b3f46',
    color: '#ffffff',
    fontSize: '18px',
    lineHeight: '32px',
    verticalAlign: 'middle',
  });
  wrapper.textContent = '▧';
  return wrapper;
}

function renderPlainText(text: string): Node[] {
  const nodes: Node[] = [];
  const dashRegex = /---|--/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = dashRegex.exec(text)) !== null) {
    if (match.index > lastIndex)
      nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    nodes.push(document.createTextNode(match[0] === '---' ? '—' : '–'));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(document.createTextNode(text.slice(lastIndex)));
  return nodes.length ? nodes : [document.createTextNode(text)];
}

function renderInline(text: string): Node[] {
  const nodes: Node[] = [];
  const regex =
    /(\{color:[^}]+\}.*?\{color\})|(\{anchor:[^}]+\})|(\*[^*]+\*)|(_[^_]+_)|(\?\?[^?]+\?\?)|(-[^\s-][^-]*?-(?=\W|$))|(\+[^+]+\+)|(\^[^^]+\^)|(~[^~]+~)|(\{\{[^}]+\}\})|(\[[^|\]]+\|[^\]]+\])|(\[(?:https?|mailto|file):[^\]]+\])|(\[#[^\]]+\])|(\[\^[^\]]+\])|(\[~[^\]]+\])|(![^!|]+(?:\|[^!]*)?!)|(:\)|:\(|:P|:D|;\)|\(y\)|\(n\)|\(i\)|\(\/\)|\(x\)|\(!\)|\(\*\)|\(\+\)|\(-\)|\(\?\)|\(flag\)|\(flagoff\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderPlainText(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    const appendTextElement = (tag: string, value: string) => {
      const element = document.createElement(tag);
      element.textContent = value;
      nodes.push(element);
    };
    if (token.startsWith('{color:')) {
      const colorMatch = token.match(/^\{color:([^}]+)\}([\s\S]*)\{color\}$/i);
      const font = document.createElement('font');
      font.setAttribute('color', colorMatch?.[1].trim() ?? '');
      font.append(...renderInline(colorMatch?.[2] ?? ''));
      nodes.push(font);
    } else if (token.startsWith('{anchor:')) {
      const el = document.createElement('a');
      el.setAttribute('name', token.slice(8, -1));
      nodes.push(el);
    } else if (token.startsWith('*')) appendTextElement('b', token.slice(1, -1));
    else if (token.startsWith('_')) appendTextElement('em', token.slice(1, -1));
    else if (token.startsWith('??')) appendTextElement('cite', token.slice(2, -2));
    else if (token.startsWith('-')) appendTextElement('del', token.slice(1, -1));
    else if (token.startsWith('+')) appendTextElement('ins', token.slice(1, -1));
    else if (token.startsWith('^')) appendTextElement('sup', token.slice(1, -1));
    else if (token.startsWith('~')) appendTextElement('sub', token.slice(1, -1));
    else if (token.startsWith('{{')) appendTextElement('tt', token.slice(2, -2));
    else if (/^\[[^|\]]+\|[^\]]+\]$/.test(token)) {
      const linkMatch = token.match(/^\[([^|\]]+)\|([^\]]+)\]$/);
      const link = document.createElement('a');
      link.href = linkMatch?.[2] ?? '';
      link.textContent = linkMatch?.[1] ?? '';
      nodes.push(link);
    } else if (/^\[(?:https?|mailto|file):[^\]]+\]$/.test(token)) {
      const href = token.slice(1, -1);
      const link = document.createElement('a');
      link.href = href;
      link.textContent = href.replace(/^mailto:/i, '');
      nodes.push(link);
    } else if (token.startsWith('[#')) {
      const anchor = token.slice(2, -1);
      const link = document.createElement('a');
      link.href = `#${anchor}`;
      link.textContent = anchor;
      nodes.push(link);
    } else if (token.startsWith('[^')) {
      const filename = token.slice(2, -1);
      const link = document.createElement('a');
      link.href = `#${filename}`;
      link.textContent = filename;
      link.className = 'attachment-title';
      nodes.push(link);
    } else if (token.startsWith('[~')) {
      const accountName = token.slice(2, -1);
      const link = document.createElement('a');
      link.href = `/secure/ViewProfile.jspa?name=${encodeURIComponent(accountName)}`;
      link.textContent = formatJiraUserMention(accountName);
      link.className = 'user-hover';
      nodes.push(link);
    } else if (token.startsWith('!')) {
      const imageUrl = token.match(/^!([^!|]+)/)?.[1] ?? '';
      if (/^[^:/?#]+\.[a-z0-9]+$/i.test(imageUrl)) {
        nodes.push(createAttachmentImagePreview(imageUrl));
      } else {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = imageUrl;
        nodes.push(img);
      }
    } else if (token in EMOTICON_EMOJI) {
      const img = document.createElement('img');
      img.className = 'emoticon';
      img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><text y="14" font-size="14">${EMOTICON_EMOJI[token] ?? token}</text></svg>`)}`;
      img.alt = token;
      img.width = 16;
      img.height = 16;
      nodes.push(img);
    } else {
      const span = document.createElement('span');
      span.className = 'error';
      span.textContent = token;
      nodes.push(span);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(...renderPlainText(text.slice(lastIndex)));
  return nodes.length ? nodes : [document.createTextNode(text)];
}

function appendParagraph(container: HTMLElement, text: string): void {
  const p = document.createElement('p');
  p.append(...renderInline(text));
  container.appendChild(p);
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.startsWith('||')) return trimmed.slice(2, -2).split('||');
  return trimmed.slice(1, -1).split('|');
}

function appendTable(container: HTMLElement, lines: string[], start: number): number {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'confluenceTable';
  const tbody = document.createElement('tbody');
  let i = start;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    const isHeader = /^\s*\|\|/.test(lines[i]);
    const tr = document.createElement('tr');
    for (const cellText of parseTableCells(lines[i])) {
      const cell = document.createElement(isHeader ? 'th' : 'td');
      cell.className = isHeader ? 'confluenceTh' : 'confluenceTd';
      cell.append(...renderInline(cellText));
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
    i += 1;
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
  return i - 1;
}

function appendList(container: HTMLElement, lines: string[], start: number): number {
  const first = lines[start].match(/^([*#]+)\s+(.+)$/);
  const root = document.createElement(first?.[1].endsWith('#') ? 'ol' : 'ul');
  const stack: Array<{
    level: number;
    marker: '*' | '#';
    list: HTMLElement;
    lastItem: HTMLLIElement | null;
  }> = [{ level: 1, marker: first?.[1].endsWith('#') ? '#' : '*', list: root, lastItem: null }];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(/^([*#]+)\s+(.+)$/);
    if (!match) break;
    const marker = match[1].endsWith('#') ? '#' : '*';
    const level = match[1].length;
    if (i > start && level === 1 && marker !== stack[0].marker) break;
    while (stack.length > level) stack.pop();
    while (stack.length < level || stack[stack.length - 1].marker !== marker) {
      const parent = stack[stack.length - 1];
      const nested = document.createElement(marker === '#' ? 'ol' : 'ul');
      if (!parent.lastItem) {
        parent.lastItem = document.createElement('li');
        parent.list.appendChild(parent.lastItem);
      }
      parent.lastItem.appendChild(nested);
      stack.push({ level: stack.length + 1, marker, list: nested, lastItem: null });
      if (stack.length >= level) break;
    }
    const current = stack[stack.length - 1];
    const li = document.createElement('li');
    li.append(...renderInline(match[2]));
    current.list.appendChild(li);
    current.lastItem = li;
    i += 1;
  }
  container.appendChild(root);
  return i - 1;
}

function appendPanel(
  container: HTMLElement,
  kind: 'code' | 'preformatted',
  codeLines: string[],
  language?: string,
): void {
  const panel = document.createElement('div');
  panel.className = `${kind} panel`;
  const content = document.createElement('div');
  content.className = `${kind}Content panelContent`;
  const pre = document.createElement('pre');
  if (kind === 'code') pre.className = `code-${language || 'java'}`;
  pre.textContent = `${codeLines.join('\n')}\n`;
  content.appendChild(pre);
  panel.appendChild(content);
  container.appendChild(panel);
}

function appendPreviewDebugLog(source: string, payload: unknown): void {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!runtime?.sendMessage) return;
  runtime.sendMessage({
    type: 'DEBUG_LOG_REQUEST',
    id: crypto.randomUUID(),
    source,
    payload,
  });
}

export function renderJiraMarkup(markup: string): HTMLElement {
  const container = document.createElement('div');
  container.dataset.jiraEnhancerPreview = 'true';
  const lines = markup.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;
    const heading = line.match(/^\s*h([1-6])\.\s+(.+)$/);
    if (heading) {
      const el = document.createElement(`h${heading[1]}`);
      el.append(...renderInline(heading[2]));
      container.appendChild(el);
      continue;
    }
    const anchor = line.match(/^\s*\{anchor:([^}]+)\}\s*$/i);
    if (anchor) {
      const el = document.createElement('a');
      el.setAttribute('name', anchor[1]);
      container.appendChild(el);
      continue;
    }
    const colorStart = line.match(/^\s*\{color:([^}]+)\}\s*$/i);
    if (colorStart) {
      const font = document.createElement('font');
      font.setAttribute('color', colorStart[1].trim());
      i += 1;
      while (i < lines.length && !/^\s*\{color\}\s*$/i.test(lines[i])) {
        font.append(...renderInline(lines[i]));
        if (i + 1 < lines.length && !/^\s*\{color\}\s*$/i.test(lines[i + 1])) {
          font.appendChild(document.createElement('br'));
        }
        i += 1;
      }
      const p = document.createElement('p');
      p.appendChild(font);
      container.appendChild(p);
      continue;
    }
    const quoteStart = line.match(/^\s*\{quote\}\s*$/i);
    if (quoteStart) {
      const blockquote = document.createElement('blockquote');
      i += 1;
      while (i < lines.length && !/^\s*\{quote\}\s*$/i.test(lines[i])) {
        blockquote.append(...renderInline(lines[i]));
        blockquote.appendChild(document.createElement('br'));
        i += 1;
      }
      container.appendChild(blockquote);
      continue;
    }
    const blockquote = line.match(/^\s*bq\.\s*(.*)$/i);
    if (blockquote) {
      const el = document.createElement('blockquote');
      el.append(...renderInline(blockquote[1]));
      container.appendChild(el);
      continue;
    }
    const panelStart = line.match(/^\s*\{(panel|info|note|warning|tip)(?::([^}]*))?\}\s*$/i);
    if (panelStart) {
      const panel = document.createElement('div');
      panel.className = 'panel';
      const title = panelStart[2]?.match(/(?:^|\|)title=([^|]+)/i)?.[1];
      if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'panelHeader';
        titleEl.append(...renderInline(title.trim()));
        panel.appendChild(titleEl);
      }
      const content = document.createElement('div');
      content.className = 'panelContent';
      i += 1;
      while (
        i < lines.length &&
        !new RegExp(`^\\s*\\{${panelStart[1]}\\}\\s*$`, 'i').test(lines[i])
      ) {
        appendParagraph(content, lines[i].trimStart());
        i += 1;
      }
      panel.appendChild(content);
      container.appendChild(panel);
      continue;
    }
    const codeStart = line.match(
      /^\s*\{code(?::([^}|]+)(?:\|[^}]*)?|:[^}]*language=([^}|]+)[^}]*)?\}\s*$/i,
    );
    if (codeStart) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*\{code\}\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      appendPanel(container, 'code', codeLines, codeStart[1] ?? codeStart[2]);
      continue;
    }
    if (/^\s*\{noformat(?:[:|][^}]*)?\}\s*$/i.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*\{noformat\}\s*$/i.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      appendPanel(container, 'preformatted', codeLines);
      continue;
    }
    if (/^\s*-{4,}\s*$/.test(line)) {
      container.appendChild(document.createElement('hr'));
      continue;
    }
    if (/^\s*\|/.test(line)) {
      i = appendTable(container, lines, i);
      continue;
    }
    if (/^[*#]+\s+/.test(line)) {
      i = appendList(container, lines, i);
      continue;
    }
    appendParagraph(container, line.trimStart());
  }
  return container;
}

export function setJiraDescription(markup: string): boolean {
  if (hasOpenDescriptionEditor()) return false;
  const renderedPreview = renderJiraMarkup(markup);
  appendPreviewDebugLog('content-preview-render', {
    raw: markup,
    rawLength: markup.length,
    domToString: String(renderedPreview),
    domText: renderedPreview.textContent,
    domHtml: renderedPreview.outerHTML,
  });
  const previewSelectors = [
    '[data-testid="issue-description"]',
    '[data-testid="issue.views.field.rich-text.description"]',
    '#description-val .user-content-block',
    '.user-content-block',
    '[data-field-id="description"]',
  ];
  for (const selector of previewSelectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) {
      appendPreviewDebugLog('content-preview-target-before', {
        selector,
        targetToString: String(el),
        targetText: el.textContent,
        targetHtml: el.outerHTML,
      });
      el.replaceChildren(...Array.from(renderedPreview.childNodes));
      appendPreviewDebugLog('content-preview-target-after', {
        selector,
        targetToString: String(el),
        targetText: el.textContent,
        targetHtml: el.outerHTML,
      });
      return true;
    }
  }
  return false;
}

export function injectEnhanceButton(onClick: () => void): HTMLButtonElement | null {
  const header = findHeader();
  if (!header) return null;

  // Don't inject twice
  const existing = document.getElementById(BUTTON_ID);
  if (existing) return existing as HTMLButtonElement;

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.textContent = '✨ Enhance';
  Object.assign(button.style, {
    padding: '6px 12px',
    backgroundColor: '#0052CC',
    color: 'white',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    marginLeft: '8px',
  });
  button.addEventListener('click', onClick);

  header.insertAdjacentElement('afterend', button);
  return button;
}

export function removeEnhanceButton(): void {
  document.getElementById(BUTTON_ID)?.remove();
}

export function updateButtonState(state: 'ready' | 'loading' | 'done' | 'error'): void {
  const button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button) return;

  switch (state) {
    case 'ready':
      button.textContent = '✨ Enhance';
      button.style.backgroundColor = '#0052CC';
      button.disabled = false;
      break;
    case 'loading':
      button.textContent = '⏳ Enhancing...';
      button.style.backgroundColor = '#6B778C';
      button.disabled = true;
      break;
    case 'done':
      button.textContent = '✅ Enhanced';
      button.style.backgroundColor = '#00875A';
      button.disabled = false;
      break;
    case 'error':
      button.textContent = '❌ Error';
      button.style.backgroundColor = '#DE350B';
      button.disabled = false;
      break;
  }
}
