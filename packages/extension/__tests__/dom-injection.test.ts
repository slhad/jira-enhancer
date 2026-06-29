// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractJiraDescription,
  injectEnhanceButton,
  removeEnhanceButton,
  setJiraDescription,
  updateButtonState,
} from '../src/content/dom-injection.js';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('description helpers', () => {
  it('extracts Markdown-ish text from Jira description DOM', () => {
    document.body.innerHTML = `
      <div data-testid="issue-description">
        <p>As a user, I want to log in.</p>
        <h3>Acceptance Criteria</h3>
        <ul><li>User can enter email and password</li><li>Invalid credentials show an error</li></ul>
      </div>
    `;

    expect(extractJiraDescription()).toBe(
      'As a user, I want to log in.\n\n### Acceptance Criteria\n\n- User can enter email and password\n- Invalid credentials show an error',
    );
  });

  it('extracts heading levels, links, and image markdown from rendered Jira content', () => {
    const img = document.createElement('img');
    img.src = '';
    img.title = 'Fallback title';
    document.body.innerHTML = `
      <div data-testid="issue-description">
        <h1>Epic title</h1>
        <h2>Section title</h2>
        <a>Plain link</a>
        <a href="https://example.test/doc">Doc</a>
        <img src="https://example.test/image.png" alt="Architecture" />
      </div>
    `;
    document.querySelector('[data-testid="issue-description"]')?.appendChild(img);

    expect(extractJiraDescription()).toBe(
      '# Epic title\n\n## Section title\n\nPlain link [Doc](https://example.test/doc) ![Architecture](https://example.test/image.png) ![Fallback title](http://localhost:3000/)',
    );
  });

  it('extracts links and image markdown from rendered Jira content', () => {
    document.body.innerHTML = `
      <div data-testid="issue-description">
        <a href="https://example.test/doc">Doc</a>
        <img src="https://example.test/image.png" alt="Architecture" />
        <img title="Fallback title" />
      </div>
    `;

    expect(extractJiraDescription()).toBe(
      '[Doc](https://example.test/doc) ![Architecture](https://example.test/image.png)',
    );
  });

  it('returns empty string when no description is found', () => {
    expect(extractJiraDescription()).toBe('');
  });

  it('renders Jira markup preview when target exists', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(
      setJiraDescription('h3. New description\n\n  h4. 1. RDS follow-up\n\nThis is *important*'),
    ).toBe(true);
    const target = document.querySelector('[data-testid="issue-description"]');
    expect(target?.querySelector('h3')?.textContent).toBe('New description');
    expect(target?.querySelector('h4')?.textContent).toBe('1. RDS follow-up');
    expect(target?.querySelector('b')?.textContent).toBe('important');
  });

  it('renders Jira lists and code blocks in preview', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(setJiraDescription('* first\n* second\n\n{code}\nconst x = 1;\n{code}')).toBe(true);
    const target = document.querySelector('[data-testid="issue-description"]');
    expect(Array.from(target?.querySelectorAll('li') ?? []).map((li) => li.textContent)).toEqual([
      'first',
      'second',
    ]);
    expect(target?.querySelector('pre')?.textContent?.trim()).toBe('const x = 1;');
  });

  it('renders Jira wiki tables, nested ordered lists, and noformat blocks', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(
      setJiraDescription(
        '# Numbered 1\n## Sub number 1.1\n# Numbered 2\n\n||Heading 1||Heading 2||\n|Col A1|Col A2|\n\n{noformat}\n*no* formatting\n{noformat}',
      ),
    ).toBe(true);
    const target = document.querySelector('[data-testid="issue-description"]');
    expect(target?.querySelector('ol ol li')?.textContent).toBe('Sub number 1.1');
    expect(target?.querySelector('th')?.textContent).toBe('Heading 1');
    expect(target?.querySelector('td')?.textContent).toBe('Col A1');
    expect(target?.querySelector('.preformatted pre')?.textContent?.trim()).toBe('*no* formatting');
  });

  it('renders converter smoke test syntax close to Jira server DOM', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(
      setJiraDescription(`h2. Converter smoke test

This is *strong*, _emphasis_, ??citation??, -deleted-, +inserted+, ^superscript^, ~subscript~, and {{monospaced}}.

[Atlassian|https://atlassian.com] [#anchor] [^attachment.ext] [~username]
[mailto:user@example.com]

{anchor:anchor}
{color:red}
red text
{color}

* bullet
** nested bullet
# numbered
#* mixed bullet

* a
* bulleted
*# with
*# nested
*# numbered
* list

||Heading 1||Heading 2||
|Cell A|Cell B|

{code:ts}
const ok = true;
{code}

:) (y) (flag)`),
    ).toBe(true);

    const target = document.querySelector('[data-testid="issue-description"]')!;
    expect(target.querySelector('h2')?.textContent).toBe('Converter smoke test');
    expect(target.querySelector('b')?.textContent).toBe('strong');
    expect(target.querySelector('em')?.textContent).toBe('emphasis');
    expect(target.querySelector('cite')?.textContent).toBe('citation');
    expect(target.querySelector('del')?.textContent).toBe('deleted');
    expect(target.querySelector('ins')?.textContent).toBe('inserted');
    expect(target.querySelector('sup')?.textContent).toBe('superscript');
    expect(target.querySelector('sub')?.textContent).toBe('subscript');
    expect(target.querySelector('tt')?.textContent).toBe('monospaced');
    expect(target.querySelector('a[href="https://atlassian.com"]')?.textContent).toBe('Atlassian');
    expect(target.querySelector('a[href="#anchor"]')?.textContent).toBe('anchor');
    expect(
      target.querySelector('a[href="mailto:user@example.com"]')?.textContent,
    ).toBe('user@example.com');
    expect(target.querySelector('a.attachment-title')?.textContent).toBe('attachment.ext');
    expect(target.querySelector('a.user-hover')?.textContent).toBe('Username');
    expect(target.querySelector('a[name="anchor"]')).not.toBeNull();
    expect(target.querySelector('font[color="red"]')?.textContent).toBe('red text');
    expect(target.querySelector('ul ul li')?.textContent).toBe('nested bullet');
    expect(target.querySelector('ol ul li')?.textContent).toBe('mixed bullet');
    expect(
      Array.from(target.querySelectorAll(':scope > ol > li')).map((li) => li.textContent),
    ).toContain('numberedmixed bullet');
    expect(
      Array.from(target.querySelectorAll(':scope > ul > li')).map(
        (li) => li.childNodes[0]?.textContent,
      ),
    ).toEqual(['bullet', 'a', 'bulleted', 'list']);
    expect(
      Array.from(target.querySelectorAll(':scope > ul > li > ol > li')).map((li) => li.textContent),
    ).toEqual(['with', 'nested', 'numbered']);
    expect(target.querySelector('th')?.textContent).toBe('Heading 1');
    expect(target.querySelector('.code.panel .code-ts')?.textContent?.trim()).toBe(
      'const ok = true;',
    );
    expect(Array.from(target.querySelectorAll('img.emoticon')).map((img) => img.alt)).toEqual([
      ':)',
      '(y)',
      '(flag)',
    ]);
  });

  it('renders attachment image placeholders, external images, and orphan nested lists', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(
      setJiraDescription('!playlist.png!\n\n!https://example.test/pic.png!\n\n** orphan'),
    ).toBe(true);
    const target = document.querySelector('[data-testid="issue-description"]')!;
    expect(
      target.querySelector('.jira-enhancer-attachment-image-preview')?.getAttribute('aria-label'),
    ).toBe('playlist.png');
    expect(target.querySelector('img:not(.emoticon)')?.getAttribute('src')).toBe(
      'https://example.test/pic.png',
    );
    expect(target.querySelector('ul ul li')?.textContent).toBe('orphan');
  });

  it('renders Jira user mentions as profile links with readable labels', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(setJiraDescription('[~intacct-support]')).toBe(true);
    expect(
      document.querySelector('[data-testid="issue-description"] a.user-hover')?.textContent,
    ).toBe('Intacct Support');
  });

  it('renders inline double and triple dash symbols like Jira', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(setJiraDescription('a tripple dash --- symbol\na double dash -- symbol')).toBe(true);
    expect(document.querySelector('[data-testid="issue-description"]')?.textContent).toContain(
      'a tripple dash — symbol',
    );
    expect(document.querySelector('[data-testid="issue-description"]')?.textContent).toContain(
      'a double dash – symbol',
    );
  });

  it('renders block quote/color, panel, inline color, inline anchor, image, and additional emoticons', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(
      setJiraDescription(
        '{quote}\nquoted block\n{quote}\n\n{color:green}\ngreen text\nsecond line\n{color}\n\nbq. quoted line\n\n{panel:title=Panel title}\npanel body\n{panel}\n\ninline {color:blue}blue text{color} and {anchor:inline-anchor}\n\n!diagram.png|alt=Diagram!\n\n:( :P :D ;) (n) (i) (!) (-) (?) (flagoff)',
      ),
    ).toBe(true);

    const target = document.querySelector('[data-testid="issue-description"]')!;
    expect(Array.from(target.querySelectorAll('blockquote')).map((el) => el.textContent)).toEqual([
      'quoted block',
      'quoted line',
    ]);
    expect(target.querySelector('font[color="green"]')?.textContent).toBe('green textsecond line');
    expect(target.querySelector('.panelHeader')?.textContent).toBe('Panel title');
    expect(target.querySelector('.panelContent')?.textContent).toContain('panel body');
    expect(target.querySelector('font[color="blue"]')?.textContent).toBe('blue text');
    expect(target.querySelector('a[name="inline-anchor"]')).not.toBeNull();
    expect(
      target.querySelector('.jira-enhancer-attachment-image-preview')?.getAttribute('aria-label'),
    ).toBe('diagram.png');
    expect(Array.from(target.querySelectorAll('img.emoticon')).map((img) => img.alt)).toEqual([
      ':(',
      ':P',
      ':D',
      ';)',
      '(n)',
      '(i)',
      '(!)',
      '(-)',
      '(?)',
      '(flagoff)',
    ]);
  });

  it('renders the live Jira wiki example into equivalent preview DOM', () => {
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    const jiraMarkup = `h3. Current behavior

We have to limit password to 10 chars because of legacy system limits, when this is addressed we should re-set the normal length as we have for the reference database.

Also set back the ssl encryption, it's discarded in the local profile on the test image

h4. TEst

some code

{code:bash}
echo "is ok"
{code}

some unknown code
{code}
// some unknown code
GIBERIRSH
{code}

here is a horizontal ruler
----

no format part
{noformat}
*no* further _formatting_ is done here
{noformat}

some emote :) (/) (x) (*) (+)

* bullet item 1
** sub item 1
* bullet item 2
* bullet item 3

# Numbered 1
## Sub number 1.1
# Numbered 2
# Numbered 3

a table now :

||Heading 1||Heading 2||
|Col A1|Col A2|`;

    expect(setJiraDescription(jiraMarkup)).toBe(true);
    const target = document.querySelector('[data-testid="issue-description"]')!;

    expect(target.querySelector('h3')?.textContent).toBe('Current behavior');
    expect(target.querySelector('h4')?.textContent).toBe('TEst');
    expect(target.querySelector('.code.panel .code-bash')?.textContent?.trim()).toBe(
      'echo "is ok"',
    );
    expect(target.querySelector('.code.panel .code-java')?.textContent).toContain('GIBERIRSH');
    expect(target.querySelector('hr')).not.toBeNull();
    expect(target.querySelector('.preformatted.panel pre')?.textContent?.trim()).toBe(
      '*no* further _formatting_ is done here',
    );
    expect(Array.from(target.querySelectorAll('img.emoticon')).map((img) => img.alt)).toEqual([
      ':)',
      '(/)',
      '(x)',
      '(*)',
      '(+)',
    ]);
    expect(target.querySelector('ul ul li')?.textContent).toBe('sub item 1');
    expect(target.querySelector('ol ol li')?.textContent).toBe('Sub number 1.1');
    expect(Array.from(target.querySelectorAll('th')).map((th) => th.textContent)).toEqual([
      'Heading 1',
      'Heading 2',
    ]);
    expect(Array.from(target.querySelectorAll('td')).map((td) => td.textContent)).toEqual([
      'Col A1',
      'Col A2',
    ]);
  });

  it('logs preview details when chrome runtime is available', () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    document.body.innerHTML = '<div data-testid="issue-description">Old</div>';

    expect(setJiraDescription('h3. Logged')).toBe(true);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEBUG_LOG_REQUEST',
        source: 'content-preview-render',
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DEBUG_LOG_REQUEST',
        source: 'content-preview-target-after',
      }),
    );
  });

  it('handles markdown headings, tables without body, and malformed table-like paragraphs', () => {
    document.body.innerHTML = '<div data-field-id="description">Old</div>';

    expect(setJiraDescription('# item one\n\n||Only heading||\n\n|not a table')).toBe(true);
    const target = document.querySelector('[data-field-id="description"]')!;
    expect(target.querySelector('ol li')?.textContent).toBe('item one');
    expect(target.querySelector('th')?.textContent).toBe('Only heading');
    expect(Array.from(target.querySelectorAll('td')).map((td) => td.textContent)).toContain(
      'not a tabl',
    );
  });

  it('returns false when no preview target exists', () => {
    expect(setJiraDescription('New description')).toBe(false);
  });

  it('does not overwrite Jira while the description editor is open', () => {
    document.body.innerHTML = `
      <div id="descriptionmodule">
        <div data-testid="issue-description">Old</div>
        <textarea name="description">Draft edit</textarea>
      </div>
    `;

    expect(setJiraDescription('New description')).toBe(false);
    expect(document.querySelector('[data-testid="issue-description"]')?.textContent).toBe('Old');
  });

  it('updates the inner Jira user-content block instead of replacing the editable wrapper', () => {
    document.body.innerHTML = `
      <div id="description-val" class="editable-field">
        <div class="user-content-block">Old</div>
        <span class="overlay-icon" aria-label="Edit Description"></span>
      </div>
    `;

    expect(setJiraDescription('h4. Safe preview')).toBe(true);
    expect(document.querySelector('#description-val')).not.toBeNull();
    expect(document.querySelector('#description-val .overlay-icon')).not.toBeNull();
    expect(document.querySelector('#description-val .user-content-block h4')?.textContent).toBe(
      'Safe preview',
    );
  });

  it('does not block preview because a comment editor is open elsewhere', () => {
    document.body.innerHTML = `
      <div data-testid="issue-description">Old</div>
      <textarea class="wiki-textfield" name="comment">Comment draft</textarea>
    `;

    expect(setJiraDescription('h3. New description')).toBe(true);
    expect(document.querySelector('[data-testid="issue-description"] h3')?.textContent).toBe(
      'New description',
    );
  });
});

describe('injectEnhanceButton', () => {
  it('creates button with correct id and text when header exists', () => {
    const header = document.createElement('div');
    header.setAttribute(
      'data-testid',
      'issue.views.issue-base.foundation.breadcrumbs.current-issue.item',
    );
    document.body.appendChild(header);

    const onClick = vi.fn();
    const button = injectEnhanceButton(onClick);

    expect(button).not.toBeNull();
    expect(button!.id).toBe('jira-enhancer-btn');
    expect(button!.textContent).toBe('✨ Enhance');
    expect(button!.style.backgroundColor).toBe('rgb(0, 82, 204)');
  });

  it('returns the existing button when already injected', () => {
    const header = document.createElement('div');
    header.id = 'jira-issue-header';
    document.body.appendChild(header);

    const first = injectEnhanceButton(vi.fn());
    const second = injectEnhanceButton(vi.fn());

    expect(second).toBe(first);
    expect(document.querySelectorAll('#jira-enhancer-btn')).toHaveLength(1);
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
    header.setAttribute(
      'data-testid',
      'issue.views.issue-base.foundation.breadcrumbs.current-issue.item',
    );
    document.body.appendChild(header);
    return injectEnhanceButton(vi.fn())!;
  }

  it('does nothing when the button is missing', () => {
    expect(() => updateButtonState('ready')).not.toThrow();
  });

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
