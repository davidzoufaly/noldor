---
noldor-page: rules
introduced: 0.4.0
---

# Rules Cascade

Noldor resolves the engineering rules that apply to a given edit from three layers:

1. **Baseline principles** — [`.claude/engineering-rules.md`](../../.claude/engineering-rules.md). Always-on, non-negotiable principles for all code in a Noldor repo (YAGNI, smallest viable diff, narrow-don't-assert, etc.). Project overlays may extend these; read both.
2. **Scoped rule store** — `.noldor/rules/<id>.md`. File- and stage-scoped overlays resolved on demand by `noldor rules resolve`. This is the cascade.
3. **Toolchain floor** — the `toolchain-floor` invariant ([`src/invariants/toolchain-floor.ts`](../../src/invariants/toolchain-floor.ts)). The subset of the baseline that lives in config rather than in prose, asserted mechanically. See [Toolchain floor](#toolchain-floor) below.

The cascade exists so a rule only surfaces where it applies — e.g. an ESM-`.js`-specifier rule scoped to `src/**/*.ts` at the `code` stage, rather than a flat wall of rules the author has to filter mentally on every edit.

## Rule store

Each rule is one markdown file at `.noldor/rules/<id>.md`. The **filename is the canonical id** — `rules resolve` / `rules list` key off the id, so [`load.ts`](../../src/rules/load.ts) hard-fails when `id:` frontmatter drifts from the filename. Filenames are unique within the dir, so this also makes duplicate ids structurally impossible (no separate dup check needed).

Frontmatter (`.strict()` — unknown keys rejected), validated by [`RuleFrontmatterSchema`](../../src/rules/types.ts):

| Field        | Type                                          | Notes                                                                                              |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`         | kebab-case string (required)                  | Must equal the filename stem.                                                                       |
| `applies-to` | `string[]` of globs (optional)                | Minimatch globs against repo-relative POSIX paths. Omit ⇒ stage-level rule (matches no file query). |
| `stage`      | `('triage' \| 'code' \| 'review' \| 'release')[]` (optional) | Lifecycle stages the rule applies to. Omit ⇒ matches any stage.                                     |
| `enforce`    | `boolean` (optional, default `false`)         | `true` ⇒ the rule lands in the **enforce** bucket; `false` ⇒ the **inject** (advisory) bucket.      |
| `links`      | `string[]` (optional)                         | Repo-relative supporting references (specs, configs).                                               |

The body (after frontmatter) is the rule text, trimmed.

Example — [`.noldor/rules/import-js-specifiers.md`](../../.noldor/rules/import-js-specifiers.md):

```markdown
---
id: import-js-specifiers
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [tsconfig.json]
---
The toolchain is ESM … internal cross-module imports stay relative and carry an explicit `.js` specifier.
```

## Resolution model

[`resolveRules(rules, { file?, stage? })`](../../src/rules/resolve.ts) returns `{ injected, enforce }`:

- **File match** — a file-scoped rule matches when any of its `applies-to` globs minimatches the query file. A stage-level rule (`applies-to` empty) matches a stage-only query, never a file query.
- **Stage match** — a rule with no `stage` matches any stage; otherwise the query stage must be in the rule's `stage` list. A query with no stage matches every rule.
- **Ordering** — total order by **glob specificity descending** (count of literal leading path segments before the first wildcard), with declaration order (filename sort) as the tiebreak. More specific rules surface first.
- **Buckets** — `enforce: true` rules go to `enforce`; the rest to `injected` (advisory context). Both preserve the sort order.

### Stages

`triage | code | review | release` (see [`stage.ts`](../../src/core/rules/stage.ts)). A persisted session path projects to a stage via `pathToStage` — `release-sweep` / `release-automation` ⇒ `release`, everything else ⇒ `code`. `triage` (pre-gate) and `review` (transient CR sub-state) are only ever passed explicitly by their callers (triage skill, CR flow).

## CLI

| Command                                              | Output                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm noldor rules resolve --file <path> --stage <stage>` | JSON `{ injected, enforce }` for the given file/stage. Both flags optional (stage-only or file-only). |
| `pnpm noldor rules brief --file <path> [--file <path> …] [--stage <stage>] [--json]` | The same resolution rendered for an author: `ENFORCE` (binding) first, `ADVISORY` second, each rule with its scope, body, and links. Unions repeated `--file`, deduped. Stamps `session.injectedRules`. `--file` is **required** — see below. |
| `pnpm noldor rules list`                             | Tab-separated `id  stage  inject\|enforce  scope` line per rule in the store.                    |
| `pnpm noldor rules validate`                         | Loads + validates the store; non-zero exit + per-rule errors on failure.                        |

`rules validate` is the store's integrity gate — schema violations, id/filename mismatches, and parse errors all surface here.

## Toolchain floor

Some baseline principles are only real if a config says so — `using` does not compile without the disposable lib, and `react/rules-of-hooks` does not run unless it is named. Those configs are the two the framework deliberately does **not** own, because which rules a repo must switch off, and which strictness flags it can afford today, are properties of *its* code. Each is disowned by its own mechanism: `.oxlintrc.json` is in `SCAFFOLD_ONLY_TEMPLATES` (see [manifest.ts](../../src/templates/manifest.ts)), so `init` writes it once and template-sync never re-asserts it; the tsconfig has no template at all, so the framework never writes it. Template sync therefore holds neither to a standard.

The `toolchain-floor` invariant closes that gap from the other side: instead of comparing against a template copy, it reads the repo's own config and asserts a floor. It runs under `pnpm noldor checks invariants`, a pre-commit job in [`lefthook/noldor.yml`](../../lefthook/noldor.yml), so it is live in this repo and in every consumer that installs the framework — bound to that consumer's root, reading that consumer's files.

Severity tracks migration cost, not importance:

- **error** — the requirement costs nothing to satisfy: `react` in `plugins`, `react/rules-of-hooks` and `react/exhaustive-deps` named as errors, and a declared `lib` that both provides Explicit Resource Management and reaches es2025. Naming a lint rule or widening a `lib` cannot break existing code (raising this repo to `["ESNext", "DOM"]` left `tsc --noEmit` clean). The `lib` year floor is what keeps the `platform-over-dependency` rule honest: it mandates `Object.groupBy`, `Promise.withResolvers`, Set operations, iterator helpers and `RegExp.escape` by name, and every one of those is a TS2550 "change the lib option" error under `lib: ["ES2023"]` — an enforced rule must not require code the config rejects.
- **error, also** — a config that is *present* but cannot be read (`tsconfig-invalid`, `oxlintrc-invalid`), and a React repo with no `.oxlintrc.json` at all (`oxlintrc-absent`). Reporting a broken blocking config as advisory is what made the floor bypassable in the first place; see below.
- **warn** — the requirement is a real migration: `noUncheckedIndexedAccess` (221 errors when first probed against this repo), `exactOptionalPropertyTypes` (47). These are a ratchet — scheduled work that stays visible on every run — because hard-failing a commit on multi-day work only teaches people to bypass the hook. Also warn: `tsconfig-absent`, `manifests-unreadable` and `lib-inherited`, where the floor could not resolve its own input and the honest report is "unchecked" rather than a verdict. Note what `lib-inherited` is not: a config with no `lib` used to pass silently, which meant a standalone `target: ES2023` project satisfied a floor it did not meet.

One thing the floor cannot assert is a **runtime**. `lib` proves the compiler knows an API, not that the deployment target implements it — the iterator helpers and Set operations need Node 22+, `RegExp.escape` and `Symbol.dispose` Node 24+. `platform-over-dependency` states that assumption and tells a consumer on an older target to waive `lib-es-builtins`, because a deploy target is not visible in the repo and nothing here can check it.

A repo that genuinely declines a floor item declares it in `.noldor/config.json`:

```jsonc
{
  "consumer": {
    "toolchainFloor": {
      "waivers": [{ "id": "disposable-lib", "reason": "deploy target has no Symbol.dispose support" }]
    }
  }
}
```

A waiver does not silence the finding — it downgrades it to a `warn` quoting the reason, so the exception stays legible in every run rather than vanishing. `reason` has a 20-character floor for the same purpose. The idiom mirrors `release.crGateExemptCommits`.

**Comments and trailing commas are read, not rejected.** `tsc --init` emits a tsconfig full of comments and oxlint accepts them too, so reading these files with bare `JSON.parse` made a perfectly ordinary config *unparseable* — and while that was reported as an advisory `warn`, the blocking half of the floor silently never ran. That was a bypass, not a rough edge. `toolchain-floor` therefore strips comments and trailing commas itself, with a small string-aware scanner, before parsing; a config that still fails is an `error`, because the repo then owns a file its own toolchain cannot read either.

Lexically invalid input is rejected rather than repaired, which is the other half of the same guarantee: an unterminated comment or string is an `error`, and a comma following no value at all (`{,}`) is left in place so `JSON.parse` still refuses it. A stripper that quietly turns a broken document into a parseable one would recreate the bypass from the opposite direction.

The scanner is hand-rolled rather than delegated for two independent reasons. Taking a JSONC package to read two config files would contradict `platform-over-dependency`, the rule this invariant exists to make enforceable. And TypeScript 7 exposes no in-process JS parser API — its root export carries `version` alone, with parsing behind the tsgo API server — so `ts.readConfigFile` is not callable here even if a dependency were acceptable. The same constraint is why the floor reads root configs directly instead of resolving the `extends` graph: that approximation is documented in `libFloorChecks`, not claimed as completeness.

Every value read from these files is validated with Zod before use, like any other external input. A file containing bare `null` is valid JSON, so the earlier `as`-cast let the first property read throw a `TypeError` out of the invariant — and an invariant that crashes tells the operator nothing.

## Template sync

Files Noldor ships into a consumer repo from [`templates/`](../../templates/) (e.g. `templates/.claude/engineering-rules.md`, `templates/lefthook/noldor.yml`) must not drift from their template copy. [`checks/check-template-sync.ts`](../../src/checks/check-template-sync.ts) (`pnpm noldor checks template-sync`) blocks a commit/push when a templated file diverges from its `templates/` source — wired into both `pre-commit` and `pre-push` in [`lefthook/noldor.yml`](../../lefthook/noldor.yml). This keeps the baseline principles and hook config a consumer receives identical to the ones the framework tests against.

### Why `rules brief` demands a `--file`

`fileMatches` ([`resolve.ts`](../../src/rules/resolve.ts)) matches a file-scoped rule only against a query that names a file: for a stage-only query it returns `rule.appliesTo.length === 0`. Every rule in the store today is file-scoped, so `rules resolve --stage code` is empirically `{ injected: [], enforce: [] }`. A brief without a file would therefore print "no rules match" no matter how full the store is — a confident lie — so it refuses instead. Pass one `--file` per path you are about to touch.

## Reaching the author and the reviewer

Resolution is only useful if someone asks. Two callers do:

- **Author, before writing** — `pnpm noldor rules brief --file <path> --stage code`, invoked per the `/noldor-gate` Step 3.5 instruction (claude) or the equivalent in [`drain-mode.md`](drain-mode.md) (codex/opencode). Prose is the delivery mechanism deliberately: a `PreToolUse` hook would be the only true per-edit seam, but `.claude/**` is withheld from non-claude consumers, so it would cover one runner of three.
- **Reviewer, after writing** — the code-stage CR resolves the `enforce` bucket for the files the diff changed and includes their text in the reviewer prompt ([`src/cr/lanes/subagent.ts`](../../src/cr/lanes/subagent.ts) → `DispatchInput.rulesBrief`). This is what makes `enforce` more than a suggestion: a violation is a finding even when the author never ran the brief. Scope: the always-on `reviewer` lane, not the `codex` lane (opt-in, forced only on M/L/XL sessions), which builds its prompt separately.

`session.injectedRules` records the ids a brief surfaced. It is an **exposure** record — what this author was shown — and must never be read as a claim that the rules were followed.

## Where it sits

- Baseline principles are reviewed at code-write time; the executable gate (`lint`, `fmt:check`, `typecheck`, `test`) is the automated half — see [`.claude/engineering-rules.md`](../../.claude/engineering-rules.md) § Commands.
- The scoped store narrows what's relevant per edit. `.claude/CLAUDE.md` overlays carry project-specific rules on top of both.
- `/noldor-garden`'s rule-contradiction sweep (Detector 14, see [garden-and-drift.md](garden-and-drift.md)) flags genuine mismatches between `.claude/CLAUDE.md` and the Noldor pages.
