import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectMilestoneShippedIncomplete } from '../milestone-shipped-incomplete.js';

// @tests: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'milestone-detector-'));
  await mkdir(join(root, 'docs/features'), { recursive: true });
  await mkdir(join(root, 'docs/milestones'), { recursive: true });
  return root;
}

async function writeMilestone(repo: string, slug: string, status: string): Promise<void> {
  await writeFile(
    join(repo, 'docs/milestones', `${slug}.md`),
    ['---', `name: ${slug}`, `status: ${status}`, '---', 'body'].join('\n'),
  );
}

async function writeFeature(
  repo: string,
  slug: string,
  phase: string,
  milestone?: string,
): Promise<void> {
  await writeFile(
    join(repo, 'docs/features', `${slug}.md`),
    [
      '---',
      `name: ${slug}`,
      `phase: ${phase}`,
      'area: test',
      'category: Tooling',
      "packages:\n  - '@acme/web'",
      'noldor-tier: specs-only',
      ...(milestone ? [`milestone: ${milestone}`] : []),
      'links:',
      '  code: []',
      '  tests: []',
      '  docs: []',
      '---',
      'body',
    ].join('\n'),
  );
}

describe('detectMilestoneShippedIncomplete', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('flags a shipped milestone with an in-progress feature (exactly one finding)', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeFeature(repo, 'open-feat', 'in-progress', 'mvp');
    const findings = await detectMilestoneShippedIncomplete(repo);
    expect(findings).toEqual([
      {
        slug: 'open-feat',
        path: join('docs/features', 'open-feat.md'),
        milestone: 'mvp',
        phase: 'in-progress',
        reason: 'shipped-milestone-incomplete-feature',
      },
    ]);
  });

  it('does NOT flag a shipped milestone whose feature is done', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeFeature(repo, 'done-feat', 'done', 'mvp');
    expect(await detectMilestoneShippedIncomplete(repo)).toEqual([]);
  });

  it('does NOT flag an active (not shipped) milestone with an in-progress feature', async () => {
    await writeMilestone(repo, 'mvp', 'active');
    await writeFeature(repo, 'open-feat', 'in-progress', 'mvp');
    expect(await detectMilestoneShippedIncomplete(repo)).toEqual([]);
  });

  it('no-op when no feature carries a milestone field', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeFeature(repo, 'plain', 'in-progress'); // no milestone field
    expect(await detectMilestoneShippedIncomplete(repo)).toEqual([]);
  });
});

// @tests: decouple-milestones-from-semver
describe('detectMilestoneShippedIncomplete — queued entries', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const block = (name: string, milestone?: string): string =>
    [
      `### ${name}`,
      '',
      '- area: tooling',
      '- type: feat',
      '- since: 2026-09-06',
      ...(milestone ? [`- milestone: ${milestone}`] : []),
      '',
      'Body.',
      '',
    ].join('\n');

  it('flags a roadmap entry naming a shipped milestone', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeFile(join(repo, 'docs/roadmap.md'), block('Still Queued', 'mvp'));
    const findings = await detectMilestoneShippedIncomplete(repo);
    expect(findings).toEqual([
      {
        slug: 'still-queued',
        path: 'docs/roadmap.md',
        milestone: 'mvp',
        phase: 'queued',
        reason: 'shipped-milestone-queued-entry',
      },
    ]);
  });

  it('flags a backlog entry the same way', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeFile(join(repo, 'docs/backlog.md'), block('Parked', 'mvp'));
    const findings = await detectMilestoneShippedIncomplete(repo);
    expect(findings[0]?.path).toBe('docs/backlog.md');
    expect(findings[0]?.reason).toBe('shipped-milestone-queued-entry');
  });

  it('ignores entries naming a milestone that is not shipped, or none at all', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    await writeMilestone(repo, 'next', 'active');
    await writeFile(
      join(repo, 'docs/roadmap.md'),
      block('Other Milestone', 'next') + block('No Milestone'),
    );
    expect(await detectMilestoneShippedIncomplete(repo)).toEqual([]);
  });

  // Queue files are optional: a repo may carry only one, or neither.
  it('returns no queue findings when the queue files are absent', async () => {
    await writeMilestone(repo, 'mvp', 'shipped');
    expect(await detectMilestoneShippedIncomplete(repo)).toEqual([]);
  });
});
