// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { loadReleaseNotes } from '../data.js';
import { renderLayout } from '../layout.js';
import { renderReleaseNotes } from '../views.js';

describe('loadReleaseNotes', () => {
  it('renders a placeholder until the first release generates docs/release-notes.md', async () => {
    // noldor has not cut a release yet, so docs/release-notes.md does not exist
    // and loadReleaseNotes degrades to a placeholder instead of throwing.
    const notes = await loadReleaseNotes();
    expect(notes.bodyHtml).toContain('No release notes yet');
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
