// @tests: auto-open-design-artifacts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT_ENV } from '../open-artifact.js';
import { runOpenArtifact, type OpenArtifactCliDeps } from '../open-artifact-cli.js';

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

function setupRepo(): { root: string; spec: string } {
  const root = tempDir('qoac-');
  execSync('git init -q', { cwd: root });
  execSync('git config user.email t@t.t', { cwd: root });
  execSync('git config user.name t', { cwd: root });
  mkdirSync(join(root, 'docs', 'design', 'specs'), { recursive: true });
  const spec = join(root, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
  writeFileSync(spec, '# X\n');
  execSync('git add -A', { cwd: root });
  execSync('git commit -qm init', { cwd: root });
  return { root, spec };
}

interface Run {
  code: number;
  out: string[];
  err: string[];
}

function run(argv: string[], cwd: string, env: Record<string, string | undefined> = {}): Run {
  const out: string[] = [];
  const err: string[] = [];
  const deps: OpenArtifactCliDeps = {
    cwd,
    env,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    // Never the real `code`: a test suite must not open editor windows.
    launch: () => ({ ok: true }),
  };
  return { code: runOpenArtifact(argv, deps), out, err };
}

describe('design open', () => {
  // The bug this test exists for: a hand-rolled positional scan excluded
  // `indexOf('--workspace-root') + 1`, which is index 0 when the flag is absent —
  // so the bare form silently reported "no file path given".
  it('accepts the bare positional form with no flags', () => {
    const { root, spec } = setupRepo();
    const r = run([spec], root);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe('docs/design/specs/2026-01-01-x-design.md');
  });

  it('prints the raw path first, then the ready-made link', () => {
    const { root, spec } = setupRepo();
    const r = run([spec], root);
    expect(r.out[0]).toBe('docs/design/specs/2026-01-01-x-design.md');
    expect(r.out[1]).toBe(
      'link: [2026-01-01-x-design.md](docs/design/specs/2026-01-01-x-design.md)',
    );
  });

  it('honours --workspace-root over the env var', () => {
    const { root } = setupRepo();
    const tree = join(root, '.worktrees', 'wt');
    execSync(`git worktree add -q -b feat/wt ${tree}`, { cwd: root });
    const treeSpec = join(tree, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
    const r = run([treeSpec, '--workspace-root', root], tree, { [WORKSPACE_ROOT_ENV]: tree });
    expect(r.out[0]).toBe('.worktrees/wt/docs/design/specs/2026-01-01-x-design.md');
  });

  it('falls back to the env var when the flag is absent', () => {
    const { root } = setupRepo();
    const tree = join(root, '.worktrees', 'wt');
    execSync(`git worktree add -q -b feat/wt ${tree}`, { cwd: root });
    const treeSpec = join(tree, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
    const r = run([treeSpec], tree, { [WORKSPACE_ROOT_ENV]: root });
    expect(r.out[0]).toBe('.worktrees/wt/docs/design/specs/2026-01-01-x-design.md');
  });

  it('exits 2 with the reason named for a non-artifact', () => {
    const { root } = setupRepo();
    const src = join(root, 'a.ts');
    writeFileSync(src, 'x\n');
    const r = run([src], root);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('not a .md file');
    expect(r.out).toEqual([]);
  });

  it('exits 2 for a malformed --workspace-root', () => {
    const { root, spec } = setupRepo();
    const r = run([spec, '--workspace-root', 'rel/dir'], root);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('absolute existing directory');
  });

  it('exits 2 for --workspace-root with no value', () => {
    const { root, spec } = setupRepo();
    const r = run([spec, '--workspace-root'], root);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('requires a value');
  });

  it('exits 2 for an unknown flag rather than ignoring it', () => {
    const { root, spec } = setupRepo();
    const r = run([spec, '--bogus'], root);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('unknown flag --bogus');
  });

  it('warns on stderr but still prints and exits 0 for a non-containing root', () => {
    const { root, spec } = setupRepo();
    const elsewhere = tempDir('qoac-other-');
    const r = run([spec, '--workspace-root', elsewhere], root);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe('docs/design/specs/2026-01-01-x-design.md');
    expect(r.err.join('\n')).toContain('does not contain');
  });
});
