// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { renderLayout } from '../layout.js';

function shell(): string {
  return renderLayout({ title: 't', body: '', activeNav: null });
}

describe('dashboard .body code surfaces — accent tint + depth', () => {
  it('tints inline code chip with --accent rgba background and accent color', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+code\s*\{[^}]*background:\s*rgba\(37,99,235/);
    expect(html).toMatch(/\.body\s+code\s*\{[^}]*color:\s*var\(--accent\)/);
    expect(html).toMatch(/\.body\s+code\s*\{[^}]*border:\s*1px\s+solid\s+rgba\(37,99,235/);
  });

  it('tints fenced code blocks with the same accent palette', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+pre\s*\{[^}]*background:\s*rgba\(37,99,235/);
  });

  it('adds subtle box-shadow on .body pre for depth', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+pre\s*\{[^}]*box-shadow/);
  });

  it('strips the chip border + accent color inside .body pre code so blocks read as one surface', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+pre\s+code\s*\{[^}]*background:\s*transparent/);
    expect(html).toMatch(/\.body\s+pre\s+code\s*\{[^}]*border:\s*0/);
    expect(html).toMatch(/\.body\s+pre\s+code\s*\{[^}]*color:\s*var\(--fg\)/);
  });
});

describe('dashboard global table polish — header tint, zebra, hover, max-width', () => {
  it('sticks thead th below the nav (top: 3rem) with solid bg + box-shadow', () => {
    const html = shell();
    expect(html).toMatch(/thead\s+th\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(html).toMatch(/thead\s+th\s*\{[^}]*position:\s*sticky/);
    expect(html).toMatch(/thead\s+th\s*\{[^}]*top:\s*3rem/);
    expect(html).toMatch(/thead\s+th\s*\{[^}]*box-shadow/);
  });

  it('zebras even tbody rows on every dashboard table', () => {
    const html = shell();
    expect(html).toMatch(
      /tbody\s+tr:nth-child\(even\)\s+td\s*\{[^}]*background:\s*rgba\(0,0,0,0\.02\)/,
    );
  });

  it('highlights row on hover with an accent tint', () => {
    const html = shell();
    expect(html).toMatch(/tbody\s+tr:hover\s+td\s*\{[^}]*background:\s*rgba\(37,99,235/);
  });

  it('caps td width and breaks long words so the Description column wraps cleanly', () => {
    const html = shell();
    expect(html).toMatch(/(^|\W)td\s*\{[^}]*max-width:\s*40rem/);
    expect(html).toMatch(/(^|\W)td\s*\{[^}]*word-break:\s*break-word/);
  });
});

describe('dashboard syntax highlighting palette', () => {
  it('emits a hljs token palette covering keyword, string, comment, number, built_in, attr', () => {
    const html = shell();
    expect(html).toMatch(/\.hljs-keyword[^{]*\{[^}]*color/);
    expect(html).toMatch(/\.hljs-string[^{]*\{[^}]*color/);
    expect(html).toMatch(/\.hljs-comment[^{]*\{[^}]*font-style:\s*italic/);
    expect(html).toMatch(/\.hljs-number[^{]*\{[^}]*color/);
    expect(html).toMatch(/\.hljs-built_in[^{]*\{[^}]*color/);
    expect(html).toMatch(/\.hljs-attr[^{]*\{[^}]*color/);
  });

  it('shifts string + number + built_in colors in dark mode', () => {
    const html = shell();
    expect(html).toMatch(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^]*?\.hljs-string[^{]*\{[^}]*color/,
    );
  });
});

describe('dashboard description column rendering', () => {
  it('scopes a small subset of .body overrides to td.description so paragraphs do not balloon row height', () => {
    const html = shell();
    expect(html).toMatch(/td\.description\s*\{[^}]*font-size/);
    expect(html).toMatch(/td\.description\s+\.body\s+p\s*\{[^}]*margin/);
  });

  it('drops sticky positioning on nested .body thead so markdown tables do not collide with the page table sticky header', () => {
    const html = shell();
    expect(html).toMatch(/\.body\s+thead\s+th\s*\{[^}]*position:\s*static/);
    expect(html).toMatch(/\.body\s+thead\s+th\s*\{[^}]*box-shadow:\s*none/);
  });
});

describe('drag.js is loaded as ES module', () => {
  it('emits <script src="/static/drag.js" type="module">', () => {
    const html = renderLayout({ title: 'x', body: '', activeNav: null });
    expect(html).toContain('<script src="/static/drag.js" type="module"></script>');
    expect(html).not.toContain('<script src="/static/drag.js" defer></script>');
  });
});

describe('filter selects share a fixed width', () => {
  it('emits a form.filters select width: 12rem rule (consistent across roadmap, backlog, features)', () => {
    const html = renderLayout({ title: 'x', body: '', activeNav: null });
    expect(html).toMatch(/form\.filters\s+select[^{]*\{[^}]*width:\s*12rem/);
  });
});

describe('description-toggle visibility CSS', () => {
  it('hides toggle by default, reveals on .has-overflow', () => {
    const html = renderLayout({ title: 'x', body: '', activeNav: null });
    expect(html).toMatch(/td\.description\s+\.description-toggle\s*\{[^}]*display:\s*none/);
    expect(html).toMatch(
      /td\.description\.has-overflow\s+\.description-toggle\s*\{[^}]*display:\s*inline-block/,
    );
  });

  it('keeps toggle visible while expanded so users can collapse', () => {
    const html = renderLayout({ title: 'x', body: '', activeNav: null });
    expect(html).toMatch(
      /td\.description\[aria-expanded="true"\]\s+\.description-toggle\s*\{[^}]*display:\s*inline-block/,
    );
  });
});
