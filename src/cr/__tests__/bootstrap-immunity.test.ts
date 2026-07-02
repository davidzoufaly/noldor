import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { injectBootstrapOverrides, resolveIntroducedGate } from '../bootstrap-immunity.js';
import { BOOTSTRAP_REASON } from '../gate-registry.js';
import { checkCrGate } from '../../release/release-cr-gate.js';

// @tests: bootstrap-immunity-for-self-gating-features

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t.io',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t.io',
    },
  });
}

function writeFd(cwd: string, slug: string, gate?: string): void {
  mkdirSync(join(cwd, 'docs/features'), { recursive: true });
  writeFileSync(
    join(cwd, 'docs/features', `${slug}.md`),
    [
      '---',
      `name: ${slug}`,
      'phase: in-progress',
      'area: test',
      'category: Tooling',
      'packages:\n  - scripts',
      'noldor-tier: specs-only',
      ...(gate ? [`introduces-gate: ${gate}`] : []),
      'links:\n  code: []\n  tests: []\n  docs: []',
      '---',
      'body',
    ].join('\n'),
  );
}

/**
 * A repo whose `origin/main..HEAD` has 3 feature commits. By default each
 * carries a `Noldor-Path-Override` (claude side satisfied); `bare: true`
 * leaves them without any review evidence at all.
 */
function makeRepo(slug: string, gate?: string, opts: { bare?: boolean } = {}): string {
  const cwd = mkdtempSync(join(tmpdir(), 'bootstrap-imm-'));
  git(cwd, ['init', '-q', '-b', 'feat/x']);
  writeFd(cwd, slug, gate);
  writeFileSync(join(cwd, 'base.txt'), 'base');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  // Pin origin/main at the base so the range is the 3 feature commits below.
  git(cwd, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (let i = 1; i <= 3; i++) {
    writeFileSync(join(cwd, `f${i}.ts`), `export const x${i} = ${i};`);
    git(cwd, ['add', '-A']);
    const msg = opts.bare
      ? `feat: change ${i}`
      : `feat: change ${i}\n\nNoldor-Path-Override: pre-existing`;
    git(cwd, ['commit', '-q', '-m', msg]);
  }
  return cwd;
}

describe('resolveIntroducedGate', () => {
  let cwd: string;
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('returns the codex-cr entry for an FD declaring it', () => {
    cwd = mkdtempSync(join(tmpdir(), 'rig-'));
    writeFd(cwd, 'feat', 'codex-cr');
    expect(resolveIntroducedGate(cwd, 'feat')?.key).toBe('codex-cr');
  });

  it('returns null for an FD without introduces-gate', () => {
    cwd = mkdtempSync(join(tmpdir(), 'rig-'));
    writeFd(cwd, 'feat');
    expect(resolveIntroducedGate(cwd, 'feat')).toBeNull();
  });
});

describe('injectBootstrapOverrides', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = makeRepo('feat', 'codex-cr');
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const range = 'origin/main..HEAD';
  const treesOf = (): string[] =>
    git(cwd, ['rev-list', range])
      .trim()
      .split('\n')
      .map((sha) => git(cwd, ['rev-parse', `${sha}^{tree}`]).trim());

  it('stamps the codex override on all 3 commits, idempotently, preserving trees', () => {
    const treesBefore = treesOf();

    const r1 = injectBootstrapOverrides({ cwd, slug: 'feat', range });
    expect(r1.gate?.key).toBe('codex-cr');
    expect(r1.injected).toHaveLength(3);

    const msgs = git(cwd, ['log', '--format=%B', range]);
    expect((msgs.match(/Noldor-CR-Override-Codex:/g) ?? []).length).toBe(3);
    expect(msgs).toContain(BOOTSTRAP_REASON);

    // Trees unchanged (message-only rewrite).
    expect(treesOf()).toEqual(treesBefore);

    // Second run is a no-op.
    const r2 = injectBootstrapOverrides({ cwd, slug: 'feat', range });
    expect(r2.injected).toEqual([]);
  });

  it('makes checkCrGate pass over a range with no review evidence', () => {
    // Bare commits: no receipt, no override — the gate must fail pre-injection.
    const bare = makeRepo('feat', 'codex-cr', { bare: true });
    try {
      const before = checkCrGate({ from: 'origin/main', to: 'HEAD', cwd: bare });
      expect(before.ok).toBe(false);

      injectBootstrapOverrides({ cwd: bare, slug: 'feat', range });
      const after = checkCrGate({ from: 'origin/main', to: 'HEAD', cwd: bare });
      expect(after.ok).toBe(true); // injected codex override counts as review evidence
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('preserves a Noldor-Reviewed-Subagent tree receipt amended before injection', () => {
    const tipTree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
    // Amend a review receipt onto the tip (as gate Step 4 does).
    const tipMsg = git(cwd, ['log', '-1', '--format=%B']).trim();
    git(cwd, [
      'commit',
      '--amend',
      '-q',
      '-m',
      `${tipMsg}\n\nNoldor-Reviewed-Subagent: ${tipTree}`,
    ]);

    injectBootstrapOverrides({ cwd, slug: 'feat', range });

    const newTipTree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
    const receipt = /Noldor-Reviewed-Subagent: (\w+)/.exec(
      git(cwd, ['log', '-1', '--format=%B']),
    )?.[1];
    expect(receipt).toBe(newTipTree); // receipt still tree-matches the (unchanged) tip tree
  });

  it('is a no-op for an FD without introduces-gate', () => {
    const plain = makeRepo('feat'); // no gate
    try {
      const r = injectBootstrapOverrides({ cwd: plain, slug: 'feat', range });
      expect(r.gate).toBeNull();
      expect(r.injected).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
