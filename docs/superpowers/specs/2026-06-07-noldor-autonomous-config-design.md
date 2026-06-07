# Spec: Document & Default Autonomous Mode Config

- **Slug:** `document-default-autonomous-mode-config` (attach → parent FD `noldor`)
- **Enhancement:** `autonomous-config`
- **Date:** 2026-06-07
- **Tier:** specs-only
- **Area:** tooling

## Problem

`/gate` already supports a fully-unsupervised path (pick `proceed-autonomous` at the
plan-stage Step 2.5; all downstream seams go non-interactive through PR-merge). Two gaps
keep it invisible and brittle:

1. **Undiscoverable.** The `autonomous` / `crLanes` config blocks are documented only in
   `gate/SKILL.md` line-by-line and partially in `docs/noldor/cr-pipeline.md`. The README
   and `adoption-guide.md` mention only the `consumer:` block.
2. **One hard error blocks the optional path.** The `autonomous` block is *already* optional
   — every field has a Zod default (`src/cr/config.ts:7-11`). The single hard failure is in
   `resolveLanes` (`src/cr/orchestrate.ts:50-52`): when `--autonomous` is set and
   `crLanes.<kind>` is absent/empty it **throws**
   `"autonomous CR requires .noldor/config.json crLanes.<kind> non-empty"`. So a consumer
   with no `crLanes` block cannot use autonomous CR at all without first hand-authoring config.

## Goals

- (b) Ship built-in `crLanes` defaults so autonomous CR works with **no** `crLanes` block —
  remove the hard error; config still overrides defaults when present.
- (a) Document the `autonomous` + `crLanes` blocks where adopters look first (README,
  adoption-guide) and make the existing `cr-pipeline.md` / `complexity-gating.md` reflect
  that the block is now optional. Correct `gate/SKILL.md` prose that still calls a missing
  default a hard error.

## Non-goals

- No change to the lane implementations (manual/codex/subagent/standalone) themselves.
- No change to `autonomous.skipLanePicker` / `onFailure` / `requireHumanPrApproval` defaults
  (already sane).
- No new CLI flags.

## Design

### 1. `DEFAULT_CR_LANES` constant — `src/cr/config.ts`

Add a single source of truth next to the schema:

```ts
import type { ArtifactKind, Lane } from './findings-schema.js';

// Built-in autonomous-safe lane defaults. `subagent` is the only lane that runs
// fully unattended: in-process (no external CLI auth like codex), no human stdin
// (unlike manual), no GUI terminal (unlike standalone). So every kind defaults to
// it when no crLanes block is configured.
export const DEFAULT_CR_LANES: Record<ArtifactKind, Lane[]> = {
  spec: ['subagent'],
  plan: ['subagent'],
  code: ['subagent'],
};
```

The `crLanes` schema field stays `.optional()` (no `.default(...)`) — we do not want
`loadConfig` to synthesize a `crLanes` block onto configs that didn't declare one (other
readers, e.g. `validate noldor-config`, should still see "absent" as absent). The default
applies only at lane-resolution time.

### 2. `resolveLanes` — remove the throw — `src/cr/orchestrate.ts:42-54`

Replace the throwing branch with a defaults fallback. New behavior:

```ts
export function resolveLanes(
  args: { slug: string; kind: ArtifactKind; lanes?: Lane[]; autonomous?: boolean },
  cfg: NoldorConfig | null,
): Lane[] {
  // 1. Explicit --lanes always wins.
  if (args.lanes && args.lanes.length > 0) return args.lanes;
  // 2. Autonomous / skipLanePicker path: config crLanes when present, else built-in defaults.
  if (args.autonomous || cfg?.autonomous?.skipLanePicker) {
    const configured = cfg?.crLanes?.[args.kind];
    return configured && configured.length > 0 ? configured : DEFAULT_CR_LANES[args.kind];
  }
  // 3. Interactive mode, no CLI flag: empty signals the /gate skill to prompt.
  return [];
}
```

Precedence (unchanged at the top, relaxed at the bottom): **CLI `--lanes` > configured
`crLanes.<kind>` > built-in `DEFAULT_CR_LANES[kind]` > interactive picker (`[]`)**.

The only semantic change: branch 2 no longer throws when `crLanes.<kind>` is missing — it
returns the built-in default. Interactive mode (branch 3) is untouched.

### 3. Test update — `src/cr/__tests__/orchestrate.test.ts`

The existing case `'autonomous + no config => throws'` (line 41) inverts. Replace with:

- `autonomous + no config => built-in defaults`: `resolveLanes({slug,kind:'spec',autonomous:true}, null)` ⇒ `['subagent']` (and `kind:'code'` ⇒ `['subagent']`).
- Keep `'CLI --lanes wins'`, `'config default applied when CLI unset + skipLanePicker'`,
  `'interactive + no CLI flag => returns empty'`.
- Add `'configured crLanes overrides built-in default'`: cfg with `crLanes.code:['subagent','codex']` + `autonomous:true` ⇒ `['subagent','codex']`.

### 4. Documentation (part a)

- **`README.md`** — under Configuration, add one paragraph: the two *optional* blocks
  (`crLanes`, `autonomous`) enable unsupervised code-review + PR-merge; absent → built-in
  `subagent`-only defaults; point to `docs/noldor/cr-pipeline.md` for the full reference.
- **`docs/noldor/adoption-guide.md`** — add a short "Optional: autonomous CR config" section
  after the `consumer:` field table, with the annotated example block and a note that the
  block is optional (defaults apply).
- **`docs/noldor/cr-pipeline.md`** — update the existing example + precedence prose to state
  that `crLanes` is optional and falls back to `DEFAULT_CR_LANES` (`subagent` per kind);
  document each `autonomous` field default explicitly.
- **`docs/noldor/complexity-gating.md`** — note that autonomous mode works with no config
  (built-in defaults), config only needed to override.
- **`.claude/skills/gate/SKILL.md`** — fix the two prose spots that still say a missing
  `crLanes` default is a hard error (Step 2.5 "missing defaults are a hard error, never a
  silent skip"; Autonomous-mode bullet "which must be non-empty for the relevant kind —
  missing default is a hard error, surface it"). New wording: orchestrate falls back to
  built-in `subagent`-only defaults when `crLanes.<kind>` is absent; config overrides.

### Annotated `.noldor/config.json` example (for docs)

```jsonc
{
  "consumer": { /* required — see adoption-guide */ },

  // OPTIONAL. Absent → built-in defaults: every kind reviews with ["subagent"].
  "crLanes": {
    "spec": ["manual", "subagent"],
    "plan": ["manual", "subagent"],
    "code": ["subagent"]              // codex opt-in: ["subagent", "codex"]
  },

  // OPTIONAL. Every field defaults (block may be omitted entirely).
  "autonomous": {
    "skipLanePicker": false,          // default false — true skips the lane multi-select
    "onFailure": "prompt",            // default "prompt" | "spawn-deep-review" | "abort"
    "requireHumanPrApproval": false   // default false — true keeps the PR-approval prompt
  }
}
```

## Acceptance criteria

1. `resolveLanes({slug,kind:'code',autonomous:true}, null)` returns `['subagent']` — no throw.
2. With a `crLanes` block configured, autonomous resolution returns the configured lanes
   (config overrides defaults).
3. `pnpm noldor cr orchestrate --autonomous --kind code` on a repo whose config has no
   `crLanes` block runs the subagent lane instead of erroring.
4. Interactive mode (no `--lanes`, no `--autonomous`, `skipLanePicker:false`) still returns
   `[]` so the gate prompts.
5. README + adoption-guide both mention the optional blocks; gate/SKILL.md no longer calls a
   missing `crLanes` default a hard error.
6. `pnpm test` (cr suite) + `pnpm typecheck` green; `pnpm noldor validate noldor-config` green.

## Risks / trade-offs

- **Silent default vs explicit intent.** The original throw forced operators to declare lanes
  before automating (fail-fast = "prove you meant it"). Defaulting to `subagent` trades that
  for discoverability. Mitigation: `subagent` is the conservative choice (always runs a real
  review; never silently skips). Operators wanting heavier review (codex/standalone) still
  opt in via `crLanes`.
- **Default-drift between code and docs.** `DEFAULT_CR_LANES` is the single source; docs
  reference it by description, not a copy that can rot.
