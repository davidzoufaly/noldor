// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer, cr-lane-verdicts-blocked-by-serialization-not-substance, cr-re-round-cap-enforcement-and-oscillation-detector, spec-stage-cr-stopping-rule
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

// Kind `plan`: these cases pin behaviour every kind shares. At kind `spec` a blocking finding
// also needs a basis (Q-0263), which has its own describe block below.
const input = (): LaneInput => ({
  slug: 'x',
  artifact: 'docs/design/plans/x.md',
  kind: 'plan',
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

describe('runSubagent at kind spec — a blocker names its basis (Q-0263)', () => {
  const spec = (): LaneInput => ({ ...input(), artifact: 'docs/design/specs/x.md', kind: 'spec' });

  // The rule removes blockers, so it fails in two directions. This table is the one that must
  // still report: a blocking finding with each basis stays a blocker and keeps its basis.
  it.each(['requirement', 'feasibility', 'risk'])(
    'keeps a blocking finding whose basis is %s as a blocker, basis recorded',
    async (basis) => {
      dispatchSubagent.mockResolvedValueOnce(
        answer(
          [
            {
              severity: 'important',
              blocking: true,
              class: 'design',
              basis,
              message: 'the spec never says who retries',
            },
          ],
          'blockers found',
        ),
      );
      const r = await runSubagent(spec());
      expect(r.ok).toBe(false);
      const j = await sinkOf(r);
      expect(j.blockers).toEqual([
        {
          file: 'docs/design/specs/x.md',
          severity: 'med',
          class: 'design',
          basis,
          message: 'the spec never says who retries',
        },
      ]);
      expect(j.summary).toBe('blockers found (1)');
    },
  );

  // ...and the one that must drop: one row per shape a missing basis arrives in.
  it.each([
    ['no basis key', {}],
    ['a null basis', { basis: null }],
    ['an unknown basis', { basis: 'wording' }],
  ])(
    'files a blocking finding with %s as a suggestion, with no basis recorded',
    async (_shape, extra) => {
      dispatchSubagent.mockResolvedValueOnce(
        answer(
          [
            {
              severity: 'critical',
              blocking: true,
              class: 'mechanical',
              message: 'reword the Goals section',
              ...extra,
            },
          ],
          'blockers found',
        ),
      );
      const r = await runSubagent(spec());
      expect(r.ok).toBe(true);
      const j = await sinkOf(r);
      expect(j.blockers).toEqual([]);
      expect(j.suggestions).toEqual([
        {
          file: 'docs/design/specs/x.md',
          severity: 'med',
          class: 'mechanical',
          message: 'reword the Goals section',
        },
      ]);
      expect(j.summary).toBe('approve');
    },
  );

  it('deletion test: a round of only wording, cross-reference and FD-stub findings is green', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer(
        [
          {
            severity: 'important',
            blocking: true,
            message: "the FD's Usage section is still a TODO stub",
          },
          {
            severity: 'important',
            blocking: true,
            message: 'the reference to run-codex.ts:126 points at the wrong line',
          },
          { severity: 'minor', blocking: false, message: 'inconsistent heading case' },
        ],
        'request changes',
      ),
    );
    const r = await runSubagent(spec());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.blockers).toEqual([]);
    expect(j.suggestions).toHaveLength(3);
  });

  it('still reds the round when the reviewer itself fails', async () => {
    dispatchSubagent.mockRejectedValueOnce(new Error('claude not on PATH'));
    const r = await runSubagent(spec());
    expect(r.ok).toBe(false);
    expect((await sinkOf(r)).blockers).toEqual([
      expect.objectContaining({ file: '<reviewer>', severity: 'high' }),
    ]);
  });

  describe('a prior carried from a sink written before the rule', () => {
    const legacy = {
      file: 'docs/design/specs/x.md',
      severity: 'high' as const,
      message: 'reword the Goals section',
    };
    const based = {
      file: 'docs/design/specs/x.md',
      severity: 'med' as const,
      message: 'the retry owner is never named',
      basis: 'requirement' as const,
    };
    const stillStanding = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ n: i + 1, resolved: false, why: 'still there' }));
    const withPrior = (prior: unknown[]): string =>
      JSON.stringify({ assessment: 'checked the fix', strengths: 's', findings: [], prior });

    // One row per shape a missing basis can take on a carried prior; the based prior beside it is
    // the must-still-block direction.
    it.each([
      ['no basis key', legacy],
      ['a null basis', { ...legacy, basis: null }],
      ['an unknown basis', { ...legacy, basis: 'wording' }],
    ])(
      'is carried as a suggestion when it has %s, while a based prior still blocks',
      async (_shape, unbased) => {
        dispatchSubagent.mockResolvedValueOnce(withPrior(stillStanding(2)));
        const r = await runSubagent({
          ...spec(),
          priorReview: { mode: 'fixes-in-diff', blockers: [unbased as never, based] },
        });
        expect(r.ok).toBe(false);
        const j = await sinkOf(r);
        expect(j.blockers).toEqual([based]);
        expect(j.suggestions).toEqual([unbased]);
        expect(j.notes).toEqual(
          expect.arrayContaining(['prior P1 carried as a suggestion: it names no basis']),
        );
      },
    );

    it('leaves the round green when it is the only prior still standing', async () => {
      dispatchSubagent.mockResolvedValueOnce(withPrior(stillStanding(1)));
      const r = await runSubagent({
        ...spec(),
        priorReview: { mode: 'fixes-in-diff', blockers: [legacy] },
      });
      expect(r.ok).toBe(true);
      const j = await sinkOf(r);
      expect(j.blockers).toEqual([]);
      expect(j.summary).toBe('approve');
    });

    it('stays a blocker behind a failed dispatch, for the next round to judge', async () => {
      dispatchSubagent.mockRejectedValueOnce(new Error('claude not on PATH'));
      const r = await runSubagent({
        ...spec(),
        priorReview: { mode: 'fixes-in-diff', blockers: [legacy] },
      });
      const j = await sinkOf(r);
      expect(j.blockers.slice(1)).toEqual([legacy]);
    });
  });

  it('dispatches with the kind, which selects the spec answer contract', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    await runSubagent(spec());
    expect(dispatchSubagent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'spec' }));
  });
});

describe('runSubagent outside kind spec — basis has no effect (Q-0263)', () => {
  it.each(['plan', 'code'] as const)(
    'a blocking finding with no basis still blocks at kind %s',
    async (kind) => {
      dispatchSubagent.mockResolvedValueOnce(
        answer([{ severity: 'critical', blocking: true, message: 'the step skips a test' }]),
      );
      const r = await runSubagent({ ...input(), kind });
      expect(r.ok).toBe(false);
      expect((await sinkOf(r)).blockers).toHaveLength(1);
    },
  );

  it('records no basis in a plan-kind sink even when the answer carries one', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'critical', blocking: true, basis: 'risk', message: 'the step skips a test' },
      ]),
    );
    const j = await sinkOf(await runSubagent(input()));
    expect(j.blockers).toHaveLength(1);
    expect('basis' in j.blockers[0]).toBe(false);
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
  const toSink = toSinkFinding('a.md', changed, 'code');

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
