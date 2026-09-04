// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../read-fd-summary.js', () => ({
  readFdSummary: vi.fn(async () => 'FD summary text'),
}));
vi.mock('../../../core/branch-added.js', () => ({
  discoverChangedFiles: vi.fn(() => []),
}));
import { discoverChangedFiles } from '../../../core/branch-added.js';

import { setDispatcher } from '../../lanes/subagent-dispatch.js';
import { mkFindingFor, resolveChangedFiles, runSubagent } from '../../lanes/subagent.js';
import { readFdSummary } from '../../read-fd-summary.js';
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
  artifact: 'docs/design/specs/x.md',
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
  it('lifts [mechanical] / [design] bullet tags into Finding.class and strips them', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      `Strengths: fine\n\nIssues:\n  Critical:\n    - [mechanical] missing section\n  Important:\n    - [design] wrong default\n  Minor:\n\nAssessment: needs changes\n`,
    );
    const r = await runSubagent(input());
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers).toEqual([
      expect.objectContaining({
        severity: 'high',
        class: 'mechanical',
        message: 'missing section',
      }),
      expect.objectContaining({ severity: 'med', class: 'design', message: 'wrong default' }),
    ]);
  });
  it('leaves an untagged bullet with NO class key, so autofix reads it as design', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      `Strengths: fine\n\nIssues:\n  Critical:\n    - unclassified finding\n  Important:\n  Minor:\n\nAssessment: needs changes\n`,
    );
    const r = await runSubagent(input());
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers).toHaveLength(1);
    expect(j.blockers[0].message).toBe('unclassified finding');
    expect('class' in j.blockers[0]).toBe(false);
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
  it('missing FD (ENOENT) → reviews with fallback summary instead of erroring', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    vi.mocked(readFdSummary).mockRejectedValueOnce(enoent);
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    expect(dispatchSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ fdSummary: expect.stringMatching(/no FD — fast-track/) }),
    );
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
  it('forwards LaneInput.dispatchTimeoutMs to the dispatcher as timeoutMs', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    await runSubagent({ ...input(), dispatchTimeoutMs: 777_000 });
    expect(dispatchSubagent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 777_000 }));
  });
  it('omits timeoutMs when the lane input carries none, leaving the dispatch default', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    await runSubagent(input());
    expect(Object.keys(dispatchSubagent.mock.calls[0][0])).not.toContain('timeoutMs');
  });
  it('forwards priorReview to the dispatcher and omits the key when absent', async () => {
    const clean = await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8');
    dispatchSubagent.mockResolvedValueOnce(clean);
    const prior = {
      mode: 'fixes-in-diff' as const,
      blockers: [{ file: 'docs/x.md', severity: 'high' as const, message: 'prior blocker' }],
    };
    await runSubagent({ ...input(), priorReview: prior });
    expect(dispatchSubagent).toHaveBeenCalledWith(expect.objectContaining({ priorReview: prior }));

    dispatchSubagent.mockResolvedValueOnce(clean);
    await runSubagent(input());
    expect(Object.keys(dispatchSubagent.mock.calls[1][0])).not.toContain('priorReview');
  });
  it('fullReview → prompt range collapses to equal shas (whole-artifact branch)', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    await runSubagent({ ...input(), fullReview: true });
    expect(dispatchSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ baseSha: 'aaa', headSha: 'aaa' }),
    );
  });
  it('fullReview keeps the rules-resolution base at the real change set', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    // kind 'code' is what routes through resolveBindingRules.
    await runSubagent({ ...input(), kind: 'code', fullReview: true });
    expect(vi.mocked(discoverChangedFiles)).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'parent', head: 'aaa' }),
    );
  });
  it("neither baseSha nor fullReview → today's HEAD~1 fallback range, unchanged", async () => {
    dispatchSubagent.mockResolvedValueOnce(
      await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8'),
    );
    const { baseSha: _drop, ...noBase } = input();
    await runSubagent(noBase as LaneInput);
    expect(dispatchSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ baseSha: 'aaa~1', headSha: 'aaa' }),
    );
  });
});

describe('resolveChangedFiles', () => {
  it('returns the changed set for a spec kind, not only code', () => {
    vi.mocked(discoverChangedFiles).mockReturnValueOnce(['docs/design/specs/a-design.md']);
    expect(resolveChangedFiles({ repoRoot: '/r', base: 'BASE', head: 'HEAD' })).toEqual([
      'docs/design/specs/a-design.md',
    ]);
    expect(discoverChangedFiles).toHaveBeenCalledWith({ cwd: '/r', base: 'BASE', head: 'HEAD' });
  });

  // Git failing here must degrade the feature, never turn a review into a lane
  // error — the same posture resolveBindingRules already takes.
  it('returns an empty set when git fails', () => {
    vi.mocked(discoverChangedFiles).mockImplementationOnce(() => {
      throw new Error('not a repository');
    });
    expect(resolveChangedFiles({ repoRoot: '/r', base: 'BASE', head: 'HEAD' })).toEqual([]);
  });
});

describe('mkFinding locations', () => {
  const changed = ['src/cr/orchestrate.ts'];

  it('attaches a resolved location and leaves the message intact', () => {
    const f = mkFindingFor('high', 'a.md', changed)('[design] `orchestrate.ts:475` returns early');
    expect(f.locations).toEqual([{ file: 'src/cr/orchestrate.ts', line: 475 }]);
    expect(f.message).toBe('`orchestrate.ts:475` returns early');
    expect(f.class).toBe('design');
  });

  it('omits the key when the bullet names no location', () => {
    const f = mkFindingFor('med', 'a.md', changed)('this is simply wrong');
    expect(f).not.toHaveProperty('locations');
  });

  it('omits the key when nothing resolves', () => {
    const f = mkFindingFor('med', 'a.md', changed)('`src/core/session.ts:10` is wrong');
    expect(f).not.toHaveProperty('locations');
  });
});
