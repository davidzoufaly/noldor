// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../data.js';

describe('renderMarkdown — mermaid fence handling', () => {
  it('rewrites a ```mermaid fence to <div class="mermaid"> with HTML-decoded source', async () => {
    const md = '```mermaid\nflowchart TD\n  A --> B\n```\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('<div class="mermaid">');
    expect(html).not.toContain('<pre><code class="hljs language-mermaid">');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('A --> B'); // decoded, not "A --&gt; B"
  });

  it('preserves non-mermaid fenced blocks (typescript)', async () => {
    const md = '```typescript\nconst x = 1;\n```\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('hljs language-typescript');
    expect(html).not.toContain('class="mermaid"');
  });

  it('handles multiple mermaid blocks in one document', async () => {
    const md = '```mermaid\ngraph A\n```\n\ntext\n\n```mermaid\ngraph B\n```\n';
    const html = await renderMarkdown(md);
    const matches = html.match(/<div class="mermaid">/g);
    expect(matches?.length).toBe(2);
  });
});

describe('renderLayout — mermaid client script', () => {
  it('embeds the mermaid esm CDN import as a module script', async () => {
    const { renderLayout } = await import('../layout.js');
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toMatch(/<script\s+type="module">/);
    expect(html).toContain('cdn.jsdelivr.net/npm/mermaid');
    expect(html).toContain('mermaid.initialize');
  });

  it('uses prefers-color-scheme to pick the mermaid theme', async () => {
    const { renderLayout } = await import('../layout.js');
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toContain('prefers-color-scheme');
    expect(html).toContain("'dark'");
    expect(html).toContain("'default'");
  });

  it('starts mermaid auto-rendering on page load', async () => {
    const { renderLayout } = await import('../layout.js');
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toContain('startOnLoad: true');
  });
});
