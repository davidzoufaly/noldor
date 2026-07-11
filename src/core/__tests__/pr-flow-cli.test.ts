// @tests: autonomous-plan-to-pr-merge, parallel-drain, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  pickMostRecentByDatePrefix,
  parseCrTrailersFromLog,
  normalizeRepoUrl,
  shouldPromptForPrApproval,
  clearMicroChoreSession,
  loadVerifyEvidence,
} from '../pr-flow-cli.js';
import { writeSession } from '../session.js';

describe('shouldPromptForPrApproval', () => {
  it('returns false when config flag is unset (default)', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: false },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(false);
  });
  it('returns true when config flag set AND session not autonomous', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: true },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(true);
  });
  it('returns false when config flag set BUT session.autonomous true (session overrides)', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: true },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't', autonomous: true },
      }),
    ).toBe(false);
  });
  it('returns false when config is null (no .noldor/config.json)', () => {
    expect(
      shouldPromptForPrApproval({
        config: null,
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(false);
  });
});

describe('pickMostRecentByDatePrefix', () => {
  it('returns the newest filename when multiple share a directory', () => {
    const paths = [
      'docs/superpowers/plans/2026-05-14-a.md',
      'docs/superpowers/plans/2026-05-16-c.md',
      'docs/superpowers/plans/2026-05-15-b.md',
    ];
    expect(pickMostRecentByDatePrefix(paths)).toBe('docs/superpowers/plans/2026-05-16-c.md');
  });

  it('returns null on empty input', () => {
    expect(pickMostRecentByDatePrefix([])).toBeNull();
  });

  it('falls back to lexical order when no date prefix present', () => {
    const paths = ['docs/superpowers/plans/zeta.md', 'docs/superpowers/plans/alpha.md'];
    expect(pickMostRecentByDatePrefix(paths)).toBe('docs/superpowers/plans/zeta.md');
  });
});

describe('parseCrTrailersFromLog', () => {
  it('extracts one pass per Noldor-Reviewed trailer (claude)', () => {
    const log = [
      'commit aaa',
      '',
      '    feat(scripts): x',
      '',
      '    Noldor-Reviewed: tree1',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [{ reviewer: 'claude', tipSha: 'tree1', findings: 0, status: 'clean' }],
      status: 'clean',
    });
  });

  it('extracts codex passes via Noldor-Reviewed-Codex trailer', () => {
    const log = [
      'commit aaa',
      '',
      '    feat(scripts): x',
      '',
      '    Noldor-Reviewed: t1',
      '    Noldor-Reviewed-Codex: t1',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [
        { reviewer: 'claude', tipSha: 't1', findings: 0, status: 'clean' },
        { reviewer: 'codex', tipSha: 't1', findings: 0, status: 'clean' },
      ],
      status: 'clean',
    });
  });

  it('returns empty passes for log with no review trailers', () => {
    expect(parseCrTrailersFromLog('commit aaa\n\n    no trailers here\n')).toEqual({
      passes: [],
      status: 'clean',
    });
  });

  it('extracts trailers at column 0 (real git log --format=%b output)', () => {
    // `git log --format=%H%n%s%n%n%b` emits trailers with NO leading whitespace.
    // The default-medium log format indents the body by 4 spaces, but `%b` does not.
    // Both forms must parse.
    const log = [
      '158be93b70b015b68a089749592a6de88ca294c3',
      'fix(noldor:framework-pr-flow): seatbelt',
      '',
      'Body paragraph.',
      '',
      'Noldor-FD: framework-pr-flow-agent-auto-merge',
      'Noldor-Reviewed: tree_at_col0',
      'Noldor-Reviewed-Codex: tree_at_col0',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [
        { reviewer: 'claude', tipSha: 'tree_at_col0', findings: 0, status: 'clean' },
        { reviewer: 'codex', tipSha: 'tree_at_col0', findings: 0, status: 'clean' },
      ],
      status: 'clean',
    });
  });
});

describe('clearMicroChoreSession', () => {
  const setup = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'prf-'));
    mkdirSync(join(dir, '.noldor'));
    return dir;
  };
  const sessionFile = (dir: string): string => join(dir, '.noldor', 'session.json');

  it('clears the session when path is micro-chore', () => {
    const dir = setup();
    writeSession(dir, { path: 'micro-chore', startedAt: '2026-06-07T00:00:00.000Z' });
    expect(existsSync(sessionFile(dir))).toBe(true);
    clearMicroChoreSession(dir, { path: 'micro-chore', startedAt: '2026-06-07T00:00:00.000Z' });
    expect(existsSync(sessionFile(dir))).toBe(false);
  });

  it('leaves the session untouched for a non-micro-chore path', () => {
    const dir = setup();
    const marker = {
      path: 'specs-only-attach' as const,
      parent: 'noldor',
      startedAt: '2026-06-07T00:00:00.000Z',
      markerVersion: 2 as const,
    };
    writeSession(dir, marker);
    clearMicroChoreSession(dir, marker);
    expect(existsSync(sessionFile(dir))).toBe(true);
  });
});

describe('loadVerifyEvidence', () => {
  const setup = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'prf-'));
    mkdirSync(join(dir, '.noldor', 'cr'), { recursive: true });
    return dir;
  };
  const sink = (dir: string, slug: string, payload: unknown): void => {
    writeFileSync(join(dir, '.noldor', 'cr', `${slug}-code-verify.json`), JSON.stringify(payload));
  };

  it('lifts verdict + evidence pairs from the code-verify sink', () => {
    const dir = setup();
    sink(dir, 'my-feature', {
      lane: 'verify',
      verdict: 'pass',
      evidence: [{ command: 'pnpm noldor --help', observed: 'exit 0' }],
    });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'pass',
      evidence: [{ command: 'pnpm noldor --help', observed: 'exit 0' }],
    });
  });

  it('returns null when the sink file is absent (verify lane not configured)', () => {
    expect(loadVerifyEvidence(setup(), 'my-feature')).toBeNull();
  });

  it('returns null on unparseable JSON', () => {
    const dir = setup();
    writeFileSync(join(dir, '.noldor', 'cr', 'my-feature-code-verify.json'), '{nope');
    expect(loadVerifyEvidence(dir, 'my-feature')).toBeNull();
  });

  it('returns null when the sink has no string verdict (non-verify lane shape)', () => {
    const dir = setup();
    sink(dir, 'my-feature', { lane: 'subagent', blockers: [] });
    expect(loadVerifyEvidence(dir, 'my-feature')).toBeNull();
  });

  it('drops malformed evidence entries but keeps well-formed ones', () => {
    const dir = setup();
    sink(dir, 'my-feature', {
      verdict: 'fail',
      evidence: [{ command: 'curl /', observed: '500' }, { command: 42 }, 'garbage', null],
    });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'fail',
      evidence: [{ command: 'curl /', observed: '500' }],
    });
  });

  it('defaults evidence to [] when the sink omits the array (cannot-verify verdicts)', () => {
    const dir = setup();
    sink(dir, 'my-feature', { verdict: 'cannot-verify' });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'cannot-verify',
      evidence: [],
    });
  });
});

describe('normalizeRepoUrl', () => {
  it('strips .git from https URL', () => {
    expect(normalizeRepoUrl('https://github.com/davidzoufaly/acme.git')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });

  it('converts SSH form to HTTPS', () => {
    expect(normalizeRepoUrl('git@github.com:davidzoufaly/acme.git')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });

  it('returns https URL unchanged when no .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/davidzoufaly/acme')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });
});
