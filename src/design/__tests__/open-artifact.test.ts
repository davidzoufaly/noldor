// @tests: auto-open-design-artifacts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { OpenResult } from '../pen-bridge-cli.js';
import {
  buildArtifactLink,
  launchArtifact,
  resolveArtifact,
  type GitProbe,
} from '../open-artifact.js';

/**
 * Every temp path this file creates, removed in `afterAll`. Temp directories are
 * named by the deterministic-cleanup rule as one of the shapes that leak, and a
 * `git worktree`-bearing fixture leaves more than an empty dir behind.
 */
const tracked: string[] = [];
afterAll(() => {
  for (const p of tracked) rmSync(p, { recursive: true, force: true });
});

/** `mkdtemp` that registers itself for cleanup. */
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tracked.push(dir);
  return dir;
}

/**
 * A real repo with a real spec. Real git, not a stubbed probe: the whole point of
 * the `--show-toplevel` leg is that its output differs in shape between a main
 * checkout and a worktree, so a mock would assert the mock.
 *
 * `realpathSync` on the temp root is deliberate for the MAIN fixture — macOS
 * `tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`, and the
 * symlink case gets its own test below rather than contaminating every row.
 */
function setupRepo(): { root: string; spec: string } {
  const root = tempDir('qoa-');
  execSync('git init -q', { cwd: root });
  execSync('git config user.email t@t.t', { cwd: root });
  execSync('git config user.name t', { cwd: root });
  mkdirSync(join(root, 'docs', 'design', 'specs', 'archive'), { recursive: true });
  mkdirSync(join(root, 'docs', 'design', 'plans'), { recursive: true });
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  const spec = join(root, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
  writeFileSync(spec, '# X\n');
  writeFileSync(join(root, 'README.md'), 'r\n');
  execSync('git add -A', { cwd: root });
  execSync('git commit -qm init', { cwd: root });
  return { root, spec };
}

/** A second checkout of `root`, as the gate's `specs-only-*` paths produce. */
function addWorktree(root: string, slug: string): { tree: string; spec: string } {
  const tree = join(root, '.worktrees', slug);
  execSync(`git worktree add -q -b feat/${slug} ${tree}`, { cwd: root });
  const spec = join(tree, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
  return { tree, spec };
}

describe('resolveArtifact — the artifact predicate', () => {
  it('accepts a spec in a main checkout', () => {
    const { root, spec } = setupRepo();
    const r = resolveArtifact({ path: spec, cwd: root });
    expect(r.kind).toBe('artifact');
  });

  it('accepts a plan as well as a spec', () => {
    const { root } = setupRepo();
    const plan = join(root, 'docs', 'design', 'plans', '2026-01-01-x.md');
    writeFileSync(plan, '# p\n');
    expect(resolveArtifact({ path: plan, cwd: root }).kind).toBe('artifact');
  });

  // The regression that matters most: an earlier draft resolved doc roots through
  // `--git-common-dir`, which names the MAIN checkout even from inside a
  // worktree, so every specs-only-*/full-* artifact was rejected — the primary
  // case the feature exists for.
  it('accepts a spec inside a real git worktree', () => {
    const { root } = setupRepo();
    const { tree, spec } = addWorktree(root, 'wt');
    const r = resolveArtifact({ path: spec, cwd: tree });
    expect(r.kind).toBe('artifact');
  });

  // The second regression: `--show-toplevel` returns a realpath, so comparing it
  // against a lexical parent rejects any caller path that crossed a symlink.
  it('accepts a spec reached through a symlinked repo path', () => {
    const { root, spec } = setupRepo();
    const link = `${root}-link`;
    symlinkSync(root, link);
    tracked.push(link);
    const viaLink = spec.replace(root, link);
    const r = resolveArtifact({ path: viaLink, cwd: link });
    expect(r.kind).toBe('artifact');
    // The lexical path survives into the report: it is what the editor opens.
    if (r.kind === 'artifact') expect(r.absPath).toBe(viaLink);
  });

  // Accepting the symlink case is not enough — the FIRST version accepted it and
  // still emitted `../<symlink>/docs/…`, a hop out of the very workspace the link
  // must resolve against, because the root was canonical and the path lexical.
  it('does not escape the workspace with ../ for a symlinked repo path', () => {
    const { root, spec } = setupRepo();
    const link = `${root}-link`;
    symlinkSync(root, link);
    tracked.push(link);
    const r = resolveArtifact({ path: spec.replace(root, link), cwd: link });
    expect(r.kind === 'artifact' && r.linkPath).toBe('docs/design/specs/2026-01-01-x-design.md');
    if (r.kind === 'artifact') expect(r.linkPath.startsWith('..')).toBe(false);
  });

  it('raises no bogus discard warning when the named root is the realpath twin', () => {
    const { root, spec } = setupRepo();
    const link = `${root}-link`;
    symlinkSync(root, link);
    tracked.push(link);
    // Named root = the realpath, artifact reached via the symlink: the same
    // mismatch used to report "does not contain" for a path plainly inside it.
    const r = resolveArtifact({ path: spec.replace(root, link), cwd: link, workspaceRoot: root });
    expect(r.kind === 'artifact' && r.warning).toBeUndefined();
  });

  it('probes git exactly once for a successful resolution', () => {
    const { root, spec } = setupRepo();
    const calls: string[][] = [];
    const counting: GitProbe = (args, cwd) => {
      calls.push([...args]);
      return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf8' }).trim();
    };
    const r = resolveArtifact({ path: spec, cwd: root, git: counting });
    expect(r.kind).toBe('artifact');
    // classify owns the one probe and hands its result to the ladder; an earlier
    // version re-ran the identical command twice more.
    expect(calls).toEqual([['rev-parse', '--show-toplevel']]);
  });

  it.each([
    ['an archived spec', (root: string) => join(root, 'docs/design/specs/archive/old-design.md')],
    ['a feature MD', (root: string) => join(root, 'docs/features/f.md')],
    ['a source file', (root: string) => join(root, 'src/a.ts')],
    ['a non-md file in a doc root', (root: string) => join(root, 'docs/design/specs/notes.txt')],
  ])('rejects %s', (_label, build) => {
    const { root } = setupRepo();
    const path = build(root);
    writeFileSync(path, 'x\n');
    const r = resolveArtifact({ path, cwd: root });
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') expect(r.reason).toBe('not-an-artifact');
  });

  it('rejects a directory named *.md', () => {
    const { root } = setupRepo();
    const dir = join(root, 'docs', 'design', 'specs', 'weird.md');
    mkdirSync(dir);
    const r = resolveArtifact({ path: dir, cwd: root });
    expect(r.kind === 'rejected' && r.reason).toBe('not-a-file');
  });

  it('rejects a broken symlink and a symlink to a directory', () => {
    const { root } = setupRepo();
    const specs = join(root, 'docs', 'design', 'specs');
    symlinkSync(join(specs, 'gone.md'), join(specs, 'broken.md'));
    symlinkSync(specs, join(specs, 'todir.md'));
    for (const name of ['broken.md', 'todir.md']) {
      const r = resolveArtifact({ path: join(specs, name), cwd: root });
      expect(r.kind === 'rejected' && r.reason, name).toBe('not-a-file');
    }
  });

  it('rejects a missing file and an absent path', () => {
    const { root } = setupRepo();
    expect(
      resolveArtifact({ path: join(root, 'docs/design/specs/nope.md'), cwd: root }).kind ===
        'rejected',
    ).toBe(true);
    const none = resolveArtifact({ path: undefined, cwd: root });
    expect(none.kind === 'rejected' && none.reason).toBe('no-path');
  });

  it('rejects an unrelated tree whose dirs merely end in the same segments', () => {
    const outside = tempDir('qoa-bare-');
    const specs = join(outside, 'docs', 'design', 'specs');
    mkdirSync(specs, { recursive: true });
    const path = join(specs, 'x-design.md');
    writeFileSync(path, '# x\n');
    // No `git init`, so there is no checkout to read doc roots from.
    const r = resolveArtifact({ path, cwd: outside });
    expect(r.kind === 'rejected' && r.reason).toBe('no-repo');
  });

  it('treats a failed predicate probe as no-repo, not as a guess', () => {
    const { root, spec } = setupRepo();
    const dead: GitProbe = () => undefined;
    const r = resolveArtifact({ path: spec, cwd: root, git: dead });
    expect(r.kind === 'rejected' && r.reason).toBe('no-repo');
  });
});

describe('resolveArtifact — the workspace-root ladder', () => {
  it('prefixes with .worktrees/<slug> when the root is the main checkout', () => {
    const { root } = setupRepo();
    const { tree, spec } = addWorktree(root, 'wt');
    const r = resolveArtifact({ path: spec, cwd: tree, workspaceRoot: root });
    expect(r.kind === 'artifact' && r.linkPath).toBe(
      '.worktrees/wt/docs/design/specs/2026-01-01-x-design.md',
    );
  });

  // The inverse layout, which an earlier draft got backwards: an operator who
  // opens the worktree as their own window needs the BARE path.
  it('prints the bare path when the root is the worktree itself', () => {
    const { root } = setupRepo();
    const { tree, spec } = addWorktree(root, 'wt');
    const r = resolveArtifact({ path: spec, cwd: tree, workspaceRoot: tree });
    expect(r.kind === 'artifact' && r.linkPath).toBe('docs/design/specs/2026-01-01-x-design.md');
  });

  it('uses hintRoot when no named root is given', () => {
    const { root } = setupRepo();
    const { tree, spec } = addWorktree(root, 'wt');
    const r = resolveArtifact({ path: spec, cwd: tree, hintRoot: root });
    expect(r.kind === 'artifact' && r.linkPath).toBe(
      '.worktrees/wt/docs/design/specs/2026-01-01-x-design.md',
    );
  });

  it('falls back to the checkout root when a soft hint is malformed', () => {
    const { root } = setupRepo();
    const { tree, spec } = addWorktree(root, 'wt');
    const r = resolveArtifact({ path: spec, cwd: tree, hintRoot: join(root, 'no-such-dir') });
    // Rung 4: the artifact's OWN checkout, so the bare path — never a rejection.
    expect(r.kind === 'artifact' && r.linkPath).toBe('docs/design/specs/2026-01-01-x-design.md');
  });

  it.each([
    ['relative', 'relative/dir'],
    ['absent from disk', join(tmpdir(), 'qoa-definitely-absent-dir')],
  ])('rejects a named root that is %s', (_label, bad) => {
    const { root, spec } = setupRepo();
    const r = resolveArtifact({ path: spec, cwd: root, workspaceRoot: bad });
    expect(r.kind === 'rejected' && r.reason).toBe('bad-workspace-root');
  });

  it('rejects a named root that is a file, not a directory', () => {
    const { root, spec } = setupRepo();
    const r = resolveArtifact({ path: spec, cwd: root, workspaceRoot: join(root, 'README.md') });
    expect(r.kind === 'rejected' && r.reason).toBe('bad-workspace-root');
  });

  it('warns but still prints when a well-formed named root does not contain the artifact', () => {
    const { root, spec } = setupRepo();
    const elsewhere = tempDir('qoa-other-');
    const r = resolveArtifact({ path: spec, cwd: root, workspaceRoot: elsewhere });
    expect(r.kind).toBe('artifact');
    if (r.kind === 'artifact') {
      expect(r.linkPath).toBe('docs/design/specs/2026-01-01-x-design.md');
      expect(r.warning).toContain('does not contain');
    }
  });
});

describe('launchArtifact', () => {
  it('reports launched on success', () => {
    expect(launchArtifact('/x.md', '/', () => ({ ok: true })).kind).toBe('launched');
  });

  it('reports not-launched when the launcher fails', () => {
    const out = launchArtifact('/x.md', '/', () => ({ ok: false, error: 'code: not found' }));
    expect(out.kind).toBe('not-launched');
    if (out.kind === 'not-launched') expect(out.warning).toContain('code: not found');
  });

  // The timeout branch as it actually arrives: `execFileSync` surfaces an expired
  // `timeout` as a failed call, so the handling is what is asserted here rather
  // than the kernel's enforcement of the deadline.
  it('reports not-launched for a timeout-shaped result', () => {
    const timedOut = (): OpenResult => ({ ok: false, error: 'ETIMEDOUT' });
    expect(launchArtifact('/x.md', '/', timedOut).kind).toBe('not-launched');
  });

  it('never throws, even when the launcher does', () => {
    const boom = (): OpenResult => {
      throw new Error('spawn exploded');
    };
    const out = launchArtifact('/x.md', '/', boom);
    expect(out.kind).toBe('not-launched');
    if (out.kind === 'not-launched') expect(out.warning).toContain('spawn exploded');
  });
});

describe('buildArtifactLink', () => {
  it('builds a plain link for a generated artifact name', () => {
    expect(buildArtifactLink('docs/design/specs/2026-01-01-x-design.md')).toBe(
      '[2026-01-01-x-design.md](docs/design/specs/2026-01-01-x-design.md)',
    );
  });

  it.each([
    ['a space', 'docs/a b.md', '[a b.md](docs/a%20b.md)'],
    ['a hash', 'docs/a#b.md', '[a#b.md](docs/a%23b.md)'],
    ['parentheses', 'docs/a(b).md', '[a(b).md](docs/a%28b%29.md)'],
    ['angle brackets', 'docs/a<b>.md', '[a<b>.md](docs/a%3Cb%3E.md)'],
    ['a question mark', 'docs/a?b.md', '[a?b.md](docs/a%3Fb.md)'],
  ])('encodes %s in the destination', (_label, input, expected) => {
    expect(buildArtifactLink(input)).toBe(expected);
  });

  // The load-bearing row. The input is a RAW filesystem path, so a literal `%20`
  // is part of the filename and MUST become `%2520`: a destination reading `%20`
  // is decoded by the resolver back to a space, naming a file that does not
  // exist. Asserting `a%20b.md` here would lock in a dead link.
  it('encodes a literal percent rather than preserving it', () => {
    expect(buildArtifactLink('docs/a%20b.md')).toBe('[a%20b.md](docs/a%2520b.md)');
  });

  it('escapes brackets in the label', () => {
    expect(buildArtifactLink('docs/a[b].md')).toBe('[a\\[b\\].md](docs/a[b].md)');
  });
});
