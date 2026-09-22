// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer, rules-cascade-v1, cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import { ALL_DIMENSIONS, DEFAULT_REVIEW_PROFILES } from '../../../core/review-profile.js';
import type { Slug } from '../../../core/slug.js';
import { BLOCKING_DEFINITION } from '../../blocking-definition.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import { buildPrompt, CUT_MARKER_TOKEN, dispatchSubagent } from '../../lanes/subagent-dispatch.js';

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

  it('tells the reviewer to respect noldor:cut markers when a minimalism-class dimension is in scope', () => {
    // The lazy-decision-ladder rule instructs authors to mark deliberate cuts;
    // without this clause the reviewer flags exactly the cuts the rule asked for.
    // Prompt-level, not per-dimension: a cut lands against any ladder rung.
    for (const dims of [
      DEFAULT_REVIEW_PROFILES['fast-track']!.dimensions, // simplification via fast-track
      ['efficiency' as const], // the canonical example is an efficiency cut
    ]) {
      const p = buildPrompt({ ...base, reviewProfile: { effort: 'low', dimensions: dims } });
      expect(p).toMatch(/noldor:cut/);
      expect(p).toMatch(/wrong ceiling/);
      expect(p).toMatch(/real cut left unmarked/);
      expect(p).toMatch(
        /never waives a finding about a defect, a vulnerability, a race, an unintended state change, an accessibility regression, or explicitly-requested behaviour that was cut/,
      );
    }
  });

  it('carries the binding-rules section only when the caller supplies one', () => {
    // The author is told to read these before writing (`rules brief`); handing
    // the reviewer the same text is what makes `enforce` more than a suggestion.
    const withRules = buildPrompt({ ...base, rulesBrief: '# Rules for src/a.ts\nNO WIDE CASTS.' });
    expect(withRules).toMatch(/Binding rules for the files under review/);
    expect(withRules).toMatch(/repo policy, not preference/);
    expect(withRules).toContain('NO WIDE CASTS.');

    // Omitted field → no section at all, and no stray "no rules" paragraph.
    const without = buildPrompt(base);
    expect(without).not.toMatch(/Binding rules for the files under review/);
    expect(without).not.toMatch(/no rules match/);
  });

  it('keeps the range line intact when a binding-rules section is inserted before it', () => {
    const p = buildPrompt({ ...base, rulesBrief: 'RULE TEXT' });
    expect(p).toMatch(/Range under review: /);
    expect(p.indexOf('RULE TEXT')).toBeLessThan(p.indexOf('Range under review:'));
  });

  it('ties the reviewer-side marker grammar to the lazy-decision-ladder rule file', () => {
    // The author half of the noldor:cut contract is prose in the rule store;
    // this pins both halves to CUT_MARKER_TOKEN so a rename in either place
    // fails here instead of reviewers silently enforcing a stale grammar.
    for (const rel of [
      '.noldor/rules/lazy-decision-ladder.md',
      'templates/.noldor/rules/lazy-decision-ladder.md',
    ]) {
      const body = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(body, rel).toContain(CUT_MARKER_TOKEN);
    }
  });

  it('keeps the low-effort line dimension-agnostic', () => {
    // A `low` profile without `simplification` must not be told to report one —
    // that would contradict the "these dimensions only" instruction. Same for the
    // noldor:cut marker clause, which only renders for minimalism-class dimensions.
    const p = buildPrompt({
      ...base,
      reviewProfile: { effort: 'low', dimensions: ['correctness'] },
    });
    expect(p).toMatch(/Skip speculative nits\./);
    expect(p).not.toMatch(/simplification/);
    expect(p).not.toMatch(/noldor:cut/);
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

  it('asks for the JSON answer with a blocking flag, under the shared definition', () => {
    const p = buildPrompt(base);
    expect(p).toContain(BLOCKING_DEFINITION);
    expect(p).toContain('"blocking" (true | false');
    expect(p).toContain('a "minor" finding never blocks');
    expect(p).toContain('never write a placeholder finding such as "(none)"');
    expect(p).toContain('Approve only when no finding blocks.');
  });

  it('files a claim it could not verify as unverified, never as a blocker', () => {
    expect(buildPrompt(base)).toContain('an unverified finding never blocks');
  });

  it('instructs the reviewer to classify blocking findings mechanical / design', () => {
    const p = buildPrompt(base);
    expect(p).toContain('"mechanical"');
    expect(p).toContain('"design"');
    // Both definitions must be present, or the reviewer is guessing at the axis.
    expect(p).toContain('the fix is determined by the finding itself');
    expect(p).toContain('requires a judgment call you are NOT making for them');
    // The tie-break points at the safe side: a design-classed blocker goes to a human,
    // which is what `cr autofix`'s fail-safe read relies on.
    expect(p).toContain('When in doubt, use "design"');
    // Classify by what the fix needs, not by severity — the two axes are orthogonal.
    expect(p).toContain('Classify by what the FIX needs, not by how severe');
  });

  it('carries the classification instruction under every profile', () => {
    for (const name of Object.keys(DEFAULT_REVIEW_PROFILES)) {
      const p = buildPrompt({ ...base, reviewProfile: DEFAULT_REVIEW_PROFILES[name]! });
      expect(p, `profile ${name}`).toContain('"mechanical"');
    }
  });
});

describe('buildPrompt prior review section', () => {
  const finding = (over: Record<string, unknown> = {}) => ({
    file: 'docs/x.md',
    severity: 'high' as const,
    message: 'unaddressed blocker',
    ...over,
  });

  it('renders blockers as [severity][class] bullets between rules and range line', () => {
    const p = buildPrompt({
      ...base,
      rulesBrief: 'RULE TEXT',
      priorReview: {
        mode: 'fixes-in-diff',
        blockers: [
          finding({ class: 'mechanical' }),
          finding({ severity: 'med', message: 'no class here' }),
        ],
      },
    });
    expect(p).toContain('Prior review round');
    expect(p).toContain('- [high][mechanical] unaddressed blocker');
    expect(p).toContain('- [med] no class here'); // class bracket omitted when absent
    expect(p.indexOf('RULE TEXT')).toBeLessThan(p.indexOf('Prior review round'));
    expect(p.indexOf('Prior review round')).toBeLessThan(p.indexOf('Range under review:'));
  });

  it('renders the fixes-in-diff clause for that mode only', () => {
    const p = buildPrompt({
      ...base,
      priorReview: { mode: 'fixes-in-diff', blockers: [finding()] },
    });
    expect(p).toContain('The diff under review contains the fixes.');
    expect(p).toContain('regressions and genuinely new issues remain fully in scope');
    expect(p).not.toContain('Do not assume any of these blockers were addressed.');
  });

  it('renders the reexamine clause without asserting the artifact is unchanged', () => {
    const p = buildPrompt({
      ...base,
      priorReview: { mode: 'reexamine', blockers: [finding()] },
    });
    expect(p).toContain('Do not assume any of these blockers were addressed.');
    expect(p).toContain('keeping its message text identical to the listing above');
    expect(p).not.toMatch(/UNCHANGED/);
    expect(p).not.toContain('The diff under review contains the fixes.');
  });

  it('caps at 20 blockers and reports the overflow count', () => {
    const blockers = Array.from({ length: 23 }, (_, i) => finding({ message: `blocker ${i}` }));
    const p = buildPrompt({ ...base, priorReview: { mode: 'fixes-in-diff', blockers } });
    expect(p).toContain('blocker 19');
    expect(p).not.toContain('blocker 20');
    expect(p).toContain('…and 3 more prior blockers');
  });

  it('truncates to 300 chars in fixes-in-diff but never in reexamine; collapses newlines in both', () => {
    const long = 'x'.repeat(400);
    const fixP = buildPrompt({
      ...base,
      priorReview: { mode: 'fixes-in-diff', blockers: [finding({ message: long })] },
    });
    expect(fixP).toContain('x'.repeat(300));
    expect(fixP).not.toContain('x'.repeat(301));
    const reP = buildPrompt({
      ...base,
      priorReview: { mode: 'reexamine', blockers: [finding({ message: long })] },
    });
    expect(reP).toContain('x'.repeat(400));

    const multiline = buildPrompt({
      ...base,
      priorReview: { mode: 'reexamine', blockers: [finding({ message: 'line one\n  line two' })] },
    });
    expect(multiline).toContain('- [high] line one line two');
  });

  it('omitted field → no section, prompt identical to the pre-context output', () => {
    expect(buildPrompt(base)).not.toContain('Prior review round');
    // Byte-identity with the absent-field shape: an explicit-undefined field
    // must render exactly the same string.
    expect(buildPrompt({ ...base, priorReview: undefined })).toBe(buildPrompt(base));
  });
});

describe('default dispatcher', () => {
  const at = (): { repoRoot: string; slug: Slug; kind: 'code' } => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-subagent-dispatch-'));
    mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
    writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
    return { repoRoot, slug: 'feat-x' as Slug, kind: 'code' };
  };
  const calls: SpawnAgentOpts[] = [];
  const clean = (): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push(opts);
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path) writeFileSync(path, '{"assessment":"approve","strengths":"s","findings":[]}');
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false };
    });
  afterEach(() => {
    calls.length = 0;
    setLaneSpawn(undefined);
  });

  it('applies DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits timeoutMs', async () => {
    clean();
    await dispatchSubagent(base, at());
    expect(calls[0]!.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
  });

  it('honors an explicit timeoutMs from the lane', async () => {
    clean();
    await dispatchSubagent({ ...base, timeoutMs: 42_000 }, at());
    expect(calls[0]!.timeoutMs).toBe(42_000);
  });
});

it('asks every critical and important finding to name a file and line', () => {
  const prompt = buildPrompt({
    artifact: 'a.md',
    fdSummary: 'summary',
    baseSha: 'BASE',
    headSha: 'HEAD',
    description: 'code for FD s',
  });
  expect(prompt).toContain('path/to/file.ts:123');
  expect(prompt).toMatch(/name the file and line/i);
});
