import { describe, expect, it } from 'vitest';
import { jiraMarkupToMarkdown } from '../src/jira-markup-to-markdown.js';
import { markdownToJiraMarkup } from '../src/markdown-to-jira-markup.js';

describe('markdownToJiraMarkup', () => {
  it('converts headings, bold, italic, links, images, and rules', () => {
    expect(
      markdownToJiraMarkup(`# Title

This is **bold**, *italic*, [link](https://example.com), and ![alt](https://img.test/a.png).

---`),
    ).toBe(
      `h1. Title

This is *bold*, _italic_, [link|https://example.com], and !https://img.test/a.png|alt=alt!.

----`,
    );
  });

  it('converts fenced code blocks with languages', () => {
    expect(markdownToJiraMarkup('```bash\necho hi\n```')).toBe('{code:bash}\necho hi\n{code}');
    expect(markdownToJiraMarkup('```\nplain\n```')).toBe('{code}\nplain\n{code}');
  });

  it('converts nested bullet and ordered lists', () => {
    expect(markdownToJiraMarkup('- A\n  - B\n1. First\n  2. Second')).toBe(
      '* A\n** B\n# First\n## Second',
    );
  });

  it('converts markdown tables to Jira wiki tables', () => {
    expect(markdownToJiraMarkup('| Name | Age |\n| --- | --- |\n| Alice | 30 |')).toBe(
      '||Name||Age||\n|Alice|30|',
    );
  });

  it('converts inline code, strike, underline, citation, superscript, subscript, and blockquotes', () => {
    expect(
      markdownToJiraMarkup(
        '> Use `code`, ~~strike~~, <u>under</u>, <cite>cite</cite>, <sup>sup</sup>, and <sub>sub</sub>.',
      ),
    ).toBe('bq. Use {{code}}, -strike-, +under+, ??cite??, ^sup^, and ~sub~.');
  });

  it('converts special links, anchors, color spans, and preserves emoticons', () => {
    expect(
      markdownToJiraMarkup(
        '<https://example.com> <mailto:user@example.com> [#here](#here) [^file.txt] <a id="here"></a> <span style="color:red">red</span> :) (y) (flag)',
      ),
    ).toBe(
      '[https://example.com] [mailto:user@example.com] [#here] [^file.txt] {anchor:here} {color:red}red{color} :) (y) (flag)',
    );
  });
});

describe('jiraMarkupToMarkdown', () => {
  it('converts headings, inline marks, links, images, and rules', () => {
    expect(
      jiraMarkupToMarkdown(
        'h2. Title\n\nThis is *bold*, _italic_, [link|https://example.com], and !https://img.test/a.png|alt=alt!.\n\n----',
      ),
    ).toBe(
      '## Title\n\nThis is **bold**, *italic*, [link](https://example.com), and ![image](https://img.test/a.png).\n\n---',
    );
  });

  it('converts code and noformat blocks', () => {
    expect(
      jiraMarkupToMarkdown('{code:ts}\nconst x = 1;\n{code}\n\n{noformat}\nraw\n{noformat}'),
    ).toBe('```ts\nconst x = 1;\n```\n\n```\nraw\n```');
  });

  it('converts nested bullet and ordered lists', () => {
    expect(jiraMarkupToMarkdown('* A\n** B\n# First\n## Second')).toBe(
      '- A\n  - B\n1. First\n  1. Second',
    );
  });

  it('converts Jira wiki tables to markdown tables', () => {
    expect(jiraMarkupToMarkdown('|| Name || Age ||\n| Alice | 30 |')).toBe(
      '| Name | Age |\n| --- | --- |\n| Alice | 30 |',
    );
  });

  it('converts blockquotes, inline code, strike, underline, citation, superscript, and subscript', () => {
    expect(
      jiraMarkupToMarkdown('bq. Use {{code}}, -strike-, +under+, ??cite??, ^sup^, and ~sub~.'),
    ).toBe(
      '> Use `code`, ~~strike~~, <u>under</u>, <cite>cite</cite>, <sup>sup</sup>, and <sub>sub</sub>.',
    );
  });

  it('converts quote, color, panels, anchors, special links, escaping, and preserves emoticons', () => {
    expect(
      jiraMarkupToMarkdown(
        '{quote}\nquoted *strong*\n{quote}\n{color:red}\nred\n{color}\n{panel:title=Note}\nSome text\n{panel}\n{anchor:here} [#here] [^file.txt] [mailto:user@example.com] [~bob] \\{panel\\} :) (y) (flag)',
      ),
    ).toBe(
      '> quoted **strong**\n<span style="color:red">red</span>\n> **Note**\n> Some text\n<a id="here"></a> [#here](#here) [^file.txt] <mailto:user@example.com> [~bob] {panel} :) (y) (flag)',
    );
  });

  it('converts mixed nested Jira list markers', () => {
    expect(jiraMarkupToMarkdown('# a\n#* bullet\n* parent\n*# numbered')).toBe(
      '1. a\n  - bullet\n- parent\n  1. numbered',
    );
  });
});

describe('Jira markup/Markdown round trips', () => {
  it('keeps common delivery-ticket structure stable enough for Jira apply', () => {
    const markdown = `## Implementation

- Add parser
- Add tests

| Type | Needed |
| --- | --- |
| Unit | yes |

\`\`\`ts
const done = true;
\`\`\``;

    expect(jiraMarkupToMarkdown(markdownToJiraMarkup(markdown))).toBe(markdown);
  });
});
