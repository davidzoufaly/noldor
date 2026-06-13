# Code Reviewer 2.0 — Design

**Slug:** code-reviewer-20
**FD:** docs/features/code-reviewer-20.md
**Date:** 2026-06-13
**Tier:** full
**Deps:** none

## Problem

The autonomous-default CR lane is thin. `buildPrompt` in
[`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts)
ships a single "Senior Code Reviewer" prompt with a one-line `Strengths` +
flat `Critical/Important/Minor` bucket format and one protocol rule
(verify-before-flag). It names **no review dimensions** — correctness,
security, reuse, simplification, efficiency, altitude are all left to the
agent's discretion. Quality is whatever the model defaults to.

Two consequences:

1. **No quality floor.** Compared to the in-repo `/code-review` and
   `/simplify` skills — which review along explicit, named dimensions — the
   subagent lane is a black box. The body asks to "raise review quality
   beyond the current CR lane," taking inspiration from the MC (multi-Claude)
   Code Reviewer's dimension-scoped, effort-calibrated passes.

2. **No way to tune/scope the pass.** `crLanes.<kind>` in
   [`src/cr/config.ts`](../../../src/cr/config.ts) selects *which lanes* run,
   but nothing controls *how hard* a lane reviews or *which dimensions* it
   covers. Fast-track (XS/S, no FD — `runSubagent` even injects
   `(no FD — fast-track change…)`) gets the exact same maximal review as a
   full-tier L feature. The body asks for "code-reviewer configuration for
   fast-track — let fast-track tune/scope the CR pass."

## Goals

- Drive the subagent lane's review off a named **review profile**: an
  `effort` level (`low|med|high|max`) and a list of **dimensions** the
  reviewer must cover.
- Make profiles configurable per-name via `.noldor/config.json` and
  selectable per orchestrate invocation via `--profile <name>`.
- Ship a built-in `fast-track` profile (scoped: low effort, correctness +
  security only) and a `default` profile (med effort, all dimensions), so
  fast-track reviews cheaper/narrower without operator config.
- Keep the existing `Strengths/Issues/Assessment` markdown contract and
  `parseSubagentMarkdown` parser **unchanged** — zero parser-risk, backward
  compatible sinks.

## Non-goals

- Touching the `codex`, `verify`, `manual`, or `standalone` lanes. Profile
  applies to the `subagent` lane only in v1 (it is the autonomous default).
- Changing the `LaneFindings` sink schema or the aggregator.
- A new multi-agent / multi-pass orchestration ("real" MC fan-out). v1 is a
  single richer pass; fan-out is a follow-up.
- Auto-detecting the session path inside orchestrate. The profile is selected
  by an explicit `--profile` flag the caller passes (see D1).

## Design (named units)

### 1. `ReviewProfile` module — `src/cr/review-profile.ts` (new)
Zod-first, mirroring `findings-schema.ts` conventions:
- `reviewEffortSchema = z.enum(['low','med','high','max'])`, `ReviewEffort`.
- `reviewDimensionSchema = z.enum(['correctness','security','reuse','simplification','efficiency','altitude'])`,
  `ReviewDimension`. Vocabulary lifted from the `/code-review` + `/simplify`
  skills (D2).
- `reviewProfileSchema = z.object({ effort, dimensions: z.array(...).min(1) })`,
  `ReviewProfile`.
- `ALL_DIMENSIONS: ReviewDimension[]` constant.
- `DEFAULT_REVIEW_PROFILES: Record<string, ReviewProfile>` with `default`
  (`med`, all dims) and `fast-track` (`low`, `['correctness','security']`).

### 2. Config block — `src/cr/config.ts`
- `crReviewConfigSchema = z.object({ profiles: z.record(z.string(), reviewProfileSchema).optional() })`.
- Add `crReview: crReviewConfigSchema.optional()` to `noldorConfigSchema`
  (alongside `crLanes`, `autonomous`, `gate`, `agents`). `.optional()`, no
  `.default()` — mirrors the `crLanes` "don't synthesize a block" rule.
- `resolveReviewProfile(cfg, name = 'default'): ReviewProfile` — returns the
  configured `crReview.profiles[name]` if present, else the built-in
  `DEFAULT_REVIEW_PROFILES[name]`, else `DEFAULT_REVIEW_PROFILES.default`.
  Mirrors `resolveSessionTtlHours` exactly.

### 3. Plumbing — `orchestrate-args.ts`, `orchestrate.ts`, `lane-types.ts`
- `orchestrateArgsSchema`: add `profile: z.string().optional()`; `parseArgs`
  parses `--profile <name>`.
- `LaneInput` (lane-types.ts): add `reviewProfile?: ReviewProfile`.
- `run()` in orchestrate.ts: after `loadConfig`, compute
  `const reviewProfile = resolveReviewProfile(cfg, opts.args.profile)` and
  spread `reviewProfile` onto the `input: LaneInput` it builds (line ~193).

### 4. Richer rubric — `src/cr/lanes/subagent-dispatch.ts`
- `DispatchInput` gains `reviewProfile?: ReviewProfile`.
- `buildPrompt` (export it for tests) gains two lookup tables —
  `DIMENSION_GUIDE` (one line per dimension) and `EFFORT_GUIDE` (one line per
  effort level) — and injects, for the selected profile, a **"Review along
  these dimensions"** block + an **effort calibration** line, *above* the
  unchanged `Strengths/Issues/Assessment` output contract. Undefined profile
  falls back to `DEFAULT_REVIEW_PROFILES.default`. The verify-before-flag
  protocol stays verbatim.
- `runSubagent` in `subagent.ts` passes `reviewProfile: input.reviewProfile`
  into the `dispatchSubagent({...})` call (line ~94).

### 5. Fast-track wiring — gate skill
- The Step-4 code-stage orchestrate command in
  [`.claude/skills/gate/SKILL.md`](../../../.claude/skills/gate/SKILL.md) (and
  its template twin `templates/.claude/skills/gate/SKILL.md`) appends
  `--profile fast-track` when the session marker `path` is `fast-track`.
  Other paths omit the flag → `default` profile. Skill-twin edit requires
  `NOLDOR_ALLOW_SHARED=1` per the shared-files guard.

## Acceptance criteria

- `resolveReviewProfile(null, 'fast-track')` → `{ effort:'low', dimensions:['correctness','security'] }`; `resolveReviewProfile(null)` → the `default` med/all profile; `resolveReviewProfile(null,'bogus')` → the `default` profile.
- A `.noldor/config.json` with `crReview.profiles['fast-track'].effort='med'` overrides the built-in for that name; unconfigured names still resolve to built-ins.
- `parseArgs([...,'--profile','fast-track'])` sets `args.profile==='fast-track'`; omitting the flag leaves it `undefined`.
- `run()` with `--profile fast-track` builds a `LaneInput` whose `reviewProfile.effort==='low'`.
- `buildPrompt` for the `fast-track` profile names `correctness` and `security` and **omits** `reuse`/`altitude`; for `default` it names all six dimensions. The output-format block (`Strengths:` / `Issues:` / `Assessment:`) is byte-identical to today's.
- `parseSubagentMarkdown` fixtures in `__tests__/fixtures/` still parse unchanged (no contract regression).
- `pnpm typecheck`, `pnpm test`, `pnpm validate:features` pass.

## Risks / trade-offs

- **Prompt drift breaking the parser.** Mitigated: the output-contract block
  is untouched; only pre-rubric guidance is added, and a regression test pins
  the fixtures.
- **Profile name typos pass silently** (resolver falls back to `default`).
  Accepted for v1 — a strict-name mode is a follow-up; falling back to the
  richer `default` fails safe (more review, not less).
- **Fast-track scoping could hide a real bug** an all-dimensions pass would
  catch. Accepted: fast-track is XS/S no-FD; the operator can widen the
  profile in config, and the smoke/verify floor is unchanged.

## User Story

As an operator running the autonomous drain, I want each CR lane to review
along explicit, configurable dimensions at a per-path effort level, so that
full-tier features get a deep multi-dimension review while fast-track XS/S
changes get a fast, focused correctness+security pass instead of the same
one-size-fits-all prompt.

## Usage

Config (`.noldor/config.json`) — optional; built-ins apply when absent:
```json
{
  "crReview": {
    "profiles": {
      "fast-track": { "effort": "low", "dimensions": ["correctness", "security"] },
      "default": { "effort": "high", "dimensions": ["correctness","security","reuse","simplification","efficiency","altitude"] }
    }
  }
}
```

CLI — select a profile for one orchestrate run:
```bash
pnpm noldor cr orchestrate --slug <slug> --artifact <paths> --kind code \
  --lanes subagent --base-sha origin/main --profile fast-track
```
Omit `--profile` → `default` profile. Gate's fast-track Step 4 appends
`--profile fast-track` automatically when the session path is `fast-track`.

## Open questions (resolved)

1. *How does fast-track select its profile — explicit `--profile` flag, or orchestrate auto-reading the session-marker path?*
   -> Explicit `--profile` flag, passed by the gate skill. (D1) Keeps `run()` pure and unit-testable with no `core → session` import edge; orchestrate already takes all selection inputs as args (`--lanes`, `--base-sha`).
2. *Invent a new dimension taxonomy, or reuse the `/code-review` + `/simplify` vocabulary?*
   -> Reuse: `correctness, security, reuse, simplification, efficiency, altitude`. (D2) One mental model across the review surface; no new term to teach.
3. *Change the markdown output contract / `parseSubagentMarkdown`?*
   -> No. Inject rubric guidance above the contract; leave the `Strengths/Issues/Assessment` format and parser untouched. (D3) Zero parser-risk, existing sinks stay valid.
4. *Default effort + dimensions for the `fast-track` profile?*
   -> `low` effort, `['correctness','security']`. (D4) Fast-track is XS/S no-FD; max effort across six dimensions is noise + slows the drain. Operator can widen via config.
5. *Apply the richer rubric to the `codex` lane too?*
   -> No, `subagent` lane only in v1. (D5) Subagent is the autonomous default (biggest leverage); the codex lane is opt-in and has its own external-CLI prompt. Keeps the change L, not XL.
