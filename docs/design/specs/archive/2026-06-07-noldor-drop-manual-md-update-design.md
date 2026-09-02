# Drop Manual Feature-MD Update Step — Design

- **FD:** `noldor` (attach; enhancement slug `drop-manual-md-update`)
- **Path:** specs-only-attach (no plan stage)
- **Date:** 2026-06-07

## Problem

The roadmap entry "Drop Manual Feature MD Update Step" (since 2026-05-16) asked to
remove an obsolete human-checklist rule from `docs/noldor/workflow.md` that told the
operator to flip `phase: done` and hand-update Summary / User Story / Usage in the
shipping commit.

**The premise is largely stale.** A later cycle (`end-of-flow-ergonomics`, PR #16)
already rewrote that section. Today:

- `workflow.md:30-34` ("After every feature…") already documents the **automated**
  `phase: in-progress → done` flip done by `/gate` Step 4 via `src/core/phase-flip-done.ts`,
  and already references `/draft-feature-md <slug> --refresh`.
- `workflow.md:36-40` ("Use /draft-feature-md, not yourself") already mandates
  `--refresh` before the shipping commit.

So "remove the obsolete rule" is mostly already done. Two genuine gaps remain, plus
one reconciliation:

1. **Gap B (live drift):** `workflow.md` *prescribes* `/draft-feature-md --refresh`
   before the ship commit, but `/gate` Step 4 never **invokes** it. `gate/SKILL.md`
   references `--from-spec` (Step 2, spec→plan transition) only; `--refresh` appears
   nowhere in Step 4.
2. **Gap C (dangling ref):** `promote/SKILL.md:147` (attach step-10 message) cites
   `per CLAUDE.md "after every feature, update the feature MD" rule`. That CLAUDE.md
   rule no longer exists — confirmed absent from `CLAUDE.md` and `.claude/CLAUDE.md`.
3. **Reconcile:** `workflow.md:30-40` now carries the `--refresh` prescription in two
   overlapping sections and still reads as if the operator runs `--refresh` by hand.

This is a **pure docs/skills feature — zero TypeScript.** All four edit targets are
markdown (three SKILL.md files + one framework doc). There is no executable change, so
no unit tests; correctness is guarded by `validate-skill-catalog`, `validate features`,
and the `rule-conflicts` invariant (which catches prose contradictions at commit).

## Approach

Chosen scope: **full-wire all paths** — `/gate` Step 4 invokes `--refresh` for every
FD-carrying path, including autonomous and attach flows. Two design decisions make
all-paths sound rather than naive:

- **Autonomous safety:** add a non-interactive `--yes` mode to `draft-feature-md` that
  auto-applies drafts. It **promotes** the skill's `<30% token-overlap with current →
  keep` rule — which today is only a *default-on-empty-reply* nudge in interactive mode
  (skill steps 8) — into an *unconditional* skip, so hand-curated prose is not silently
  clobbered. This is a deliberate behavior change, not identical behavior. The refreshed
  FD lands in the worktree diff and is re-reviewed by Step 4's code-stage CR. **In
  autonomous mode that CR is a subagent, not a human, and the PR auto-merges when it
  finds no blockers** — so the overlap guard plus the subagent CR are the only gates,
  and residual prose drift can ship unattended (see Risk).
- **Attach safety:** add `--scope <paths>` (draft only from the listed files instead of
  the FD's full `links.code`/`links.tests`) and `--usage-only` (write only `## Usage`,
  never `## User Story`). On attach paths, `/gate` refreshes the **parent** FD scoped to
  the enhancement's changed files, Usage-only — so a 3-file enhancement can never
  rewrite a 50-file meta-FD's story.

## Changes

### 1. `.claude/skills/draft-feature-md/SKILL.md` — three new flags

Add to the **Inputs** section and `--refresh` steps:

- **`--yes`** (non-interactive). Suppresses every prompt. For each of `User Story`,
  `Usage` (subject to `--usage-only`): compute normalized current vs drafted (same
  normalization as interactive step 7).
  - equal → leave unchanged, log `<section>: unchanged`.
  - token-overlap(current, drafted) `< 30%` → **keep current** (treat as hand-curated),
    log `<section>: kept (curated)`.
  - else → **apply drafted**, log `<section>: refreshed`.
  Still never stages/commits (unchanged rule). Still never touches Summary/frontmatter.
  Note the behavior delta: interactively this `<30%` rule only sets the empty-reply
  default (the operator can still override either way); under `--yes` it is the
  unconditional decision.
- **`--scope <comma-separated paths>`**. Overrides the source files: draft from exactly
  these paths instead of reading `links.code` + `links.tests`. Files that don't exist
  are skipped with a warning (reuse the existing missing-file behavior). When `--scope`
  is empty after filtering, abort with the existing "nothing to draw from" message.
- **`--usage-only`**. Restrict drafting/writing to `## Usage`; `## User Story` is read
  for context but never modified or diffed.

Flags compose. Attach-autonomous invocation is
`/draft-feature-md <parent> --refresh --yes --scope <files> --usage-only`.

Update the skill's frontmatter `description` to mention the non-interactive + scoped
modes, then regenerate the skill catalog so `validate-skill-catalog` stays green
(`docs/noldor/skill-catalog.md`).

### 2. `.claude/skills/gate/SKILL.md` — Step 4 wiring

Insert a new **first** action in Step 4, *before* the `phase-flip-done` flip, so the
refreshed prose is committed together with `phase: done` (same file → one commit) and
is included in the diff the code-stage CR reviews:

- **Resolve target + scope by path:**
  - `specs-only-new` / `full-new` → target = `<slug>` (the new FD); full links.code;
    both sections. Invoke `/draft-feature-md <slug> --refresh` (interactive) or
    `… --refresh --yes` (autonomous).
  - `specs-only-attach` / `full-attach` → target = `<parent>`; scoped + Usage-only.
    Changed files = `git diff --name-only origin/main...HEAD` filtered to
    `draft-feature-md`'s step-3 extension allowlist (the single source of that list —
    currently `.ts .tsx .md .html`; reference it, don't re-hardcode a copy that can
    drift), **excluding** the target FD file and anything under `docs/design/`
    (specs/plans). Invoke `/draft-feature-md <parent> --refresh --scope <changed>
    --usage-only` (+ `--yes` in autonomous).
  - `fast-track` / `micro-chore` → skip (no FD). Unchanged.
- The existing `phase-flip-done` flip + commit then stages the FD, which now carries
  both the phase flip and the refreshed prose. Update that commit's subject to
  `mark phase=done + refresh User Story/Usage` on new-FD paths, or
  `mark phase=done + refresh Usage` on attach paths (Usage-only); drop the `+ refresh …`
  suffix entirely when `--refresh` produced no change. All trailers unchanged.
- Autonomous mode: the new action emits no `AskUserQuestion`; it relies on `--yes`.
- **Incidental fix (same file).** `gate/SKILL.md` carries **12 stale `scripts/noldor/*.ts`
  path references** (the code moved to `src/core/`); correct all of them to `src/core/*.ts`
  — `allowlist`, `session`, `phase-revert`, `phase-flip-done` (×3), `pr-flow`,
  `pr-flow-cli` (×2), `cr-retry`. The inline tsx commands at L84/L145 are broken as
  written (ENOENT — hit live this session). `workflow.md:32` already uses the correct
  path. The `rule-conflicts` invariant does not catch a moved-file path, so this is a
  manual sweep folded into this edit. (Code-stage CR additionally caught a sibling
  `scripts/hooks/noldor-validate-trailer.ts` → `src/hooks/` ref at L92 — same class,
  fixed too.)

The `--refresh` write itself never commits (skill rule); the commit is the existing
`phase-flip-done` step. If `--refresh` produced no change, behavior is identical to
today.

### 3. `.claude/skills/promote/SKILL.md:147` — kill the dangling ref

Reword the attach step-10 reminder. Replace the clause
`per CLAUDE.md "after every feature, update the feature MD" rule` with a pointer to the
live guidance: the parent-FD body is refreshed automatically by `/gate` Step 4 via
`/draft-feature-md --refresh` (see `docs/noldor/workflow.md`). No CLAUDE.md rule is
referenced.

### 4. `docs/noldor/workflow.md:30-40` — reconcile

- Fold the two overlapping `--refresh` mentions into a single statement of record: the
  feature-MD body (User Story / Usage) is refreshed **automatically** by `/gate` Step 4
  via `/draft-feature-md --refresh`; the operator no longer runs it by hand. Keep the
  `--from-spec` guidance (spec→plan transition) as the one place the operator/controller
  invokes the drafter manually.
- Remove residual "operator must…" framing for the phase flip and body update — both are
  now Step 4 automation. Keep the `release-markers.ts` safety-net paragraph and the
  "never set `introduced`/`updated`" rule.
- Ensure no statement contradicts `gate/SKILL.md` (guarded by the `rule-conflicts`
  invariant).

## Testing / validation

No TypeScript changes → no unit tests. Validation surface:

- `pnpm noldor validate features` — FD schema (parent `noldor` unchanged in shape).
- `validate-skill-catalog` (pre-commit) — must stay green after editing the
  `draft-feature-md` description; regenerate the catalog if needed.
- `rule-conflicts` invariant (pre-commit) — proves `workflow.md` / `gate` / `promote` /
  `draft-feature-md` prose stays mutually consistent (no contradictory rules).
- `validate-noldor` / `validate-noldor-scope` — page frontmatter + commit scope for the
  `docs/noldor/workflow.md` edit (`noldor:workflow` or `noldor` scope).
- **Manual dogfood (emulated).** This session is itself `specs-only-attach` to `noldor`.
  Because the `~/.claude` registry copy won't carry the new flags until this PR merges
  (see Risk → bootstrap), its Step 4 cannot invoke `--refresh --yes --scope --usage-only`
  through the registry. Instead the controller **emulates** the new attach-scoped
  behavior by following the repo copy's updated prose by hand against the `noldor` parent
  FD. This validates the prose is *followable and correct*, not the registry wiring — a
  dry-run, not a first registry invocation.

## Risk / trade-off

- **Auto-accepted prose drift (autonomous `--yes`).** Guarded by the `<30%-overlap →
  keep` rule and the Step 4 code-stage CR reviewing the FD diff. **But in autonomous mode
  no human sees the refreshed FD** — the code-stage CR is a subagent, and the PR
  auto-merges when it returns no blockers. So a drafted section that overlaps ≥30% but is
  subtly worse can be applied and **shipped fully unattended**; the subagent CR is the
  only backstop. Interactive (non-autonomous) flows keep the human diff-confirm, so this
  risk is autonomous-only. Accepted: the alternative (block autonomous refresh) was
  rejected when the scope choice was full-wire-all-paths.
- **Attach Usage-only skips User Story.** Intentional: an enhancement rarely reshapes a
  parent's User Story, and rewriting a meta-FD's story from a few files is the failure
  mode we're avoiding. Cost: a genuine User-Story-level change on an attach must be
  hand-edited. Acceptable.
- **Bootstrap / registry lag.** The `Skill` tool loads `draft-feature-md` from
  `~/.claude/skills/`, which won't carry the new flags until this PR merges. For *this
  session's* Step 4, the controller executes the new attach-scoped `--refresh` by
  following the **repo copy's** updated prose inline rather than via the registry. This
  is standard bootstrap-immunity (a feature can't consume its own unshipped capability
  through the global registry).
- **Dual-copy skill drift.** Repo `.claude/skills/**` and `~/.claude/skills/**` are
  separate copies; this PR edits the repo copy (what ships). Out of scope to reconcile
  the sync mechanism here.

## Out of scope

- Removing the "obsolete human-checklist rule" as literally worded — already done by
  `end-of-flow-ergonomics` (PR #16); this FD records that the premise was pre-satisfied.
- Any TypeScript change (`phase-flip-done.ts`, `release-markers.ts` untouched).
- `draft-feature-md` multi-slug / batch mode (already backlog).
- Reconciling the repo ↔ `~/.claude` skill-copy sync mechanism.
