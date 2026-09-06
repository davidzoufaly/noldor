import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderMilestoneShow } from '../lib.js';

// @tests: decouple-milestones-from-semver

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'milestone-show-'));
  await mkdir(join(repo, 'docs/features'), { recursive: true });
  await mkdir(join(repo, 'docs/milestones'), { recursive: true });
  await writeFile(
    join(repo, 'docs/milestones/mvp.md'),
    ['---', 'name: mvp', 'status: active', 'description: the first gate', '---', 'body'].join('\n'),
  );
  await writeFile(
    join(repo, 'docs/features/shipped-thing.md'),
    [
      '---',
      'name: shipped-thing',
      'phase: done',
      'area: test',
      'category: Tooling',
      "packages:\n  - '@acme/web'",
      'noldor-tier: specs-only',
      'milestone: mvp',
      'links:',
      '  code: []',
      '  tests: []',
      '  docs: []',
      '---',
      'body',
    ].join('\n'),
  );
  await writeFile(
    join(repo, 'docs/roadmap.md'),
    [
      '### Queued Thing',
      '',
      '- area: tooling',
      '- type: feat',
      '- since: 2026-09-06',
      '- size: S',
      '- milestone: mvp',
      '',
      'Body.',
      '',
      '### Elsewhere',
      '',
      '- area: tooling',
      '- milestone: other',
      '',
      'Body.',
      '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe(renderMilestoneShow, () => {
  it('lists both the features and the queue entries naming the milestone', async () => {
    const result = await renderMilestoneShow('mvp', repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('shipped-thing');
    expect(result.text).toContain('queued-thing');
    expect(result.text).toContain('Features (1/1 done)');
    expect(result.text).toContain('Queued (1)');
  });

  it('omits work that names a different milestone', async () => {
    const result = await renderMilestoneShow('mvp', repo);
    expect(result.ok && result.text).not.toContain('elsewhere');
  });

  it('refuses an unknown slug, naming it', async () => {
    const result = await renderMilestoneShow('nope', repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('nope');
  });

  // The queue files are optional; a repo may carry neither.
  it('reports an empty queue when no roadmap or backlog exists', async () => {
    await rm(join(repo, 'docs/roadmap.md'));
    const result = await renderMilestoneShow('mvp', repo);
    expect(result.ok && result.text).toContain('Queued (0)');
  });
});
