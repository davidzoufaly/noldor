// @tests: milestone-membership-has-no-tagger-and-no-counter, decouple-milestones-from-semver, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering, sdd-detector-5-idea-merge-semantic-similarity
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSddFeatures } from '../../core/fd-load.js';
import { parseBacklog, parseRoadmap } from '../../utils/parse-blocks.js';
import { assignMain } from '../assign-cli.js';
import { renderMilestoneShow } from '../lib.js';

let repo: string;
let out: string;
let err: string;

const io = {
  out: (s: string) => {
    out += s;
  },
  err: (s: string) => {
    err += s;
  },
};

const run = (...argv: string[]): Promise<number> => assignMain(argv, repo, io);
const read = (rel: string): Promise<string> => readFile(join(repo, rel), 'utf8');

const milestoneMd = (name: string, status: string): string =>
  ['---', `name: ${name}`, `status: ${status}`, '---', 'body', ''].join('\n');

const featureMd = (name: string, extra: string[] = []): string =>
  [
    '---',
    `name: ${name}`,
    'phase: in-progress',
    'area: tooling',
    'category: Tooling',
    'packages:',
    '  - tooling',
    'noldor-tier: specs-only',
    ...extra,
    'links:',
    '  code: []',
    '  tests: []',
    '---',
    '',
    '## Summary',
    '',
    'Body.',
    '',
  ].join('\n');

const block = (name: string, fields: string[]): string[] => [
  `### ${name}`,
  '',
  ...fields,
  '',
  `${name} body.`,
  '',
];

beforeEach(async () => {
  out = '';
  err = '';
  repo = await mkdtemp(join(tmpdir(), 'milestone-assign-'));
  await mkdir(join(repo, 'docs/features'), { recursive: true });
  await mkdir(join(repo, 'docs/milestones'), { recursive: true });
  await writeFile(join(repo, 'docs/milestones/mvp.md'), milestoneMd('mvp', 'active'));
  await writeFile(join(repo, 'docs/milestones/next.md'), milestoneMd('next', 'draft'));
  await writeFile(join(repo, 'docs/milestones/old.md'), milestoneMd('old', 'shipped'));
  await writeFile(
    join(repo, 'docs/roadmap.md'),
    [
      '# Roadmap',
      '',
      ...block('Untagged Entry', ['- id: Q-0001', '- area: tooling', '- size: S']),
      ...block('Tagged Entry', ['- id: Q-0002', '- area: tooling', '- milestone: next']),
      ...block('Shared Name', ['- id: Q-0003', '- area: tooling']),
    ].join('\n'),
  );
  await writeFile(
    join(repo, 'docs/backlog.md'),
    ['# Backlog', '', ...block('Parked Entry', ['- id: Q-0004', '- area: tooling'])].join('\n'),
  );
  await writeFile(
    join(repo, 'docs/features/some-fd.md'),
    featureMd('some-fd', ['entry-id: Q-0005']),
  );
  await writeFile(join(repo, 'docs/features/shared-name.md'), featureMd('shared-name'));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe(assignMain, () => {
  it('tags a roadmap entry, a backlog entry by ID and a feature MD in one call', async () => {
    expect(await run('mvp', 'untagged-entry', 'Q-0004', 'some-fd')).toBe(0);

    const roadmap = parseRoadmap(await read('docs/roadmap.md'));
    expect(roadmap.find((e) => e.slug === 'untagged-entry')?.milestone).toBe('mvp');
    expect(roadmap.find((e) => e.slug === 'tagged-entry')?.milestone).toBe('next');
    expect(parseBacklog(await read('docs/backlog.md'))[0]?.milestone).toBe('mvp');
    const features = await loadSddFeatures(join(repo, 'docs/features'));
    expect(features.find((f) => f.slug === 'some-fd')?.frontmatter.milestone).toBe('mvp');
  });

  it('finds a feature MD by its entry-id', async () => {
    expect(await run('mvp', 'Q-0005')).toBe(0);
    expect(await read('docs/features/some-fd.md')).toMatch(/^milestone: mvp$/m);
  });

  it('changes nothing on a re-run', async () => {
    expect(await run('mvp', 'untagged-entry', 'some-fd')).toBe(0);
    const roadmap = await read('docs/roadmap.md');
    const fd = await read('docs/features/some-fd.md');
    out = '';
    expect(await run('mvp', 'untagged-entry', 'some-fd')).toBe(0);
    expect(await read('docs/roadmap.md')).toBe(roadmap);
    expect(await read('docs/features/some-fd.md')).toBe(fd);
    expect(out).toMatch(/^noop/m);
  });

  it('refuses a different milestone unless --replace', async () => {
    const before = await read('docs/roadmap.md');
    expect(await run('mvp', 'tagged-entry')).toBe(1);
    expect(await read('docs/roadmap.md')).toBe(before);

    expect(await run('mvp', 'tagged-entry', '--replace')).toBe(0);
    const entry = parseRoadmap(await read('docs/roadmap.md')).find(
      (e) => e.slug === 'tagged-entry',
    );
    expect(entry?.milestone).toBe('mvp');
  });

  it('refuses a name that matches both a queue block and a feature MD, naming both', async () => {
    expect(await run('mvp', 'shared-name')).toBe(1);
    expect(out).toContain('roadmap:shared-name');
    expect(out).toContain('feature:shared-name');
    // The ID picks one of them.
    expect(await run('mvp', 'Q-0003')).toBe(0);
  });

  it('writes nothing when any one target refuses', async () => {
    const roadmap = await read('docs/roadmap.md');
    const fd = await read('docs/features/some-fd.md');
    expect(await run('mvp', 'untagged-entry', 'some-fd', 'no-such-thing')).toBe(1);
    expect(await read('docs/roadmap.md')).toBe(roadmap);
    expect(await read('docs/features/some-fd.md')).toBe(fd);
  });

  it.each([
    ['an unknown milestone', 'nope'],
    ['a shipped milestone', 'old'],
    ['a traversal slug', '../x'],
  ])('refuses %s', async (_label, milestone) => {
    const roadmap = await read('docs/roadmap.md');
    expect(await run(milestone, 'untagged-entry')).toBe(1);
    expect(await read('docs/roadmap.md')).toBe(roadmap);
  });

  it('exits 2 without a target', async () => {
    expect(await run('mvp')).toBe(2);
  });

  it('moves the milestone counter once the tagged feature is done', async () => {
    expect(await run('mvp', 'some-fd')).toBe(0);
    const shown = await renderMilestoneShow('mvp', repo);
    expect(shown.ok && shown.text).toContain('Features (0/1 done)');

    const fd = await read('docs/features/some-fd.md');
    await writeFile(
      join(repo, 'docs/features/some-fd.md'),
      fd.replace('phase: in-progress', 'phase: done'),
    );
    const after = await renderMilestoneShow('mvp', repo);
    expect(after.ok && after.text).toContain('Features (1/1 done)');
  });
});
