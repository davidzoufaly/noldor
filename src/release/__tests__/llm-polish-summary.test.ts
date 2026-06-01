// packages/noldor/src/release/__tests__/llm-polish-summary.test.ts
// @tests: dynamic-fd-changelog

import { describe, expect, it } from 'vitest';

import { joinSubjectsDeterministic, polishSummary } from '../llm-polish-summary.js';

import type { FeatureCommit } from '../release-fd-commits.js';

function makeCommit(sha: string, type: string, subject: string): FeatureCommit {
  return { sha, type, subject, date: '2026-05-09' };
}

describe('joinSubjectsDeterministic', () => {
  it('joins subjects in order with sentence-case capitalisation on the first', () => {
    const out = joinSubjectsDeterministic([
      makeCommit('a', 'feat', 'add subtract op'),
      makeCommit('b', 'fix', 'cone radius default'),
    ]);
    expect(out).toBe('Add subtract op. Cone radius default.');
  });

  it('returns empty string for empty input', () => {
    expect(joinSubjectsDeterministic([])).toBe('');
  });

  it('preserves identifier-shaped tokens verbatim (no aggressive lowercasing)', () => {
    const out = joinSubjectsDeterministic([makeCommit('a', 'feat', 'wire `claude -p` runner')]);
    expect(out).toBe('Wire `claude -p` runner.');
  });
});

describe('polishSummary', () => {
  it('returns empty string for empty commits regardless of mode', async () => {
    expect(await polishSummary([])).toBe('');
    expect(await polishSummary([], { offline: true })).toBe('');
  });

  it('uses deterministic fallback when offline=true', async () => {
    const commits = [makeCommit('a', 'feat', 'one'), makeCommit('b', 'feat', 'two')];
    const out = await polishSummary(commits, { offline: true });
    expect(out).toBe('One. Two.');
  });

  it('uses deterministic fallback when NOLDOR_NO_LLM=1', async () => {
    const original = process.env.NOLDOR_NO_LLM;
    process.env.NOLDOR_NO_LLM = '1';
    try {
      const out = await polishSummary([makeCommit('a', 'feat', 'one')]);
      expect(out).toBe('One.');
    } finally {
      if (original === undefined) delete process.env.NOLDOR_NO_LLM;
      else process.env.NOLDOR_NO_LLM = original;
    }
  });

  it('uses injected runner when provided and not offline', async () => {
    const out = await polishSummary([makeCommit('a', 'feat', 'one')], {
      runner: async () => 'Polished prose.',
    });
    expect(out).toBe('Polished prose.');
  });

  it('falls back to deterministic join when runner throws', async () => {
    const out = await polishSummary([makeCommit('a', 'feat', 'one')], {
      runner: async () => {
        throw new Error('subprocess crashed');
      },
    });
    expect(out).toBe('One.');
  });
});
