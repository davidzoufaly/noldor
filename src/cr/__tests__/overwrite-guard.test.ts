// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { promptSelect } = vi.hoisted(() => ({ promptSelect: vi.fn() }));
vi.mock('../../core/prompt-stdin.js', () => ({ promptSelect, promptText: vi.fn() }));

import { guardLaneOverwrite } from '../orchestrate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guard-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  promptSelect.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const writePrior = async (file: string, finishedAt: string | null = '2026-05-25T00:00:00.000Z') => {
  await writeFile(
    join(root, '.noldor', 'cr', file),
    JSON.stringify({
      lane: file.split('-').pop()!.replace('.json', ''),
      artifact: 'x',
      kind: 'spec',
      slug: 'x',
      blockers: [],
      suggestions: [],
      summary: 'prior',
      startedAt: '2026-05-25T00:00:00.000Z',
      ...(finishedAt ? { finishedAt } : {}),
    }),
    'utf8',
  );
};

describe('guardLaneOverwrite', () => {
  it('returns lanes unchanged when no priors', async () => {
    const r = await guardLaneOverwrite(['manual'], { slug: 'x', kind: 'spec', cwd: root });
    expect(r).toEqual(['manual']);
  });
  it('prompts on completed prior + overwrite picks proceed', async () => {
    await writePrior('x-spec-manual.json');
    promptSelect.mockResolvedValueOnce('overwrite');
    const r = await guardLaneOverwrite(['manual'], { slug: 'x', kind: 'spec', cwd: root });
    expect(r).toEqual(['manual']);
  });
  it('keep-and-skip drops the lane', async () => {
    await writePrior('x-spec-manual.json');
    promptSelect.mockResolvedValueOnce('skip');
    const r = await guardLaneOverwrite(['manual', 'reviewer'], {
      slug: 'x',
      kind: 'spec',
      cwd: root,
    });
    expect(r).toEqual(['reviewer']);
  });
  it('archive-and-overwrite copies prior to archive/', async () => {
    await writePrior('x-spec-manual.json');
    promptSelect.mockResolvedValueOnce('archive');
    const r = await guardLaneOverwrite(['manual'], { slug: 'x', kind: 'spec', cwd: root });
    expect(r).toEqual(['manual']);
    const archive = await readdir(join(root, '.noldor', 'cr', 'archive'));
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatch(/x-spec-manual\.json$/);
  });
  it('never offers keep-and-skip for the mandatory reviewer lane on spec/plan', async () => {
    await writePrior('x-spec-reviewer.json');
    promptSelect.mockResolvedValueOnce('overwrite');
    const r = await guardLaneOverwrite(['reviewer'], { slug: 'x', kind: 'spec', cwd: root });
    expect(r).toEqual(['reviewer']);
    const offered = promptSelect.mock.calls[0][0].choices.map((c: { value: string }) => c.value);
    expect(offered).toEqual(['overwrite', 'archive']);
    // ...but code may still skip its reviewer lane (receipt trailer enforces there).
    promptSelect.mockResolvedValueOnce('overwrite');
    await writePrior('x-code-reviewer.json');
    await guardLaneOverwrite(['reviewer'], { slug: 'x', kind: 'code', cwd: root });
    const offeredForCode = promptSelect.mock.calls[1][0].choices.map(
      (c: { value: string }) => c.value,
    );
    expect(offeredForCode).toContain('skip');
  });
  it('keeps the mandatory reviewer lane even if a skip choice comes back anyway', async () => {
    await writePrior('x-plan-reviewer.json');
    promptSelect.mockResolvedValueOnce('skip');
    const r = await guardLaneOverwrite(['reviewer'], { slug: 'x', kind: 'plan', cwd: root });
    expect(r).toEqual(['reviewer']);
  });
  it('autonomous mode defaults to archive-and-overwrite without prompting', async () => {
    await writePrior('x-spec-manual.json');
    const r = await guardLaneOverwrite(
      ['manual'],
      { slug: 'x', kind: 'spec', cwd: root },
      { autonomous: true },
    );
    expect(promptSelect).not.toHaveBeenCalled();
    expect(r).toEqual(['manual']);
    const archive = await readdir(join(root, '.noldor', 'cr', 'archive'));
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatch(/x-spec-manual\.json$/);
  });
});
