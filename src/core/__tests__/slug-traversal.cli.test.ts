// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BIN = resolve(import.meta.dirname, '../../../bin/noldor.mjs');
const MILESTONE_CLI = resolve(import.meta.dirname, '../../milestones/cli.ts');
const TSX = resolve(import.meta.dirname, '../../../node_modules/.bin/tsx');

/**
 * Hostile slug shapes. Every one must be refused before a protected operation.
 *
 * A value starting with `-` is consumed as a flag by every parser here, so it
 * is passed after `--` — otherwise the test would prove argv parsing, not the
 * guard.
 */
const HOSTILE = [
  ['slash', 'a/b'],
  ['dot-dot traversal', '../../../escape'],
  ['leading hyphen', '-lead'],
  ['trailing hyphen', 'trail-'],
  ['doubled hyphen', 'a--b'],
  ['uppercase', 'BadSlug'],
  ['unicode', 'ünïcode'],
] as const;

/**
 * The payload used where the matrix is not exhaustive.
 *
 * Deep enough to clear every base directory in play: `docs/features/` is two
 * levels below the repo root and `.worktrees/` one, so a fixed payload lands at
 * a different depth per command. Rather than tune it per command, the assertion
 * below snapshots the whole tree outside the repo — so the test cannot pass
 * merely because the arithmetic missed.
 */
const CANONICAL = '../../../../sentinel-target';

interface Run {
  status: number;
  stderr: string;
}

/**
 * The guard's own diagnostics.
 *
 * Asserting the message, not just a non-zero exit, is what makes these tests
 * mean anything: an unguarded `phase-flip-done ../../../nope` also exits
 * non-zero — with "FD not found" — so a status-only assertion stays green with
 * the guard deleted. Verified by reverting the guard mid-implementation: all
 * 15 cases still passed until this matcher was added.
 */
const REFUSED = /invalid slug|refusing '/;

let repo: string;
let base: string;
const SENTINEL_BODY =
  '---\nphase: in-progress\nname: sentinel\nstatus: draft\n---\n\nDO NOT TOUCH\n';

/**
 * Every path outside the repo, with its contents — the thing that must not move.
 *
 * A per-file sentinel check can only prove the one path the test author
 * predicted; this proves that nothing outside the repo was created, deleted or
 * rewritten, whatever depth a payload happened to resolve to.
 */
function outsideTree(): string {
  const seen: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((x, y) =>
      x.name.localeCompare(y.name),
    )) {
      const full = join(dir, entry.name);
      if (full === repo) continue; // inside the repo is fair game
      if (entry.isDirectory()) {
        seen.push(`d ${full}`);
        walk(full);
      } else {
        seen.push(`f ${full} ${readFileSync(full, 'utf8')}`);
      }
    }
  };
  walk(base);
  return seen.join('\n');
}

let treeBefore: string;

function run(args: string[]): Run {
  try {
    execFileSync('node', [BIN, ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? -1, stderr: e.stderr ?? '' };
  }
}

function runMilestone(args: string[]): Run {
  try {
    execFileSync(TSX, [MILESTONE_CLI, ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? -1, stderr: e.stderr ?? '' };
  }
}

/** Nothing outside the repo may differ after a refusal. */
function sentinelUnchanged(): boolean {
  return outsideTree() === treeBefore;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'slug-traversal-'));
  repo = join(base, 'a', 'b', 'repo');
  mkdirSync(join(repo, 'docs', 'features'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'milestones'), { recursive: true });
  mkdirSync(join(repo, '.noldor'), { recursive: true });
  // A sentinel at every depth a payload can land on, each shaped so an
  // unguarded command would rewrite it: the phase commands look for `phase:`,
  // `activate` for milestone frontmatter.
  for (const dir of [base, join(base, 'a'), join(base, 'a', 'b')]) {
    writeFileSync(join(dir, 'sentinel-target.md'), SENTINEL_BODY);
    writeFileSync(join(dir, 'sentinel-target.pids'), '0 99999\n');
  }
  treeBefore = outsideTree();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('phase-flip-done — full hostile matrix', () => {
  for (const [label, value] of HOSTILE) {
    it(`refuses ${label}`, () => {
      const r = run(['features', 'phase-flip-done', '--', value]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(REFUSED);
      expect(sentinelUnchanged()).toBe(true);
    });
  }
});

describe('payloads that land on a real file — the escape itself', () => {
  // `<repo>/docs/features/../../../../sentinel-target.md` resolves to
  // `<base>/a/sentinel-target.md`, which exists and carries `phase:`, so an
  // unguarded build reads it and writes it back flipped. Confirmed by hand
  // against the pre-fix code: exit 0, `phase: in-progress` → `phase: done`.
  it('phase-flip-done cannot flip a file outside the repo', () => {
    const r = run(['features', 'phase-flip-done', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(readFileSync(join(base, 'a', 'sentinel-target.md'), 'utf8')).toBe(SENTINEL_BODY);
  });

  it('phase-revert cannot revert a file outside the repo', () => {
    writeFileSync(
      join(base, 'a', 'sentinel-target.md'),
      '---\nphase: done\nname: sentinel\n---\n\nDO NOT TOUCH\n',
    );
    const before = readFileSync(join(base, 'a', 'sentinel-target.md'), 'utf8');
    const r = run(['features', 'phase-revert', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(readFileSync(join(base, 'a', 'sentinel-target.md'), 'utf8')).toBe(before);
  });

  it('milestones activate cannot rewrite a milestone-shaped file outside the repo', () => {
    // `activate` preflights docs/vision.md before it writes, so without one the
    // command dies for an unrelated reason and this case passes with the guard
    // gutted — a false green the CR probe caught. The fixture supplies vision.md
    // so the refusal has to come from the guard, and the REFUSED matcher pins
    // which refusal it was.
    writeFileSync(join(repo, 'docs', 'vision.md'), '---\n---\n\n# Vision\n');
    const r = runMilestone(['activate', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(readFileSync(join(base, 'a', 'sentinel-target.md'), 'utf8')).toBe(SENTINEL_BODY);
  });
});

describe('the remaining entry points — canonical traversal payload', () => {
  it('features phase-revert refuses and writes nothing', () => {
    const r = run(['features', 'phase-revert', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('milestones draft refuses and creates nothing', () => {
    const r = runMilestone(['draft', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('milestones activate refuses and rewrites nothing', () => {
    const r = runMilestone(['activate', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('worktrees up refuses in the default mode', () => {
    const r = run(['worktrees', 'up', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('worktrees up refuses with --no-create — the mode that skipped the old guard', () => {
    const r = run(['worktrees', 'up', '--no-create', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('worktrees up refuses when a directory already sits at the traversed path', () => {
    // The mode that used to skip the guard entirely: the old code only reached
    // the validating createWorktree when the path did NOT already exist.
    for (const dir of [base, join(base, 'a'), join(base, 'a', 'b')]) {
      mkdirSync(join(dir, 'sentinel-target'), { recursive: true });
    }
    treeBefore = outsideTree();
    const r = run(['worktrees', 'up', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('worktrees down refuses without --remove — the pid-read path', () => {
    const r = run(['worktrees', 'down', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });

  it('worktrees down refuses with --remove — the git-removal path', () => {
    const r = run(['worktrees', 'down', '--remove', '--', CANONICAL]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(REFUSED);
    expect(sentinelUnchanged()).toBe(true);
  });
});
