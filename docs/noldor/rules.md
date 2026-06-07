---
noldor-page: rules
introduced: 0.4.0
---

# Rules Cascade

Noldor resolves the engineering rules that apply to a given edit from two layers:

1. **Baseline principles** — [`.claude/engineering-rules.md`](../../.claude/engineering-rules.md). Always-on, non-negotiable principles for all code in a Noldor repo (YAGNI, smallest viable diff, narrow-don't-assert, etc.). Project overlays may extend these; read both.
2. **Scoped rule store** — `.noldor/rules/<id>.md`. File- and stage-scoped overlays resolved on demand by `noldor rules resolve`. This is the cascade.

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
| `pnpm noldor rules list`                             | Tab-separated `id  stage  inject\|enforce  scope` line per rule in the store.                    |
| `pnpm noldor rules validate`                         | Loads + validates the store; non-zero exit + per-rule errors on failure.                        |

`rules validate` is the store's integrity gate — schema violations, id/filename mismatches, and parse errors all surface here.

## Template sync

Files Noldor ships into a consumer repo from [`templates/`](../../templates/) (e.g. `templates/.claude/engineering-rules.md`, `templates/lefthook/noldor.yml`) must not drift from their template copy. [`checks/check-template-sync.ts`](../../src/checks/check-template-sync.ts) (`pnpm noldor checks template-sync`) blocks a commit/push when a templated file diverges from its `templates/` source — wired into both `pre-commit` and `pre-push` in [`lefthook/noldor.yml`](../../lefthook/noldor.yml). This keeps the baseline principles and hook config a consumer receives identical to the ones the framework tests against.

## Where it sits

- Baseline principles are reviewed at code-write time; the executable gate (`lint`, `fmt:check`, `typecheck`, `test`) is the automated half — see [`.claude/engineering-rules.md`](../../.claude/engineering-rules.md) § Commands.
- The scoped store narrows what's relevant per edit. `.claude/CLAUDE.md` overlays carry project-specific rules on top of both.
- `/garden`'s rule-contradiction sweep (Detector 14, see [garden-and-drift.md](garden-and-drift.md)) flags genuine mismatches between `.claude/CLAUDE.md` and the Noldor pages.
