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
  GhPreflightError,
  MergeTimeoutError,
  PrClosedWithoutMergeError,
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
  specPath: 'docs/superpowers/specs/2026-05-15-test-feature-design.md',
  planPath: 'docs/superpowers/plans/2026-05-15-test-feature.md',
  crResults: {
    passes: [
      { reviewer: 'claude', tipSha: 'abc123', findings: 0, status: 'clean' },
      { reviewer: 'codex', tipSha: 'abc123', findings: 0, status: 'clean' },
    ],
    status: 'clean',
  },
  headSha: 'abc123',
  firstCommitSubject: 'feat(scripts:test-feature): scaffold',
};

describe('composeTitle', () => {
  it('uses the first commit subject for full-new path', () => {
    expect(composeTitle(baseInput)).toBe('feat(scripts:test-feature): scaffold');
  });

  it('uses the first commit subject for micro-chore path (no fd)', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'micro-chore', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      firstCommitSubject: 'chore(docs): typo fix',
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
    expect(body).toContain('docs/superpowers/specs/2026-05-15-test-feature-design.md');
    expect(body).toContain('docs/superpowers/plans/2026-05-15-test-feature.md');
    expect(body).toContain('## CR Results');
    expect(body).toContain('| 1 | claude | `abc123` | 0 | ✅ |');
    expect(body).toContain('| 2 | codex | `abc123` | 0 | ✅ |');
    expect(body).toContain('## Test Plan');
    expect(body).toContain('Opened by Noldor `/gate` end-of-flow.');
  });

  it('omits Spec/Plan lines for micro-chore (null paths)', () => {
    const input: PrFlowInput = {
      ...baseInput,
      session: { ...baseInput.session, path: 'micro-chore', slug: undefined },
      fd: null,
      specPath: null,
      planPath: null,
      firstCommitSubject: 'chore(docs): typo fix',
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
      firstCommitSubject: 'fix(core): correct pr summary label',
    };
    const body = composeBody(input);
    expect(body).toContain('Fast-track: fix(core): correct pr summary label');
    expect(body).not.toContain('Micro-chore:');
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
      specPath: 'docs/superpowers/specs/2026-05-16-existing-feature-enhancement-design.md',
      planPath: 'docs/superpowers/plans/2026-05-16-existing-feature-enhancement.md',
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
    headSha: 'abc123',
    firstCommitSubject: 'chore(release-sweep): graphify output',
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

  it('extends timeout when state BEHIND observed', async () => {
    let pollCount = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      pollCount++;
      if (pollCount < 10)
        return { stdout: JSON.stringify({ mergedAt: null, state: 'BEHIND' }), exitCode: 0 };
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
    const result = await openAndAutoMerge({ ...baseInput, spawn, openOnly: true });
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
    await expect(openAndAutoMerge({ ...baseInput, spawn })).rejects.toThrow(GhPreflightError);
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
    await expect(openAndAutoMerge({ ...baseInput, spawn })).rejects.toThrow(
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
    const result = await openAndAutoMerge({ ...baseInput, spawn });
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
});
