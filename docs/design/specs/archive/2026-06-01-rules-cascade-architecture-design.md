# Rules Cascade Architecture — Design

**Date:** 2026-06-01
**Status:** Approved (design); ready for implementation plan
**Driver:** Framework behavior currently lives in prose docs the agent never consults. Move behavior into executable, just-in-time, enforced artifacts; demote docs to human explanation.

## Problem

`docs/noldor/` is ~1,983 lines, ~70% prescriptive rules. The same rule is re-encoded across docs + skills + code:

- gate-path list in 4 places (`session.ts`, `complexity-gating.md`, `lifecycle.md`, `skill-catalog.md`)
- phase state machine in 4 places (`lifecycle.md`, `gate/SKILL.md`, `phase-flip-done.ts`, `phase-revert.ts`)
- micro-chore allowlist in 2 (`allowlist.ts`, `complexity-gating.md`) — already drifting (`lefthook.yml` gap)
- garden detectors scattered (narrative in `garden-and-drift.md`, definitions across `garden-*.ts`)

Two failure modes, ranked by the operator:

1. **Primary — "doc never consulted":** the agent acts without ever loading the relevant rule. Docs are passively loaded; the agent must choose to read them and often doesn't.
2. Secondary — drift: editing one copy of a rule leaves the others stale.

Root cause: a single artifact class (docs) is forced to serve **two audiences** — humans who need explanation, and the agent which needs enforceable behavior. The dual role bloats the docs and still fails the agent.

## Existing substrate (verified 2026-06-01)

This design lands on partially-built infrastructure. Confirmed against the repo:

- **A rule store already half-exists:** `.claude/engineering-rules.md` (16KB) and its template `templates/.claude/engineering-rules.md`. This is the obvious v1 migration source and home-consolidation target — not `docs/noldor/testing-principles.md`.
- **Two PreToolUse guards are written but unwired:** `src/hooks/agent-rules-guard.ts` (forces Agent-dispatch prompts to reference the rules doc) and `src/hooks/noldor-pre-edit-guard.ts` (blocks edits without a `/gate` session). **There is no `.claude/settings.json` anywhere** (repo or `templates/`), so the PreToolUse slot this design needs is currently dead code. Rule injection must wire that slot and compose with these two guards.
- **`stage` does not exist.** `SessionMarkerSchema` (`src/core/session.ts:19-42`) is `.strict()` and carries `path` (one of 8 `PATHS`), `slug`, `parent`, `startedAt`, `autonomous`, `markerVersion` — no `stage`, no `injectedRules`. Both are net-new fields. The 8 gate paths → 4 stages projection is undefined work this spec must define (see Stage model).
- **Transclusion cannot read consts.** `src/docs/docs-transclude.ts` only inlines example source files into `<!-- example:start -->` markers. There is no const→doc-block generator; that is new work, not reuse.
- **Live drift to clean up:** the page `engineering-principles.md` was dropped but is still referenced in 13 files (incl. `src/hooks/agent-rules-guard.ts:19,61`, `src/dashboard/data.ts`, `docs/noldor/README.md`, templates). Migration should retarget these to the new rule store.
- **CLI manifest extends trivially:** a `rules` group fits `MANIFEST` (`src/cli/manifest.ts:20`) like every other `pnpm noldor <group> <sub>`. Runs via compiled `node bin/noldor.mjs` (not tsx) — warm-ish, but still a fresh Node process per invocation.

## Stage model (cascade key 2 — defined, not deferred)

`stage` is load-bearing for resolution, so it is defined here, in v1 scope. Project the 8 gate paths onto 4 stages:

| Stage | Gate paths |
|---|---|
| triage | (pre-gate; `/triage`, `/promote` flows) |
| code | micro-chore, fast-track, full-new, full-attach, specs-only-new, specs-only-attach |
| review | (code path during CR) |
| release | release-sweep, release-automation |

Decision: derive stage from `session.json.path` via a pure mapping in `src/core/rules/` (no new persisted field where avoidable); add an explicit `session.json.stage` override only if a path maps to multiple stages across its lifetime (review is a sub-state of code paths — model it as a transient flag, not a 9th path). Adding any `session.json` field requires editing the `.strict()` schema and the `markerVersion` superRefine (`session.ts:31-40`).

## Principle

**Two audiences → two artifact classes.**

- **Human layer** (`docs/noldor/`): explanation, mental model, the *why*. As detailed as desired. Target personas: the creator, and a human who installed Noldor and wants to understand it. **Never states a rule the agent must follow** — it explains the rule and links to the canonical artifact, or carries volatile values via generated blocks.
- **Agent layer** (rules + skills + hooks + scripts): the behavior source of truth. Each rule lives **once**. Reaches the agent by being *pushed into the moment*, not parked in a doc.

## Architecture

### Layer taxonomy

| Layer | Audience | Role | Source of truth for |
|---|---|---|---|
| `docs/noldor/` | human | explain, mental model | nothing behavioral — links / generated blocks only |
| **Rules** `.noldor/rules/` | agent | atomic engineering rules, cascade-selected | *how we engineer* |
| **Skills** `.claude/skills/` | agent | procedural orchestration | *what flow to run*; point to rules by id |
| **Hooks** (lefthook) | agent (enforced) | block the hard rule subset at git boundary | enforcement |
| **Scripts** (`src/`) | agent + hooks | deterministic decide/compute | facts/decisions (paths, scoring, resolve) |

### Rule file format

One rule = one file at `.noldor/rules/<id>.md`:

```markdown
---
id: ts-no-default-export
applies-to: ["src/**/*.ts"]          # globs — cascade key 1
stage: [code]                         # triage|code|review|release — cascade key 2; omit = any stage
enforce: false                        # true → hooks block; false → injected guidance only
links: [docs/noldor/testing-principles.md]   # human docs that explain this rule
---

Named exports only. Default exports break tree-shaking and rename refactors.
```

- **Body** = the rule, terse, agent-facing.
- **Frontmatter** = applicability (`applies-to`, `stage`) + delivery strength (`enforce`).
- `enforce` fuses guidance and enforcement in **one file, two strengths**: `false` rules are injected as context; `true` rules are additionally enforced by a hook. No duplication between a "guidance doc" and an "enforcement check."

### Cascade resolution

Single resolver: `pnpm noldor rules resolve --file <f> --stage <s>`.

1. Match rules where any `applies-to` glob matches `<f>` **and** (`stage` is empty **or** includes `<s>`).
2. Single total order: **specificity primary** (more literal path segments > wildcards), **declaration order as tiebreak**. On direct conflict, the higher-ordered rule overrides.
3. Output an ordered rule set, partitioned into `injected` (enforce:false) and `enforce` (enforce:true) subsets.

The resolver is the only place cascade logic lives. Hooks call it, the `rules` skill calls it, humans call it.

**Design constraint:** the resolver is invoked per-edit via a fresh Node process (PreToolUse spawns a subprocess; `pnpm noldor` is compiled, not tsx — already warmer than feared). Target a perf budget (~sub-150ms cold) via a **cached/serialized rule index** read by a minimal entrypoint — parse `.noldor/rules/*.md` once into a compact index, invalidate on dir mtime. No resident daemon (YAGNI). A perf-budget test guards the path.

### Delivery — the anti-"never consulted" mechanism

A rule the agent does not load is just a doc again. Only **push** mechanisms fix the primary failure mode; pull mechanisms (agent chooses to run a script / a skill must trigger) regress to it.

- **Session / gate push:** at gate entry, inject the **stage-level** rules (those with no `applies-to` glob, e.g. "in review stage, do X"). Pin their ids to `session.json`.
- **PreToolUse on Edit/Write:** resolve glob rules for the target file, inject **delta only** — skip ids already recorded in `session.json.injectedRules`. Live per edit → never stale, never spammy. This slot must be **created** (`.claude/settings.json` does not exist yet, in repo or templates) and **composed** with the two existing guards (`noldor-pre-edit-guard`, `agent-rules-guard`) — preferably one PreToolUse dispatcher running gate-check → rule-injection in sequence, not three independent entries racing the same event.
- **Subagent inheritance:** subagents (Agent tool) get fresh context and won't see `session.json.injectedRules`. Resolver output for the relevant files must be injected into the **Agent dispatch prompt** — replacing the current `agent-rules-guard` mechanism, which points at the dropped `engineering-principles.md`. Without this, the thesis fails for all subagent work.
- **commit / pre-push hooks:** enforce the `enforce:true` subset as a non-bypassable block — a new lefthook job re-resolves rules over `{staged_files}` and blocks on violation. Backstop for when injected guidance is still ignored.
- **`rules` CLI + a rules skill:** manual escape hatches for humans / explicit recall, **not** the primary path.

### Doc ↔ code sync (drift kill)

- **Volatile enumerations** (gate paths, allowlist globs, garden detector list, the rule index itself) → **generated blocks** in human docs, pulled from consts. The const→doc-block generator is **new work** (transclusion only inlines example source, not consts) — pattern it after `src/docs/docs-transclude.ts`'s marker model, but it reads `src/core/rules/` consts. Edit the const → regenerate the block.
- **Stable concepts** (what a phase *is*, why worktrees) → prose + link, never restated values.
- `src/core/rules/` consts = one source; code, hooks, and generated doc blocks all import it.
- New garden detector framed as **link-presence**, not semantic duplication (too noisy): a doc section tagged with a rule id must contain a link to that rule, not a paraphrase of its body. Tractable string check, sits beside the existing LLM-filtered contradiction detector.

## Components

- `src/core/rules/` — rule registry consts + the enumerations that today drift (gate paths, allowlist globs, detector list). Single import source.
- `src/rules/resolve.ts` — cascade resolver (glob match + stage filter + specificity order + injected/enforce partition). Fast path.
- `src/rules/load.ts` — read + validate `.noldor/rules/*.md` frontmatter (schema validation, unique ids, valid globs/stages).
- `pnpm noldor rules` CLI group — `resolve` (flags `--file`, `--stage`), `list`, `validate`. (`for <file>` folded into `resolve --file` — one verb.)
- `src/core/rules/stage.ts` — pure `path → stage` mapping (see Stage model).
- `.claude/settings.json` + `templates/.claude/settings.json` — **created from scratch**; wires the PreToolUse dispatcher (gate-check → rule-injection) and is shipped to consumers via `init`.
- PreToolUse dispatcher — composes `noldor-pre-edit-guard` + rule-injection; replaces `agent-rules-guard`'s dispatch-prompt injection with resolver output.
- New lefthook job — re-resolve `enforce:true` rules over `{staged_files}` at commit; block on violation.
- `session.json` extension — add `injectedRules: string[]` (dedupe delta injection) to the `.strict()` schema + bump `markerVersion` superRefine (`session.ts:31-40`). `stage` derived, not persisted (see Stage model).
- Migration: extract rule bodies from `.claude/engineering-rules.md` (primary) and the rule-heavy `docs/noldor/*` into `.noldor/rules/*`, leaving prose + link behind. Retarget the 13 dangling `engineering-principles.md` references to the new store.

## Data flow

```
Edit(file) ─▶ PreToolUse hook ─▶ rules resolve --file f --stage <session.stage>
                                      │
                          ┌───────────┴───────────┐
                       injected (enforce:false)  enforce (enforce:true)
                          │                         │
              inject delta vs session.injectedRules │
                          │                         ▼
                   agent context           git commit/push hook re-resolves,
                                            blocks if a touched file violates
```

## Error handling

- Resolver fails / rules dir missing → **fail open** for injection (log, inject nothing), **fail closed** for enforcement at commit (block with a clear message; a broken rule store must not silently pass an `enforce` gate).
- Malformed rule file (bad frontmatter, dup id, bad glob) → `rules validate` errors in pre-commit; resolver skips the malformed rule at runtime and warns.
- Hook latency budget exceeded → injection is best-effort (skippable); enforcement is not.

## Testing

- `load.ts`: frontmatter schema, dup-id detection, glob/stage validity, fixtures for malformed files.
- `resolve.ts`: glob matching, stage filtering, specificity ordering, conflict override, injected/enforce partition — table-driven fixtures.
- Delivery: session-pin injection writes `injectedRules`; pre-edit delta skips already-injected ids; enforce subset blocks at commit on violation, passes when clean.
- Drift: garden detector flags a doc that restates a rule body; generated enumeration blocks regenerate from consts.
- e2e: a `.noldor/rules/` fixture set + a simulated edit → assert correct rules injected and enforced.

## Phasing (decomposed — each phase is a separately plannable feature)

The thesis ("agent can't act without the relevant rule loaded") is proven by per-edit push, which lives in v2. v1 alone is CLAUDE.md-style preloading — necessary substrate, but not the proof. Plan them as distinct features:

- **v1 — rule store + resolver (substrate):** rule format + `load.ts` + `resolve.ts` (cached index, perf budget) + `rules` CLI + `src/core/rules/` consts + `stage.ts` mapping + `session.json` `injectedRules` field + migrate `.claude/engineering-rules.md` into `.noldor/rules/*` (representative, not a doc slice) + gate-pinned stage injection. Independently valuable + testable. **Prerequisite for everything else: the Stage model must land here.**
- **v2-push — PreToolUse delta injection (the thesis):** create `.claude/settings.json`, the PreToolUse dispatcher, subagent dispatch-prompt injection (replacing `agent-rules-guard`). This is where the design earns itself.
- **v2-enforce:** `enforce:true` lefthook job over staged files + fail-closed semantics.
- **v2-sync:** const→doc-block generator + link-presence garden detector + bulk `docs/noldor/` migration + retarget the 13 dangling `engineering-principles.md` refs.

## Out of scope

- Rules-as-data engine (declarative spec driving everything) — rejected as over-abstraction for a framework still dogfooding.
- Rewriting skills beyond making them point to rule ids instead of restating rules.
- Cascade keys beyond file globs + stage (gate-path / area selection can be added later if needed).

## Migration impact (v2-sync prerequisite checklist)

Extracting rule bodies out of `docs/noldor/` touches enforcement that reads those docs:
- `validate skill-catalog` (lefthook glob `docs/noldor/skill-catalog.md`, `lefthook/noldor.yml:54`)
- `validate noldor` invariants over `docs/noldor/**/*.md` (`noldor.yml:51`)
- garden contradiction detector reading invariant prose (`src/garden/garden-detect.ts:341-362`)
- `sync doc-links` (`noldor.yml:16`)
- 13 files referencing the dropped `engineering-principles.md` page (`agent-rules-guard.ts:19,61`, `src/dashboard/data.ts`, `docs/noldor/README.md`, templates, …)

Each must be updated or re-pointed as rules move; the link-presence detector replaces the prose-restatement it removes.

## Open questions (non-blocking)

- Exact specificity algorithm for glob conflicts — single total order: specificity primary (literal segments > wildcards), declaration order as tiebreak. Finalize during `resolve.ts` TDD.
- Whether `links:` frontmatter should feed `sync doc-links` or be validated only by `rules validate` (leaning: `rules validate` only, to avoid coupling).
