// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { loadReleaseNotes } from '../data.js';
import { renderLayout } from '../layout.js';
import { renderReleaseNotes } from '../views.js';

describe('loadReleaseNotes', () => {
  it('returns the rendered body of docs/release-notes.md', async () => {
    const notes = await loadReleaseNotes();
    expect(notes.bodyHtml).toContain('<h1>Release Notes</h1>');
    expect(notes.bodyHtml).toContain('v0.3.0');
  });
});

describe('renderReleaseNotes', () => {
  it('wraps body in .body for markdown styling', async () => {
    const html = renderReleaseNotes(await loadReleaseNotes());
    expect(html).toContain('class="body"');
    expect(html).toContain('docs/release-notes.md');
  });
});

describe('layout — Releases nav entry', () => {
  it('renders the Releases link', () => {
    const html = renderLayout({ title: 't', body: '', activeNav: null });
    expect(html).toContain('href="/release-notes"');
    expect(html).toContain('>Releases<');
  });
});
