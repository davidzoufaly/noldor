import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectTrailerScopeMismatch } from '../trailer-scope-mismatch.js';

// @tests: noldor

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trailer-scope-mismatch-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function addCommit(dir: string, msg: string): string {
  writeFileSync(join(dir, `${Date.now()}-${Math.random()}.txt`), msg);
  spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return r.stdout.trim();
}

describe('detectTrailerScopeMismatch', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns no findings when scope matches the FD trailer', async () => {
    addCommit(repo, 'feat(my-feature): implement the thing\n\nNoldor-FD: my-feature');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('returns no findings when scope contains the FD slug (multi-level scope)', async () => {
    addCommit(repo, 'feat(scripts:my-feature): implement script\n\nNoldor-FD: my-feature');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('flags a commit where scope does not contain the FD slug', async () => {
    addCommit(repo, 'chore: genesis'); // root commit is skipped; flag a later one
    addCommit(repo, 'feat(other-feature): unrelated commit\n\nNoldor-FD: my-feature');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fdSlug).toBe('my-feature');
    expect(findings[0]!.scope).toBe('other-feature');
    expect(findings[0]!.reason).toBe('scope-missing-fd-slug');
  });

  it('flags a commit with no scope when FD trailer is present', async () => {
    addCommit(repo, 'chore: genesis'); // root commit is skipped; flag a later one
    addCommit(repo, 'feat: no scope commit\n\nNoldor-FD: my-feature');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.scope).toBeNull();
  });

  it('skips the root (genesis import) commit even when its scope mismatches its FD trailer', async () => {
    // Mirrors the standalone-repo genesis: the first commit squash-imports
    // external history and carries a legacy scope that can never conform.
    addCommit(repo, 'feat(noldor): lift framework\n\nNoldor-FD: noldor-package-lift');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('ignores commits with no Noldor-FD trailer', async () => {
    addCommit(repo, 'feat(garden): commit without FD trailer');

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('skips commits that carry Noldor-Path-Override (override commits bypass scope alignment)', async () => {
    addCommit(
      repo,
      'chore(garden): override commit\n\nNoldor-FD: some-feature\nNoldor-Path-Override: rollout cutover; gate not yet active',
    );

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('ignores mismatches reachable only from another branch', async () => {
    const marker = addCommit(repo, 'chore: rollout marker');
    mkdirSync(join(repo, '.noldor'), { recursive: true });
    writeFileSync(join(repo, '.noldor', 'rollout-marker'), `${marker}\n`);
    addCommit(repo, 'feat(my-feature): main branch commit\n\nNoldor-FD: my-feature');

    spawnSync('git', ['checkout', '-b', 'side', marker], { cwd: repo, stdio: 'ignore' });
    addCommit(repo, 'feat(other-feature): side branch mismatch\n\nNoldor-FD: my-feature');
    spawnSync('git', ['checkout', 'main'], { cwd: repo, stdio: 'ignore' });

    const findings = await detectTrailerScopeMismatch({ cwd: repo });
    expect(findings).toHaveLength(0);
  });

  it('accepts a bare short scope token registered as an alias for the FD slug', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat(cr): a cr commit\n\nNoldor-FD: noldor');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor'] },
    });
    expect(findings).toHaveLength(0);
  });

  it('accepts a multi-level scope whose last segment is an alias for the FD slug', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat(garden:cr): a nested cr commit\n\nNoldor-FD: noldor');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor'] },
    });
    expect(findings).toHaveLength(0);
  });

  it('accepts a token mapped to multiple FD slugs for each slug', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat(cr): first\n\nNoldor-FD: noldor');
    addCommit(repo, 'feat(cr): second\n\nNoldor-FD: codex-cr-override-audit');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor', 'codex-cr-override-audit'] },
    });
    expect(findings).toHaveLength(0);
  });

  it('still flags a token that is registered as an alias for a different FD', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat(cr): wrong fd\n\nNoldor-FD: some-other-feature');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor'] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fdSlug).toBe('some-other-feature');
  });

  it('still flags an unknown token not present in the alias map', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat(unknown): nope\n\nNoldor-FD: noldor');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor'] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.scope).toBe('unknown');
  });

  it('cannot alias a commit with no scope (null scope stays flagged)', async () => {
    addCommit(repo, 'chore: genesis');
    addCommit(repo, 'feat: no scope\n\nNoldor-FD: noldor');

    const findings = await detectTrailerScopeMismatch({
      cwd: repo,
      scopeAliases: { cr: ['noldor'] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.scope).toBeNull();
  });
});
