// @tests: autonomous-plan-to-pr-merge
import { describe, it, expect } from 'vitest';

import {
  pickMostRecentByDatePrefix,
  parseCrTrailersFromLog,
  normalizeRepoUrl,
  shouldPromptForPrApproval,
} from '../pr-flow-cli.js';

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
