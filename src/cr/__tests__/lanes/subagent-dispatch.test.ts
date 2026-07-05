// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../lanes/subagent-dispatch.js';
import { DEFAULT_REVIEW_PROFILES } from '../../../core/review-profile.js';

const base = {
  artifact: 'x.ts',
  fdSummary: 'fd',
  baseSha: 'a',
  headSha: 'b',
  description: 'code for FD s',
};

describe('buildPrompt review profile', () => {
  it('names only fast-track dimensions for the fast-track profile', () => {
    const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES['fast-track'] });
    expect(p).toMatch(/correctness/);
    expect(p).toMatch(/security/);
    expect(p).not.toMatch(/altitude/);
    expect(p).toMatch(/high-confidence/i); // low-effort calibration line
  });

  it('names all six dimensions for the default profile', () => {
    const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES.default });
    for (const d of [
      'correctness',
      'security',
      'reuse',
      'simplification',
      'efficiency',
      'altitude',
    ]) {
      expect(p).toMatch(new RegExp(d));
    }
  });

  it('keeps the unchanged output contract and defaults to the default profile', () => {
    const p = buildPrompt(base);
    expect(p).toContain('Strengths: <one-line summary');
    expect(p).toContain('Issues:');
    expect(p).toContain('Assessment: <one-line verdict');
  });
});
