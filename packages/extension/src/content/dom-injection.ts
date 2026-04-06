const BUTTON_ID = 'jira-enhancer-btn';

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
