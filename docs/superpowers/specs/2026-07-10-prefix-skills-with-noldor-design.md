# Prefix Skills with noldor- — Design

**Slug:** prefix-skills-with-noldor
**FD:** docs/features/prefix-skills-with-noldor.md
**Date:** 2026-07-10
**Tier:** full
**Deps:** none

## Problem

Nine framework skills carry bare, un-namespaced names: `gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`. Three siblings were born prefixed — `noldor-spec`, `noldor-plan`, `noldor-research` — proving the intended convention. The bare names collide with consumer-side or vendored skills of the same word (`refactor`, `promote`, `gate` are all generic), and they read as ad-hoc rather than as one framework's namespace.

A 2026-06-13 drain attempt mislabeled this `S` and revealed the real shape: a self-referential mega-rename. The words being renamed are **homonyms** across the codebase — `kind: 'gate'` is a code-review lane, `refactor` is a conventional-commit type, `'release-sweep'` is a session-marker `Path` value, `promote`/`demote` are dashboard actions, and `src/garden/` + `src/triage/` are module directories. A naive substring rewrite corrupts all of these. The rename must touch only *skill-invocation* occurrences.

## Goals

- All nine skills end up as `noldor-<name>`, structurally identical to the already-prefixed trio: directory `noldor-<name>`, frontmatter `name: noldor-<name>`, body H1 `# /noldor-<name>`, catalog heading `## /noldor-<name>` — in **both** the canonical `.claude/skills/` tree and the byte-identical `templates/.claude/skills/` twin.
- Every live cross-reference that invokes a renamed skill (`/gate`, `` Skill tool, name `promote` ``, "the `refactor` skill") is rewritten.
- Load-bearing code that embeds a skill-invocation string keeps working: the drain `gatePrompt` and the release-sweep self-edit allowlist glob.
- `pnpm verify` stays fully green; the dynamic `validate-skill-catalog` validator agrees dirs ↔ catalog.
- Consumers (ps-offsite, charuy) migrate cleanly on `noldor upgrade`: old vendored dirs removed, new `noldor-*` dirs in place, catalog consistent — idempotent, single command.
- Homonyms, internal identifiers, archival docs, and generated docs are provably untouched.

## Non-goals

- **No auto-forwarding aliases.** Directory-based skills cannot forward without content duplication; there is no programmatic caller that silently breaks (skills are invoked by a human/agent typing a slash command). Old names simply stop resolving; users type `/noldor-<name>`. (D1)
- **No internal-identifier churn.** `gatePrompt`, `buildDrainGatePrompt`, the filename `src/autonomous/gate-prompt.ts`, and the `Path` union value `'release-sweep'` in `src/core/session.ts` are NOT skill invocations. Renaming them is pure churn with zero functional benefit. (D2)
- **No rewrite of homonyms** (see Problem) — enumerated and protected in Unit 2.
- **No rewrite of archival `docs/superpowers/{specs,plans}/**`** — point-in-time records. Nor generated outputs (`docs/sdd-report.md`, `docs/release-notes.md`, `graphify-out/**`, `docs/user/reference/api/**`) — those regenerate.
- **The operator's global `~/.claude/skills/*` is out of PR scope** — not committable to this repo. Optional post-merge manual mirror.

## Design

### Unit 1 — Skill directory + metadata renames (both trees)

For each of the nine skills, in **both** `.claude/skills/<name>/` and `templates/.claude/skills/<name>/`:

1. `git mv .claude/skills/<name> .claude/skills/noldor-<name>` (and the twin).
2. Frontmatter line 2 `name: <name>` → `name: noldor-<name>`.
3. Body H1 `# /<name>` → `# /noldor-<name>`.

The twins are verified byte-identical today, so the same edits apply to both. Target shape is exactly `noldor-spec/SKILL.md` (`name: noldor-spec`, body `# /noldor-spec`).

### Unit 2 — Catalog + cross-reference codemod (surgical, idempotent, homonym-safe)

Precedent: `src/core/rename-plan-only-tier.ts` — a pure, idempotent text codemod with slug-protection over a fixed glob set. This unit adds `src/core/prefix-skills-codemod.ts` with the same shape, keyed on **word-boundary-anchored skill-invocation forms only** (never bare-substring, never bare-prefix):

For each renamed name `N` in the 9, replace exactly these tokens:
- **Slash invocation, word-boundary anchored (both sides):** `/N` bounded by non-`[\w-]` chars on the right AND a non-`[\w-]` char before the `/` on the left → `/noldor-N`. Expressed as `new RegExp('(?<![\\w-])/' + N + '(?![\\w-])', 'g')`. Both guards are REQUIRED and MUST match the acceptance residue-grep's `(?<![\w-])…(?![\w-])` anchoring exactly (review round-2). The RIGHT guard stops `/milestone`→`/milestones` (route, `docs/noldor/milestones.md:65`) and `docs/milestones/…`; the LEFT guard stops matching `/N` glued to a preceding token (a path/word char before the slash, e.g. `foo/gate-*` segments). `/N --drain`, `/N <slug>`, `` `/N` ``, line-start `/N` still match; `/milestones`, `/promote-from-backlog` do not.
- **Dir path segment:** `.claude/skills/N/` → `.claude/skills/noldor-N/`.
- **Backtick skill-context:** `` `N` `` only when adjacent to the word "skill" or preceded by "name " (`` name `N` ``, `` the `N` skill ``) → `` `noldor-N` ``.

Explicit protected tokens (round-tripped through placeholders BEFORE the rules run, restored after — the `PROTECTED_SLUG` mechanism, `rename-plan-only-tier.ts:33-42`):
- Homonym tokens (belt-and-suspenders atop the word-boundary): `docs/milestones/`, `/milestones`, `promote-from-backlog`, `demote`.
- FD slugs/filenames literally containing a renamed word: `prefix-skills-with-noldor`, `portable-gate-entrypoint-for-non-claude-runners`, and any `*-gate-*`/`*-promote-*`/`*-refactor-*` slug — enumerate at impl time via `ls docs/features docs/superpowers/{specs,plans}`.

Homonym guard: no rule uses bare-substring; `kind: 'gate'`, commit type `refactor`, `src/garden/` imports carry no `/`, `.claude/skills/`, or backtick-skill anchor, so they never match. The `## /N` catalog heading is already matched by the `/N(?![\w-])` rule (`## /gate` → `## /noldor-gate`) — it is NOT a separate rewrite rule, carried only as a Unit 6 test assertion (per review Suggestion 2).

Glob set (mirror + extend `rename-plan-only-tier.ts:44-56`, which itself included features/roadmap/backlog): `.claude/skills/*/SKILL.md`, `templates/.claude/skills/*/SKILL.md`, `docs/noldor/*.md`, `templates/docs/noldor/*.md`, `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md`. The features/roadmap globs are load-bearing — ~49 live FDs carry `/gate`/`/promote`/… cross-references (verified); omitting them is the half-rename Goal 2 forbids. Excludes: `node_modules`, `.git`, `.worktrees`, `.claude/worktrees`, `docs/superpowers/**` (archival), `CHANGELOG.md` + `docs/release-notes.md` + `docs/sdd-report.md` + `graphify-out/**` + `docs/user/reference/api/**` (all generated — regenerate downstream), `ideas.md` (pre-triage scratch, not a live reference — 5 hits left as-is), and the codemod's own source + test. `lefthook/noldor.yml` needs no edit — its sole match is the homonym glob `docs/milestones/**`.

The dynamic validator `src/core/validate-skill-catalog.ts` (`loadSkillSlugs` reads dir names, `parseCatalogSlugs` reads `## /<slug>`, `diffSkillSets` compares) needs **no** edit — it stays green because Unit 1 renames dirs and Unit 2 renames catalog headings together. Same for the dashboard's dynamic `loadSkills()` (`src/dashboard/data.ts`).

### Unit 3 — Load-bearing code hand-edits (verified individually)

- `src/autonomous/gate-prompt.ts:25` — `` return `/gate --drain ${slug}` `` → `/noldor-gate --drain`; `:51` — `` `/gate --resume ${slug} --autonomous` `` → `/noldor-gate --resume`. The prose branches (lines 27, 62) point at `docs/noldor/drain-mode.md` and carry no `/gate` token (asserted by `gate-prompt.test.ts:23`); leave them. Update that test's expectation.
- `src/core/allowlist.ts:28` — `'.claude/skills/release-sweep/**'` → `'.claude/skills/noldor-release-sweep/**'`. (The adjacent `RELEASE_SWEEP_GLOBS` identifier name and the session `Path` value `'release-sweep'` are NOT changed — Non-goal D2.)

### Unit 4 — User-facing strings + framework docs

User-facing invocation strings (they instruct a human/agent to invoke a renamed skill, so a stale one is a bug): `src/hooks/noldor-pre-commit.ts:55,120`, `noldor-pre-edit-guard.ts:66`, `noldor-pre-push.ts:23,27`, `noldor-validate-trailer.ts:214`, `src/core/session.ts:37,113`, `pr-flow-cli.ts:149`, `pr-flow.ts:159`, `src/cli/commands/init.ts:102`, `src/prep/prep-promote.ts:371`, `src/testing/stub-gate.ts:38,65,74`, `src/garden/garden-receipt.ts:63,70-71,96`, `src/dashboard/views.ts:373`, **`src/cli/manifest.ts:126`** (the `merge-candidates` `desc:` string `…for /triage; --json…` — `--help` output, not a comment, so the opportunistic carve-out below does NOT cover it). Framework docs `docs/noldor/**` (+twins) are handled by the Unit 2 codemod glob. JSDoc-comment mentions (blast-radius §4c) are updated opportunistically when a file is already open — cosmetic, non-blocking.

### Unit 5 — Consumer migration (v0.6.0, chain-contiguous)

New `src/migrations/0.6.0.ts` (`Migration`, `from: '0.5.0'`, `to: '0.6.0'`). `migrate(cwd, config)`:
1. Copy the nine new `noldor-*` skill dirs **and every changed `docs/noldor/*.md` twin** (the Unit 2 codemod rewrites slash-invocations across essentially all 24 pages — `drain-mode.md`, `workflow.md`, `lifecycle.md`, `skill-catalog.md`, …; a consumer that only got new skill dirs would keep vendored docs instructing `/gate --drain`, sending agents at dead skills and reddening doctor-drift — B3) from the installed package templates into the consumer via `copyTemplate(templateRoot, cwd, relPaths, {update:true})` (`src/templates/copy.ts`). `relPaths` = `templateFiles()`-derived `.claude/skills/noldor-*/**` + `docs/noldor/*.md` (copy the full docs/noldor set with `{update:true}`; byte-identical pages report `unchanged`, so over-listing is safe and keeps the list drift-proof).
2. `rmSync` the nine old vendored `.claude/skills/<name>/` dirs (recursive), if present.
3. Return `MigrationStep[]` describing adds (`before:''`) + removals + doc updates, for the `--dry-run` report.

`dryRun()` returns the same steps without writing. Consumer-OWNED docs (`docs/features/*`, `docs/roadmap.md`, `docs/backlog.md`) are NOT templated to consumers and are NOT touched by the migration — those globs in Unit 2 are noldor-repo-internal only. Chain contiguity: `resolveChain` (`src/migrations/chain.ts:24-31`) asserts each `from` equals the running cursor. Today the chain ends at the `0.4.0` anchor; a consumer anchored at `0.4.0` upgrading to `0.6.0` would gap. Add a no-op `src/migrations/0.5.0.ts` (`from:'0.4.0'`, `to:'0.5.0'`, empty steps — mirrors `0.4.0.ts`) to bridge, and register both in `src/migrations/registry.ts`. The `migration-coverage` detector (`src/garden/detectors/migration-coverage.ts`) does not force this (no `SCHEMA_SURFACE` file changes) — shipped by choice. Release bumps the version to 0.6.0 so `installedFrameworkVersion()` matches `to`.

### Unit 6 — Tests

- `src/core/__tests__/prefix-skills-codemod.test.ts` — new: golden-rename per form; word-boundary non-match for the exact homonyms review found — `/milestones` (route), `docs/milestones/<slug>.md`, `/api/roadmap/promote-from-backlog/`, `demote`, plus `kind: 'gate'`, `refactor` commit type, `src/garden/` import; `## /gate` heading → `## /noldor-gate` assertion (Suggestion 2 — asserted, not a rule); slug-protection round-trip (`prefix-skills-with-noldor`, `portable-gate-entrypoint-*`); idempotency (second run over renamed input returns input unchanged).
- `src/migrations/__tests__/0.6.0.test.ts` — new: dry-run enumerates skill-dir adds + doc updates + removals; apply into a fixture adds `noldor-*`, rewrites `docs/noldor` twins, removes old dirs, leaves consumer-owned files untouched; **idempotent second apply pinned against real `copyTemplate` semantics (Suggestion 1)** — byte-identical files report `unchanged`, no re-reported adds, `rmSync` no-ops on absent dirs.
- `src/migrations/__tests__/0.5.0.test.ts` — new: bridge anchor is a no-op (empty steps), chain `0.4.0→0.5.0→0.6.0` resolves contiguous.
- Update path/string hardcodes: `allowlist.test.ts`, `extract-touches.test.ts`, `gate-prompt.test.ts`, `drain-source.test.ts`, `build-pool.test.ts`, `escalations.test.ts`, `dashboard-skills.test.ts`, `agent-filter.test.ts`.
- Full `pnpm verify` (typecheck + all suites + validators).

## Acceptance criteria

- All 9 skill dirs are `noldor-*` in both trees; each `SKILL.md` line-2 `name:` and body H1 match the dir; `docs/noldor/skill-catalog.md` (+twin) heading matches.
- `pnpm noldor validate skill-catalog` exits 0 (dirs ↔ catalog agree, no bare-name residue).
- **Idempotency = no in-scope residue:** re-running the Unit 2 codemod a second time reports `0 file(s) touched`. This is the homonym-agnostic residue check (replaces a raw grep that cannot pass — the un-anchored `rg '/gate|…'` returns 784 hits, mostly by-design survivors: module imports `../garden/`, dashboard routes `/milestones`, `docs/milestones/`, generated docs, the codemod's own fixtures — B2).
- **Scoped anchored grep** over the Unit 2 glob set only, excluding protected slugs, returns zero: `rg -nP '(?<![\w-])/(gate|garden|triage|promote|milestone|new-feature|draft-feature-md|refactor|release-sweep)(?![\w-])' .claude/skills docs/noldor templates/.claude/skills templates/docs/noldor docs/features docs/roadmap.md docs/backlog.md`.
- Drain still emits `/noldor-gate --drain <slug>` / `/noldor-gate --resume <slug> --autonomous`; `gate-prompt.test.ts` green.
- `RELEASE_SWEEP_GLOBS` points at `noldor-release-sweep/**`; release-sweep self-edit allowlist test green.
- Homonyms unchanged: `kind: 'gate'` (CR), `refactor` (commit type), `'release-sweep'` (session `Path`), `promote`/`demote` + `/milestones` route (dashboard), `docs/milestones/` paths, `src/garden`+`src/triage` modules — asserted by targeted grep + green existing tests.
- `noldor upgrade` on a fixture at 0.5.0 → 0.6.0: dry-run lists 9 skill-dir adds + the changed `docs/noldor` doc updates + 9 removals; apply yields exactly the `noldor-*` skill set with rewritten docs; second apply is a no-op (`copyTemplate` reports `unchanged`, `rmSync` skips absent dirs).
- `pnpm verify` green.

## Risks / trade-offs

- **Half-rename (worst case):** dirs renamed but a cross-ref or catalog heading missed → validator red or a broken invocation. Mitigated by the codemod doing the bulk atomically over a fixed glob + the acceptance grep + `validate-skill-catalog`.
- **Codemod over-match:** an anchor rule accidentally hits a homonym. Mitigated by anchor-only rules (no bare substring) + explicit homonym non-match tests (Unit 6).
- **Consumer double-state:** if a consumer runs template re-copy without the migration, old+new dirs coexist and their catalog validator reds. Mitigated by the migration doing both add+remove in one `migrate()`; documented in the migration `description`.
- **Muscle memory / automation:** anyone (or any doc/cron) still typing `/gate` breaks. Accepted per D1 — private-registry consumers are the user's own repos, all covered by the migration + a CHANGELOG note.
- **Low impact, high churn:** roadmap rates impact `low`. Scope is deliberately bounded (Non-goals) to keep the churn proportionate and the diff reviewable.

## User Story

As a Noldor operator (human or agent) working across multiple repos, I want every framework skill to live under the `noldor-` namespace, so that framework skills never collide with consumer-side or vendored skills of the same generic word and the whole skill surface reads as one coherent, discoverable namespace.

## Usage

- Invoke any framework skill by its new name: `/noldor-gate`, `/noldor-promote`, `/noldor-triage`, `/noldor-garden`, `/noldor-milestone`, `/noldor-new-feature`, `/noldor-draft-feature-md`, `/noldor-refactor`, `/noldor-release-sweep` (joining `/noldor-spec`, `/noldor-plan`, `/noldor-research`).
- Consumer upgrade: `noldor upgrade --dry-run` shows the 9 add + 9 remove steps for the 0.5.0 → 0.6.0 step; `noldor upgrade` applies them (rename-in-place of vendored skills), idempotent on re-run.
- No new CLI surface; the drain/gate entrypoints are unchanged except the emitted slash string.

## Open questions (resolved)

1. *Auto-forwarding back-compat aliases for old skill names?* -> No — clean break + consumer migration (D1). Directory-based skills can't forward without duplication; there's no programmatic caller that silently breaks, and consumers are the user's own private-registry repos, all covered by the migration.
2. *Rename internal TS identifiers (`gatePrompt`, `gate-prompt.ts`, session `Path` value `'release-sweep'`)?* -> No (D2) — not skill invocations; pure churn, YAGNI. Only the emitted slash *strings* and the `.claude/skills/` *glob* are load-bearing.
3. *Blind substring codemod like `rename-plan-only-tier`?* -> No (D3) — the renamed words are homonyms; use anchor-only rules (`/N`, `.claude/skills/N/`, `## /N`, backtick skill-context) with slug-protection, backed by homonym non-match tests.
4. *Migration target version and chain contiguity?* -> v0.6.0 (`from:0.5.0`) plus a no-op `0.5.0` bridge anchor (`from:0.4.0`) so `resolveChain` stays contiguous for consumers still anchored at 0.4.0 (D4). Release bumps to 0.6.0.
5. *Scope of doc/reference updates?* -> Live framework only: `docs/noldor/**` (+twins), `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md` via the codemod (D5); user-facing src strings by hand. Archival `docs/superpowers/**` and all generated outputs are left untouched (they regenerate); global `~/.claude/skills` is out of PR scope.
6. *Include `docs/features/*.md` + roadmap/backlog + `ideas.md` + `lefthook/noldor.yml` in the rewrite? (review B4)* -> Features/roadmap/backlog: YES — 49 live FDs carry `/gate`/`/promote` cross-references and the precedent codemod globbed them; slug-protection shields their filenames. `ideas.md`: NO — pre-triage scratch (5 hits), not a live reference. `lefthook/noldor.yml`: NO — its only hit is the homonym glob `docs/milestones/**`, not a skill invocation (D6).
7. *Does the consumer migration touch consumer-owned docs (features/roadmap/backlog)?* -> No — those are never templated to consumers; the migration copies only `.claude/skills/noldor-*` + `docs/noldor/*` twins. The features/roadmap/backlog codemod globs are noldor-repo-internal (D7).
