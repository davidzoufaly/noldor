# Lazy Decision Ladder (pre-generation) — Design

**Slug:** rules-cascade-v1-lazy-decision-ladder
**FD:** docs/features/rules-cascade-v1.md (attach — parent FD; no child FD)
**Date:** 2026-08-10
**Tier:** specs-only
**Entry:** Q-0078 (`lazy-decision-ladder-pre-generation`)

## Problem

Everything Noldor has against over-engineering today is post-hoc: the `simplify` skill and the CR `simplification` dimension both review code *after* it is written. Nothing tells the author to stop *before* writing — no pre-generation discipline says "does this need to exist at all, and if so, what is the least that works?" [ponytail](https://github.com/DietrichGebert/ponytail) packages exactly that discipline as an ordered decision ladder. Its core belongs in the rules cascade, where it surfaces scoped to code edits instead of living in yet another always-on prose wall.

A second, sharper problem appears the moment the ladder exists: the ladder says "cut it", the CR `simplification` dimension says "you cut it — flag". Without a shared convention for a *deliberate, bounded* cut, the two halves of the system fight each other.

## Goals

1. A new cascade rule `.noldor/rules/lazy-decision-ladder.md` carrying ponytail's core: the understanding-first preamble, the 7-rung ladder, the never-cut carve-outs, and the `noldor:cut` marker convention. `stage: [code]`, `enforce: true`, `applies-to: ["**/*.ts"]`.
2. A byte-identical twin at `templates/.noldor/rules/lazy-decision-ladder.md` so consumers receive the rule on `init`/`init --update` ([`templateFiles()`](../../../src/templates/manifest.ts) auto-walks `templates/`; [`check-template-sync`](../../../src/checks/check-template-sync.ts) then enforces identity).
3. One clause appended to `DIMENSION_GUIDE.simplification` in [`subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) so the reviewer respects a marked cut and flags only a wrong ceiling or a real cut left unmarked — resolving the ladder-vs-CR conflict (D1: the entry cited `review-profile.ts`, but dimension prose only reaches the reviewer prompt via `DIMENSION_GUIDE`).

## Non-goals

- **No ponytail `review`/`audit`/`debt`/`gain` analogs** — post-hoc review is already covered by the `simplify` skill and the CR `simplification` dimension (ladder rung 2: reuse what exists).
- **No "one runnable check behind" rule** — covered by `noldor-verify`, the `test-real-behavior` rule, and TDD.
- **No `noldor:cut` tooling** (D2) — no grep detector, no lint, no debt-ledger CLI. The convention is prose in the rule body plus the CR clause. Ponytail's own marker is informal; tooling can come later if markers accumulate.
- **No delivery-mechanism work** — nothing today injects resolved rules into the authoring loop automatically (`rules resolve` is on-demand CLI). Closing that gap is Q-0069 / parent-FD territory, not this slice.

## Design

### Unit 1 — the rule file (`.noldor/rules/lazy-decision-ladder.md`)

One markdown file per the store contract ([`RuleFrontmatterSchema`](../../../src/rules/types.ts), strict; filename = canonical id per [`load.ts`](../../../src/rules/load.ts)):

```markdown
---
id: lazy-decision-ladder
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md, docs/noldor/rules.md]
---
Understand the problem first: read the code the change touches and trace the real
flow before writing anything. Lazy about the solution, never about reading. Then
climb this ladder and stop at the first rung that holds:

1. Does this need to exist? → no: skip it (YAGNI)
2. Already in this codebase? → reuse it, don't rewrite
3. Stdlib does it? → use it
4. Native platform feature? → use it
5. Installed dependency already does it? → use it
6. One line? → one line
7. Only then: the minimum that works

Never cut, at any rung: validation at trust boundaries, error handling that
prevents data loss, security, accessibility, and explicitly-requested behaviour.

Mark a deliberate, bounded corner-cut in code with
`// noldor:cut <ceiling> — <upgrade path>` — where `<ceiling>` is what the cut
deliberately stops at (a ladder rung like "one-liner", or a concrete bound like
"linear scan, fine ≤1k rules") and `<upgrade path>` is what to build when the
ceiling stops holding. A marked cut is a decision, not an omission.
```

Ladder text follows ponytail's README (fetched 2026-08-10) with only clarifying edits; the carve-out list adds `explicitly-requested behaviour` per the roadmap entry.

### Unit 2 — the templates twin

`templates/.noldor/rules/lazy-decision-ladder.md`, byte-identical copy of Unit 1. No manifest edit needed — `templateFiles()` walks the tree. Not added to `SCAFFOLD_ONLY_TEMPLATES` (this is a synced twin, not a starter): template-sync blocks drift between the two copies from the first commit. Note the existing three rules (`import-js-specifiers`, `test-real-behavior`, `ts-colocate-schema-type`) have **no** twins — they are framework-repo-specific overlays; this rule is deliberately the first *distributed* one, per the entry.

### Unit 3 — the CR clause

Append one sentence to `DIMENSION_GUIDE.simplification` in [`subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) (currently ends `…not a speculative nit`):

> `Respect \`noldor:cut <ceiling> — <upgrade path>\` markers: a marked cut is a deliberate decision — do not flag the cut itself; flag only a wrong ceiling or a real cut left unmarked.`

This rides the dimension line (same placement rationale as the existing nit-override: profiles that omit `simplification` are never told about markers).

### Data flow

Author-side: rule lands in the `enforce` bucket of `pnpm noldor rules resolve --file <any .ts> --stage code` (glob `**/*.ts`, specificity 0 → sorts after the more specific `src/**` rules; ordering is cosmetic — both buckets are fully surfaced). Reviewer-side: `buildPrompt()` interpolates the extended guide string into every profile that includes `simplification` (`default`, `fast-track`).

### Error handling

None new. `rules validate` / `load.ts` already reject a malformed rule file; template-sync already blocks twin drift; no runtime code paths are added.

### Testing

- Extend [`subagent-dispatch.test.ts`](../../../src/cr/__tests__/lanes/subagent-dispatch.test.ts): the simplification guide asserts the new clause (`noldor:cut`, `wrong ceiling`), and the existing `low`-profile-without-simplification test keeps proving the clause never leaks into profiles that omit the dimension.
- Store integrity: `pnpm noldor rules validate` green with the new file (covers schema + id/filename equality).
- Resolution: one case in [`resolve.test.ts`](../../../src/rules/__tests__/resolve.test.ts) is NOT needed — glob/stage/enforce matching is generic and already covered; a per-rule-content test would test data, not behavior (ladder rung 1).
- Template sync: `pnpm noldor checks template-sync` green (byte-identity of the twin).

## Acceptance criteria

1. `pnpm noldor rules resolve --file src/core/session.ts --stage code` lists `lazy-decision-ladder` in the `enforce` bucket; `--file docs/roadmap.md` does not.
2. `pnpm noldor rules validate` exits 0.
3. `templates/.noldor/rules/lazy-decision-ladder.md` is byte-identical to `.noldor/rules/lazy-decision-ladder.md`; `pnpm noldor checks template-sync` exits 0.
4. `buildPrompt()` output for the `default` and `fast-track` profiles contains the `noldor:cut` respect clause on the simplification line; a profile without `simplification` contains no mention of it (test-asserted).
5. `pnpm test`, `pnpm typecheck` green.

## Risks / trade-offs

- **`**/*.ts` glob includes test files** — intended: tests over-engineer too. The carve-outs keep test rigor (explicitly-requested behaviour = the plan's test list) uncuttable.
- **First distributed rule** — consumers on `init --update` suddenly receive an `enforce: true` rule. Enforce-bucket semantics today are advisory-by-surface (nothing hard-gates on it), so blast radius is prompt-text only.
- **Reviewer over-trust of markers** — an author could `noldor:cut` a genuine defect. Mitigation is in the clause itself: a *wrong ceiling* stays flaggable; correctness/security dimensions are unaffected by the marker.
- **Mixed-scope commit** — diff spans `.noldor/rules/` + `templates/` + `src/cr/`; the `noldor-scope` pre-commit hook may force a commit split or a `Noldor-Sibling-Scope` trailer. Implementation follows whatever the hook demands; no code change either way.

## User Story

As a Noldor code author (human or agent), I want a pre-generation decision ladder enforced on the files I'm editing plus a marker for deliberate corner-cuts, so that over-engineering is stopped before code is written and the CR reviewer respects intentional minimalism instead of fighting it.

## Usage

- Author: before writing code in any `*.ts` file, climb the ladder (surfaces via `pnpm noldor rules resolve --file <path> --stage code`, enforce bucket); stop at the first rung that holds.
- Author: mark a deliberate cut inline: `// noldor:cut linear scan, fine ≤1k rules — index by id when stores grow`.
- Reviewer (automatic): CR `simplification` dimension respects the marker; flags only a wrong ceiling or an unmarked real cut.
- Consumer repos: receive the rule via `pnpm noldor init` / `init --update` (templates twin).

## Open questions (resolved)

1. *Where does the CR wiring live — `review-profile.ts` (entry's cite) or `subagent-dispatch.ts`?*
   -> `DIMENSION_GUIDE.simplification` in `subagent-dispatch.ts` (D1). Dimension prose only reaches the reviewer prompt there; `review-profile.ts` holds effort/dimension lists, and a new prose field in the profile schema would be a heavier change at the wrong layer.
2. *Does `noldor:cut` get tooling (detector, ledger)?*
   -> No (D2). Prose convention only; ponytail's own marker is informal, and rung 1 of the ladder applies to the ladder's own port. Revisit if markers accumulate.
3. *Should the rule glob be narrower (`src/**/*.ts`) like the existing rules?*
   -> No — `["**/*.ts"]` verbatim per the entry (D3). The discipline applies to scripts, hooks, and tests equally; the carve-outs protect what must not be cut there.
4. *Twin for the other three existing rules too?*
   -> No — out of scope; they are framework-specific overlays. The entry asks for a twin only for the new rule. A follow-up entry can revisit distribution of the rest.
