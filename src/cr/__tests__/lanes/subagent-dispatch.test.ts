// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../lanes/subagent-dispatch.js';
import { ALL_DIMENSIONS, DEFAULT_REVIEW_PROFILES } from '../../../core/review-profile.js';

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
    expect(p).toMatch(/- reuse:/); // copy-paste lands on the XS/S no-FD lane
    expect(p).toMatch(/- simplification:/); // the drain hardcodes this profile → KISS must be in scope
    expect(p).toMatch(/- correctness:.*race conditions/); // no `concurrency` here → clause must stay
    expect(p).not.toMatch(/altitude/);
    expect(p).toMatch(/high-confidence/i); // low-effort calibration line
  });

  it('gives the simplification guide concrete tells plus a nit-suppression override', () => {
    const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES['fast-track'] });
    expect(p).toMatch(/- simplification:.*materially shorter equivalent/);
    expect(p).toMatch(/- simplification:.*single call site/);
    expect(p).toMatch(/- simplification:.*actionable at any effort, not a speculative nit/);
  });

  it('keeps the low-effort line dimension-agnostic', () => {
    // A `low` profile without `simplification` must not be told to report one —
    // that would contradict the "these dimensions only" instruction.
    const p = buildPrompt({
      ...base,
      reviewProfile: { effort: 'low', dimensions: ['correctness'] },
    });
    expect(p).toMatch(/Skip speculative nits\./);
    expect(p).not.toMatch(/simplification/);
  });

  it('names every dimension for the default profile', () => {
    const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES.default });
    for (const d of [
      'correctness',
      'security',
      'reuse',
      'simplification',
      'efficiency',
      'altitude',
      'concurrency',
      'effects',
    ]) {
      expect(p).toMatch(new RegExp(`- ${d}:`));
    }
  });

  it('gives every schema dimension a guide line, so the default sweep can never emit a bare name', () => {
    const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES.default });
    for (const d of ALL_DIMENSIONS) {
      expect(p).toMatch(new RegExp(`- ${d}: \\S`));
    }
  });

  it('keeps the unchanged output contract and defaults to the default profile', () => {
    const p = buildPrompt(base);
    expect(p).toContain('Strengths: <one-line summary');
    expect(p).toContain('Issues:');
    expect(p).toContain('Assessment: <one-line verdict');
  });

  it('instructs the reviewer to classify blockers [mechanical] / [design]', () => {
    const p = buildPrompt(base);
    expect(p).toContain('[mechanical]');
    expect(p).toContain('[design]');
    // Both definitions must be present, or the reviewer is guessing at the axis.
    expect(p).toContain('the fix is determined by the finding itself');
    expect(p).toContain('requires a judgment call you are NOT making for them');
    // The tie-break must point at the safe side: an untagged/design blocker goes
    // to a human, which is what `cr autofix`'s fail-safe read relies on.
    expect(p).toContain('When in doubt, tag `[design]`');
    // Tag by what the fix needs, not by severity — the two axes are orthogonal.
    expect(p).toContain('Tag by what the FIX needs, not by how severe');
    expect(p).toContain('- [mechanical|design] <bullet>');
  });

  it('carries the classification instruction under every profile', () => {
    for (const name of Object.keys(DEFAULT_REVIEW_PROFILES)) {
      const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES[name]! });
      expect(p, `profile ${name}`).toContain('[mechanical]');
    }
  });
});
