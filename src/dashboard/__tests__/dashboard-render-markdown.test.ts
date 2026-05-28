// @tests: project-tracking-dashboard

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderMarkdown } from '../data.js';
import type { PrRef } from '../../release/fd-prs-since-tag.js';

// Mock prsSinceLastTag so we don't shell git in unit tests. The helper is
// independently tested in packages/noldor/src/release/__tests__/fd-prs-since-tag.test.ts.
vi.mock('../../release/fd-prs-since-tag.js', () => ({
  prsSinceLastTag: vi.fn(),
}));

const { prsSinceLastTag } = await import('../../release/fd-prs-since-tag.js');
const mockedHelper = vi.mocked(prsSinceLastTag);

describe('renderMarkdown', () => {
  it('renders normal markdown', async () => {
    const md = '## Hello\n\n**bold** and `code`';
    const html = await renderMarkdown(md);
    expect(html).toContain('<h2>Hello</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips HTML comments', async () => {
    const md = '<!-- a comment -->\n\nVisible text';
    const html = await renderMarkdown(md);
    expect(html).not.toContain('a comment');
    expect(html).toContain('Visible text');
  });
});

describe('renderMarkdown — @prs-since-last-release marker', () => {
  beforeEach(() => {
    mockedHelper.mockReset();
  });

  it('expands marker to bullet list when helper returns ≥1 PRs', async () => {
    mockedHelper.mockResolvedValueOnce([
      { number: 7, title: 'feat(scope:foo): bar', url: 'https://github.com/example/repo/pull/7' },
      { number: 3, title: 'fix(scope:foo): baz', url: 'https://github.com/example/repo/pull/3' },
    ] satisfies PrRef[]);
    const md = '## PRs\n\n<!-- @prs-since-last-release: foo -->\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('PRs');
    expect(html).toContain('#7');
    expect(html).toContain('#3');
    expect(html).toContain('https://github.com/example/repo/pull/7');
  });

  it('strips the canonical 4-line block when helper returns 0 PRs', async () => {
    mockedHelper.mockResolvedValueOnce([]);
    const md = 'before\n\n## PRs\n\n<!-- @prs-since-last-release: foo -->\n\nafter\n';
    const html = await renderMarkdown(md);
    expect(html).not.toContain('PRs');
    expect(html).not.toContain('@prs-since-last-release');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('expands a free-floating marker without stripping any heading', async () => {
    mockedHelper.mockResolvedValueOnce([
      { number: 1, title: 'feat: x', url: 'https://github.com/example/repo/pull/1' },
    ]);
    const md = 'paragraph\n<!-- @prs-since-last-release: foo -->\nmore prose\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('#1');
    expect(html).toContain('paragraph');
    expect(html).toContain('more prose');
  });

  it('preserves heading when marker is followed by content without a blank gap', async () => {
    mockedHelper.mockResolvedValueOnce([]);
    const md = '## PRs\n\n<!-- @prs-since-last-release: foo -->\nimmediate\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('PRs');
    expect(html).not.toContain('@prs-since-last-release');
    expect(html).toContain('immediate');
  });

  it('preserves following heading when 0 PRs and ## Changelog directly follows', async () => {
    mockedHelper.mockResolvedValueOnce([]);
    const md = '## PRs\n\n<!-- @prs-since-last-release: foo -->\n## Changelog\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('Changelog');
    expect(html).not.toContain('@prs-since-last-release');
  });

  it('skips helper on the sync fast-path when no marker is present', async () => {
    const md = '## Summary\n\nsome prose\n\n## Changelog\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('Summary');
    expect(html).toContain('Changelog');
    expect(mockedHelper).not.toHaveBeenCalled();
  });
});
