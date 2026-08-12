# Author-Side Rule Injection — Design

**Slug:** rules-cascade-v1-author-side-rule-injection
**FD:** docs/features/rules-cascade-v1.md
**Date:** 2026-08-12
**Tier:** specs-only
**Deps:** none

## Problem

The rules cascade resolves which rules apply to an edit, and nothing ever asks it.

`resolveRules` ([`src/rules/resolve.ts:39`](../../../src/rules/resolve.ts)) sorts matching rules into an `enforce` bucket and an advisory `injected` bucket. Four thin CLIs expose it. But a repo-wide search finds no caller: `rules resolve` appears only in [`src/cli/manifest.ts:154`](../../../src/cli/manifest.ts) and in docs — no hook, no skill, no CR lane, no gate step invokes it. `SessionMarker.injectedRules` ([`src/core/session.ts:28`](../../../src/core/session.ts)) is dead schema with zero writers outside its own schema test.

So the `enforce` bucket enforces nothing. The `lazy-decision-ladder` rule — ported from ponytail in PR #277 precisely to be *pre-generation* discipline — reaches an author only if that author happens to open `.noldor/rules/lazy-decision-ladder.md` unprompted. The parent FD already admits this at [`docs/features/rules-cascade-v1.md:50`](../../features/rules-cascade-v1.md) ("automatic injection into the authoring loop is deferred").

One constraint shapes everything below. `fileMatches` ([`src/rules/resolve.ts:33`](../../../src/rules/resolve.ts)) returns `rule.appliesTo.length === 0` for a query with no `file`, so a **file-scoped rule never matches a stage-only query**. Every rule in the store today is file-scoped, which makes the stage-only call empirically empty:

```
$ pnpm noldor rules resolve --stage code
{ "injected": [], "enforce": [] }
```

Any injection that does not name a file surfaces nothing. That is why this design is per-file rather than per-session.

## Goals

- An author (human or agent) sees the rules that apply to a file **before** editing it, with the `enforce` bucket marked as binding rather than advisory.
- The reviewer checks the diff against the **actual text** of the enforce rules for the changed files, not against generic dimension descriptions.
- Runner-neutral: works identically for claude, codex, and opencode consumers.
- `SessionMarker.injectedRules` stops being dead schema.

## Non-goals

- **A claude `PreToolUse` per-edit hook.** [`src/hooks/noldor-pre-edit-guard.ts:40`](../../../src/hooks/noldor-pre-edit-guard.ts) already receives the exact `file_path` and would be the natural host, but `filterTemplatesByAgents` ([`src/templates/agent-filter.ts`](../../../src/templates/agent-filter.ts)) withholds `.claude/**` from non-claude consumers, so the hook would silently do nothing for two of three supported runners (D1). It remains a clean later layer on top of this work.
- **A commit-time "was it briefed" assertion.** A hook comparing staged files against `session.injectedRules` proves the rule text was *printed*, not obeyed — compliance theater, plus a false-red bricking risk on resumed sessions (D4).
- **Authoring new rules.** Q-0069 (`Prose Rules → Enforce Cascade Rules`, [`docs/roadmap.md:59`](../../roadmap.md)) migrates prose baseline rules *into* rule files. Complementary, not this: injection is what makes Q-0069 worth doing at all (D2).
- **`noldor:cut` tooling** — still no detector, no lint, no debt ledger (unchanged from the PR #277 spec's D2).

## Design

Two delivery points, one shared renderer.

### Unit 1 — `renderBrief` (`src/rules/brief.ts`, new, pure)

```ts
export interface BriefOptions {
  readonly files: readonly string[];
  readonly stage?: Stage;
  readonly enforceOnly?: boolean;
}
export function unionResults(results: readonly ResolveResult[]): ResolveResult;
export function renderBrief(result: ResolveResult, opts: BriefOptions): string;
```

`unionResults` concatenates per-file `ResolveResult`s and dedupes by `Rule.id`, preserving first-seen order — `resolveRules` already returns a total order (specificity desc, declaration asc), so first-seen preserves it per file without a re-sort.

`renderBrief` emits markdown: a header naming the files and stage, then an `ENFORCE (n) — binding, not advisory` section and an `ADVISORY (n)` section. Each rule renders its `id`, its scope (`applies-to` joined, plus `stage`), its `body`, and its `links`. `Rule` already carries `body` ([`src/rules/types.ts:20`](../../../src/rules/types.ts)), so rendering needs no second file read.

An empty result renders one explicit line (`no rules match <files> at stage <stage>`) rather than empty output — the same "unknown is never printed as clean" posture the clones verdicts use.

`enforceOnly` drops the advisory section; the CR side (Unit 4) uses it.

### Unit 2 — `rules brief` CLI (`src/rules/cli-brief.ts`, new)

`pnpm noldor rules brief --file <path> [--file <path> …] [--stage <stage>] [--json]`

Parses repeated `--file` (so a known touch set is one call), calls `runResolve` from [`src/rules/cli-cores.ts:6`](../../../src/rules/cli-cores.ts) once per file, unions, renders, prints. `--json` emits `{ files, stage, enforce, injected }` for programmatic callers. Zero `--file` arguments is a usage error naming the stage-only-is-empty constraint, rather than printing a misleading empty brief.

Then it stamps the session (Unit 3). Registered in [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) under the existing `rules` group.

### Unit 3 — `stampInjectedRules` (`src/core/session.ts`)

```ts
export function stampInjectedRules(cwd: string, ids: readonly string[]): void;
```

Reads the marker; **no-op when absent** — modelled on `touchSession` rather than `setAutonomous` (which throws), because `rules brief` must stay usable outside a gate session. Writes `{ ...m, injectedRules: <union of existing and ids, sorted> }`. Union, not overwrite: a session briefs once per file, and the field should accumulate what the author was shown.

### Unit 4 — enforce rules into the CR prompt

`DispatchInput` ([`src/cr/lanes/subagent-dispatch.ts:6`](../../../src/cr/lanes/subagent-dispatch.ts)) gains an optional pre-rendered `rulesBrief?: string`, concatenated into the prompt beside `CUT_MARKER_GUIDE`. The lane stays a pure prompt builder with no git and no fs access — exact precedent: `fdSummary: string` is already a pre-rendered string the caller supplies.

The caller ([`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts)) resolves it, because that is where git access already lives:

1. `discoverChangedFiles({ cwd, base, head, runGit })` — new sibling of `discoverAddedFiles` in [`src/core/branch-added.ts:75`](../../../src/core/branch-added.ts), reusing that module's `RunGit` seam and both of its hard-won flags (`-c core.quotepath=false` so non-ASCII paths stay matchable, `-M` so a moved file is not read as added). Same shape minus `--diff-filter=A`.
2. Resolve per changed file at stage `code`, union, `renderBrief(..., { enforceOnly: true })`.
3. Pass the string as `rulesBrief`. Omitted entirely when the render is empty, so a prompt never carries a "no rules" paragraph.

`--kind code` only: a spec or plan artifact has no `**/*.ts` files to resolve against.

### Unit 5 — gate wiring (prose, both twins)

[`.claude/skills/noldor-gate/SKILL.md`](../../../.claude/skills/noldor-gate/SKILL.md) implementation step gains one instruction: before the first edit to a file, run `pnpm noldor rules brief --file <path> --stage code` and treat the `ENFORCE` section as binding. Mirrored verbatim into `templates/.claude/skills/noldor-gate/SKILL.md` (the `checks shared-files` gate enforces the twin) and named in [`docs/noldor/drain-mode.md`](../../noldor/drain-mode.md), which is the runner-neutral restatement a codex/opencode implementer child receives — that is what makes prose delivery runner-neutral (D1).

## Acceptance criteria

- `rules brief --file src/rules/brief.ts --stage code` prints `lazy-decision-ladder` under `ENFORCE` and `import-js-specifiers` + `ts-colocate-schema-type` under `ADVISORY`.
- `rules brief --file src/foo.ts --file src/foo.test.ts --stage code` lists `test-real-behavior` once, and lists no rule twice.
- `rules brief` with no `--file` exits non-zero with a message naming the stage-only-is-empty constraint.
- A brief run inside a gate session leaves `.noldor/session.json` carrying `injectedRules` with the surfaced ids; a second brief for a different file unions rather than replaces.
- A brief run with no session marker present prints normally and exits 0.
- `renderBrief` on an empty `ResolveResult` returns a non-empty explanatory line.
- `discoverChangedFiles` returns modified, added, and renamed-destination paths for a `base..head` range, and does not C-quote a non-ASCII path.
- The reviewer prompt contains the `lazy-decision-ladder` body when a `--kind code` run's diff touches a `.ts` file, and contains no rules section when the diff touches none.
- `noldor rules brief` appears in `docs/noldor/script-catalog.md` and its `templates/` twin; `pnpm noldor validate script-catalog` and `pnpm noldor checks shared-files` both pass.

## Risks / trade-offs

- **Prose compliance is the delivery mechanism.** An agent that skips the brief step gets no rules, and nothing blocks it. Accepted deliberately: the two alternatives were a claude-only hook (silently dead for 2 of 3 runners) and a printed-not-obeyed commit assertion. Unit 4 is the mitigation — the reviewer holds the rule text regardless of whether the author read it, so a violation is caught at review even when the brief was skipped.
- **Per-file call cost.** One subprocess per file touched. The rule index is already memoized by mtime ([`src/rules/index-cache.ts`](../../../src/rules/index-cache.ts)), and repeated `--file` collapses a known touch set into one call.
- **Prompt growth.** Four rules today is small; a store grown by Q-0069 could crowd the reviewer prompt. No cap now (YAGNI); if it bites, cap by rule count and say what was dropped rather than truncating silently.
- **`injectedRules` records exposure, not compliance.** It answers "what was this author shown", which is the honest claim; it must never be read as "these rules were followed".

## User Story

As an agent editing code in a Noldor repo, I want the rules that apply to the exact file I am about to change surfaced before I write, with the binding ones marked, so that the enforce bucket shapes the code being written instead of being discovered by a reviewer afterwards.

## Usage

- `pnpm noldor rules brief --file <path> [--file <path> …] [--stage code] [--json]` — print the rules that apply to those files, `ENFORCE` first. Stamps `session.injectedRules` when a gate session is active; no-ops that stamp when none is.
- Gate implementation step: run it before the first edit to a file; treat `ENFORCE` as binding, `ADVISORY` as context.
- Code-stage CR (`cr orchestrate --kind code`) automatically resolves the enforce rules for the changed files and includes their text in the reviewer prompt — no flag.
- `--file` is required; a stage-only brief would be empty by construction because every rule in the store is file-scoped.

## Open questions (resolved)

1. _Runner-neutral CLI plus gate prose, or a claude `PreToolUse` hook on `Edit|Write`?_
   -> **Runner-neutral CLI plus gate prose** (D1). The hook is the only true per-edit seam, but `.claude/**` templates are withheld from codex/opencode consumers, so it would cover one runner of three; gate prose reaches all of them via `drain-mode.md`.

2. _What does the brief resolve against, when a stage-only query returns nothing?_
   -> **Per-file, lazily, before each edit** (D3), with repeated `--file` so a known touch set is one call. This needs no change to `resolveRules` semantics and delivers each rule exactly where it applies. A "union every stage-matching rule" mode was rejected for reintroducing the wall-of-text the cascade exists to remove.

3. _What gives the enforce bucket teeth beyond being printed?_
   -> **Feed the resolved enforce bodies into the CR reviewer prompt** (D4). Teeth land where the framework already has them. A commit-time assertion was rejected: it proves printing, not obeying.

4. _Does `session.injectedRules` become live, or stay dead schema?_
   -> **Live** (D5). The brief stamps the ids it surfaced. It is an exposure record, not a compliance record.

5. _Should `stampInjectedRules` throw when no session marker exists?_
   -> **No — no-op**, following `touchSession` rather than `setAutonomous`. `rules brief` is useful outside a gate session (an operator reading the rules for a file), and a throw would make the CLI unusable there.

6. _Should the CR side resolve rules inside the lane or in the caller?_
   -> **In the caller.** `subagent-dispatch.ts` stays a pure prompt builder; `fdSummary: string` is the existing precedent for a pre-rendered string passed in. Git access inside a prompt builder is exactly what the `altitude` review dimension exists to flag.
