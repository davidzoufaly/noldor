# Code Reviewer 2.0 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Drive the subagent CR lane off a configurable, per-path **review profile** (effort level + named dimensions); ship a scoped `fast-track` profile.
**Architecture:** New `review-profile.ts` Zod module → `crReview` config block + `resolveReviewProfile` resolver → `--profile` flag plumbed through orchestrate into `LaneInput` → richer `buildPrompt` rubric → gate fast-track wiring.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod, Vitest.

---

## File Structure

- `src/cr/review-profile.ts` — NEW: effort/dimension/profile Zod schemas, `ALL_DIMENSIONS`, `DEFAULT_REVIEW_PROFILES`.
- `src/cr/__tests__/review-profile.test.ts` — NEW: schema + defaults tests.
- `src/cr/config.ts` — MODIFY: `crReviewConfigSchema`, `crReview` field, `resolveReviewProfile`.
- `src/cr/__tests__/config.test.ts` — MODIFY: resolver tests.
- `src/cr/orchestrate-args.ts` — MODIFY: `profile` field + `--profile` parse.
- `src/cr/__tests__/orchestrate.test.ts` — MODIFY: profile plumbing test.
- `src/cr/lane-types.ts` — MODIFY: `reviewProfile?` on `LaneInput`.
- `src/cr/orchestrate.ts` — MODIFY: resolve + attach profile to `LaneInput`.
- `src/cr/lanes/subagent-dispatch.ts` — MODIFY: export `buildPrompt`, add dimension/effort rubric, `reviewProfile` on `DispatchInput`.
- `src/cr/__tests__/lanes/subagent-dispatch.test.ts` — NEW: rubric tests.
- `src/cr/lanes/subagent.ts` — MODIFY: pass `input.reviewProfile` to dispatch.
- `.claude/skills/gate/SKILL.md` + `templates/.claude/skills/gate/SKILL.md` — MODIFY: fast-track passes `--profile fast-track`.

---

## Task 1: Review-profile module

**Files:**
- Create: `src/cr/review-profile.ts`
- Test: `src/cr/__tests__/review-profile.test.ts`

- [ ] **Step 1: Write failing test for schemas + defaults.**
Create `src/cr/__tests__/review-profile.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  ALL_DIMENSIONS,
  DEFAULT_REVIEW_PROFILES,
  reviewProfileSchema,
} from '../review-profile.js';

describe('review-profile', () => {
  it('ships default and fast-track built-in profiles', () => {
    expect(DEFAULT_REVIEW_PROFILES.default).toEqual({ effort: 'med', dimensions: ALL_DIMENSIONS });
    expect(DEFAULT_REVIEW_PROFILES['fast-track']).toEqual({
      effort: 'low',
      dimensions: ['correctness', 'security'],
    });
  });

  it('rejects an empty dimensions list', () => {
    expect(() => reviewProfileSchema.parse({ effort: 'low', dimensions: [] })).toThrow();
  });

  it('rejects an unknown effort', () => {
    expect(() =>
      reviewProfileSchema.parse({ effort: 'turbo', dimensions: ['correctness'] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**
```bash
pnpm vitest run src/cr/__tests__/review-profile.test.ts
```
Expected: fails — `Cannot find module '../review-profile.js'`.

- [ ] **Step 3: Implement `src/cr/review-profile.ts`.**
```ts
import { z } from 'zod';

export const reviewEffortSchema = z.enum(['low', 'med', 'high', 'max']);
export type ReviewEffort = z.infer<typeof reviewEffortSchema>;

export const reviewDimensionSchema = z.enum([
  'correctness',
  'security',
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
]);
export type ReviewDimension = z.infer<typeof reviewDimensionSchema>;

export const reviewProfileSchema = z.object({
  effort: reviewEffortSchema,
  dimensions: z.array(reviewDimensionSchema).min(1),
});
export type ReviewProfile = z.infer<typeof reviewProfileSchema>;

export const ALL_DIMENSIONS: ReviewDimension[] = [
  'correctness',
  'security',
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
];

/**
 * Built-in profiles, used when `crReview.profiles.<name>` is absent.
 * `default` = a full med-effort sweep across every dimension. `fast-track`
 * = a scoped low-effort correctness+security pass for XS/S no-FD changes.
 */
export const DEFAULT_REVIEW_PROFILES: Record<string, ReviewProfile> = {
  default: { effort: 'med', dimensions: ALL_DIMENSIONS },
  'fast-track': { effort: 'low', dimensions: ['correctness', 'security'] },
};
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
pnpm vitest run src/cr/__tests__/review-profile.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Commit.**
```bash
git add src/cr/review-profile.ts src/cr/__tests__/review-profile.test.ts ; git commit -m "feat(cr): add review-profile schema and built-in profiles" -m "Noldor-FD: code-reviewer-20"
```

---

## Task 2: crReview config block + resolver

**Files:**
- Modify: `src/cr/config.ts`
- Test: `src/cr/__tests__/config.test.ts`

- [ ] **Step 1: Write failing resolver test.** Append to `src/cr/__tests__/config.test.ts`:
```ts
import { resolveReviewProfile } from '../config.js';

describe('resolveReviewProfile', () => {
  it('returns the built-in default when config is null', () => {
    expect(resolveReviewProfile(null)).toEqual({
      effort: 'med',
      dimensions: ['correctness', 'security', 'reuse', 'simplification', 'efficiency', 'altitude'],
    });
  });

  it('returns the built-in fast-track profile by name', () => {
    expect(resolveReviewProfile(null, 'fast-track')).toEqual({
      effort: 'low',
      dimensions: ['correctness', 'security'],
    });
  });

  it('falls back to default for an unknown name', () => {
    expect(resolveReviewProfile(null, 'bogus').effort).toBe('med');
  });

  it('lets config override a built-in profile name', () => {
    const cfg = { crReview: { profiles: { 'fast-track': { effort: 'high', dimensions: ['correctness'] } } } } as const;
    expect(resolveReviewProfile(cfg, 'fast-track')).toEqual({ effort: 'high', dimensions: ['correctness'] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```
Expected: fails — `resolveReviewProfile is not a function` / import error.

- [ ] **Step 3: Add schema + field to `src/cr/config.ts`.** After the `import` block add:
```ts
import { reviewProfileSchema } from './review-profile.js';
import type { ReviewProfile } from './review-profile.js';
import { DEFAULT_REVIEW_PROFILES } from './review-profile.js';
```
Above `noldorConfigSchema` add:
```ts
export const crReviewConfigSchema = z.object({
  profiles: z.record(z.string(), reviewProfileSchema).optional(),
});
```
Add the field inside `noldorConfigSchema` (after `crLanes`):
```ts
  crReview: crReviewConfigSchema.optional(),
```

- [ ] **Step 4: Add the resolver to `src/cr/config.ts`.** At end of file:
```ts
/**
 * Resolves the effective review profile for `name` (default `'default'`):
 * a configured `crReview.profiles[name]`, else the built-in
 * {@link DEFAULT_REVIEW_PROFILES}[name], else the `default` built-in. Never
 * throws on an unknown name — falls back to the richer default (fails safe:
 * more review, not less). Mirrors {@link resolveSessionTtlHours}.
 */
export function resolveReviewProfile(
  config: NoldorConfig | null,
  name = 'default',
): ReviewProfile {
  return (
    config?.crReview?.profiles?.[name] ??
    DEFAULT_REVIEW_PROFILES[name] ??
    DEFAULT_REVIEW_PROFILES.default
  );
}
```

- [ ] **Step 5: Run — expect PASS.**
```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```
Expected: all passed (new + existing config tests).

- [ ] **Step 6: Commit.**
```bash
git add src/cr/config.ts src/cr/__tests__/config.test.ts ; git commit -m "feat(cr): add crReview config block and resolveReviewProfile" -m "Noldor-FD: code-reviewer-20"
```

---

## Task 3: `--profile` flag + orchestrate plumbing

**Files:**
- Modify: `src/cr/orchestrate-args.ts`, `src/cr/lane-types.ts`, `src/cr/orchestrate.ts`
- Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write failing test.** Add to `src/cr/__tests__/orchestrate.test.ts`:
```ts
import { parseArgs } from '../orchestrate-args.js';

describe('--profile arg', () => {
  it('parses --profile', () => {
    const a = parseArgs(['node', 'x', '--slug', 's', '--artifact', 'a', '--kind', 'code', '--profile', 'fast-track']);
    expect(a.profile).toBe('fast-track');
  });
  it('leaves profile undefined when absent', () => {
    const a = parseArgs(['node', 'x', '--slug', 's', '--artifact', 'a', '--kind', 'code']);
    expect(a.profile).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t "profile"
```
Expected: fails — `a.profile` is `undefined` in the first case (flag not parsed).

- [ ] **Step 3: Add `profile` to `src/cr/orchestrate-args.ts`.** In `orchestrateArgsSchema` add after `autonomous`:
```ts
  profile: z.string().optional(),
```
In `parseArgs`, add a branch after the `--autonomous` line:
```ts
    else if (t === '--profile') a.profile = argv[++i];
```

- [ ] **Step 4: Add `reviewProfile` to `LaneInput` in `src/cr/lane-types.ts`.** Add the import and field:
```ts
import type { ReviewProfile } from './review-profile.js';
```
Inside `LaneInput`, after `fullReview?: boolean;`:
```ts
  reviewProfile?: ReviewProfile;
```

- [ ] **Step 5: Resolve + attach in `src/cr/orchestrate.ts`.** Update the config import:
```ts
import { DEFAULT_CR_LANES, loadConfig, resolveReviewProfile } from './config.js';
```
Inside `run()`, immediately after the `const cfg = await loadConfig(...)` line, add:
```ts
  const reviewProfile = resolveReviewProfile(cfg, opts.args.profile);
```
Add `reviewProfile` to the `input: LaneInput` object literal (after the `fullReview` spread):
```ts
    reviewProfile,
```

- [ ] **Step 6: Run — expect PASS.**
```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts
```
Expected: all passed.

- [ ] **Step 7: Commit.**
```bash
git add src/cr/orchestrate-args.ts src/cr/lane-types.ts src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts ; git commit -m "feat(cr): plumb --profile through orchestrate into LaneInput" -m "Noldor-FD: code-reviewer-20"
```

---

## Task 4: Dimension/effort rubric in buildPrompt

**Files:**
- Modify: `src/cr/lanes/subagent-dispatch.ts`, `src/cr/lanes/subagent.ts`
- Test: `src/cr/__tests__/lanes/subagent-dispatch.test.ts`

- [ ] **Step 1: Write failing test.** Create `src/cr/__tests__/lanes/subagent-dispatch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../lanes/subagent-dispatch.js';
import { DEFAULT_REVIEW_PROFILES } from '../../review-profile.js';

const base = { artifact: 'x.ts', fdSummary: 'fd', baseSha: 'a', headSha: 'b', description: 'code for FD s' };

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
    for (const d of ['correctness', 'security', 'reuse', 'simplification', 'efficiency', 'altitude']) {
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
```

- [ ] **Step 2: Run — expect FAIL.**
```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts
```
Expected: fails — `buildPrompt` is not exported.

- [ ] **Step 3: Edit `src/cr/lanes/subagent-dispatch.ts`.** Add imports at top:
```ts
import { DEFAULT_REVIEW_PROFILES } from '../review-profile.js';
import type { ReviewDimension, ReviewEffort, ReviewProfile } from '../review-profile.js';
```
Add `reviewProfile?` to `DispatchInput`:
```ts
  reviewProfile?: ReviewProfile;
```
Above `buildPrompt`, add the guide tables:
```ts
const DIMENSION_GUIDE: Record<ReviewDimension, string> = {
  correctness: 'logic errors, off-by-one, null/undefined, race conditions, wrong API usage',
  security: 'injection, path traversal, unsafe shell/exec, secret leakage, unvalidated input',
  reuse: 'duplicated logic an existing helper already covers; missed single-source-of-truth',
  simplification: 'dead branches, needless indirection, over-abstraction, a simpler equivalent',
  efficiency: 'avoidable O(n^2), redundant IO/subprocess, repeated reads, sync work in a loop',
  altitude: 'wrong layer/abstraction, leaky boundaries, responsibility in the wrong module',
};

const EFFORT_GUIDE: Record<ReviewEffort, string> = {
  low: 'Report only high-confidence, clearly-actionable findings. Skip speculative nits.',
  med: 'Report confident findings across the dimensions; a few well-justified maybes allowed.',
  high: 'Broaden coverage; include lower-confidence findings, each prefixed `maybe:`.',
  max: 'Be exhaustive; surface every plausible concern, prefixing uncertain ones `maybe:`.',
};
```
Change `buildPrompt` to be exported and inject the rubric. Replace the existing `function buildPrompt(input: DispatchInput): string {` body's opening and the `Range under review` paragraph region with this — the `Emit your review in this exact format` block onward stays byte-for-byte:
```ts
export function buildPrompt(input: DispatchInput): string {
  const profile = input.reviewProfile ?? DEFAULT_REVIEW_PROFILES.default;
  const dimensionLines = profile.dimensions.map((d) => `- ${d}: ${DIMENSION_GUIDE[d]}`).join('\n');
  return `You are a Senior Code Reviewer. Review the markdown artifact at \`${input.artifact}\` (description: ${input.description}).

FD summary context:
${input.fdSummary}

Range under review: ${input.baseSha}..${input.headSha}. If they differ, review only the diff; if equal, review the whole artifact.

Review along these dimensions only — do not flag concerns outside them:
${dimensionLines}

Effort: ${profile.effort}. ${EFFORT_GUIDE[profile.effort]}

Verify-before-flag protocol: before flagging a Critical issue that claims a command, validator, or test will fail (e.g. \`pnpm validate:features\`, \`pnpm typecheck\`, \`pnpm test\`), run that exact command first and quote its actual error output in the bullet. If the command passes, or you cannot run it, do not flag the claim as Critical — file it under Important prefixed with \`unverified:\` instead.

Emit your review in this exact format, no preamble:

Strengths: <one-line summary of what is well-done>

Issues:
  Critical:
    - <bullet>
  Important:
    - <bullet>
  Minor:
    - <bullet>

Assessment: <one-line verdict: approve | blockers found | needs changes>

Leave a bucket's bullet list empty (no bullets) when there are no items at that severity.`;
}
```

- [ ] **Step 4: Pass the profile from `subagent.ts`.** In `src/cr/lanes/subagent.ts`, in the `dispatchSubagent({...})` call add after `description`:
```ts
      ...(input.reviewProfile ? { reviewProfile: input.reviewProfile } : {}),
```

- [ ] **Step 5: Run — expect PASS (and no parser regression).**
```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts src/cr/__tests__/lanes/subagent.test.ts
```
Expected: all passed — new rubric tests green, existing subagent + `parseSubagentMarkdown` fixture tests still green.

- [ ] **Step 6: Commit.**
```bash
git add src/cr/lanes/subagent-dispatch.ts src/cr/lanes/subagent.ts src/cr/__tests__/lanes/subagent-dispatch.test.ts ; git commit -m "feat(cr): drive subagent review off dimension+effort profile" -m "Noldor-FD: code-reviewer-20"
```

---

## Task 5: Fast-track wiring + full verify

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`, `templates/.claude/skills/gate/SKILL.md`

- [ ] **Step 1: Wire the gate skill.** In `.claude/skills/gate/SKILL.md`, at the Step-4 code-stage orchestrate command (the `pnpm noldor cr orchestrate ... --kind code` block) add a sentence + the flag for the fast-track path:
```
When the session marker `path` is `fast-track`, append `--profile fast-track` to the orchestrate command so the CR pass is scoped (low effort, correctness+security per `crReview.profiles`). Other paths omit the flag and get the `default` profile.
```
Append `--profile fast-track` to the example command shown for the fast-track / drain code-stage review.

- [ ] **Step 2: Mirror into the template twin.** Apply the identical edit to `templates/.claude/skills/gate/SKILL.md`. The shared-files guard requires:
```bash
NOLDOR_ALLOW_SHARED=1 git add templates/.claude/skills/gate/SKILL.md
```

- [ ] **Step 3: Full verification gate.**
```bash
pnpm typecheck && pnpm test && pnpm validate:features
```
Expected: typecheck clean, full suite green, feature MDs valid.

- [ ] **Step 4: Commit.**
```bash
NOLDOR_ALLOW_SHARED=1 git add .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md ; git commit -m "feat(cr): scope fast-track CR with the fast-track review profile" -m "Noldor-FD: code-reviewer-20"
```
