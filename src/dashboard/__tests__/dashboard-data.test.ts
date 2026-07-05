// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  featureSlugsForCodePath,
  hotZoneRowSchema,
  loadBacklog,
  loadBacklogWithHash,
  loadCounts,
  loadFdChangelog,
  loadFeatureDetail,
  loadFeatureGitTimestamps,
  loadFeatures,
  loadGaps,
  loadHotZones,
  loadRoadmapWithHash,
  loadSddInput,
  loadVelocity,
  loadVision,
  loadWipAge,
  mergeChangelogIntoBody,
  parseBacklogFromString,
  parseFeatureLastCommitDates,
  parseRoadmap,
  parseRoadmapFromString,
  resolveRenamePath,
  WIP_AGE_THRESHOLDS,
  wipAgeRowSchema,
} from '../data.js';

import { DEFAULT_SCAN_ROOTS } from '../../core/repo-paths.js';

import type { FeatureCommit } from '../../release/release-fd-commits.js';

const execFileP = promisify(execFile);

async function fixtureGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout.trim();
}

async function fixtureCommit(
  cwd: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(cwd, file), content, 'utf8');
  await fixtureGit(cwd, ['add', file]);
  await fixtureGit(cwd, ['commit', '-m', message]);
}

describe('parseBacklogFromString category derivation', () => {
  // Task 2 — backlog entries don't carry a `- category:` bullet; the
  // dashboard derives a user-facing category from `- area:` via the
  // shared `areaToCategory` helper. parseBacklogFromString stamps the
  // derived category on each parsed entry so the view layer can render
  // a Category column + filter without duplicating the lookup table.
  it('stamps a derived Category on every parsed backlog entry', () => {
    // Derivation uses the consumer's configured `areaCategories` map
    // (.noldor/config.json). noldor maps `tooling`→Tooling, `core`→Core.
    const raw = `### Foo Tooling Thing

- area: tooling
- type: feat

Body.

### Bar Core Thing

- area: core
- type: feat

Body.
`;
    const entries = parseBacklogFromString(raw);
    expect(entries).toHaveLength(2);
    const fooTooling = entries.find((e) => e.name === 'Foo Tooling Thing');
    const barCore = entries.find((e) => e.name === 'Bar Core Thing');
    expect(fooTooling?.category).toBe('Tooling');
    expect(barCore?.category).toBe('Core');
  });

  it('falls back to Other for unknown areas', () => {
    const raw = `### Quirky

- area: quirk

Body.
`;
    const entries = parseBacklogFromString(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('Other');
  });
});

describe('parseRoadmap', () => {
  it('returns a flat array of entries from real docs/roadmap.md', async () => {
    const result = await parseRoadmap();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('every entry has a name and area', async () => {
    const result = await parseRoadmap();
    for (const e of result) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.area.length).toBeGreaterThan(0);
    }
  });

  it('captures entries with non-empty name and area fields', async () => {
    const result = await parseRoadmap();
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((e) => typeof e.name === 'string' && e.name.length > 0)).toBe(true);
    expect(result.every((e) => typeof e.area === 'string' && e.area.length > 0)).toBe(true);
  });

  it('captures type field on at least one entry', async () => {
    const result = await parseRoadmap();
    const typed = result.find((e) => e.type !== undefined);
    expect(typed).toBeDefined();
  });

  it('captures body text on at least one entry', async () => {
    const result = await parseRoadmap();
    const withBody = result.find((e) => e.body.length > 20);
    expect(withBody).toBeDefined();
  });

  it('captures category on at least one H4 entry', async () => {
    const result = await parseRoadmap();
    const cat = result.find((e) => e.category !== undefined);
    expect(cat).toBeDefined();
  });
});

describe('parseRoadmapFromString', () => {
  it('surfaces size + impact fields from roadmap H4 blocks', () => {
    const md = `# Roadmap

### Category One

#### Entry One

- area: tooling
- type: feat
- size: M
- impact: high

Body paragraph.
`;
    const entries = parseRoadmapFromString(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe('M');
    expect(entries[0].impact).toBe('high');
  });

  it('omits size + impact when bullets absent', () => {
    const md = `# Roadmap

### Some Entry

- area: web
- type: feat

Body.
`;
    const entries = parseRoadmapFromString(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBeUndefined();
    expect(entries[0].impact).toBeUndefined();
  });
});

describe('loadFeatures', () => {
  it('parses every docs/features/*.md without throwing', async () => {
    const features = await loadFeatures();
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) {
      expect(typeof f.slug).toBe('string');
      expect(f.frontmatter.name.length).toBeGreaterThan(0);
      expect(['done', 'in-progress']).toContain(f.frontmatter.phase);
    }
  });
});

describe('parseFeatureLastCommitDates', () => {
  it('maps each feature slug to its newest commit date (first occurrence wins)', () => {
    const stdout = [
      '2026-06-10T10:00:00+02:00',
      '',
      'docs/features/foo.md',
      'docs/features/bar.md',
      '',
      '2026-06-01T09:00:00+02:00',
      '',
      'docs/features/foo.md',
      'docs/features/baz.md',
      '',
    ].join('\n');
    const map = parseFeatureLastCommitDates(stdout);
    expect(map.get('foo')).toBe('2026-06-10T10:00:00+02:00');
    expect(map.get('bar')).toBe('2026-06-10T10:00:00+02:00');
    expect(map.get('baz')).toBe('2026-06-01T09:00:00+02:00');
  });

  it('ignores non-md paths and returns an empty map for empty stdout', () => {
    expect(parseFeatureLastCommitDates('').size).toBe(0);
    const stdout = ['2026-06-10T10:00:00+02:00', '', 'docs/features/img.png', ''].join('\n');
    expect(parseFeatureLastCommitDates(stdout).size).toBe(0);
  });
});

describe('loadFeatureGitTimestamps', () => {
  it('returns a slug → ISO date map covering committed feature MDs', async () => {
    const map = await loadFeatureGitTimestamps();
    const features = await loadFeatures();
    expect(map.size).toBeGreaterThan(0);
    const dated = features.filter((f) => map.has(f.slug));
    expect(dated.length).toBeGreaterThan(0);
    for (const f of dated) {
      expect(map.get(f.slug)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('loadFeatureDetail', () => {
  it('returns frontmatter + bodyMarkdown + bodyHtml + changelog for a known feature', async () => {
    const detail = await loadFeatureDetail('framework-doc-extraction');
    expect(detail).not.toBeNull();
    if (detail === null) return;
    expect(detail.slug).toBe('framework-doc-extraction');
    expect(detail.bodyMarkdown.length).toBeGreaterThan(0);
    expect(detail.bodyHtml.length).toBeGreaterThan(0);
    expect(detail.bodyHtml).toContain('<');
    expect(detail.changelog).toBeDefined();
    expect(Array.isArray(detail.changelog.unreleased)).toBe(true);
    expect(detail.changelog.perVersion).toBeInstanceOf(Map);
  });

  it('returns null for unknown slug', async () => {
    const detail = await loadFeatureDetail('does-not-exist-anywhere');
    expect(detail).toBeNull();
  });
});

describe('loadBacklog', () => {
  it('returns parsed backlog entries from docs/backlog.md', async () => {
    const entries = await loadBacklog();
    expect(Array.isArray(entries)).toBe(true);
    for (const e of entries) {
      expect(typeof e.name).toBe('string');
      expect(typeof e.area).toBe('string');
    }
  });
});

describe('loadGaps', () => {
  it('returns flat array of gaps with category + itemId + message', async () => {
    const gaps = await loadGaps();
    expect(Array.isArray(gaps)).toBe(true);
    for (const g of gaps) {
      expect(typeof g.category).toBe('string');
      expect(typeof g.itemId).toBe('string');
      expect(typeof g.message).toBe('string');
    }
  });
});

describe('loadCounts', () => {
  it('byPhase sums to total', async () => {
    const counts = await loadCounts();
    const sum = counts.features.byPhase.done + counts.features.byPhase['in-progress'];
    expect(sum).toBe(counts.features.total);
  });

  it('skills count is a positive integer, scripts count a nonnegative integer', async () => {
    const counts = await loadCounts();
    expect(counts.skills).toBeGreaterThan(0);
    // scripts/ holds only test-contract.mjs now — every framework script
    // migrated into src/, so a zero .ts count here is correct, not a bug.
    expect(counts.scripts).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(counts.skills)).toBe(true);
    expect(Number.isInteger(counts.scripts)).toBe(true);
  });
});

describe('loadVelocity', () => {
  it('returns commits with last7d <= last30d <= last90d', async () => {
    const v = await loadVelocity();
    expect(v.commits.last7d).toBeLessThanOrEqual(v.commits.last30d);
    expect(v.commits.last30d).toBeLessThanOrEqual(v.commits.last90d);
  });

  it('returns activeWorktrees as a non-negative integer', async () => {
    const v = await loadVelocity();
    expect(Number.isInteger(v.activeWorktrees)).toBe(true);
    expect(v.activeWorktrees).toBeGreaterThanOrEqual(0);
  });

  it('returns releases newest-first and non-zero commitsSincePrev for at least one non-first release', async () => {
    const v = await loadVelocity();
    if (v.releases.length < 2) return;
    for (let i = 0; i < v.releases.length - 1; i++) {
      const newer = v.releases[i];
      const older = v.releases[i + 1];
      if (!newer || !older) continue;
      expect(newer.date >= older.date).toBe(true);
    }
    const nonFirst = v.releases.slice(0, -1);
    expect(nonFirst.some((r) => r.commitsSincePrev > 0)).toBe(true);
  });

  it('aggregates commitsByScope by the prefix before `:`', async () => {
    const v = await loadVelocity();
    for (const key of Object.keys(v.commitsByScope)) {
      expect(key.includes(':')).toBe(false);
    }
  });
});

describe('resolveRenamePath', () => {
  it('passes non-rename paths through unchanged', () => {
    expect(resolveRenamePath('src/dashboard/data.ts')).toBe('src/dashboard/data.ts');
  });

  it('resolves a braced segment rename to the new path', () => {
    expect(resolveRenamePath('src/{old.ts => new.ts}')).toBe('src/new.ts');
    expect(resolveRenamePath('{scripts => src}/cli/run.ts')).toBe('src/cli/run.ts');
  });

  it('resolves a braced rename with an empty side without double slashes', () => {
    expect(resolveRenamePath('src/{ => sub}/a.ts')).toBe('src/sub/a.ts');
    expect(resolveRenamePath('src/{sub => }/a.ts')).toBe('src/a.ts');
  });

  it('strips the stray leading slash when a top-level dir empties out', () => {
    expect(resolveRenamePath('{src => }/a.ts')).toBe('a.ts');
    expect(resolveRenamePath('{ => src}/a.ts')).toBe('src/a.ts');
  });

  it('resolves a whole-path rename to the new path', () => {
    expect(resolveRenamePath('old-name.md => new-name.md')).toBe('new-name.md');
  });
});

describe('loadHotZones', () => {
  it('returns rows that satisfy hotZoneRowSchema', async () => {
    const rows = await loadHotZones({ days: 30, limit: 10 });
    for (const row of rows) {
      expect(() => hotZoneRowSchema.parse(row)).not.toThrow();
    }
  });

  it('honors limit', async () => {
    const rows = await loadHotZones({ days: 30, limit: 3 });
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('assigns sequential ranks starting at 1', async () => {
    const rows = await loadHotZones({ days: 30, limit: 10 });
    rows.forEach((row, i) => {
      expect(row.rank).toBe(i + 1);
    });
  });

  it('sorts by changeCount descending', async () => {
    const rows = await loadHotZones({ days: 30, limit: 10 });
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].changeCount).toBeGreaterThanOrEqual(rows[i].changeCount);
    }
  });

  it('excludes lockfile and generated paths', async () => {
    const rows = await loadHotZones({ days: 90, limit: 100 });
    const paths = rows.map((r) => r.path);
    expect(paths).not.toContain('pnpm-lock.yaml');
    expect(paths.every((p) => !p.startsWith('graphify-out/'))).toBe(true);
    expect(paths).not.toContain('docs/sdd-report.md');
    expect(paths.every((p) => !p.startsWith('docs/user/reference/api/'))).toBe(true);
    expect(paths.every((p) => !p.endsWith('.original.md'))).toBe(true);
  });

  it('returns distinct authors per row', async () => {
    const rows = await loadHotZones({ days: 90, limit: 100 });
    for (const row of rows) {
      expect(new Set(row.authors).size).toBe(row.authors.length);
    }
  });

  it('populates featureSlugs as an array (possibly empty)', async () => {
    const rows = await loadHotZones({ days: 90, limit: 100 });
    for (const row of rows) {
      expect(Array.isArray(row.featureSlugs)).toBe(true);
    }
  });

  it('accumulates non-negative integer insertions and deletions per row', async () => {
    const rows = await loadHotZones({ days: 90, limit: 100 });
    expect(rows.length).toBeGreaterThan(0); // this repo always has recent churn
    for (const row of rows) {
      expect(Number.isInteger(row.insertions)).toBe(true);
      expect(Number.isInteger(row.deletions)).toBe(true);
      expect(row.insertions).toBeGreaterThanOrEqual(0);
      expect(row.deletions).toBeGreaterThanOrEqual(0);
    }
    // A multi-commit text file accrues at least one changed line in the window.
    const top = rows[0];
    expect(top.insertions + top.deletions).toBeGreaterThan(0);
  });

  it('honors days window (no row predates today minus days)', async () => {
    const days = 7;
    const rows = await loadHotZones({ days, limit: 100 });
    const cutoff = new Date(Date.now() - (days + 1) * 86_400_000);
    for (const row of rows) {
      expect(new Date(row.lastCommitDate).getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    }
  });

  it('populates featureSlugs when a tracked feature claims the path', async () => {
    const features = await loadFeatures();
    const claimedPaths = new Set(features.flatMap((f) => f.frontmatter.links.code));
    if (claimedPaths.size === 0) return;

    const rows = await loadHotZones({ days: 90, limit: 200 });
    const matched = rows.find((r) => claimedPaths.has(r.path));
    if (!matched) return; // vacuous if no recently-changed file is claimed
    expect(matched.featureSlugs.length).toBeGreaterThan(0);
  });

  it('maps directory links.code entries to nested hot-zone file paths', () => {
    const features = [
      {
        slug: 'sample-scene-gallery',
        bodyMarkdown: '',
        frontmatter: {
          area: 'web',
          category: 'Tooling',
          deps: [],
          links: {
            code: ['packages/sample-scenes', 'apps/web/src/components/gallery/'],
            commits: [],
            docs: [],
            tests: [],
          },
          name: 'Sample-Scene Gallery',
          packages: ['web', 'sample-scenes'],
          phase: 'done',
        },
      },
    ];

    expect(featureSlugsForCodePath('packages/sample-scenes/src/empty-room.ts', features)).toEqual([
      'sample-scene-gallery',
    ]);
    expect(
      featureSlugsForCodePath('apps/web/src/components/gallery/GalleryModal.tsx', features),
    ).toEqual(['sample-scene-gallery']);
  });
});

describe('renderMarkdown', () => {
  it('escapes raw HTML while preserving markdown-generated elements', async () => {
    const { renderMarkdown } = await import('../data.js');
    const html = await renderMarkdown('<script>alert(1)</script>\n\n## Safe heading');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<h2>Safe heading</h2>');
  });
});

describe('loadWipAge', () => {
  it('returns rows matching the schema, sorted by ageDays desc', async () => {
    const rows = await loadWipAge();
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) wipAgeRowSchema.parse(r);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].ageDays).toBeGreaterThanOrEqual(rows[i].ageDays);
    }
  });

  it('only includes phase: in-progress features', async () => {
    const [rows, features] = await Promise.all([loadWipAge(), loadFeatures()]);
    const inProgressSlugs = new Set(
      features.filter((f) => f.frontmatter.phase === 'in-progress').map((f) => f.slug),
    );
    for (const r of rows) {
      expect(inProgressSlugs.has(r.slug)).toBe(true);
    }
  });

  it('buckets by WIP_AGE_THRESHOLDS (fresh < 7 < aging < 14 <= stale)', async () => {
    const rows = await loadWipAge();
    for (const r of rows) {
      if (r.ageDays >= WIP_AGE_THRESHOLDS.stale) expect(r.bucket).toBe('stale');
      else if (r.ageDays >= WIP_AGE_THRESHOLDS.aging) expect(r.bucket).toBe('aging');
      else expect(r.bucket).toBe('fresh');
    }
  });

  it('bumps every row to stale when now is far in the future', async () => {
    const future = new Date(Date.now() + 365 * 86_400_000);
    const rows = await loadWipAge({ now: future });
    for (const r of rows) expect(r.bucket).toBe('stale');
  });
});

describe('loadVision', () => {
  it('parses real docs/vision.md frontmatter — current-milestone is optional string', async () => {
    const vision = await loadVision();
    const slug = vision.frontmatter['current-milestone'];
    // current-milestone is optional; when present it must be a non-empty string
    if (slug !== undefined) {
      expect(typeof slug).toBe('string');
      expect(slug.length).toBeGreaterThan(0);
    }
  });

  it('renders the body to non-empty HTML', async () => {
    const vision = await loadVision();
    expect(typeof vision.bodyHtml).toBe('string');
    expect(vision.bodyHtml.length).toBeGreaterThan(0);
    expect(vision.bodyHtml).toContain('<h2');
  });
});

describe('rewriteRelativeLinksToVscode', () => {
  it('swaps ../../ relative paths for vscode://file URLs', async () => {
    const { rewriteRelativeLinksToVscode } = await import('../data.js');
    const html = '<a href="../../scripts/foo.ts">foo.ts</a>';
    const out = rewriteRelativeLinksToVscode(html, '/home/me/repo');
    expect(out).toContain('href="vscode://file/home/me/repo/scripts/foo.ts"');
    expect(out).toContain('rel="noopener"');
  });

  it('preserves external github URLs unchanged', async () => {
    const { rewriteRelativeLinksToVscode } = await import('../data.js');
    const html = '<a href="https://github.com/x/y/commit/abc">abc</a>';
    expect(rewriteRelativeLinksToVscode(html, '/r')).toBe(html);
  });

  it('rewrites multiple anchors in the same body', async () => {
    const { rewriteRelativeLinksToVscode } = await import('../data.js');
    const html = '<a href="../../a.ts">a</a> and <a href="../../b/c.ts">c</a>';
    const out = rewriteRelativeLinksToVscode(html, '/r');
    expect(out).toContain('href="vscode://file/r/a.ts"');
    expect(out).toContain('href="vscode://file/r/b/c.ts"');
  });

  it('leaves non-../../ relative anchors alone (fragment links etc.)', async () => {
    const { rewriteRelativeLinksToVscode } = await import('../data.js');
    const html = '<a href="#summary">jump</a>';
    expect(rewriteRelativeLinksToVscode(html, '/r')).toBe(html);
  });
});

function makeCommit(sha: string, type: string, subject: string): FeatureCommit {
  return { sha, type, subject, date: '2026-05-09' };
}

describe('mergeChangelogIntoBody', () => {
  const REPO = 'https://github.com/owner/repo';

  it('returns body unchanged when changelog is empty', () => {
    const body = '## Summary\n\nFoo.\n\n## Changelog\n\n### 0.3.0\n\n#### Summary\n\nShipped.\n';
    const out = mergeChangelogIntoBody(body, { unreleased: [], perVersion: new Map() }, REPO);
    expect(out).toBe(body);
  });

  it('appends ## Changelog section when body lacks one and unreleased commits exist', () => {
    const body = '## Summary\n\nFoo.\n';
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [makeCommit('abc123def456', 'feat', 'add thing')],
        perVersion: new Map(),
      },
      REPO,
    );
    expect(out).toContain('## Changelog');
    expect(out).toContain('### Unreleased');
    expect(out).toContain('#### Commits');
    expect(out).toContain('[abc123def456](https://github.com/owner/repo/commit/abc123def456)');
    expect(out).toContain('feat: add thing');
  });

  it('injects #### Commits subsection under existing static ### <version> block', () => {
    const body =
      '## Summary\n\nFoo.\n\n## Changelog\n\n### 0.3.0\n\n#### Summary\n\nShipped a thing.\n';
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [],
        perVersion: new Map([['0.3.0', [makeCommit('aaa111bbb222', 'feat', 'shipped thing')]]]),
      },
      REPO,
    );
    expect(out).toContain('### 0.3.0');
    expect(out).toContain('Shipped a thing.');
    expect(out).toContain('#### Commits');
    expect(out).toContain('[aaa111bbb222]');
    expect(out).toContain('feat: shipped thing');
  });

  it('prepends ### Unreleased block ahead of existing version blocks', () => {
    const body = '## Changelog\n\n### 0.3.0\n\n#### Summary\n\nShipped.\n';
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [makeCommit('uuu000vvv111', 'fix', 'unrel fix')],
        perVersion: new Map([['0.3.0', []]]),
      },
      REPO,
    );
    const unrelPos = out.indexOf('### Unreleased');
    const v030Pos = out.indexOf('### 0.3.0');
    expect(unrelPos).toBeGreaterThan(-1);
    expect(v030Pos).toBeGreaterThan(-1);
    expect(unrelPos).toBeLessThan(v030Pos);
    expect(out).toContain('fix: unrel fix');
  });

  it('synthesizes ### <version> block when commits exist for a version absent from body', () => {
    const body = '## Changelog\n\n### 0.3.0\n\n#### Summary\n\nShipped.\n';
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [],
        perVersion: new Map([
          ['0.3.0', []],
          ['0.4.0', [makeCommit('xxx777yyy888', 'feat', 'added later')]],
        ]),
      },
      REPO,
    );
    expect(out).toContain('### 0.4.0');
    expect(out).toContain('_(no summary on file)_');
    expect(out).toContain('feat: added later');
    // Newest first: 0.4.0 should appear before 0.3.0.
    expect(out.indexOf('### 0.4.0')).toBeLessThan(out.indexOf('### 0.3.0'));
  });

  it('preserves static ### <version> block when no commits for that version', () => {
    const body = '## Changelog\n\n### 0.3.0\n\n#### Summary\n\nStatic only.\n';
    const out = mergeChangelogIntoBody(
      body,
      { unreleased: [], perVersion: new Map([['0.3.0', []]]) },
      REPO,
    );
    expect(out).toContain('### 0.3.0');
    expect(out).toContain('Static only.');
    // No commits → no #### Commits subsection emitted for this version.
    expect(out).not.toContain('#### Commits');
  });

  it('locates ## Changelog by line-anchored heading, not inline prose reference', () => {
    // Inline reference inside prose must NOT be mistaken for the H2 heading.
    const body = [
      '## Summary',
      '',
      'For `updated` features, the renderer prefers the per-version `## Changelog > ### <version> > #### Summary` block.',
      '',
      '## Changelog',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'Real heading.',
      '',
    ].join('\n');
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [makeCommit('aaa', 'feat', 'live commit')],
        perVersion: new Map(),
      },
      'https://github.com/owner/repo',
    );
    // The inline reference in prose must remain intact.
    expect(out).toContain('per-version `## Changelog > ### <version> > #### Summary` block.');
    // Synthesized Unreleased + commit list must come AFTER the real H2 heading,
    // not be injected into the inline prose.
    const realHeadingIdx = out.indexOf('\n## Changelog\n');
    const unrelIdx = out.indexOf('### Unreleased');
    expect(realHeadingIdx).toBeGreaterThan(-1);
    expect(unrelIdx).toBeGreaterThan(realHeadingIdx);
  });

  it('preserves head content above ## Changelog untouched', () => {
    const body =
      '## Summary\n\nKeep me.\n\n## User Story\n\nAlso me.\n\n## Changelog\n\n### 0.3.0\n\n#### Summary\n\nOld.\n';
    const out = mergeChangelogIntoBody(
      body,
      {
        unreleased: [makeCommit('aaa', 'feat', 'x')],
        perVersion: new Map(),
      },
      REPO,
    );
    expect(out).toContain('## Summary\n\nKeep me.');
    expect(out).toContain('## User Story\n\nAlso me.');
  });
});

describe('loadFdChangelog', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'fdcl-'));
    await fixtureGit(repo, ['init', '-q']);
    await fixtureGit(repo, ['config', 'user.email', 'test@test']);
    await fixtureGit(repo, ['config', 'user.name', 'Test']);
    await fixtureGit(repo, ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns empty perVersion + all-Unreleased when no tags exist', async () => {
    await fixtureCommit(repo, 'a.txt', '1', 'feat(engine:foo): one');
    const cl = await loadFdChangelog('foo', repo);
    expect(cl.perVersion.size).toBe(0);
    expect(cl.unreleased).toHaveLength(1);
    expect(cl.unreleased[0].subject).toBe('one');
  });

  it('attributes pre-tag commits to v0.1.0 bucket only (no leak across first tag)', async () => {
    await fixtureCommit(repo, 'a.txt', '1', 'feat(engine:foo): pre');
    await fixtureGit(repo, ['tag', 'v0.1.0']);
    await fixtureCommit(repo, 'b.txt', '2', 'feat(engine:foo): post');
    const cl = await loadFdChangelog('foo', repo);
    expect(cl.perVersion.get('0.1.0')?.map((c) => c.subject)).toEqual(['pre']);
    expect(cl.unreleased.map((c) => c.subject)).toEqual(['post']);
  });

  it('partitions commits across multiple tags correctly', async () => {
    await fixtureCommit(repo, 'a.txt', '1', 'feat(engine:foo): one');
    await fixtureGit(repo, ['tag', 'v0.1.0']);
    await fixtureCommit(repo, 'b.txt', '2', 'feat(engine:foo): two');
    await fixtureGit(repo, ['tag', 'v0.2.0']);
    await fixtureCommit(repo, 'c.txt', '3', 'feat(engine:foo): three');
    const cl = await loadFdChangelog('foo', repo);
    expect(cl.perVersion.get('0.1.0')?.map((c) => c.subject)).toEqual(['one']);
    expect(cl.perVersion.get('0.2.0')?.map((c) => c.subject)).toEqual(['two']);
    expect(cl.unreleased.map((c) => c.subject)).toEqual(['three']);
  });

  it('skips commits whose scope slug does not match the requested feature', async () => {
    await fixtureCommit(repo, 'a.txt', '1', 'feat(engine:foo): mine');
    await fixtureCommit(repo, 'b.txt', '2', 'feat(engine:bar): theirs');
    const cl = await loadFdChangelog('foo', repo);
    expect(cl.unreleased.map((c) => c.subject)).toEqual(['mine']);
  });

  it('iteration order: perVersion is creatordate ascending (oldest tag first)', async () => {
    await fixtureCommit(repo, 'a.txt', '1', 'feat(engine:foo): one');
    await fixtureGit(repo, ['tag', 'v0.1.0']);
    await fixtureCommit(repo, 'b.txt', '2', 'feat(engine:foo): two');
    await fixtureGit(repo, ['tag', 'v0.2.0']);
    const cl = await loadFdChangelog('foo', repo);
    expect([...cl.perVersion.keys()]).toEqual(['0.1.0', '0.2.0']);
  });
});

describe(loadRoadmapWithHash, () => {
  it('returns entries plus SHA-256 hex matching the file bytes', async () => {
    const { entries, rawHash } = await loadRoadmapWithHash();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.slug).toMatch(/^[a-z0-9-]+$/);
    const expected = createHash('sha256').update(readFileSync('docs/roadmap.md')).digest('hex');
    expect(rawHash).toBe(expected);
  });
});

describe(loadBacklogWithHash, () => {
  it('returns entries plus SHA-256 hex matching the file bytes', async () => {
    const { entries, rawHash } = await loadBacklogWithHash();
    expect(Array.isArray(entries)).toBe(true);
    expect(rawHash).toMatch(/^[a-f0-9]{64}$/);
    const expected = createHash('sha256').update(readFileSync('docs/backlog.md')).digest('hex');
    expect(rawHash).toBe(expected);
  });
});

describe('loadSddInput layout parity', () => {
  // Regression: the hardcoded packages/apps(+scripts) walk left allRepoPaths
  // empty on a standalone src/ repo and graphSrcRoots pinned to the Charuy
  // trio, so dashboard gaps diverged from sdd-report main() (post-#122).
  it('walks scanRoots() and mirrors them into graphSrcRoots on a standalone layout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'noldor-dash-standalone-'));
    await mkdir(join(dir, '.noldor'), { recursive: true });
    await writeFile(
      join(dir, '.noldor', 'config.json'),
      JSON.stringify({
        consumer: {
          name: 'acme',
          repoUrl: 'https://github.com/x/y',
          lockstepPackages: ['package.json'],
          scanPaths: [],
          boundaries: [],
          deprecatedPackages: [],
          e2ePrefix: '',
          samplesPath: '',
          packagePrefix: '',
          appPathPrefix: '',
        },
      }),
    );
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'widget.ts'), 'export const widget = 1;\n');
    await writeFile(join(dir, 'src', 'widget.test.ts'), 'export {};\n');
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const input = await loadSddInput();
      expect(input.allRepoPaths).toContain('src/widget.ts');
      expect(input.allRepoPaths).toContain('src/widget.test.ts');
      expect(input.testInputs.map((t) => t.path)).toEqual(['src/widget.test.ts']);
      expect(input.graphSrcRoots).toEqual(DEFAULT_SCAN_ROOTS);
      expect(input.actualPackages).toEqual([]);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
