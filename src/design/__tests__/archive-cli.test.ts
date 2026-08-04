// @tests: doc-gardening-skill
// Spawn-level coverage of `noldor design archive` in real temp git repos: the
// staging shapes (git mv vs untracked fs-rename), dry-run inertness, the
// fail-closed paths, and the legacy `docs/superpowers/*` transition window.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TSX = join(process.cwd(), 'node_modules/.bin/tsx');
const CLI = join(process.cwd(), 'src/design/archive-cli.ts');

const KEY = 'doc-gardening-skill-archive-at-done-flip';
const SPEC = `2026-08-04-${KEY}-design.md`;
const PLAN = `2026-08-04-${KEY}.md`;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function run(cwd: string, args: string[] = []) {
  const r = spawnSync(TSX, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

interface RepoOptions {
  /** Design subdir root; `docs/superpowers` exercises the 1.0.0 transition alias. */
  designRoot?: string;
  /** Leave the spec untracked to exercise the fs-rename branch. */
  untrackedSpec?: boolean;
  /** Session marker to write; omit for no marker. */
  session?: Record<string, unknown> | null;
  /** Also create a plan alongside the spec. */
  withPlan?: boolean;
}

function repo(options: RepoOptions = {}): string {
  const {
    designRoot = 'docs/design',
    session = {
      enhancement: 'archive-at-done-flip',
      markerVersion: 2,
      parent: 'doc-gardening-skill',
      path: 'specs-only-attach',
      startedAt: '2026-08-04T00:00:00.000Z',
    },
    untrackedSpec = false,
    withPlan = false,
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'design-archive-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  git(dir, ['checkout', '-qb', 'feat']);
  mkdirSync(join(dir, designRoot, 'specs'), { recursive: true });
  mkdirSync(join(dir, designRoot, 'plans'), { recursive: true });
  writeFileSync(join(dir, designRoot, 'specs', SPEC), 'spec body\n');
  if (withPlan) writeFileSync(join(dir, designRoot, 'plans', PLAN), 'plan body\n');
  if (!untrackedSpec) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'add design artifacts']);
  }

  if (session !== null) {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor', 'session.json'), JSON.stringify(session));
  }
  return dir;
}

function staged(dir: string): string[] {
  return git(dir, ['diff', '--cached', '--name-status', '-M'])
    .split('\n')
    .filter((l) => l.length > 0);
}

describe('noldor design archive', () => {
  it('git mv-moves tracked spec + plan, leaves them staged, and is idempotent', () => {
    const dir = repo({ withPlan: true });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('archived: 2 artifact(s)');
    expect(existsSync(join(dir, 'docs/design/specs/archive', SPEC))).toBe(true);
    expect(existsSync(join(dir, 'docs/design/plans/archive', PLAN))).toBe(true);
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(false);

    const lines = staged(dir);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith('R'))).toBe(true);

    git(dir, ['commit', '-qm', 'archive']);
    const again = run(dir);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('nothing to do');
  });

  it('leaves an uncommitted spec alone — the ownership gate only knows commits', () => {
    const dir = repo({ untrackedSpec: true });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nothing to do');
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(true);
    expect(staged(dir)).toEqual([]);
  });

  it('--dry-run reports the move and touches neither disk nor index', () => {
    const dir = repo();
    const r = run(dir, ['--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('would archive:');
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(true);
    expect(existsSync(join(dir, 'docs/design/specs/archive', SPEC))).toBe(false);
    expect(staged(dir)).toEqual([]);
  });

  it('archives under legacy docs/superpowers/* during the 1.0.0 transition window', () => {
    const dir = repo({ designRoot: 'docs/superpowers' });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'docs/superpowers/specs/archive', SPEC))).toBe(true);
    expect(staged(dir)).toEqual([
      `R100\tdocs/superpowers/specs/${SPEC}\tdocs/superpowers/specs/archive/${SPEC}`,
    ]);
  });

  it('skips a collision instead of overwriting an archived artifact', () => {
    const dir = repo();
    mkdirSync(join(dir, 'docs/design/specs/archive'), { recursive: true });
    writeFileSync(join(dir, 'docs/design/specs/archive', SPEC), 'already archived\n');
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('skipped (exists in archive):');
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(true);
  });

  it('exits 1 with a scaffold hint when no session marker exists', () => {
    const dir = repo({ session: null });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no .noldor/session.json');
  });

  it('no-ops on a path that carries no design artifacts', () => {
    const dir = repo({ session: { path: 'fast-track', startedAt: '2026-08-04T00:00:00.000Z' } });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('carries no design artifacts');
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(true);
  });

  it('fails closed when the branch-added range cannot be determined', () => {
    const dir = repo();
    git(dir, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('cannot determine branch-added artifacts');
    expect(existsSync(join(dir, 'docs/design/specs', SPEC))).toBe(true);
  });

  it('--slug overrides the key but still honours the ownership gate', () => {
    const dir = repo({ session: null });
    const ok = run(dir, ['--slug', KEY]);
    expect(ok.status).toBe(0);
    expect(existsSync(join(dir, 'docs/design/specs/archive', SPEC))).toBe(true);

    // A key naming an artifact that exists on main (not branch-added) resolves nothing.
    const other = repo({ session: null });
    git(other, ['checkout', '-q', 'main']);
    mkdirSync(join(other, 'docs/design/specs'), { recursive: true });
    writeFileSync(join(other, 'docs/design/specs/2026-01-01-foreign-design.md'), 'x\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-qm', 'foreign spec on main']);
    git(other, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(other, ['checkout', '-q', 'feat']);
    git(other, ['merge', '-q', '--no-edit', 'main']);
    const gated = run(other, ['--slug', 'foreign']);
    expect(gated.status).toBe(0);
    expect(gated.stdout).toContain('nothing to do');
    expect(existsSync(join(other, 'docs/design/specs/2026-01-01-foreign-design.md'))).toBe(true);
  });

  it('resolves the same moves when run from a subdirectory', () => {
    const dir = repo();
    const r = run(join(dir, 'docs', 'design', 'specs'));
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'docs/design/specs/archive', SPEC))).toBe(true);
  });
});
