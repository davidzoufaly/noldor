import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectPlanWithoutFd } from '../plan-without-fd.js';

// @tests: noldor, outcome-telemetry-and-effectiveness-metrics

const DONE_FD = `---
name: My Feature
phase: done
introduced: 1.0.0
area: test
category: Tooling
packages:
  - '@acme/web'
links:
  code: []
  tests: []
  docs: []
---
body
`;

const IN_PROGRESS_FD = `---
name: My Feature
phase: in-progress
area: test
category: Tooling
packages:
  - '@acme/web'
links:
  code: []
  tests: []
  docs: []
---
body
`;

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-without-fd-'));
  await mkdir(join(root, 'docs/design/plans'), { recursive: true });
  await mkdir(join(root, 'docs/features'), { recursive: true });
  // Init git repo so we can also test with real slugs
  spawnSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'ignore' });
  return root;
}

describe('detectPlanWithoutFd', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns no findings when plan has a matching FD', async () => {
    await writeFile(
      join(repo, 'docs/design/plans/2026-01-01-my-feature.md'),
      '# My Feature Plan\n',
    );
    await writeFile(join(repo, 'docs/features/my-feature.md'), DONE_FD);

    const findings = await detectPlanWithoutFd(repo);
    expect(findings).toHaveLength(0);
  });

  it('flags a plan file whose slug has no matching FD', async () => {
    await writeFile(join(repo, 'docs/design/plans/2026-01-01-orphan-plan.md'), '# Orphan Plan\n');

    const findings = await detectPlanWithoutFd(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slug).toBe('orphan-plan');
    expect(findings[0]!.reason).toBe('no-matching-fd');
  });

  it('flags plans for in-progress FDs too — plan-without-fd only checks plan existence', async () => {
    await writeFile(
      join(repo, 'docs/design/plans/2026-01-01-in-progress.md'),
      '# In Progress Plan\n',
    );
    await writeFile(join(repo, 'docs/features/in-progress.md'), IN_PROGRESS_FD);

    const findings = await detectPlanWithoutFd(repo);
    expect(findings).toHaveLength(0);
  });

  it('ignores plan files that do not match the date-slug naming convention', async () => {
    await writeFile(join(repo, 'docs/design/plans/README.md'), '# Plans readme\n');

    const findings = await detectPlanWithoutFd(repo);
    expect(findings).toHaveLength(0);
  });

  it('flags multiple orphan plans', async () => {
    await writeFile(join(repo, 'docs/design/plans/2026-01-01-orphan-a.md'), '# A\n');
    await writeFile(join(repo, 'docs/design/plans/2026-01-02-orphan-b.md'), '# B\n');

    const findings = await detectPlanWithoutFd(repo);
    expect(findings).toHaveLength(2);
  });
});
