// @tests: project-tracking-dashboard, dashboard-roadmap-drag-drop

import { describe, expect, it } from 'vitest';

import { renderLayout } from '../layout.js';

function shell(): string {
  return renderLayout({ title: 't', body: '<div class="body"><p>x</p></div>', activeNav: null });
}

describe('dashboard .body markdown styles — typography baseline', () => {
  it('scopes heading rules under .body so dashboard chrome h1/h2 stay untouched', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+h1\s*\{/);
    expect(html).toMatch(/\.body\s+h2\s*\{/);
    expect(html).toMatch(/\.body\s+h3\s*\{/);
    expect(html).toMatch(/\.body\s+h4\s*\{/);
  });

  it('gives .body paragraphs and lists comfortable line-height', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+p\s*\{[^}]*line-height/);
    expect(html).toMatch(/\.body\s+(ul|ol)\s*\{[^}]*line-height/);
  });

  it('renders blockquotes with an accent bar via border-left', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+blockquote\s*\{[^}]*border-left/);
  });

  it('shows a hover state on .body links', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+a:hover\s*\{/);
  });
});

describe('dashboard .body markdown styles — code surfaces and tables', () => {
  it('styles inline code as a chip with background + monospace', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toMatch(/\.body\s+code\s*\{[^}]*background/);
    expect(html).toMatch(/\.body\s+code\s*\{[^}]*font-family/);
  });

  it('styles fenced code blocks as a bordered block', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toMatch(/\.body\s+pre\s*\{[^}]*border/);
  });

  it('strips chip styling from code inside pre so blocks read as one surface', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toMatch(/\.body\s+pre\s+code\s*\{[^}]*background:\s*transparent/);
  });

  it('gives GFM tables visible borders and zebra rows', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toMatch(/\.body\s+table\s*\{[^}]*border-collapse/);
    expect(html).toMatch(/\.body\s+(th|td)\s*\{[^}]*border/);
    expect(html).toMatch(/\.body\s+tbody\s+tr:nth-child\(even\)/);
  });
});

describe('renderLayout combinedEtag meta', () => {
  it('emits <meta name="combined-etag"> in <head> when supplied', () => {
    const html = renderLayout({
      title: 't',
      body: '',
      activeNav: null,
      combinedEtag: 'abc:def',
    });
    expect(html).toContain('<meta name="combined-etag" content="abc:def">');
    // Meta tag belongs in <head>, before the body content.
    const headEnd = html.indexOf('</head>');
    const metaIdx = html.indexOf('<meta name="combined-etag"');
    expect(metaIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeLessThan(headEnd);
  });

  it('omits the combined-etag meta when not supplied', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).not.toContain('combined-etag');
  });

  it('html-escapes the combinedEtag value', () => {
    const html = renderLayout({
      title: 't',
      body: '',
      activeNav: null,
      combinedEtag: 'a"<>:&b',
    });
    // Should not contain a raw `"` inside the content attribute that
    // would break the meta tag's quoting.
    expect(html).toContain('content="a&quot;&lt;&gt;:&amp;b"');
  });
});
