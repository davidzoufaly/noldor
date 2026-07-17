// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { renderLayout, repoDisplayName } from '../layout.js';

describe('repoDisplayName — brand derived from repo folder name', () => {
  it('upper-cases the first letter of the basename', () => {
    expect(repoDisplayName('/home/dev/charuy')).toBe('Charuy');
    expect(repoDisplayName('/home/dev/noldor')).toBe('Noldor');
  });

  it('tolerates a trailing slash on the path', () => {
    expect(repoDisplayName('/home/dev/charuy/')).toBe('Charuy');
  });

  it('falls back to Noldor for an empty basename', () => {
    expect(repoDisplayName('/')).toBe('Noldor');
  });
});

describe('renderLayout — brand mark', () => {
  it('renders the supplied brand in the top-nav', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null, brand: 'Charuy' });
    expect(html).toContain(
      '<a class="brand" href="/"><span class="mark" aria-hidden="true">◆</span>Charuy</a>',
    );
  });

  it('escapes the brand text', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null, brand: '<script>' });
    expect(html).not.toContain('<script>◆');
    expect(html).toContain('&lt;script&gt;');
  });

  it('defaults the brand to the repo display name when none supplied', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toContain(`◆</span>${repoDisplayName()}</a>`);
  });
});
