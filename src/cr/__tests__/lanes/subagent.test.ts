// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer, cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../read-fd-summary.js', () => ({
  readFdSummary: vi.fn(async () => 'FD summary text'),
}));
vi.mock('../../../core/branch-added.js', () => ({
  discoverChangedFiles: vi.fn(() => []),
}));
import { discoverChangedFiles } from '../../../core/branch-added.js';

import { setDispatcher } from '../../lanes/subagent-dispatch.js';
import {
  normalizeFinding,
  resolveChangedFiles,
  runSubagent,
  toSinkFinding,
} from '../../lanes/subagent.js';
import { readFdSummary } from '../../read-fd-summary.js';
import type { LaneInput } from '../../lane-types.js';

const dispatchSubagent = vi.fn();
beforeEach(() => {
  setDispatcher(dispatchSubagent);
});

/** What the reviewer child writes to its answer file. */
const answer = (findings: unknown[] = [], assessment = 'approve — clear summary'): string =>
  JSON.stringify({ assessment, strengths: 'clear summary', findings });
const CLEAN = answer();

const sinkOf = async (r: { sinkPath: string }): Promise<Record<string, any>> =>
  JSON.parse(await readFile(r.sinkPath, 'utf8')) as Record<string, any>;

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
  it('clean answer → approve summary, empty blockers, the assessment kept in notes', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.summary).toBe('approve');
    expect(j.blockers).toEqual([]);
    expect(j.notes).toEqual(
      expect.arrayContaining(['Assessment: approve — clear summary', 'Strengths: clear summary']),
    );
  });

  it('maps severity × blocking into blockers and suggestions', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer(
        [
          { severity: 'critical', blocking: true, class: 'mechanical', message: 'missing section' },
          { severity: 'important', blocking: true, class: 'design', message: 'wrong default' },
          { severity: 'important', blocking: false, message: 'cleanup worth doing' },
          { severity: 'minor', blocking: false, message: 'typo' },
        ],
        'blockers found',
      ),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = await sinkOf(r);
    expect(j.summary).toBe('blockers found (2)');
    expect(j.blockers).toEqual([
      expect.objectContaining({
        severity: 'high',
        class: 'mechanical',
        message: 'missing section',
      }),
      expect.objectContaining({ severity: 'med', class: 'design', message: 'wrong default' }),
    ]);
    expect(j.suggestions.map((s: { severity: string }) => s.severity)).toEqual(['med', 'low']);
  });

  it('approves over non-blocking Important findings, keeping them as suggestions', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'important', blocking: false, message: 'the two Important items are cleanup' },
      ]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.summary).toBe('approve');
    expect(j.suggestions).toHaveLength(1);
  });

  it('never lets a minor, maybe: or unverified: finding block, whatever its flag says', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'minor', blocking: true, message: 'nit' },
        { severity: 'critical', blocking: true, message: 'maybe: a race in the retry loop' },
        { severity: 'important', blocking: true, message: 'Unverified: pnpm typecheck may fail' },
      ]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    expect((await sinkOf(r)).suggestions).toHaveLength(3);
  });

  it('drops placeholder findings, so (none) can never block (Q-0246 replay)', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'critical', blocking: true, message: '(none)' },
        { severity: 'important', blocking: true, message: '- None.' },
      ]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.blockers).toEqual([]);
    expect(j.summary).toBe('approve');
  });

  it('a blocking finding without a class carries no class key, so autofix reads it as design', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([{ severity: 'critical', blocking: true, message: 'unclassified finding' }]),
    );
    const j = await sinkOf(await runSubagent(input()));
    expect(j.blockers).toHaveLength(1);
    expect('class' in j.blockers[0]).toBe(false);
  });

  it('an unreadable answer, even after the repair round, → synthetic blocker', async () => {
    dispatchSubagent.mockResolvedValue(
      'Strengths: fine\n\nIssues:\n  Critical:\n    - (none)\n\nAssessment: approve',
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    expect(dispatchSubagent).toHaveBeenCalledTimes(2);
    expect((await sinkOf(r)).blockers[0].message).toMatch(/no trustworthy answer/);
  });

  it('missing FD (ENOENT) → reviews with fallback summary instead of erroring', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    vi.mocked(readFdSummary).mockRejectedValueOnce(enoent);
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
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
    expect(j.blockers[0].file).toBe('<reviewer>');
    expect(j.summary).toBe('subagent error');
  });
  it('forwards LaneInput.dispatchTimeoutMs to the dispatcher as timeoutMs', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    await runSubagent({ ...input(), dispatchTimeoutMs: 777_000 });
    expect(dispatchSubagent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 777_000 }));
  });
  it('omits timeoutMs when the lane input carries none, leaving the dispatch default', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    await runSubagent(input());
    expect(Object.keys(dispatchSubagent.mock.calls[0][0])).not.toContain('timeoutMs');
  });
  it('forwards priorReview to the dispatcher and omits the key when absent', async () => {
    const clean = CLEAN;
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
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    await runSubagent({ ...input(), fullReview: true });
    expect(dispatchSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ baseSha: 'aaa', headSha: 'aaa' }),
    );
  });
  it('fullReview keeps the rules-resolution base at the real change set', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    // kind 'code' is what routes through resolveBindingRules.
    await runSubagent({ ...input(), kind: 'code', fullReview: true });
    expect(vi.mocked(discoverChangedFiles)).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'parent', head: 'aaa' }),
    );
  });
  it("neither baseSha nor fullReview → today's HEAD~1 fallback range, unchanged", async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    const { baseSha: _drop, ...noBase } = input();
    await runSubagent(noBase as LaneInput);
    expect(dispatchSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ baseSha: 'aaa~1', headSha: 'aaa' }),
    );
  });
});

describe('runSubagent re-round (Q-0260)', () => {
  const p1 = {
    file: 'docs/design/specs/x.md',
    severity: 'high' as const,
    message: 'first prior',
    class: 'design' as const,
  };
  const p2 = { file: 'docs/design/specs/x.md', severity: 'med' as const, message: 'second prior' };
  const reRound = (): LaneInput => ({
    ...input(),
    priorReview: { mode: 'fixes-in-diff', blockers: [p1, p2] },
  });
  const withPrior = (prior: unknown[], findings: unknown[] = []): string =>
    JSON.stringify({ assessment: 'checked the fix', strengths: 's', findings, prior });

  it('resolving every prior and adding one non-blocking finding writes a green sink', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      withPrior(
        [
          { n: 1, resolved: true, why: 'the section now says it' },
          { n: 2, resolved: true, why: 'removed' },
        ],
        [
          {
            severity: 'important',
            blocking: false,
            message: 'the added sentence could be tighter',
          },
        ],
      ),
    );
    const r = await runSubagent(reRound());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.summary).toBe('approve');
    expect(j.blockers).toEqual([]);
    expect(j.suggestions).toHaveLength(1);
    expect(j.notes).toEqual(expect.arrayContaining(['prior P1 resolved: the section now says it']));
  });

  it('re-files a prior that still stands, and an unanswered one, verbatim ahead of new blockers', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      withPrior(
        [{ n: 1, resolved: false, why: 'the fix missed the second caller' }],
        [
          {
            severity: 'critical',
            blocking: true,
            class: 'mechanical',
            message: 'the fix broke the parser',
          },
        ],
      ),
    );
    const r = await runSubagent(reRound());
    expect(r.ok).toBe(false);
    const j = await sinkOf(r);
    expect(j.blockers.map((b: { message: string }) => b.message)).toEqual([
      'first prior',
      'second prior',
      'the fix broke the parser',
    ]);
    expect(j.blockers[0]).toEqual(p1);
    expect(j.blockers[1]).toEqual(p2);
    expect(j.summary).toBe('blockers found (3)');
    expect(j.notes).toEqual(
      expect.arrayContaining([
        'prior P1 still stands: the fix missed the second caller',
        'prior P2 unanswered — carried',
      ]),
    );
  });

  it('a dispatch error after being given priors keeps them behind its own failure blocker', async () => {
    dispatchSubagent.mockRejectedValueOnce(new Error('claude not on PATH'));
    const r = await runSubagent(reRound());
    expect(r.ok).toBe(false);
    const j = await sinkOf(r);
    expect(j.blockers).toHaveLength(3);
    expect(j.blockers[0].file).toBe('<reviewer>');
    expect(j.blockers.slice(1)).toEqual([p1, p2]);
  });

  it('an untrustworthy answer after being given priors keeps them behind its own failure blocker', async () => {
    dispatchSubagent.mockResolvedValue('not json at all');
    const r = await runSubagent(reRound());
    const j = await sinkOf(r);
    expect(j.blockers[0].file).toBe('<reviewer>');
    expect(j.blockers[0].message).toMatch(/no trustworthy answer/);
    expect(j.blockers.slice(1)).toEqual([p1, p2]);
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

describe('toSinkFinding / normalizeFinding', () => {
  const changed = ['src/cr/orchestrate.ts'];
  const toSink = toSinkFinding('a.md', changed);

  it('attaches a resolved location and leaves the message intact', () => {
    const f = toSink({
      severity: 'critical',
      blocking: true,
      class: 'design',
      message: '`orchestrate.ts:475` returns early',
    });
    expect(f).toMatchObject({
      severity: 'high',
      class: 'design',
      message: '`orchestrate.ts:475` returns early',
      locations: [{ file: 'src/cr/orchestrate.ts', line: 475 }],
    });
  });

  it('lifts a leftover [mechanical] message prefix into class when the field is absent', () => {
    expect(
      normalizeFinding({
        severity: 'important',
        blocking: true,
        message: '[mechanical] missing section',
      }),
    ).toMatchObject({ class: 'mechanical', message: 'missing section' });
  });

  it('omits locations when the message names none, or none resolves', () => {
    expect(
      toSink({ severity: 'minor', blocking: false, message: 'this is simply wrong' }),
    ).not.toHaveProperty('locations');
    expect(
      toSink({ severity: 'minor', blocking: false, message: '`src/core/session.ts:10` is wrong' }),
    ).not.toHaveProperty('locations');
  });
});
