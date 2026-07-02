// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadReleaseNotes, setDocRootsOverride } from '../data.js';
import { renderLayout } from '../layout.js';
import { renderReleaseNotes } from '../views.js';

// loadReleaseNotes reads docs/release-notes.md from the doc root. These tests
// pin a temp fixture root via setDocRootsOverride so they assert the load
// behaviour hermetically rather than coupling to the live repo's release state.
describe('loadReleaseNotes (fixture)', () => {
  afterEach(() => {
    setDocRootsOverride(undefined);
  });

  it('degrades to a placeholder when docs/release-notes.md is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'relnotes-absent-'));
    try {
      setDocRootsOverride(root);
      const notes = await loadReleaseNotes();
      expect(notes.bodyHtml).toContain('No release notes yet');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('renders the file content once a release has generated docs/release-notes.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'relnotes-present-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(
        join(root, 'docs', 'release-notes.md'),
        '# Release Notes\n\n## v0.2.0 — 2026-06-01\n\n### Tooling\n\nbody\n',
      );
      setDocRootsOverride(root);
      const notes = await loadReleaseNotes();
      expect(notes.bodyHtml).toContain('Release Notes');
      expect(notes.bodyHtml).not.toContain('No release notes yet');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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
