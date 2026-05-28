// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import {
  loadFrameworkPage,
  loadFrameworkPages,
  loadUserDoc,
  loadUserDocs,
  rewriteDocLinks,
} from '../data.js';
import {
  renderFrameworkIndex,
  renderFrameworkPage,
  renderUserDoc,
  renderUserDocsIndex,
} from '../views.js';

describe('loadFrameworkPages', () => {
  it('returns all docs/noldor/*.md files (excluding README) with parsed metadata', async () => {
    const pages = await loadFrameworkPages();
    expect(pages.length).toBeGreaterThanOrEqual(14);
    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain('lifecycle');
    expect(slugs).toContain('complexity-gating');
    expect(slugs).toContain('engineering-principles');
    expect(slugs).not.toContain('README');
  });

  it('orders pages by route-table sequence from README.md, not alphabetical', async () => {
    const pages = await loadFrameworkPages();
    const order = pages.map((p) => p.slug);
    const lifecycleIdx = order.indexOf('lifecycle');
    const complexityIdx = order.indexOf('complexity-gating');
    const adoptionIdx = order.indexOf('adoption-guide');
    expect(lifecycleIdx).toBeLessThan(complexityIdx);
    expect(complexityIdx).toBeLessThan(adoptionIdx);
  });

  it('exposes page title from the first H1 of each file', async () => {
    const pages = await loadFrameworkPages();
    const lifecycle = pages.find((p) => p.slug === 'lifecycle');
    expect(lifecycle?.title).toBe('Lifecycle');
  });
});

describe('renderFrameworkIndex', () => {
  it('renders one row per page with link to /framework/<slug>', async () => {
    const html = renderFrameworkIndex(await loadFrameworkPages());
    expect(html).toContain('<h1>Framework</h1>');
    expect(html).toContain('href="/framework/lifecycle"');
    expect(html).toContain('href="/framework/complexity-gating"');
    expect(html).toContain('Lifecycle');
  });
});

describe('rewriteDocLinks', () => {
  it('rewrites a same-dir <a href="lifecycle.md"> from docs/noldor to /framework/lifecycle', () => {
    const html = '<a href="lifecycle.md">Lifecycle</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toContain('href="/framework/lifecycle"');
  });

  it('preserves anchor-only links (#section)', () => {
    const html = '<a href="#body-sections">jump</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toContain('href="#body-sections"');
  });

  it('preserves absolute external URLs', () => {
    const html = '<a href="https://example.com/x.md">ext</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toContain('href="https://example.com/x.md"');
  });

  it('rewrites cross-corpus links from noldor to /docs paths', () => {
    const html = '<a href="../user/how-to/save-and-load-a-scene.md">how-to</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toContain(
      'href="/docs/how-to/save-and-load-a-scene"',
    );
  });

  it('rewrites sibling-category links inside user docs (tutorials → how-to)', () => {
    const html = '<a href="../how-to/save-and-load-a-scene.md">how-to</a>';
    expect(rewriteDocLinks(html, 'docs/user/tutorials')).toContain(
      'href="/docs/how-to/save-and-load-a-scene"',
    );
  });

  it('rewrites user-doc links to /features for ../../features/<slug>.md', () => {
    const html = '<a href="../../features/auto-save.md">Auto-save</a>';
    expect(rewriteDocLinks(html, 'docs/user/tutorials')).toContain('href="/features/auto-save"');
  });

  it('preserves anchor on rewritten cross-page links', () => {
    const html = '<a href="feature-md-schema.md#body-sections">body</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toContain(
      'href="/framework/feature-md-schema#body-sections"',
    );
  });

  it('passes through links to corpora not surfaced by the dashboard (e.g. ../backlog.md)', () => {
    const html = '<a href="../backlog.md">backlog</a>';
    expect(rewriteDocLinks(html, 'docs/noldor')).toBe(html);
  });

  it('rewrites absolute github.com blob URLs to /features/<slug> (Feature page links in release-notes.md)', () => {
    const html =
      '<a href="https://github.com/davidzoufaly/charuy/blob/main/docs/features/auto-save.md">Feature page</a>';
    // sourceDir doesn't matter for absolute URLs — the rewrite is pure pattern match.
    expect(rewriteDocLinks(html, '')).toContain('href="/features/auto-save"');
    expect(rewriteDocLinks(html, '')).not.toContain('github.com');
  });

  it('preserves anchors on rewritten github URLs', () => {
    const html =
      '<a href="https://github.com/davidzoufaly/charuy/blob/main/docs/features/auto-save.md#agent-api">api</a>';
    expect(rewriteDocLinks(html, '')).toContain('href="/features/auto-save#agent-api"');
  });

  it('passes through github URLs that do not target docs/features/<slug>.md', () => {
    const html =
      '<a href="https://github.com/davidzoufaly/charuy/blob/main/README.md">repo readme</a>';
    expect(rewriteDocLinks(html, '')).toBe(html);
  });
});

describe('loadFrameworkPage', () => {
  it('returns null for an unknown slug', async () => {
    expect(await loadFrameworkPage('definitely-not-a-page')).toBeNull();
  });

  it('returns rendered HTML body for a real page', async () => {
    const page = await loadFrameworkPage('lifecycle');
    expect(page).not.toBeNull();
    expect(page!.bodyHtml).toContain('<h1');
    expect(page!.title).toBe('Lifecycle');
  });
});

describe('renderFrameworkPage', () => {
  it('wraps the rendered body in .body for markdown styling', async () => {
    const page = await loadFrameworkPage('lifecycle');
    const html = renderFrameworkPage(page!);
    expect(html).toContain('class="body"');
    expect(html).toContain('<h1>Lifecycle</h1>');
  });

  it('rewrites internal markdown links to /framework routes (complexity-gating → feature-md-schema)', async () => {
    const page = await loadFrameworkPage('complexity-gating');
    const html = renderFrameworkPage(page!);
    expect(html).toMatch(/href="\/framework\/feature-md-schema/);
  });

  it('exposes a back link to the framework index', async () => {
    const page = await loadFrameworkPage('lifecycle');
    const html = renderFrameworkPage(page!);
    expect(html).toContain('href="/framework"');
  });
});

describe('loadUserDocs', () => {
  it('returns the four Diátaxis categories in canonical order', async () => {
    const docs = await loadUserDocs();
    expect(docs.map((c) => c.category)).toEqual([
      'tutorials',
      'how-to',
      'reference',
      'explanation',
    ]);
  });

  it('includes top-level .md files per category', async () => {
    const docs = await loadUserDocs();
    const tutorials = docs.find((c) => c.category === 'tutorials')!;
    const slugs = tutorials.docs.map((d) => d.slug);
    expect(slugs).toContain('your-first-shape');
    expect(slugs).toContain('export-for-3d-printing');
  });

  it('filters out generated index.md files (e.g. how-to/index.md)', async () => {
    const docs = await loadUserDocs();
    const howTo = docs.find((c) => c.category === 'how-to')!;
    expect(howTo.docs.map((d) => d.slug)).not.toContain('index');
  });

  it('excludes the reference/api/ typedoc subtree', async () => {
    const docs = await loadUserDocs();
    const reference = docs.find((c) => c.category === 'reference')!;
    const slugs = reference.docs.map((d) => d.slug);
    expect(slugs).not.toContain('api');
    expect(slugs.every((s) => !s.startsWith('api/'))).toBe(true);
  });

  it('exposes title from each doc’s first H1', async () => {
    const docs = await loadUserDocs();
    const tutorials = docs.find((c) => c.category === 'tutorials')!;
    const yfs = tutorials.docs.find((d) => d.slug === 'your-first-shape');
    expect(yfs?.title).toBe('Your First Shape');
  });
});

describe('renderUserDocsIndex', () => {
  it('renders all categories as grouped sections with per-category counts', async () => {
    const all = await loadUserDocs();
    const html = renderUserDocsIndex(all, { category: '' });
    expect(html).toContain('<h1>Docs</h1>');
    // Filter form is rendered.
    expect(html).toContain('<form class="filters"');
    expect(html).toContain('name="category"');
    // Each non-empty category becomes a `<h2>Category (N)</h2>` section.
    for (const c of all.filter((cat) => cat.docs.length > 0)) {
      expect(html).toContain(`<h2>${c.category} (${c.docs.length})</h2>`);
    }
    // Doc links go directly to /docs/<category>/<slug>, not the old per-category index.
    const tutorials = all.find((c) => c.category === 'tutorials');
    if (tutorials && tutorials.docs.length > 0) {
      const slug = tutorials.docs[0].slug;
      expect(html).toContain(`href="/docs/tutorials/${slug}"`);
    }
  });

  it('filters to the selected category when filters.category is set', async () => {
    const all = await loadUserDocs();
    const html = renderUserDocsIndex(all, { category: 'tutorials' });
    expect(html).toContain('<h2>tutorials (');
    // Other categories must not render headings when filtered out.
    expect(html).not.toContain('<h2>how-to (');
    expect(html).not.toContain('<h2>reference (');
    expect(html).not.toContain('<h2>explanation (');
  });

  it('renders the empty state when filter matches no docs', async () => {
    const all = await loadUserDocs();
    const html = renderUserDocsIndex(all, { category: 'does-not-exist' });
    expect(html).toContain('class="empty"');
    expect(html).toContain('No matching docs.');
  });

  it('keeps the selected option marked as selected in the dropdown', async () => {
    const all = await loadUserDocs();
    const html = renderUserDocsIndex(all, { category: 'how-to' });
    expect(html).toContain('value="how-to" selected');
  });
});

describe('loadUserDoc', () => {
  it('returns null for unknown category', async () => {
    expect(await loadUserDoc('not-a-category', 'whatever')).toBeNull();
  });

  it('returns null for unknown slug within a known category', async () => {
    expect(await loadUserDoc('tutorials', 'not-a-doc')).toBeNull();
  });

  it('returns rendered HTML body for a known doc', async () => {
    const doc = await loadUserDoc('tutorials', 'your-first-shape');
    expect(doc).not.toBeNull();
    expect(doc!.bodyHtml).toContain('<h1');
  });

  it('rewrites internal cross-corpus links to /features routes', async () => {
    // your-first-shape.md links to ../../features/<slug>.md repeatedly
    const doc = await loadUserDoc('tutorials', 'your-first-shape');
    expect(doc!.bodyHtml).toMatch(/href="\/features\/[a-z0-9-]+/);
  });
});

describe('renderUserDoc', () => {
  it('wraps body in .body class for markdown styling', async () => {
    const doc = await loadUserDoc('tutorials', 'your-first-shape');
    expect(renderUserDoc('tutorials', doc!)).toContain('class="body"');
  });

  it('shows back link to the docs index', async () => {
    const doc = await loadUserDoc('tutorials', 'your-first-shape');
    const html = renderUserDoc('tutorials', doc!);
    expect(html).toContain('href="/docs"');
  });
});

describe('dashboard nav includes Framework and Docs', () => {
  it('renders the Framework link', async () => {
    const { renderLayout } = await import('../layout.js');
    expect(renderLayout({ title: 't', body: '', activeNav: null })).toContain('href="/framework"');
  });

  it('renders the Docs link', async () => {
    const { renderLayout } = await import('../layout.js');
    expect(renderLayout({ title: 't', body: '', activeNav: null })).toContain('href="/docs"');
  });
});
