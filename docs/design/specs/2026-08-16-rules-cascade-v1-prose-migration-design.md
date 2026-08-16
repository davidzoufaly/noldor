# Prose Rules → Enforce Cascade Rules — Design

**Slug:** rules-cascade-v1 (enhancement: prose-migration, entry Q-0069 `prose-rules-enforce-cascade-rules`)
**FD:** docs/features/rules-cascade-v1.md
**Date:** 2026-08-16
**Tier:** specs-only (attach)

## Problem

Three review dimensions are prose-only today: error flow, state discipline, and concurrency. Their normative text sits in the 195-line always-on baseline ([`.claude/engineering-rules.md`](../../../.claude/engineering-rules.md) — Error Handling at lines 151–156; the concurrency machine-gap named at line 31: `require-atomic-updates` has no oxlint implementation) or exists only as an earned lesson that was never written down anywhere (the Q-0073 state-discipline rule, 14 CR rounds on PR #268). The cascade cannot surface any of it: `rules brief --file` returns nothing for these dimensions, and the code-stage reviewer's enforce-bucket injection ([`src/cr/lanes/subagent-dispatch.ts:158`](../../../src/cr/lanes/subagent-dispatch.ts) — "a violation of any of these is a finding") never sees them. Authors get a wall of text to filter mentally; reviewers get `DIMENSION_GUIDE` tells but no binding rule text.

## Goals

- The three dimensions land in the **enforce** bucket exactly on the files being edited (`src/**/*.ts`, stage `code`), via three new rule files in `.noldor/rules/`.
- The Q-0073 state-discipline lesson is captured as normative rule text, including its reviewer-side reading.
- Consumers receive all three rules via `pnpm noldor init` / `init --update` (template twins).
- Existing store integrity gates keep holding: `pnpm noldor rules validate`, `pnpm noldor checks template-sync`.

## Non-goals

- No change to the cascade engine (`src/rules/load.ts`, `resolve.ts`, `index-cache.ts`), the brief renderer, or the reviewer prompt builder — this grows the store, the substrate already delivers it (parent FD Usage: "Q-0069 remains separate: it grows the store, this delivers it").
- No baseline edit: `.claude/engineering-rules.md` and its template twin stay byte-identical and untouched (D1).
- No new review dimensions in `DIMENSION_GUIDE` / `ReviewProfile` — the rules report under existing dimensions.
- No oxlint config changes (`require-atomic-updates` stays unavailable upstream; that is why the rule is prose).

## Design

Six new markdown files, one FD frontmatter edit, zero code changes.

### Unit 1 — `.noldor/rules/error-result-types.md`

Frontmatter: `id: error-result-types`, `applies-to: ["src/**/*.ts"]`, `stage: [code]`, `enforce: true`, `links: [.claude/engineering-rules.md]`.

Body (operational restatement of baseline lines 151–156, not a verbatim copy):

- Expected failures return a result type (`{ success: true, data } | { success: false, errors }` or equivalent discriminated union) so callers confront both branches.
- `throw` is reserved for programmer errors / invariant violations — a thrown error means "this should never happen".
- External throw sources (subprocess, network, file IO, `parse()`) are caught once at the boundary they enter and converted to the result type; interior code trusts typed results.
- Never swallow: an empty `catch {}` is a bug — minimum log-and-rethrow, ideally surface as a result. (`eslint/no-empty` covers the machine half; this rule is the semantic half.)

### Unit 2 — `.noldor/rules/recompute-over-maintained-state.md`

Frontmatter: `id: recompute-over-maintained-state`, same scope/stage/enforce, `links: [.claude/engineering-rules.md]`.

Body carries the Q-0073 lesson (PR #268, 14 CR rounds):

- Prefer a recomputed decision over maintained state whenever the state has many mutation sites. A `finishable` Set mutated at every ship/skip/merge/retry/timeout leaf produced four separate "you missed another `delete`" rounds; replacing it with a verdict recomputed fresh immediately before each use (`resolveFinishPrompt`) erased the class.
- Reviewer-side reading: repeated rounds of "you missed another unwind site" are the reviewer circling a design smell — treat as one design finding (replace the maintained state), not N separate bugs.

### Unit 3 — `.noldor/rules/concurrency-write-discipline.md`

Frontmatter: `id: concurrency-write-discipline`, same scope/stage/enforce, `links: [.claude/engineering-rules.md, src/core/atomic-write.ts]`.

Body (write-time counterpart of `DIMENSION_GUIDE.concurrency`'s review-time tells):

- Non-atomic read-modify-write on shared files is a race; route multi-reader file writes through the house helper ([`src/core/atomic-write.ts`](../../../src/core/atomic-write.ts) `atomicWriteFileSync` — temp file + rename).
- git / subprocess / poll loops stay sequential on purpose — `eslint/no-await-in-loop` is off deliberately; `Promise.all` over such steps races the index or the remote.
- Liveness is a fresh probe (`ps`, an actual connect), never trust in a stale lock or PID file.
- Machine half stays named in `.oxlintrc.json` (`no-async-promise-executor`); `require-atomic-updates` has no oxlint implementation, which is exactly why this rule exists.

### Unit 4 — template twins

Byte-identical copies of Units 1–3 under `templates/.noldor/rules/` (same filenames), following the `lazy-decision-ladder.md` distribution pattern. `pnpm noldor checks template-sync` gates the pairing from then on.

### Unit 5 — parent FD `links.code` + Usage refresh

Append the three repo-side rule paths + three template-twin paths to `docs/features/rules-cascade-v1.md` frontmatter `links.code` (the generated Resources section follows via the `fd-resources` pre-commit sync — never hand-edit the section itself).

The FD documents the rules it owns in body prose — Usage line 58 describes `lazy-decision-ladder` inline — so frontmatter-only edits would leave the body stale. Unit 5 therefore also adds one Usage bullet naming the three new rule ids with a one-line gist each, written by hand during implementation (Usage prose is authored, not generated; the gate Step 4 automatic `--refresh --usage-only` pass is not relied on here because its changed-file filter is a source-extension allowlist that may exclude `.noldor/rules/*.md`-only diffs).

### Data flow (unchanged, now carrying 3 more rules)

Author side: `pnpm noldor rules brief --file <src-path> --stage code` → the three rules render in the ENFORCE section. Reviewer side: code-stage orchestrate resolves the enforce bucket for changed files → `renderBrief(..., { enforceOnly: true })` → `DispatchInput.rulesBrief` → binding-rules section of the reviewer prompt.

### Error handling

None new — the store loader already hard-fails on id/filename drift and schema violations (`RuleFrontmatterSchema.strict()`, [`src/rules/types.ts:6`](../../../src/rules/types.ts)).

### Testing

No new unit tests: this is a data-only change and every rules test runs against fixture stores by design (`src/rules/__tests__/cli-brief.test.ts:9` — "A repo holding a FIXTURE rule store, never the live `.noldor/rules/`: Q-0069"). `subagent-dispatch.test.ts` pins only `lazy-decision-ladder` content (cut-marker token) — unaffected. Verification is by the store's own gates plus a live-CLI acceptance check below.

## Acceptance criteria

- `pnpm noldor rules validate` exits 0 with 8 rules loaded (5 existing + 3 new).
- `pnpm noldor rules brief --file src/core/session.ts --stage code` lists `error-result-types`, `recompute-over-maintained-state`, `concurrency-write-discipline` in the ENFORCE section.
- `pnpm noldor rules brief --file src/rules/__tests__/load.test.ts --stage code` also lists them (globs include tests; ratified — no negation globs).
- `pnpm noldor checks template-sync` exits 0 (twins byte-identical).
- `.claude/engineering-rules.md` and `templates/.claude/engineering-rules.md` are unchanged (`git diff --quiet` on both).
- `pnpm noldor validate features` exits 0 after the FD `links.code` edit.
- `docs/features/rules-cascade-v1.md` Usage names all three new rule ids inline (body prose, not only `links.code` frontmatter).
- Each rule body ≤ ~15 lines, states behavior not phrasing, and contains no review-history meta-narrative.

## Risks / trade-offs

- **Prose drift between baseline and rule files** (D1): accepted — the rule file is the normative operational text; the baseline remains the always-on read surface. No validator can check semantic sync either way.
- **Enforce-bucket growth = longer reviewer prompts** on every src-touching CR round (3 more rule bodies injected). Bodies are kept tight (≤ ~15 lines each) to bound the token cost.
- **False-positive findings against test files**: globs include `__tests__` (ratified O2/O3 — result-type discipline in tests is odd but harmless; reviewer judgment filters).
- **Consumer surprise on `init --update`**: three new enforce rules appear in downstream repos. Mitigated by them mirroring the already-distributed baseline — the policy is not new, only its delivery.

## User Story

As a Noldor author or reviewer agent, I want the error-flow, state-discipline, and concurrency disciplines delivered as scoped enforce rules on exactly the files I am editing, so that they bind at write time and review time instead of hiding in a 195-line baseline I have to filter mentally.

## Usage

- `pnpm noldor rules brief --file <path> --stage code` — the three rules render under ENFORCE for any `src/**/*.ts` path (gate Step 3.5 runs this before the first edit).
- Code-stage CR: orchestrate resolves the enforce bucket for changed files automatically; a violation is a finding even when the brief was skipped.
- `pnpm noldor rules list` / `rules resolve` — store enumeration includes the new ids.
- Consumers: `pnpm noldor init` / `init --update` scaffolds the three rules from `templates/.noldor/rules/`.

## Open questions (resolved)

1. _What happens to the matching baseline sections once the rules exist?_ -> Keep the baseline untouched; rule files link back. Matches the `ts-colocate-schema-type` precedent and avoids churning a distributed, twin-synced page (D1).
2. _Do the rules distribute to consumers?_ -> Yes, all three get `templates/.noldor/rules/` twins. They mirror already-distributed baseline policy; shipping enforce coverage only to noldor itself would reproduce downstream the exact dogfood gap the entry complains about (D2).
3. _Ids, scope, flags?_ -> `error-result-types` (entry-named), `recompute-over-maintained-state`, `concurrency-write-discipline`; all `enforce: true`, `stage: [code]`, `applies-to: ["src/**/*.ts"]` including tests — no negation globs until a real false-positive round earns them (D3).
4. _New tests?_ -> None. Data-only change; rules tests are fixture-store by design, and `rules validate` + `template-sync` + the live-CLI acceptance checks cover the store. Adding a test that pins live-store contents would couple the suite to policy data — the exact coupling `cli-brief.test.ts` documents avoiding (D3).
