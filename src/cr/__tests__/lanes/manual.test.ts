// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { promptText, promptSelect } = vi.hoisted(() => ({
  promptText: vi.fn(),
  promptSelect: vi.fn(),
}));

vi.mock('../../../core/prompt-stdin.js', () => ({ promptText, promptSelect }));

import { runManual } from '../../lanes/manual.js';
import type { LaneInput } from '../../lane-types.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'manual-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  promptText.mockReset();
  promptSelect.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const input = (over: Partial<LaneInput> = {}): LaneInput => ({
  slug: 'x',
  artifact: 'docs/superpowers/specs/x.md',
  kind: 'spec',
  fdPath: 'docs/features/x.md',
  artifactSha: 'aaa',
  repoRoot: root,
  ...over,
});

describe('runManual', () => {
  it('writes approve JSON on approve verdict', async () => {
    promptSelect.mockResolvedValueOnce('approve');
    const r = await runManual(input());
    expect(r.ok).toBe(true);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.summary).toMatch(/approved/);
    expect(j.blockers).toEqual([]);
  });
  it('loops on blockers-found verdict, collecting findings', async () => {
    promptSelect
      .mockResolvedValueOnce('blockers-found')
      .mockResolvedValueOnce('high') // severity
      .mockResolvedValueOnce('done'); // continue prompt → done
    promptText
      .mockResolvedValueOnce('missing type') // message
      .mockResolvedValueOnce('add z.string()'); // suggestion
    const r = await runManual(input());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers).toHaveLength(1);
    expect(j.blockers[0].severity).toBe('high');
    expect(j.blockers[0].message).toBe('missing type');
    expect(j.blockers[0].suggestion).toBe('add z.string()');
  });
  it('writes the artifact path into Finding.file', async () => {
    promptSelect
      .mockResolvedValueOnce('blockers-found')
      .mockResolvedValueOnce('low')
      .mockResolvedValueOnce('done');
    promptText.mockResolvedValueOnce('m').mockResolvedValueOnce('');
    const r = await runManual(input({ artifact: 'docs/x.md' }));
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers[0].file).toBe('docs/x.md');
  });
});
