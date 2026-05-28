import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../read-fd-summary.js', () => ({
  readFdSummary: vi.fn(async () => 'FD summary text'),
}));

import { setDispatcher } from '../../lanes/subagent-dispatch.js';
import { runSubagent } from '../../lanes/subagent.js';
import type { LaneInput } from '../../lane-types.js';

const dispatchSubagent = vi.fn();
beforeEach(() => {
  setDispatcher(dispatchSubagent);
});

const FIX = resolve(__dirname, '..', 'fixtures');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sub-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  dispatchSubagent.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const input = (): LaneInput => ({
  slug: 'x',
  artifact: 'docs/superpowers/specs/x.md',
  kind: 'spec',
  fdPath: 'docs/features/x.md',
  artifactSha: 'aaa',
  baseSha: 'parent',
  repoRoot: root,
});

describe('runSubagent', () => {
  it('clean markdown → approve summary, empty blockers', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.summary).toBe('approve');
    expect(j.notes?.[0]).toMatch(/clear summary/);
  });
  it('issues markdown → maps Critical→blocker.high, Important→blocker.med, Minor→suggestion.low', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-issues.md'), 'utf8'),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers.map((b: { severity: string }) => b.severity).toSorted()).toEqual([
      'high',
      'med',
    ]);
    expect(j.suggestions).toHaveLength(1);
    expect(j.suggestions[0].severity).toBe('low');
  });
  it('malformed markdown → synthetic blocker', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-malformed.md'), 'utf8'),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers[0].message).toMatch(/malformed/i);
  });
  it('tolerates bolded + h3-decorated headings (real subagent output)', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-bolded.md'), 'utf8'),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers).toHaveLength(1);
    expect(j.blockers[0].severity).toBe('high');
    expect(j.summary).toBe('blockers found');
  });
  it('dispatch error → synthetic blocker', async () => {
    dispatchSubagent.mockRejectedValueOnce(new Error('claude not on PATH'));
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers).toHaveLength(1);
    expect(j.blockers[0].severity).toBe('high');
    expect(j.blockers[0].message).toMatch(/subagent.*errored.*claude not on PATH/i);
    expect(j.summary).toBe('subagent error');
  });
});
