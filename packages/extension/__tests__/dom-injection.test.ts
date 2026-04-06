// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectEnhanceButton, removeEnhanceButton, updateButtonState } from '../src/content/dom-injection.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('injectEnhanceButton', () => {
  it('creates button with correct id and text when header exists', () => {
    const header = document.createElement('div');
    header.setAttribute('data-testid', 'issue.views.issue-base.foundation.breadcrumbs.current-issue.item');
    document.body.appendChild(header);

    const onClick = vi.fn();
    const button = injectEnhanceButton(onClick);

    expect(button).not.toBeNull();
    expect(button!.id).toBe('jira-enhancer-btn');
    expect(button!.textContent).toBe('✨ Enhance');
    expect(button!.style.backgroundColor).toBe('rgb(0, 82, 204)');
  });

  it('returns null when no header found', () => {
    const onClick = vi.fn();
    const button = injectEnhanceButton(onClick);
    expect(button).toBeNull();
  });

  it('calls click handler when button is clicked', () => {
    const header = document.createElement('div');
    header.id = 'jira-issue-header';
    document.body.appendChild(header);

    const onClick = vi.fn();
    const button = injectEnhanceButton(onClick)!;
    button.click();

    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('removeEnhanceButton', () => {
  it('removes the button from the DOM', () => {
    const header = document.createElement('div');
    header.setAttribute('data-testid', 'issue-field-heading.ui.title');
    document.body.appendChild(header);

    injectEnhanceButton(vi.fn());
    expect(document.getElementById('jira-enhancer-btn')).not.toBeNull();

    removeEnhanceButton();
    expect(document.getElementById('jira-enhancer-btn')).toBeNull();
  });
});

describe('updateButtonState', () => {
  function setup(): HTMLButtonElement {
    const header = document.createElement('div');
    header.setAttribute('data-testid', 'issue.views.issue-base.foundation.breadcrumbs.current-issue.item');
    document.body.appendChild(header);
    return injectEnhanceButton(vi.fn())!;
  }

  it('sets ready state', () => {
    const button = setup();
    updateButtonState('loading'); // change away first
    updateButtonState('ready');
    expect(button.textContent).toBe('✨ Enhance');
    expect(button.style.backgroundColor).toBe('rgb(0, 82, 204)');
    expect(button.disabled).toBe(false);
  });

  it('sets loading state', () => {
    const button = setup();
    updateButtonState('loading');
    expect(button.textContent).toBe('⏳ Enhancing...');
    expect(button.style.backgroundColor).toBe('rgb(107, 119, 140)');
    expect(button.disabled).toBe(true);
  });

  it('sets done state', () => {
    const button = setup();
    updateButtonState('done');
    expect(button.textContent).toBe('✅ Enhanced');
    expect(button.style.backgroundColor).toBe('rgb(0, 135, 90)');
    expect(button.disabled).toBe(false);
  });

  it('sets error state', () => {
    const button = setup();
    updateButtonState('error');
    expect(button.textContent).toBe('❌ Error');
    expect(button.style.backgroundColor).toBe('rgb(222, 53, 11)');
    expect(button.disabled).toBe(false);
  });
});
