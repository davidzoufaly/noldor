// @tests: noldor
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCrGate } from '../release-cr-gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function initRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'crgate-e2e-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  return cwd;
}

/** Creates the base commit tagged v0.0.0 and returns the tag name. */
function tagBase(cwd: string): string {
  writeFileSync(join(cwd, 'README.md'), '# repo\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'init']);
  git(cwd, ['tag', 'v0.0.0']);
  return 'v0.0.0';
}

/**
 * Writes `file`, stages it, makes a commit with `body` as the message, then
 * optionally amends the commit to append `trailers`.  Trailer template strings
 * may contain the literal `<tree>` which will be replaced with the real tree
 * SHA of the just-created commit.
 *
 * Returns the final commit SHA.
 */
function commit(cwd: string, file: string, body: string, trailers: string[]): string {
  const fullPath = join(cwd, file);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Math.random().toString());
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', body]);

  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
  const expanded = trailers.map((t) => t.replaceAll('<tree>', tree));

  if (expanded.length > 0) {
    const msgFile = join(cwd, '.git', 'CR_E2E_MSG');
    writeFileSync(msgFile, `${body}\n\n${expanded.join('\n')}\n`);
    git(cwd, ['commit', '--amend', '-q', '-F', msgFile]);
  }

  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('release-cr-gate e2e', () => {
  it('passes on a single review receipt (tree value not re-checked)', () => {
    const cwd = initRepo();
    const base = tagBase(cwd);

    commit(cwd, 'src/a.ts', 'feat: add feature', ['Noldor-Reviewed-Subagent: <tree>']);

    const r = checkCrGate({ from: base, to: 'HEAD', cwd });
    expect(r.ok).toBe(true);
    expect(r.offenders).toHaveLength(0);
  });

  it('passes when the receipt sits mid-body under a Co-authored-by tail (squash shape)', () => {
    const cwd = initRepo();
    const base = tagBase(cwd);

    // Emulate a GitHub squash: trailers inlined mid-body, divider + co-author
    // tail as the only real trailer block.
    const body = [
      'feat: squashed (#7)',
      '',
      '* feat: squashed',
      '',
      'Noldor-Path: fast-track',
      'Noldor-Reviewed-Subagent: deadbeef',
      '',
      '---------',
      '',
      'Co-authored-by: t <t@t.io>',
    ].join('\n');
    commit(cwd, 'src/b.ts', body, []);

    const r = checkCrGate({ from: base, to: 'HEAD', cwd });
    expect(r.ok).toBe(true);
  });

  it('skips doc-only commits', () => {
    const cwd = initRepo();
    const base = tagBase(cwd);

    // docs/foo.md matches the MICRO_CHORE_GLOBS allowlist — no trailers needed
    commit(cwd, 'docs/foo.md', 'docs: update readme', []);

    const r = checkCrGate({ from: base, to: 'HEAD', cwd });
    expect(r.ok).toBe(true);
    expect(r.offenders).toHaveLength(0);
  });

  it('fails when no review evidence exists on a code-touching commit', () => {
    const cwd = initRepo();
    const base = tagBase(cwd);

    const sha = commit(cwd, 'src/c.ts', 'feat: bare commit', [
      // no receipt, no override
    ]);

    const r = checkCrGate({ from: base, to: 'HEAD', cwd });
    expect(r.ok).toBe(false);
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0].sha).toBe(sha);
    expect(r.offenders[0].subject).toBe('feat: bare commit');
  });
});
