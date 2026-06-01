import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectFdWithoutPlan } from '../fd-without-plan.js';

// @tests: noldor

function makeRepoSync(root: string): void {
  spawnSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'ignore' });
}

function gitAdd(cwd: string): void {
  spawnSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
}

function gitCommit(cwd: string, msg: string): void {
  spawnSync('git', ['commit', '--allow-empty', '-m', msg], { cwd, stdio: 'ignore' });
}

/**
 * Commit all staged files so git can track creation SHAs.
 */
async function commitAll(root: string, msg: string): Promise<void> {
  return new Promise((resolve) => {
    gitAdd(root);
    gitCommit(root, msg);
    resolve();
  });
}

const DONE_FD = `---
name: My Feature
phase: done
introduced: 1.0.0
area: test
category: Tooling
packages:
  - '@acme/web'
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
body
`;

function makeInProgressFd(name = 'My Feature'): string {
  return `---
name: ${name}
phase: in-progress
area: test
category: Tooling
packages:
  - '@acme/web'
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
body
`;
}

describe('detectFdWithoutPlan', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'fd-without-plan-'));
    await mkdir(join(repo, 'docs/superpowers/plans'), { recursive: true });
    await mkdir(join(repo, 'docs/features'), { recursive: true });
    makeRepoSync(repo);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('does NOT flag done FDs (grandfathered regardless of plan)', async () => {
    await writeFile(join(repo, 'docs/features/done-feature.md'), DONE_FD);
    await commitAll(repo, 'chore: initial');

    // Set rollout marker to first commit so all subsequent would be post-rollout
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/rollout-marker'), sha);

    // Add another commit after rollout marker (but done-feature was before)
    await writeFile(join(repo, 'dummy.txt'), 'after rollout');
    await commitAll(repo, 'chore: after rollout');

    const findings = await detectFdWithoutPlan(repo);
    expect(findings.filter((f) => f.slug === 'done-feature')).toHaveLength(0);
  });

  it('does NOT flag in-progress FDs created pre-rollout (grandfathered by creation date)', async () => {
    // FD created before rollout marker → skip
    await writeFile(
      join(repo, 'docs/features/pre-rollout-feature.md'),
      makeInProgressFd('Pre Rollout Feature'),
    );
    await commitAll(repo, 'chore: add pre-rollout FD');
    const oldSha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();

    // Add a new commit to be the rollout marker (AFTER FD creation)
    await writeFile(join(repo, 'dummy.txt'), 'rollout');
    await commitAll(repo, 'chore: rollout marker commit');
    const rolloutSha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();

    // Write rollout marker at rollout SHA
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/rollout-marker'), rolloutSha);

    // FD was created at oldSha which is BEFORE rolloutSha → grandfathered
    const findings = await detectFdWithoutPlan(repo);
    expect(findings.filter((f) => f.slug === 'pre-rollout-feature')).toHaveLength(0);

    void oldSha; // used implicitly through git history
  });

  it('flags in-progress post-rollout FD with no plan', async () => {
    // Establish rollout marker on initial commit
    await writeFile(join(repo, 'dummy.txt'), 'initial');
    await commitAll(repo, 'chore: initial');
    const rolloutSha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/rollout-marker'), rolloutSha);

    // Now add in-progress FD AFTER rollout marker
    await writeFile(
      join(repo, 'docs/features/post-rollout-feature.md'),
      makeInProgressFd('Post Rollout Feature'),
    );
    await commitAll(repo, 'feat(post-rollout-feature): create FD');

    const findings = await detectFdWithoutPlan(repo);
    expect(findings.filter((f) => f.slug === 'post-rollout-feature')).toHaveLength(1);
    expect(findings[0]!.reason).toBe('in-progress-post-rollout-no-plan');
  });

  it('does NOT flag in-progress post-rollout FD that has a matching plan', async () => {
    await writeFile(join(repo, 'dummy.txt'), 'initial');
    await commitAll(repo, 'chore: initial');
    const rolloutSha = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/rollout-marker'), rolloutSha);

    // Add FD and plan after rollout
    await writeFile(join(repo, 'docs/features/has-plan.md'), makeInProgressFd('Has Plan Feature'));
    await writeFile(join(repo, 'docs/superpowers/plans/2026-01-01-has-plan.md'), '# Has Plan\n');
    await commitAll(repo, 'feat(has-plan): create FD and plan');

    const findings = await detectFdWithoutPlan(repo);
    expect(findings.filter((f) => f.slug === 'has-plan')).toHaveLength(0);
  });
});
