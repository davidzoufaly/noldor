// @tests: autonomous-plan-to-pr-merge
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { promptSelect } = vi.hoisted(() => ({ promptSelect: vi.fn() }));
vi.mock('../prompt-stdin.js', () => ({ promptSelect, promptText: vi.fn() }));

import { guardStandaloneInProgress } from '../orchestrate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sip-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  promptSelect.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const writeStub = async (finishedAt: string | null) => {
  await writeFile(
    join(root, '.noldor', 'cr', 'x-spec-standalone.json'),
    JSON.stringify({
      lane: 'standalone',
      artifact: 'docs/x.md',
      kind: 'spec',
      slug: 'x',
      blockers: [],
      suggestions: [],
      summary: 'running',
      startedAt: '2026-05-25T00:00:00.000Z',
      ...(finishedAt ? { finishedAt } : {}),
    }),
    'utf8',
  );
};

describe('guardStandaloneInProgress', () => {
  it('no-op when no prior stub exists', async () => {
    const r = await guardStandaloneInProgress({ slug: 'x', kind: 'spec', cwd: root });
    expect(r).toBe('proceed');
    expect(promptSelect).not.toHaveBeenCalled();
  });
  it('no-op when prior stub has finishedAt set', async () => {
    await writeStub('2026-05-25T00:01:00.000Z');
    const r = await guardStandaloneInProgress({ slug: 'x', kind: 'spec', cwd: root });
    expect(r).toBe('proceed');
    expect(promptSelect).not.toHaveBeenCalled();
  });
  it('prompts when in-flight stub found; wait → skip-spawn', async () => {
    await writeStub(null);
    promptSelect.mockResolvedValueOnce('wait');
    const r = await guardStandaloneInProgress({ slug: 'x', kind: 'spec', cwd: root });
    expect(r).toBe('skip-spawn');
  });
  it('kill-and-respawn → proceed (operator manually closes prior iTerm2)', async () => {
    await writeStub(null);
    promptSelect.mockResolvedValueOnce('kill-and-respawn');
    const r = await guardStandaloneInProgress({ slug: 'x', kind: 'spec', cwd: root });
    expect(r).toBe('proceed');
  });
  it('continue-without-lane → drop-lane', async () => {
    await writeStub(null);
    promptSelect.mockResolvedValueOnce('continue-without-lane');
    const r = await guardStandaloneInProgress({ slug: 'x', kind: 'spec', cwd: root });
    expect(r).toBe('drop-lane');
  });
  it('autonomous mode returns drop-lane without prompting on stuck standalone', async () => {
    await writeStub(null);
    const r = await guardStandaloneInProgress(
      { slug: 'x', kind: 'spec', cwd: root },
      { autonomous: true },
    );
    expect(promptSelect).not.toHaveBeenCalled();
    expect(r).toBe('drop-lane');
  });
});
