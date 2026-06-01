import { prependToReleaseNotes, renderReleaseNotesEntry } from '../release-notes.js';
import type { ReleaseNotesFeature } from '../release-notes.js';

describe(renderReleaseNotesEntry, () => {
  it('groups features by category and renders feature page link', async () => {
    const features: ReleaseNotesFeature[] = [
      {
        category: 'Core',
        kind: 'introduced',
        name: '3MF Export',
        changelogBlock: null,
        slug: '3mf-export',
        summaryFirstParagraph:
          '3MF format export for richer 3D print metadata — embeds color, units, and assembly structure that plain STL discards.',
      },
      {
        category: 'Tooling',
        kind: 'introduced',
        name: 'Adaptive Grid',
        changelogBlock: null,
        slug: 'adaptive-grid',
        summaryFirstParagraph: 'Density changes with zoom.',
      },
    ];

    const entry = await renderReleaseNotesEntry({
      date: '2026-05-12',
      features,
      version: '0.2.0',
    });

    expect(entry).toContain('## v0.2.0 — 2026-05-12');
    expect(entry).toContain('### Core');
    expect(entry).toContain('### Tooling');
    expect(entry).toContain('#### 3MF Export');
    expect(entry).toContain('3MF format export for richer 3D print metadata');
    expect(entry).toContain('[Feature page](/features/3mf-export)');
    expect(entry).not.toMatch(/github\.com/);
    expect(entry).toContain('#### Adaptive Grid');
    expect(entry).toContain('Density changes with zoom.');
    expect(entry.indexOf('### Core')).toBeLessThan(entry.indexOf('### Tooling'));
  });

  it('marks updated features with a tag', async () => {
    const entry = await renderReleaseNotesEntry({
      date: '2026-05-20',
      features: [
        {
          category: 'Tooling',
          slug: 'undo-redo',
          name: 'Undo/Redo',
          summaryFirstParagraph: 'Snapshot-based undo/redo.',
          changelogBlock:
            '### 0.2.1\n\n#### Summary\n\nAdded step limit.\n\n#### Commits\n\n- feat: added step limit',
          kind: 'updated',
        },
      ],
      version: '0.2.1',
    });
    expect(entry).toContain('#### Undo/Redo *(updated)*');
  });

  it('produces a compact "no user-facing features" entry when features array empty', async () => {
    const entry = await renderReleaseNotesEntry({
      date: '2026-05-20',
      features: [],
      version: '0.2.1',
    });
    expect(entry).toContain('## v0.2.1 — 2026-05-20');
    expect(entry).toContain('No user-facing feature changes');
  });
});

describe('renderReleaseNotesEntry — updated entries fall back to FD Summary, never commits', () => {
  it('renders updated entries using changelog #### Summary when present (overrides FD Summary)', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.2.0',
      date: '2026-05-08',
      features: [
        {
          slug: 'foo',
          name: 'Foo',
          category: 'Tooling',
          summaryFirstParagraph: 'FD-level summary that the changelog Summary should override.',
          kind: 'updated',
          changelogBlock:
            '### v0.2.0 — 2026-05-08\n\n#### Summary\n\nVersion-specific note.\n\n#### Commits\n\n- feat: thing ([abc123def456](https://x/commit/abc123def456))',
        },
      ],
    });
    expect(out).toContain('Version-specific note.');
    expect(out).not.toContain('FD-level summary');
    // Commits never appear in release-notes output, even when present in the changelog block.
    expect(out).not.toMatch(/abc123def456/);
  });

  it('falls back to FD ## Summary first paragraph when changelog has no #### Summary (no commit bullets)', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.2.0',
      date: '2026-05-08',
      features: [
        {
          slug: 'foo',
          name: 'Foo',
          category: 'Tooling',
          summaryFirstParagraph: 'FD-level summary as the fallback.',
          kind: 'updated',
          changelogBlock:
            '### v0.2.0 — 2026-05-08\n\n- feat: added a thing ([abc123def456](https://x/commit/abc123def456))',
        },
      ],
    });
    expect(out).toContain('FD-level summary as the fallback.');
    expect(out).not.toContain('- feat: added a thing');
    expect(out).not.toMatch(/abc123def456/);
  });

  it('renders introduced entries with the Summary as before', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.1.0',
      date: '2026-05-08',
      features: [
        {
          slug: 'foo',
          name: 'Foo',
          category: 'Tooling',
          summaryFirstParagraph: 'Initial feature description.',
          kind: 'introduced',
          changelogBlock: null,
        },
      ],
    });
    expect(out).toContain('Initial feature description.');
  });

  it('renders introduced entries using changelog #### Summary when present (overrides FD Summary)', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.4.0',
      date: '2026-05-11',
      features: [
        {
          slug: 'noldor',
          name: 'Noldor Framework',
          category: 'Tooling',
          summaryFirstParagraph: 'FD-level summary describing the broader feature vision.',
          kind: 'introduced',
          changelogBlock:
            '### 0.4.0\n\n#### Summary\n\nVersion-specific release note for the initial cut.\n\n#### PRs\n\n- feat: thing ([#1](https://x/pulls/1))',
        },
      ],
    });
    expect(out).toContain('Version-specific release note for the initial cut.');
    expect(out).not.toContain('FD-level summary describing the broader feature vision.');
    expect(out).not.toMatch(/#1/);
  });

  it('renders introduced entries using Initial Release block #### Summary when present', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.1.0',
      date: '2026-05-08',
      features: [
        {
          slug: 'foo',
          name: 'Foo',
          category: 'Tooling',
          summaryFirstParagraph: 'FD-level summary.',
          kind: 'introduced',
          changelogBlock:
            '### Initial Release (v0.1.0)\n\n#### Summary\n\nInitial-release note from the changelog block.\n\n#### PRs\n\n- feat: bootstrap',
        },
      ],
    });
    expect(out).toContain('Initial-release note from the changelog block.');
    expect(out).not.toContain('FD-level summary.');
  });

  it('falls back to FD ## Summary when introduced changelog block has no #### Summary', async () => {
    const out = await renderReleaseNotesEntry({
      version: '0.4.0',
      date: '2026-05-11',
      features: [
        {
          slug: 'bar',
          name: 'Bar',
          category: 'Tooling',
          summaryFirstParagraph: 'FD-level summary as the fallback.',
          kind: 'introduced',
          changelogBlock: '### 0.4.0\n\n#### PRs\n\n- feat: thing',
        },
      ],
    });
    expect(out).toContain('FD-level summary as the fallback.');
  });
});

describe(prependToReleaseNotes, () => {
  it('inserts after H1 like CHANGELOG', () => {
    const existing = `# Release Notes

## v0.1.0 — 2026-04-14

Initial release.
`;
    const result = prependToReleaseNotes(existing, '## v0.2.0 — 2026-05-12\n\nThings shipped.\n');
    expect(result).toMatch(/^# Release Notes\n\n## v0\.2\.0/);
    expect(result).toContain('## v0.1.0 — 2026-04-14');
  });

  it('creates file structure when empty', () => {
    const result = prependToReleaseNotes('', '## v0.1.0 — 2026-04-14\n\nFirst\n');
    expect(result).toMatch(/^# Release Notes\n\n## v0\.1\.0/);
  });
});
