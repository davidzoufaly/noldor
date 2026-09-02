// @tests: auto-open-design-artifacts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { WORKSPACE_ROOT_ENV } from '../../design/open-artifact.js';
import type { OpenResult } from '../../design/pen-bridge-cli.js';
import { openArtifactForPayload } from '../noldor-open-artifact.js';

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

const ok = (): OpenResult => ({ ok: true });
const fails = (): OpenResult => ({ ok: false, error: 'code: command not found' });

function setupRepo(autoOpen = false): { root: string; spec: string } {
  const root = tempDir('qoah-');
  execSync('git init -q', { cwd: root });
  execSync('git config user.email t@t.t', { cwd: root });
  execSync('git config user.name t', { cwd: root });
  mkdirSync(join(root, 'docs', 'design', 'specs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  const spec = join(root, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
  writeFileSync(spec, '# X\n');
  writeFileSync(join(root, 'src', 'a.ts'), 'x\n');
  mkdirSync(join(root, '.noldor'), { recursive: true });
  if (autoOpen) {
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      JSON.stringify({ design: { autoOpen: true } }),
    );
  }
  execSync('git add -A', { cwd: root });
  execSync('git commit -qm init', { cwd: root });
  return { root, spec };
}

/** The context string an agent would actually receive, or `''`. */
function contextFor(
  payload: unknown,
  env: Record<string, string | undefined> = {},
  launch = ok,
): string {
  const out = openArtifactForPayload(payload as never, env, launch);
  return out?.hookSpecificOutput.additionalContext ?? '';
}

describe('hooks open-artifact', () => {
  it('hands the agent a ready-made markdown link for a new spec', () => {
    const { root, spec } = setupRepo();
    const ctx = contextFor({ cwd: root, tool_input: { file_path: spec } });
    expect(ctx).toContain('[2026-01-01-x-design.md](docs/design/specs/2026-01-01-x-design.md)');
  });

  it('resolves the link against payload.cwd, not the artifact checkout', () => {
    const { root } = setupRepo();
    const tree = join(root, '.worktrees', 'wt');
    execSync(`git worktree add -q -b feat/wt ${tree}`, { cwd: root });
    const treeSpec = join(tree, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
    // The common Claude case: the editor has the MAIN checkout open while the
    // gate session writes into the worktree beneath it.
    expect(contextFor({ cwd: root, tool_input: { file_path: treeSpec } })).toContain(
      '(.worktrees/wt/docs/design/specs/2026-01-01-x-design.md)',
    );
    // The inverse layout: the operator opened the worktree as its own window.
    expect(contextFor({ cwd: tree, tool_input: { file_path: treeSpec } })).toContain(
      '(docs/design/specs/2026-01-01-x-design.md)',
    );
  });

  // A `payload.cwd` that is not a directory must fall through the ladder, not
  // come back `bad-workspace-root` — routing the inferred value through the hard
  // field would report no path at all.
  it('still reports a path when payload.cwd is not a real directory', () => {
    const { root, spec } = setupRepo();
    const ctx = contextFor({ cwd: join(root, 'gone'), tool_input: { file_path: spec } });
    expect(ctx).toContain('(docs/design/specs/2026-01-01-x-design.md)');
  });

  it('honours the workspace-root env var as the named root', () => {
    const { root } = setupRepo();
    const tree = join(root, '.worktrees', 'wt');
    execSync(`git worktree add -q -b feat/wt ${tree}`, { cwd: root });
    const treeSpec = join(tree, 'docs', 'design', 'specs', '2026-01-01-x-design.md');
    const ctx = contextFor(
      { cwd: tree, tool_input: { file_path: treeSpec } },
      {
        [WORKSPACE_ROOT_ENV]: root,
      },
    );
    expect(ctx).toContain('(.worktrees/wt/docs/design/specs/2026-01-01-x-design.md)');
  });

  it('reports the path AND says no tab opened when the editor is missing', () => {
    const { root, spec } = setupRepo(true);
    const ctx = contextFor({ cwd: root, tool_input: { file_path: spec } }, {}, fails);
    expect(ctx).toContain('(docs/design/specs/2026-01-01-x-design.md)');
    expect(ctx).toContain('No editor tab opened');
  });

  it.each([
    [
      'a source file',
      (root: string, _s: string) => ({
        cwd: root,
        tool_input: { file_path: join(root, 'src/a.ts') },
      }),
    ],
    ['an absent file_path', (root: string) => ({ cwd: root, tool_input: {} })],
    ['an absent tool_input', (root: string) => ({ cwd: root })],
    ['an empty payload', () => ({})],
  ])('emits nothing for %s', (_label, build) => {
    const { root, spec } = setupRepo();
    expect(openArtifactForPayload(build(root, spec) as never, {}, ok)).toBeUndefined();
  });

  it('absorbs a throwing launcher into the report instead of propagating it', () => {
    const { root, spec } = setupRepo(true);
    const boom = (): OpenResult => {
      throw new Error('spawn exploded');
    };
    const ctx = contextFor({ cwd: root, tool_input: { file_path: spec } }, {}, boom);
    // The path is still reported — the deliverable survives a dead editor.
    expect(ctx).toContain('(docs/design/specs/2026-01-01-x-design.md)');
    expect(ctx).toContain('No editor tab opened');
    expect(ctx).toContain('spawn exploded');
  });

  // A stale env var used to be validated before the artifact predicate ran, so
  // the misconfiguration notice landed in the model's context on EVERY `Write`,
  // artifact or not. It must stay silent for a non-artifact.
  it('stays silent about a stale workspace-root env var on a non-artifact write', () => {
    const { root } = setupRepo();
    const out = openArtifactForPayload(
      { cwd: root, tool_input: { file_path: join(root, 'src', 'a.ts') } },
      { [WORKSPACE_ROOT_ENV]: join(root, 'nope-gone') },
      ok,
    );
    expect(out).toBeUndefined();
  });

  it('reports a stale workspace-root env var when there IS an artifact to report', () => {
    const { root, spec } = setupRepo();
    const ctx = contextFor(
      { cwd: root, tool_input: { file_path: spec } },
      {
        [WORKSPACE_ROOT_ENV]: join(root, 'nope-gone'),
      },
    );
    expect(ctx).toContain(WORKSPACE_ROOT_ENV);
    expect(ctx).toContain('misconfigured');
  });

  // The link is the fix; the tab is opt-in. Off by default, the hook must still
  // hand over a usable link — it just must not raise anyone's window.
  it('reports the link but launches nothing while autoOpen is off', () => {
    const { root, spec } = setupRepo();
    let launches = 0;
    const ctx = contextFor({ cwd: root, tool_input: { file_path: spec } }, {}, () => {
      launches += 1;
      return { ok: true };
    });
    expect(ctx).toContain('(docs/design/specs/2026-01-01-x-design.md)');
    expect(launches).toBe(0);
    expect(ctx).not.toContain('No editor tab opened');
  });

  it('launches once when design.autoOpen is opted into', () => {
    const { root, spec } = setupRepo(true);
    let launches = 0;
    contextFor({ cwd: root, tool_input: { file_path: spec } }, {}, () => {
      launches += 1;
      return { ok: true };
    });
    expect(launches).toBe(1);
  });

  it('treats a malformed config as not opted in rather than throwing', () => {
    const { root, spec } = setupRepo();
    writeFileSync(join(root, '.noldor', 'config.json'), 'not json at all');
    let launches = 0;
    const ctx = contextFor({ cwd: root, tool_input: { file_path: spec } }, {}, () => {
      launches += 1;
      return { ok: true };
    });
    expect(ctx).toContain('(docs/design/specs/2026-01-01-x-design.md)');
    expect(launches).toBe(0);
  });

  it('names the PostToolUse event so the runner feeds the text to the model', () => {
    const { root, spec } = setupRepo();
    const out = openArtifactForPayload({ cwd: root, tool_input: { file_path: spec } }, {}, ok);
    expect(out?.hookSpecificOutput.hookEventName).toBe('PostToolUse');
  });
});
