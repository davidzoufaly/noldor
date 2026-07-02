// @tests: plan-runner
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  preflight,
  promoteExitCode,
  promoteOne,
  selectApproved,
  toPrepEntry,
} from '../prep-promote.js';

import type { FeatureDraft, StagingManifest } from '../types.js';

const ROADMAP = `# Roadmap

### Foo Bar
- area: tooling
- type: feat
- size: M
- impact: high

Does the foo.

### Big Thing
- area: tooling
- type: feat
- size: L
- impact: high

Big body.
`;

function draft(over: Partial<FeatureDraft> & Pick<FeatureDraft, 'slug'>): FeatureDraft {
  return {
    name: over.slug,
    tier: 'specs-only',
    size: 'M',
    area: 'tooling',
    deps: [],
    specFile: `.noldor/prep-batch/2026-06-10/${over.slug}.spec.md`,
    planFile: '',
    complete: true,
    summary: 's',
    confidence: 'high',
    risks: [],
    openQuestions: [],
    ...over,
  };
}

describe('toPrepEntry', () => {
  it('rebuilds the entry and uppercases size → tier', () => {
    const e = toPrepEntry(ROADMAP, 'foo-bar');
    expect(e?.tier).toBe('specs-only');
    expect(e?.size).toBe('M');
    expect(toPrepEntry(ROADMAP, 'big-thing')?.tier).toBe('full');
  });

  it('returns null when the slug is absent', () => {
    expect(toPrepEntry(ROADMAP, 'nope')).toBeNull();
  });
});

describe('selectApproved', () => {
  const manifest: StagingManifest = {
    today: '2026-06-10',
    batchDir: '.noldor/prep-batch/2026-06-10',
    entries: [
      draft({ slug: 'done-one', complete: true }),
      draft({ slug: 'half-one', complete: false }),
    ],
  };

  it('--slugs drops an explicitly-requested but incomplete slug', () => {
    const got = selectApproved(manifest, '/nope', {
      all: false,
      dryRun: false,
      ship: false,
      json: false,
      slugs: ['half-one'],
    });
    expect(got).toEqual([]);
  });

  it('--all selects only complete entries', () => {
    const got = selectApproved(manifest, '/nope', {
      all: true,
      dryRun: false,
      ship: false,
      json: false,
    });
    expect(got.map((d) => d.slug)).toEqual(['done-one']);
  });
});

describe('promoteExitCode', () => {
  it('returns 0 on clean success (promoted, none failed)', () => {
    expect(promoteExitCode(2, 0)).toBe(0);
  });
  it('returns 1 on partial failure (some promoted, some failed) — scripted callers can detect it', () => {
    expect(promoteExitCode(1, 1)).toBe(1);
  });
  it('returns 1 when all failed', () => {
    expect(promoteExitCode(0, 1)).toBe(1);
  });
  it('returns 1 when nothing was promoted', () => {
    expect(promoteExitCode(0, 0)).toBe(1);
  });
});

describe('promoteOne (temp git repo)', () => {
  const repos: string[] = [];
  afterEach(() => {
    for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'prep-promote-'));
    repos.push(dir);
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: dir });
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t.t']);
    git(['config', 'user.name', 't']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(dir, '.gitignore'), '.noldor/\n', 'utf8'); // staging is operator-local (mirrors real repo)
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'roadmap.md'), ROADMAP, 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    return dir;
  }

  function writeStagingSpec(dir: string, slug: string): void {
    const d = join(dir, '.noldor', 'prep-batch', '2026-06-10');
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, `${slug}.spec.md`),
      `# X — Design\n\n## User Story\n\nAs a dev, I want ${slug}.\n\n## Usage\n\nRun ${slug}.\n`,
      'utf8',
    );
  }

  it('promotes a specs-only feature: FD created, roadmap block removed, 2 commits, clean tree', () => {
    const dir = initRepo();
    writeStagingSpec(dir, 'foo-bar');
    const res = promoteOne(dir, '2026-06-10', draft({ slug: 'foo-bar' }));
    expect(res.status).toBe('promoted');
    expect(res.commits).toHaveLength(2); // promote + spec (no plan for specs-only)
    expect(existsSync(join(dir, 'docs', 'features', 'foo-bar.md'))).toBe(true);
    expect(readFileSync(join(dir, 'docs', 'roadmap.md'), 'utf8')).not.toContain('### Foo Bar');
    // FD User Story was lifted from the staging spec.
    expect(readFileSync(join(dir, 'docs', 'features', 'foo-bar.md'), 'utf8')).toContain(
      'As a dev, I want foo-bar.',
    );
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim(),
    ).toBe('');
  });

  it('rolls back fully when a full-tier plan is missing: status failed, roadmap UNCHANGED, no FD', () => {
    const dir = initRepo();
    writeStagingSpec(dir, 'big-thing'); // spec present, plan absent
    const before = readFileSync(join(dir, 'docs', 'roadmap.md'), 'utf8');
    const res = promoteOne(
      dir,
      '2026-06-10',
      draft({
        slug: 'big-thing',
        tier: 'full',
        size: 'L',
        planFile: '.noldor/prep-batch/2026-06-10/big-thing.plan.md',
      }),
    );
    expect(res.status).toBe('failed');
    expect(res.note).toContain('staging plan missing');
    // The major fix: nothing was written before the missing-input check.
    expect(readFileSync(join(dir, 'docs', 'roadmap.md'), 'utf8')).toBe(before);
    expect(readFileSync(join(dir, 'docs', 'roadmap.md'), 'utf8')).toContain('### Big Thing');
    expect(existsSync(join(dir, 'docs', 'features', 'big-thing.md'))).toBe(false);
  });
});

describe('preflight (temp git repo)', () => {
  const repos: string[] = [];
  afterEach(() => {
    for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'prep-preflight-'));
    repos.push(dir);
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: dir });
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t.t']);
    git(['config', 'user.name', 't']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(dir, 'tracked.txt'), 'v1\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    // Self-remote so `git fetch origin main` + the ahead check have an origin.
    git(['remote', 'add', 'origin', dir]);
    git(['fetch', '-q', 'origin', 'main']);
    return dir;
  }

  it('passes with only untracked files present', () => {
    const dir = initRepo();
    writeFileSync(join(dir, 'scratch-note.md'), 'stray artifact\n', 'utf8');
    expect(preflight(dir)).toEqual({ ok: true, note: 'clean' });
  });

  it('blocks on a modified tracked file', () => {
    const dir = initRepo();
    writeFileSync(join(dir, 'tracked.txt'), 'v2\n', 'utf8');
    expect(preflight(dir)).toEqual({ ok: false, note: 'working tree not clean' });
  });

  it('blocks on a staged file even when untracked files are also present', () => {
    const dir = initRepo();
    writeFileSync(join(dir, 'scratch-note.md'), 'stray artifact\n', 'utf8');
    writeFileSync(join(dir, 'staged.txt'), 'new\n', 'utf8');
    execFileSync('git', ['add', 'staged.txt'], { cwd: dir });
    expect(preflight(dir)).toEqual({ ok: false, note: 'working tree not clean' });
  });
});
