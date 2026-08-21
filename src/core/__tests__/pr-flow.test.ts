// @tests: autonomous-plan-to-pr-merge, framework-pr-flow-agent-auto-merge, noldor, parallel-drain
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  composeTitle,
  composeBody,
  preflightGh,
  pollAutoMerge,
  openAndAutoMerge,
  checkRedundantDelivery,
  mergePrWithFallback,
  isLinkedWorktree,
  pollChecksBeforeMerge,
  GhPreflightError,
  PrSummaryError,
  validatePrSummary,
  MergeTimeoutError,
  PrClosedWithoutMergeError,
  ChecksFailedError,
  ChecksPendingTimeoutError,
} from '../pr-flow.js';
import type { PrFlowInput, SpawnFn } from '../pr-flow.js';

const baseInput: PrFlowInput = {
  cwd: '/tmp/wt',
  branch: 'worktree-test-feature',
  base: 'main',
  repoUrl: 'https://github.com/davidzoufaly/acme',
  session: {
    path: 'full-new',
    slug: 'test-feature',
    parent: undefined,
    startedAt: '2026-05-15T10:00:00Z',
  },
  fd: {
    name: 'Test Feature',
    summary: 'A test feature for unit assertions.',
  },
  specPath: 'docs/design/specs/2026-05-15-test-feature-design.md',
  planPath: 'docs/design/plans/2026-05-15-test-feature.md',
  crResults: {
    passes: [
      { reviewer: 'claude', tipSha: 'abc123', findings: 0, status: 'clean' },
      { reviewer: 'codex', tipSha: 'abc123', findings: 0, status: 'clean' },
    ],
    status: 'clean',
  },
  verify: null,
  headSha: 'abc123',
  summaryCommit: { subject: 'feat(scripts:test-feature): scaffold', body: '' },
};

describe('composeTitle', () => {
  it('uses the summary commit subject for full-new path', () => {
    expect(composeTitle(baseInput)).toBe('feat(scripts:test-feature): scaffold');
  });

  it('uses the summary commit subject for micro-chore path (no fd)', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'micro-chore', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: { subject: 'chore(docs): typo fix', body: '' },
    };
    expect(composeTitle(input)).toBe('chore(docs): typo fix');
  });
});

describe('composeBody', () => {
  it('renders full-new body with all sections', () => {
    const body = composeBody(baseInput);
    expect(body).toContain('## Summary');
    expect(body).toContain('A test feature for unit assertions.');
    expect(body).toContain('## Scope');
    expect(body).toContain('Gate path: `full-new`');
    expect(body).toContain('Slug: `test-feature`');
    expect(body).toContain('## Links');
    expect(body).toContain('docs/features/test-feature.md');
    expect(body).toContain(
      'https://github.com/davidzoufaly/acme/blob/abc123/docs/features/test-feature.md',
    );
    expect(body).toContain('docs/design/specs/2026-05-15-test-feature-design.md');
    expect(body).toContain('docs/design/plans/2026-05-15-test-feature.md');
    expect(body).toContain('## CR Results');
    expect(body).toContain('| 1 | claude | `abc123` | 0 | ✅ |');
    expect(body).toContain('| 2 | codex | `abc123` | 0 | ✅ |');
    expect(body).toContain('## Test Plan');
    expect(body).toContain('Opened by Noldor `/noldor-gate` end-of-flow.');
  });

  it('omits Spec/Plan lines for micro-chore (null paths)', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'micro-chore', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: { subject: 'chore(docs): typo fix', body: '' },
    };
    const body = composeBody(input);
    expect(body).toContain('Micro-chore: chore(docs): typo fix');
    expect(body).not.toContain('Spec:');
    expect(body).not.toContain('Plan:');
    expect(body).not.toContain('## Links'); // entire section omitted when nothing to link
    expect(body).toContain('## CR Results');
  });

  it('labels the summary Fast-track (not Micro-chore) on the fast-track path', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'fast-track', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: { subject: 'fix(core): correct pr summary label', body: '' },
    };
    const body = composeBody(input);
    expect(body).toContain('Fast-track: fix(core): correct pr summary label');
    expect(body).not.toContain('Micro-chore:');
  });

  it('carries the summary commit body into the no-FD Summary', () => {
    // A subject line states only WHAT shipped. `pr-summary-why-how-what` requires
    // the why and the how too, and the commit body is where they were written.
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'fast-track', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: {
        subject: 'fix(dashboard): count zero scripts when scripts/ is absent',
        body: 'The overview route rendered an internal error on a consumer with no scripts/ tree.\n\nRecursive readdir now treats ENOENT as an empty tree; permission errors still surface.',
      },
    };
    const body = composeBody(input);
    expect(body).toContain(
      'Fast-track: fix(dashboard): count zero scripts when scripts/ is absent',
    );
    expect(body).toContain('The overview route rendered an internal error');
    expect(body).toContain('Recursive readdir now treats ENOENT as an empty tree');
  });

  it('degrades to a subject-only Summary when the commit body is empty', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'fast-track', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: { subject: 'chore: bump lockfile', body: '' },
    };
    expect(composeBody(input)).toContain(
      '## Summary\n\nFast-track: chore: bump lockfile\n\n## Scope',
    );
  });

  // The FD names the feature; the commit body explains the increment that
  // shipped. On an attach path the FD is the PARENT's, so an FD-only Summary
  // describes a feature this PR did not build.
  it('appends the summary commit body beneath the FD summary on FD paths', () => {
    const input: PrFlowInput = {
      ...baseInput,
      summaryCommit: {
        subject: 'feat: whatever',
        body: 'Why — the increment this PR shipped.',
      },
    };
    const body = composeBody(input);
    expect(body).toContain('A test feature for unit assertions.');
    expect(body).toContain('Why — the increment this PR shipped.');
    expect(body.indexOf('A test feature for unit assertions.')).toBeLessThan(
      body.indexOf('Why — the increment this PR shipped.'),
    );
  });

  // PRs #318 and #319: every commit is roadmap-entry bookkeeping, so
  // `pickSummarySha` has no code commit to fall back from and the Summary was
  // the retirement subject alone — what-only by construction.
  describe('retirement-only branches', () => {
    const retirementInput = (subject: string, slug?: string): PrFlowInput => ({
      ...baseInput,
      session: { ...baseInput.session, path: 'fast-track', slug },
      fd: null,
      specPath: null,
      planPath: null,
      summaryCommit: { subject, body: '' },
      branchFiles: ['docs/roadmap.md', '.noldor/retired-entry-ids.json'],
    });

    it('renders why, how and what instead of the bookkeeping subject alone', () => {
      const body = composeBody(
        retirementInput(
          'docs(roadmap): retire doctor-ahead-anchor-dead-end — shipped via fast-track (no FD)',
          'doctor-ahead-anchor-dead-end',
        ),
      );
      expect(body).toContain('Bookkeeping: retire `doctor-ahead-anchor-dead-end`');
      expect(body).toContain('Why — ');
      expect(body).toContain('How — ');
      expect(body).toContain('What — ');
    });

    it('quotes the reason from the subject em-dash clause', () => {
      const body = composeBody(
        retirementInput(
          'docs(roadmap): retire some-slug — shipped via fast-track (no FD)',
          'some-slug',
        ),
      );
      expect(body).toContain('Why — shipped via fast-track (no FD), so the gate stops surfacing');
    });

    it('degrades when the subject carries no em-dash clause', () => {
      const body = composeBody(retirementInput('docs(roadmap): retire some-slug', 'some-slug'));
      expect(body).toContain('Why — the entry is being taken off the queue');
    });

    it('falls back to the subject capture when the session marker has no slug', () => {
      const body = composeBody(
        retirementInput('docs(roadmap): retire orphan-slug — superseded by Q-0124'),
      );
      expect(body).toContain('Bookkeeping: retire `orphan-slug`');
      expect(body).toContain('Why — superseded by Q-0124');
    });

    it('renders the doc-only Test Plan — nothing but the roadmap changed', () => {
      const body = composeBody(retirementInput('docs(roadmap): retire some-slug', 'some-slug'));
      expect(body).toContain('Doc-only change; no test plan');
    });

    // The path shape proves "roadmap bookkeeping only", which a reorder also
    // satisfies. Rendering the template on shape alone would assert a
    // retirement, a slug and a retired-ID write that never happened.
    it('does not claim a retirement when the subject never says retire', () => {
      const body = composeBody(
        retirementInput('docs(roadmap): reorder priorities after Q-0124', 'test-feature'),
      );
      expect(body).not.toContain('Bookkeeping: retire');
      expect(body).not.toContain('remove-block');
      expect(body).toContain('reorder priorities after Q-0124');
    });

    // remove-block records an ID only when the entry carries one, so an ID-less
    // entry's retirement touches the roadmap alone.
    it('does not claim a retired-ID write when the map is not in the diff', () => {
      const body = composeBody({
        ...retirementInput('docs(roadmap): retire some-slug — superseded', 'some-slug'),
        branchFiles: ['docs/roadmap.md'],
      });
      expect(body).toContain('Bookkeeping: retire `some-slug`');
      expect(body).toContain('no retired-ID mapping to record');
      expect(body).not.toContain('records its ID in');
    });

    it('claims the retired-ID write when the map IS in the diff', () => {
      const body = composeBody(
        retirementInput('docs(roadmap): retire some-slug — superseded', 'some-slug'),
      );
      expect(body).toContain('records its ID in');
      expect(body).toContain('one ID recorded');
    });

    it('takes the slug from the subject, never from the session marker', () => {
      const body = composeBody(
        retirementInput('docs(roadmap): retire real-slug — superseded', 'stale-marker-slug'),
      );
      // The Scope section still reports session.slug — that is its job. What
      // must never happen is the retirement claim naming it.
      expect(body).toContain('Bookkeeping: retire `real-slug`');
      expect(body).not.toContain('retire `stale-marker-slug`');
    });
  });

  describe('Test Plan derives from the diff, not from FD presence', () => {
    // Hole #5: PRs #298, #313 and #315 were code changes rendering
    // "Doc-only change" because they carried no FD.
    it('renders the code checklist for a no-FD branch that touched src/**', () => {
      const body = composeBody({
        ...baseInput,
        session: { ...baseInput.session, path: 'fast-track', slug: undefined },
        fd: null,
        specPath: null,
        planPath: null,
        summaryCommit: { subject: 'fix(clones): union untracked files', body: 'Why — …' },
        branchFiles: ['src/clones/ranges.ts', 'docs/roadmap.md'],
      });
      expect(body).toContain('`pnpm typecheck` passes.');
      expect(body).not.toContain('Doc-only change');
      // No FD to point a dogfood step at.
      expect(body).not.toContain('Manual dogfood');
    });

    // Hole #5 inverted: the fix must not hand a prose PR a checklist it cannot run.
    it('keeps the doc-only line for a docs/noldor-only branch', () => {
      const body = composeBody({
        ...baseInput,
        session: { ...baseInput.session, path: 'micro-chore', slug: undefined },
        fd: null,
        specPath: null,
        planPath: null,
        summaryCommit: { subject: 'docs(noldor): clarify pr-flow', body: '' },
        branchFiles: ['docs/noldor/pr-flow.md', 'templates/docs/noldor/pr-flow.md'],
      });
      expect(body).toContain('Doc-only change; no test plan');
      expect(body).not.toContain('`pnpm typecheck` passes.');
    });

    // touchesCode([]) is false, so a bare `?? []` default would answer
    // "doc-only" for every caller that omitted the field.
    it('falls back to the FD-presence rule when branchFiles is absent', () => {
      const { branchFiles: _omitted, ...withoutBranchFiles } = {
        ...baseInput,
        branchFiles: undefined,
      };
      const body = composeBody(withoutBranchFiles as PrFlowInput);
      expect(body).toContain('`pnpm typecheck` passes.');
      expect(body).not.toContain('Doc-only change');
    });

    it('treats an explicitly empty branchFiles as doc-only', () => {
      const body = composeBody({ ...baseInput, branchFiles: [] });
      expect(body).toContain('Doc-only change');
    });

    it('adds the dogfood step only when an FD is present', () => {
      const body = composeBody({
        ...baseInput,
        branchFiles: ['src/core/pr-flow.ts'],
      });
      expect(body).toContain('Manual dogfood');
    });
  });

  it('renders the FD summary alone when the commit carried no body', () => {
    const input: PrFlowInput = {
      ...baseInput,
      summaryCommit: { subject: 'feat: whatever', body: '' },
    };
    expect(composeBody(input)).toContain('## Summary\n\nA test feature for unit assertions.\n\n');
  });

  it('renders the parent FD link on attach paths (slug undefined, parent set)', () => {
    // Attach sessions leave `slug` undefined and set `parent` to the FD being
    // extended. The body must link to docs/features/<parent>.md, not the
    // fallback docs/features/unknown.md that the original `slug ?? 'unknown'`
    // expression produced.
    const input: PrFlowInput = {
      ...baseInput,
      session: {
        ...baseInput.session,
        path: 'full-attach',
        slug: undefined,
        parent: 'existing-feature',
      },
      fd: {
        name: 'Existing Feature',
        summary: 'The FD being extended via an attach session.',
      },
      specPath: 'docs/design/specs/2026-05-16-existing-feature-enhancement-design.md',
      planPath: 'docs/design/plans/2026-05-16-existing-feature-enhancement.md',
    };
    const body = composeBody(input);
    expect(body).toContain('docs/features/existing-feature.md');
    expect(body).toContain(
      'https://github.com/davidzoufaly/acme/blob/abc123/docs/features/existing-feature.md',
    );
    expect(body).not.toContain('docs/features/unknown.md');
    // Scope block still reports `Slug: —` (no new slug) and `Parent FD: existing-feature`.
    expect(body).toContain('Slug: `—`');
    expect(body).toContain('Parent FD: `existing-feature`');
  });

  it('renders CR retry passes with "addressed" rows', () => {
    const input: PrFlowInput = {
      ...baseInput,
      crResults: {
        passes: [
          { reviewer: 'codex', tipSha: 'aaa', findings: 2, status: 'addressed' },
          { reviewer: 'codex', tipSha: 'bbb', findings: 0, status: 'clean' },
        ],
        status: 'clean',
      },
    };
    const body = composeBody(input);
    expect(body).toContain('| 1 | codex | `aaa` | 2 | ✏️ addressed |');
    expect(body).toContain('| 2 | codex | `bbb` | 0 | ✅ |');
  });

  it('renders exhausted warning banner above CR Results when status is exhausted', () => {
    const input: PrFlowInput = {
      ...baseInput,
      crResults: {
        passes: [
          { reviewer: 'codex', tipSha: 'aaa', findings: 2, status: 'addressed' },
          { reviewer: 'codex', tipSha: 'bbb', findings: 1, status: 'addressed' },
          { reviewer: 'codex', tipSha: 'ccc', findings: 1, status: 'addressed' },
        ],
        status: 'exhausted',
      },
    };
    const body = composeBody(input);
    expect(body).toContain('⚠️ **CR retry exhausted**');
    expect(body).toContain('manual review recommended before merge');
    expect(body).toContain('| 1 | codex | `aaa` | 2 | ✏️ addressed |');
    expect(body).toContain('| 2 | codex | `bbb` | 1 | ✏️ addressed |');
    expect(body).toContain('| 3 | codex | `ccc` | 1 | ✏️ addressed |');
    // Banner must appear before the CR Results heading
    const bannerIdx = body.indexOf('⚠️ **CR retry exhausted**');
    const crHeadingIdx = body.indexOf('## CR Results');
    expect(bannerIdx).toBeLessThan(crHeadingIdx);
  });

  it('renders Verify Evidence with verdict + command/observed pairs between CR Results and Test Plan', () => {
    const input: PrFlowInput = {
      ...baseInput,
      verify: {
        verdict: 'pass',
        evidence: [
          { command: 'pnpm noldor --help', observed: 'exit 0' },
          {
            command: 'curl -s localhost:5174/',
            observed: 'GET http://localhost:5174/ → 200\nsecond line',
          },
        ],
      },
    };
    const body = composeBody(input);
    expect(body).toContain('## Verify Evidence');
    expect(body).toContain('Lane verdict: `pass`');
    expect(body).toContain('1. `pnpm noldor --help`');
    expect(body).toContain('2. `curl -s localhost:5174/`');
    expect(body).toContain('   GET http://localhost:5174/ → 200');
    expect(body).toContain('   second line');
    const crIdx = body.indexOf('## CR Results');
    const verifyIdx = body.indexOf('## Verify Evidence');
    const testPlanIdx = body.indexOf('## Test Plan');
    expect(crIdx).toBeLessThan(verifyIdx);
    expect(verifyIdx).toBeLessThan(testPlanIdx);
  });

  it('renders a placeholder line when the verdict carries no evidence pairs', () => {
    const input: PrFlowInput = {
      ...baseInput,
      verify: { verdict: 'cannot-verify', evidence: [] },
    };
    const body = composeBody(input);
    expect(body).toContain('Lane verdict: `cannot-verify`');
    expect(body).toContain('_No command/observed pairs recorded for this verdict._');
  });

  it('omits the Verify Evidence section entirely when verify is null', () => {
    expect(composeBody(baseInput)).not.toContain('## Verify Evidence');
  });
});

describe('composeBody — release-sweep template', () => {
  const sweepInput: PrFlowInput = {
    cwd: '/tmp/repo',
    branch: 'release-sweep/1747465320',
    base: 'main',
    repoUrl: 'https://github.com/davidzoufaly/acme',
    session: { path: 'release-sweep', startedAt: '2026-05-17T08:00:00.000Z' },
    fd: null,
    specPath: null,
    planPath: null,
    crResults: { passes: [], status: 'clean' },
    verify: null,
    headSha: 'abc123',
    summaryCommit: { subject: 'chore(release-sweep): graphify output', body: '' },
  };

  it('renders a sweep-specific summary (no Micro-chore prefix)', () => {
    const body = composeBody(sweepInput);
    expect(body).not.toContain('Micro-chore:');
    expect(body).toContain('Pre-release sweep');
  });

  it('lists the gate path as release-sweep', () => {
    const body = composeBody(sweepInput);
    expect(body).toContain('Gate path: `release-sweep`');
  });

  it('does not render a Links section when fd/specPath/planPath are null', () => {
    const body = composeBody(sweepInput);
    expect(body).not.toContain('## Links');
  });

  it('does not render a CR passes table for sweep', () => {
    const body = composeBody(sweepInput);
    expect(body).not.toContain('| Pass | Reviewer |');
  });
});

describe('composeBody — existing branch regression guard', () => {
  it('renders the existing full-new template unchanged after release-sweep branch added', () => {
    const body = composeBody(baseInput);
    expect(body).toContain('A test feature for unit assertions.');
    expect(body).toContain('| Pass | Reviewer |');
    expect(body).toContain('## Links');
  });
});

describe('preflightGh', () => {
  it('passes when gh --version + gh auth status succeed', async () => {
    const spawn: SpawnFn = vi.fn(async (_cmd, args) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.50', exitCode: 0 };
      if (args.join(' ') === 'auth status') return { stdout: 'Logged in', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    await expect(preflightGh({ spawn })).resolves.toBeUndefined();
  });

  it('throws GhPreflightError when gh --version exits non-zero (gh missing)', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({ stdout: '', exitCode: 127 }));
    await expect(preflightGh({ spawn })).rejects.toThrow(GhPreflightError);
  });

  it('throws GhPreflightError when gh auth status exits non-zero (unauthenticated)', async () => {
    const spawn: SpawnFn = vi.fn(async (_cmd, args) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.50', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    await expect(preflightGh({ spawn })).rejects.toThrow(/unauthenticated/i);
  });
});

describe('pollAutoMerge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns mergedAt on first poll when already merged', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({ mergedAt: '2026-05-15T10:01:00Z', state: 'MERGED' }),
      exitCode: 0,
    }));
    const result = await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 5000,
      timeoutMs: 600_000,
    });
    expect(result.mergedAt).toBe('2026-05-15T10:01:00Z');
  });

  it('throws PrClosedWithoutMergeError when state CLOSED + no mergedAt', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({ mergedAt: null, state: 'CLOSED' }),
      exitCode: 0,
    }));
    await expect(
      pollAutoMerge({
        prUrl: 'https://github.com/x/y/pull/1',
        spawn,
        intervalMs: 5000,
        timeoutMs: 600_000,
      }),
    ).rejects.toThrow(PrClosedWithoutMergeError);
  });

  it('extends timeout when mergeStateStatus BEHIND observed', async () => {
    let pollCount = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      pollCount++;
      if (pollCount < 10)
        return {
          stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BEHIND' }),
          exitCode: 0,
        };
      return {
        stdout: JSON.stringify({ mergedAt: '2026-05-15T10:15:00Z', state: 'MERGED' }),
        exitCode: 0,
      };
    });
    const promise = pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 5000,
      timeoutMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    const result = await promise;
    expect(result.mergedAt).toBe('2026-05-15T10:15:00Z');
  });

  it('throws MergeTimeoutError when never merges and BEHIND never seen', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({ mergedAt: null, state: 'OPEN' }),
      exitCode: 0,
    }));
    const promise = pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 5000,
      timeoutMs: 600_000,
    });
    // Attach rejection handler immediately to prevent unhandled rejection warning
    // before we advance timers and await the assertion.
    const caught = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const err = await caught;
    expect(err).toBeInstanceOf(MergeTimeoutError);
  });
});

// Delivery fixtures carry a gate-passing summary body: openAndAutoMerge now
// runs validatePrSummary before anything else, and baseInput's empty body would
// be rejected at the door on its code-carrying session.
const shipInput: PrFlowInput = {
  ...baseInput,
  summaryCommit: {
    subject: baseInput.summaryCommit.subject,
    body: [
      'Why — the scaffold was missing and every consumer had to hand-write it.',
      'How — a generator renders the template into the target tree at init time.',
      'What — src/scripts/scaffold.ts plus its test, wired into the init command.',
    ].join('\n'),
  },
};

describe('openAndAutoMerge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs preflight, push, create, merge, poll on happy path', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      // `+ ` ⇒ genuine new content ⇒ idempotency guard lets delivery proceed.
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ deadbeef\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/42', exitCode: 0 };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge')
        return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-05-15T10:01:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.prUrl).toBe('https://github.com/davidzoufaly/acme/pull/42');
    expect(result.prNumber).toBe(42);
    expect(result.mergedAt).toBe('2026-05-15T10:01:00Z');
    expect(calls.map((c) => `${c.cmd} ${c.args[0]}`)).toEqual([
      'gh --version',
      'gh auth',
      'git fetch',
      'git cherry',
      'git push',
      'gh pr',
      'gh pr',
      'gh pr',
    ]);
  });

  it('openOnly: pushes + opens the PR, NEVER merges (merge deferred to drain coordinator)', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ deadbeef\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/7', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn, openOnly: true });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.prUrl).toBe('https://github.com/davidzoufaly/acme/pull/7');
    expect(result.prNumber).toBe(7);
    expect(result.mergedAt).toBeNull();
    // No `gh pr merge` of any kind — the supervisor's coordinator owns the merge.
    expect(calls.some((c) => c.cmd === 'gh' && c.args[0] === 'pr' && c.args[1] === 'merge')).toBe(
      false,
    );
  });

  it('throws GhPreflightError before any git push when gh missing', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({ stdout: '', exitCode: 127 }));
    await expect(openAndAutoMerge({ ...shipInput, spawn })).rejects.toThrow(GhPreflightError);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('falls back to direct squash-merge when auto-merge fails', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ deadbeef\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/77', exitCode: 0 };
      }
      // First merge attempt (auto) fails — repo doesn't have auto-merge enabled.
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge' && args.includes('--auto')) {
        return { stdout: '', exitCode: 1 };
      }
      // Direct merge fallback succeeds.
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge' && !args.includes('--auto')) {
        return { stdout: '', exitCode: 0 };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-05-16T19:55:13Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.prNumber).toBe(77);
    expect(result.mergedAt).toBe('2026-05-16T19:55:13Z');
    // Verify the call sequence: preflight, push, create, merge --auto, merge --squash (direct), pr view.
    const mergeCalls = calls.filter((c) => c.cmd === 'gh' && c.args[1] === 'merge');
    expect(mergeCalls).toHaveLength(2);
    expect(mergeCalls[0].args).toContain('--auto');
    expect(mergeCalls[1].args).toContain('--squash');
    expect(mergeCalls[1].args).toContain('--delete-branch');
    expect(mergeCalls[1].args).not.toContain('--auto');
  });

  it('tolerates non-zero exit from direct merge when gh pr view confirms MERGED', async () => {
    // Reproduces the "main is already used by another worktree" quirk:
    // gh pr merge --squash succeeds server-side but the post-merge local
    // checkout step fails with a non-zero exit. The fallback should trust
    // gh pr view's MERGED state, not the directMerge exit code.
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ deadbeef\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/88', exitCode: 0 };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge' && args.includes('--auto')) {
        return { stdout: '', exitCode: 1 };
      }
      // Direct merge exits non-zero (local checkout failed) but PR is merged on server.
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge' && !args.includes('--auto')) {
        return { stdout: '', exitCode: 1 };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-05-16T20:00:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.mergedAt).toBe('2026-05-16T20:00:00Z');
  });

  it('throws with both exit codes when auto-merge and direct merge both fail (PR still open)', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ deadbeef\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/99', exitCode: 0 };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
        return { stdout: '', exitCode: 1 };
      }
      // gh pr view succeeds but reports the PR is still OPEN — merge actually failed.
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: null, state: 'OPEN' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    await expect(openAndAutoMerge({ ...shipInput, spawn })).rejects.toThrow(
      /direct merge fallback exit 1; PR state is "OPEN"/,
    );
  });

  it('SKIPS delivery (no push/create/merge) when every branch commit already on origin (all `-`)', async () => {
    // The PR #76+#77 race: the branch commit was already squash-merged by a
    // concurrent process, so `git cherry` reports it patch-id-equivalent (`-`).
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry')
        return { stdout: '- 1111111\n- 2222222\n', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if (!('skipped' in result)) throw new Error('expected skip, got delivery');
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/already exist on origin\/main \(patch-id match\)/);
    // No push, no PR create, no merge — the whole delivery is short-circuited.
    expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'push')).toBe(false);
    expect(calls.some((c) => c.cmd === 'gh' && c.args[1] === 'create')).toBe(false);
    expect(calls.some((c) => c.cmd === 'gh' && c.args[1] === 'merge')).toBe(false);
  });

  it('DELIVERS when the branch mixes already-landed (`-`) and new (`+`) commits', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry')
        return { stdout: '- 1111111\n+ 3333333\n', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/50', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge')
        return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
        return {
          stdout: JSON.stringify({ mergedAt: '2026-05-15T10:01:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.prNumber).toBe(50);
  });

  it('fail-open: DELIVERS when the guard fetch fails (offline), guard never wedges a real ship', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[0] === '--version')
        return { stdout: 'gh version 2.50', exitCode: 0 };
      if (cmd === 'gh' && args.join(' ') === 'auth status')
        return { stdout: 'Logged in', exitCode: 0 };
      // Fetch fails (e.g. offline) — guard must fail-open and let delivery proceed.
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 128 };
      if (cmd === 'git' && args[0] === 'push') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
        return { stdout: 'https://github.com/davidzoufaly/acme/pull/51', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge')
        return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
        return {
          stdout: JSON.stringify({ mergedAt: '2026-05-15T10:01:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      return { stdout: '', exitCode: 1 };
    });
    const result = await openAndAutoMerge({ ...shipInput, spawn });
    if ('skipped' in result) throw new Error('expected delivery, got skip');
    expect(result.prNumber).toBe(51);
    // Fetch failed ⇒ `git cherry` is never attempted.
    expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'cherry')).toBe(false);
  });
});

describe('checkRedundantDelivery', () => {
  it('skips (empty cherry output) when the branch has no commits ahead of upstream', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '\n', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    const result = await checkRedundantDelivery({ branch: 'feat/x', base: 'main', spawn });
    expect(result?.skipped).toBe(true);
    expect(result?.reason).toMatch(/no commits ahead of origin\/main \(already merged\)/);
  });

  it('skips when every cherry line is `-` (patch-id equivalent upstream)', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '- aaaaaaa\n', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    const result = await checkRedundantDelivery({ branch: 'feat/x', base: 'main', spawn });
    expect(result?.skipped).toBe(true);
    expect(result?.reason).toMatch(/all 1 commit\(s\) on feat\/x already exist/);
  });

  it('returns null (deliver) on a `+` line', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ bbbbbbb\n', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    expect(await checkRedundantDelivery({ branch: 'feat/x', base: 'main', spawn })).toBeNull();
  });

  it('fail-open (null) when fetch fails', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 1 };
      return { stdout: '', exitCode: 1 };
    });
    expect(await checkRedundantDelivery({ branch: 'feat/x', base: 'main', spawn })).toBeNull();
  });

  it('fail-open (null) when git cherry errors', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '', exitCode: 129 };
      return { stdout: '', exitCode: 1 };
    });
    expect(await checkRedundantDelivery({ branch: 'feat/x', base: 'main', spawn })).toBeNull();
  });

  it('queries the correct upstream ref and branch', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args[0] === 'cherry') return { stdout: '+ ccccccc\n', exitCode: 0 };
      return { stdout: '', exitCode: 1 };
    });
    await checkRedundantDelivery({ branch: 'worktree-foo', base: 'develop', spawn });
    expect(calls.find((c) => c.args[0] === 'fetch')?.args).toEqual(['fetch', 'origin', 'develop']);
    expect(calls.find((c) => c.args[0] === 'cherry')?.args).toEqual([
      'cherry',
      'origin/develop',
      'worktree-foo',
    ]);
  });
});

describe('pollAutoMerge status streaming', () => {
  // Real timers + tiny interval + a settable clock the spawn mock advances per
  // cycle, so the test controls elapsed time regardless of how many times now()
  // is read within a cycle (deadline + throttle + elapsed all read it).
  it('emits on first non-merged cycle with state/mergeStateStatus/elapsed', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // 10s per cycle
      if (cycle >= 2) {
        return {
          stdout: JSON.stringify({
            mergedAt: '2026-06-07T00:00:00Z',
            state: 'MERGED',
            mergeStateStatus: 'CLEAN',
          }),
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }),
        exitCode: 0,
      };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual(['Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s']);
  });

  it('throttles: no second emit < 30s, emits at >= 30s', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // cycles at elapsed 10s,20s,30s,40s
      if (cycle >= 5) {
        return {
          stdout: JSON.stringify({
            mergedAt: '2026-06-07T00:00:00Z',
            state: 'MERGED',
            mergeStateStatus: 'CLEAN',
          }),
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }),
        exitCode: 0,
      };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    // emit at 10s (first), skip 20s (<30s since last), skip 30s (=20s since last),
    // emit at 40s (=30s since last emit at 10s).
    expect(lines).toEqual([
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s',
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=40s',
    ]);
  });

  it('emits immediately on a state/mergeStateStatus transition inside the 30s window', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // cycles at elapsed 10s, 20s, ...
      if (cycle === 1) {
        return {
          stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }),
          exitCode: 0,
        };
      }
      if (cycle === 2) {
        // transition at elapsed 20s (<30s since first emit) — must emit on change
        return {
          stdout: JSON.stringify({ mergedAt: null, state: 'BEHIND', mergeStateStatus: 'BEHIND' }),
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify({
          mergedAt: '2026-06-07T00:00:00Z',
          state: 'MERGED',
          mergeStateStatus: 'CLEAN',
        }),
        exitCode: 0,
      };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual([
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s',
      'Auto-merge: state=BEHIND, mergeStateStatus=BEHIND, elapsed=20s',
    ]);
  });

  it('emits nothing on instant merge (first cycle already merged)', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    const spawn: SpawnFn = vi.fn(async () => {
      nowMs += 10_000;
      return {
        stdout: JSON.stringify({
          mergedAt: '2026-06-07T00:00:00Z',
          state: 'MERGED',
          mergeStateStatus: 'CLEAN',
        }),
        exitCode: 0,
      };
    });
    const r = await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(r.mergedAt).toBe('2026-06-07T00:00:00Z');
    expect(lines).toEqual([]);
  });

  it('prints UNKNOWN when mergeStateStatus absent', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000;
      if (cycle >= 2) {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify({ mergedAt: null, state: 'OPEN' }),
        exitCode: 0,
      };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual(['Auto-merge: state=OPEN, mergeStateStatus=UNKNOWN, elapsed=10s']);
  });

  it('does not emit on a failed (non-zero) gh fetch cycle', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000;
      if (cycle === 1) return { stdout: '', exitCode: 1 }; // failed fetch, no state
      return {
        stdout: JSON.stringify({
          mergedAt: '2026-06-07T00:00:00Z',
          state: 'MERGED',
          mergeStateStatus: 'CLEAN',
        }),
        exitCode: 0,
      };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual([]); // cycle 1 failed (no emit), cycle 2 merged (returns before emit)
  });
});

describe('mergePrWithFallback', () => {
  const prUrl = 'https://github.com/davidzoufaly/acme/pull/9';

  it('queues auto-merge and polls to mergedAt when auto-merge is enabled', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-07-02T12:00:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await mergePrWithFallback({ prUrl, spawn });
    expect(result.mergedAt).toBe('2026-07-02T12:00:00Z');
  });

  it('falls back to direct squash-merge when auto-merge is disabled', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[1] === 'merge' && args.includes('--auto'))
        return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-07-02T12:05:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await mergePrWithFallback({ prUrl, spawn });
    expect(result.mergedAt).toBe('2026-07-02T12:05:00Z');
    const mergeCalls = calls.filter((c) => c.args[1] === 'merge');
    expect(mergeCalls).toHaveLength(2);
    expect(mergeCalls[1].args).toContain('--squash');
    expect(mergeCalls[1].args).toContain('--delete-branch');
    expect(mergeCalls[1].args).not.toContain('--auto');
  });

  it('throws with both exit codes when both merge legs fail and PR stays open', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'view') {
        return { stdout: JSON.stringify({ mergedAt: null, state: 'OPEN' }), exitCode: 0 };
      }
      return { stdout: '', exitCode: 1 };
    });
    await expect(mergePrWithFallback({ prUrl, spawn })).rejects.toThrow(
      /gh pr merge --auto failed: exit 1; direct merge fallback exit 1; PR state is "OPEN"/,
    );
  });

  it('refuses the direct-merge fallback when a check has failed', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'gh' && args[1] === 'merge' && args.includes('--auto'))
        return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'view' && args.includes('statusCheckRollup')) {
        return {
          stdout: JSON.stringify({
            statusCheckRollup: [
              { name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' },
              { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
            ],
          }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    await expect(mergePrWithFallback({ prUrl, spawn })).rejects.toThrow(ChecksFailedError);
    // The direct squash-merge must never have been attempted.
    const directMerges = calls.filter((c) => c.args[1] === 'merge' && !c.args.includes('--auto'));
    expect(directMerges).toHaveLength(0);
  });

  it('waits for pending checks to settle green before the direct-merge fallback', async () => {
    let rollupCalls = 0;
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'merge' && args.includes('--auto'))
        return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'view' && args.includes('statusCheckRollup')) {
        rollupCalls += 1;
        return {
          stdout: JSON.stringify({
            statusCheckRollup: [
              rollupCalls === 1
                ? { name: 'verify', status: 'IN_PROGRESS' }
                : { name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
            ],
          }),
          exitCode: 0,
        };
      }
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-07-11T12:00:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await mergePrWithFallback({ prUrl, spawn, intervalMs: 1 });
    expect(result.mergedAt).toBe('2026-07-11T12:00:00Z');
    expect(rollupCalls).toBe(2);
  });

  it('merges via fallback when the PR has no checks at all', async () => {
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[1] === 'merge' && args.includes('--auto'))
        return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'view' && args.includes('statusCheckRollup')) {
        return { stdout: JSON.stringify({ statusCheckRollup: [] }), exitCode: 0 };
      }
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({ mergedAt: '2026-07-11T12:05:00Z', state: 'MERGED' }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    const result = await mergePrWithFallback({ prUrl, spawn });
    expect(result.mergedAt).toBe('2026-07-11T12:05:00Z');
  });

  /** Shared mock for the fallback leg: auto-merge unavailable, no checks, PR merges.
   *  `gitDirs` is the two-line `git rev-parse` payload that decides worktree context;
   *  `headRefName` is omitted from the `gh pr view` payload when passed `undefined`. */
  function fallbackSpawn(opts: {
    gitDirs: string;
    headRefName?: string;
    lsRemote?: { stdout: string; exitCode: number };
  }): {
    spawn: SpawnFn;
    calls: Array<{ cmd: string; args: string[] }>;
  } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn: SpawnFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: opts.gitDirs, exitCode: 0 };
      if (cmd === 'git' && args[0] === 'ls-remote')
        return opts.lsRemote ?? { stdout: '', exitCode: 0 };
      if (cmd === 'git' && args.includes('--delete')) return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'merge' && args.includes('--auto'))
        return { stdout: '', exitCode: 1 };
      if (cmd === 'gh' && args[1] === 'view' && args.includes('statusCheckRollup'))
        return { stdout: JSON.stringify({ statusCheckRollup: [] }), exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'merge') return { stdout: '', exitCode: 0 };
      if (cmd === 'gh' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            mergedAt: '2026-08-06T09:00:00Z',
            state: 'MERGED',
            ...(opts.headRefName !== undefined ? { headRefName: opts.headRefName } : {}),
          }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 1 };
    });
    return { spawn, calls };
  }

  const WORKTREE_DIRS = '/repo/.git/worktrees/fast-x\n/repo/.git\n';
  const MAIN_DIRS = '/repo/.git\n/repo/.git\n';

  it('withholds --delete-branch and deletes the remote ref when run from a linked worktree', async () => {
    const { spawn, calls } = fallbackSpawn({ gitDirs: WORKTREE_DIRS, headRefName: 'fast/x' });
    const lines: string[] = [];
    const result = await mergePrWithFallback({ prUrl, spawn, onStatus: (l) => lines.push(l) });
    expect(result.mergedAt).toBe('2026-08-06T09:00:00Z');
    const directMerge = calls.filter((c) => c.args[1] === 'merge' && !c.args.includes('--auto'));
    expect(directMerge).toHaveLength(1);
    expect(directMerge[0].args).not.toContain('--delete-branch');
    expect(calls).toContainEqual({ cmd: 'git', args: ['push', 'origin', '--delete', 'fast/x'] });
    expect(lines.some((l) => l.includes('deleted remote branch fast/x'))).toBe(true);
  });

  it('keeps --delete-branch when run from the main checkout', async () => {
    const { spawn, calls } = fallbackSpawn({ gitDirs: MAIN_DIRS, headRefName: 'fast/x' });
    const result = await mergePrWithFallback({ prUrl, spawn });
    expect(result.mergedAt).toBe('2026-08-06T09:00:00Z');
    const directMerge = calls.find((c) => c.args[1] === 'merge' && !c.args.includes('--auto'));
    expect(directMerge).toBeDefined();
    expect(directMerge?.args).toContain('--delete-branch');
    // gh owns the branch delete here — pr-flow must not push a second one.
    expect(calls.some((c) => c.cmd === 'git' && c.args.includes('--delete'))).toBe(false);
  });

  it('warns when the remote branch survives gh --delete-branch in the main checkout', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const { spawn, calls } = fallbackSpawn({
        gitDirs: MAIN_DIRS,
        headRefName: 'fast/x',
        lsRemote: { stdout: 'deadbeef\trefs/heads/fast/x\n', exitCode: 0 },
      });
      await mergePrWithFallback({ prUrl, spawn });
      expect(calls).toContainEqual({
        cmd: 'git',
        args: ['ls-remote', '--heads', 'origin', 'refs/heads/fast/x'],
      });
      expect(
        warn.mock.calls.some(([m]) => String(m).includes('remote branch fast/x still exists')),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet in the main checkout when the remote branch is gone', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const { spawn } = fallbackSpawn({ gitDirs: MAIN_DIRS, headRefName: 'fast/x' });
      await mergePrWithFallback({ prUrl, spawn });
      expect(warn.mock.calls.some(([m]) => String(m).includes('still exists'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet in the main checkout when the ls-remote probe itself fails', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const { spawn } = fallbackSpawn({
        gitDirs: MAIN_DIRS,
        headRefName: 'fast/x',
        lsRemote: { stdout: '', exitCode: 128 },
      });
      await mergePrWithFallback({ prUrl, spawn });
      expect(warn.mock.calls.some(([m]) => String(m).includes('still exists'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not probe the remote in worktree context — it deletes the ref itself', async () => {
    const { spawn, calls } = fallbackSpawn({ gitDirs: WORKTREE_DIRS, headRefName: 'fast/x' });
    await mergePrWithFallback({ prUrl, spawn });
    expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'ls-remote')).toBe(false);
  });

  it('still reports the merge when gh pr view omits headRefName in worktree context', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const { spawn, calls } = fallbackSpawn({ gitDirs: WORKTREE_DIRS });
      const result = await mergePrWithFallback({ prUrl, spawn });
      expect(result.mergedAt).toBe('2026-08-06T09:00:00Z');
      expect(calls.some((c) => c.cmd === 'git' && c.args.includes('--delete'))).toBe(false);
      expect(warn.mock.calls.some(([m]) => String(m).includes('no headRefName'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('isLinkedWorktree', () => {
  const probe = (stdout: string, exitCode = 0): SpawnFn =>
    vi.fn(async () => ({ stdout, exitCode }));

  it('is true when --git-dir and --git-common-dir differ', async () => {
    await expect(isLinkedWorktree(probe('/repo/.git/worktrees/x\n/repo/.git\n'))).resolves.toBe(
      true,
    );
  });

  it('is false in the main checkout, where both resolve to the same path', async () => {
    await expect(isLinkedWorktree(probe('/repo/.git\n/repo/.git\n'))).resolves.toBe(false);
  });

  it('is false and warns when the rev-parse probe fails', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await expect(isLinkedWorktree(probe('', 128))).resolves.toBe(false);
      expect(warn.mock.calls.some(([m]) => String(m).includes('worktree probe failed'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('is false and warns when rev-parse emits fewer than two paths', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await expect(isLinkedWorktree(probe('/repo/.git\n'))).resolves.toBe(false);
      expect(warn.mock.calls.some(([m]) => String(m).includes('worktree probe failed'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('pollChecksBeforeMerge', () => {
  const prUrl = 'https://github.com/davidzoufaly/acme/pull/9';

  it('throws ChecksFailedError naming the failing checks', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({
        statusCheckRollup: [
          { name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' },
          { context: 'legacy-ci', state: 'ERROR' },
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ],
      }),
      exitCode: 0,
    }));
    await expect(
      pollChecksBeforeMerge({ prUrl, spawn, intervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toThrow(/failing status checks — verify, legacy-ci/);
  });

  it('treats a null statusCheckRollup as no checks and returns', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({ statusCheckRollup: null }),
      exitCode: 0,
    }));
    await expect(
      pollChecksBeforeMerge({ prUrl, spawn, intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it('accepts SKIPPED and NEUTRAL conclusions as settled', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({
      stdout: JSON.stringify({
        statusCheckRollup: [
          { name: 'optional', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { name: 'advisory', status: 'COMPLETED', conclusion: 'NEUTRAL' },
          { context: 'legacy-ci', state: 'SUCCESS' },
        ],
      }),
      exitCode: 0,
    }));
    await expect(
      pollChecksBeforeMerge({ prUrl, spawn, intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it('throws ChecksPendingTimeoutError when checks never settle', async () => {
    let nowMs = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      nowMs += 10_000;
      return {
        stdout: JSON.stringify({
          statusCheckRollup: [{ name: 'verify', status: 'IN_PROGRESS' }],
        }),
        exitCode: 0,
      };
    });
    await expect(
      pollChecksBeforeMerge({
        prUrl,
        spawn,
        intervalMs: 1,
        timeoutMs: 30_000,
        now: () => nowMs,
      }),
    ).rejects.toThrow(ChecksPendingTimeoutError);
  });

  it('re-polls through transient gh failures and unparseable stdout', async () => {
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      if (cycle === 1) return { stdout: '', exitCode: 1 };
      if (cycle === 2) return { stdout: 'not-json', exitCode: 0 };
      return {
        stdout: JSON.stringify({
          statusCheckRollup: [{ name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' }],
        }),
        exitCode: 0,
      };
    });
    await expect(
      pollChecksBeforeMerge({ prUrl, spawn, intervalMs: 1, timeoutMs: 60_000 }),
    ).resolves.toBeUndefined();
    expect(cycle).toBe(3);
  });
});

describe('validatePrSummary', () => {
  it('rejects a code-carrying PR whose Summary lacks the three sections', () => {
    const r = validatePrSummary({ ...baseInput, branchFiles: ['src/core/x.ts'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/missing Why, How, What/);
      expect(r.error).toContain(baseInput.summaryCommit.subject);
    }
  });

  it('accepts a code-carrying PR whose summary commit body carries the sections', () => {
    const r = validatePrSummary({ ...shipInput, branchFiles: ['src/core/x.ts'] });
    expect(r.ok).toBe(true);
  });

  it('exempts a branch that carries no code', () => {
    const r = validatePrSummary({ ...baseInput, branchFiles: ['docs/roadmap.md'] });
    expect(r.ok).toBe(true);
  });

  it('exempts the release-sweep automation path', () => {
    const r = validatePrSummary({
      ...baseInput,
      session: { ...baseInput.session, path: 'release-sweep' },
      branchFiles: ['src/core/x.ts'],
    });
    expect(r.ok).toBe(true);
  });

  it('exempts a retirement-only branch (deterministic template already explains it)', () => {
    const r = validatePrSummary({
      ...baseInput,
      fd: null,
      session: { ...baseInput.session, path: 'fast-track' },
      summaryCommit: {
        subject: 'docs(roadmap): retire some-slug — shipped via fast-track (no FD)',
        body: '',
      },
      branchFiles: ['docs/roadmap.md', '.noldor/retired-entry-ids.json'],
    });
    expect(r.ok).toBe(true);
  });

  it('with no branchFiles, falls back to FD presence as the code signal', () => {
    // fd !== null reads as code-carrying — the same fallback composeBody uses.
    const r = validatePrSummary({ ...baseInput });
    expect(r.ok).toBe(false);
  });

  it('openAndAutoMerge throws PrSummaryError before spawning anything', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({ stdout: '', exitCode: 0 }));
    await expect(
      openAndAutoMerge({ ...baseInput, branchFiles: ['src/core/x.ts'], spawn }),
    ).rejects.toThrow(PrSummaryError);
    expect(spawn).not.toHaveBeenCalled();
  });
});
