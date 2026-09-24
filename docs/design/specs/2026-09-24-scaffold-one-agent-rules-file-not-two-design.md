# Scaffold One Agent-Rules File, Not Two — Design

**Slug:** scaffold-one-agent-rules-file-not-two
**FD:** docs/features/scaffold-one-agent-rules-file-not-two.md
**Date:** 2026-09-24
**Tier:** specs-only

## Problem

The roadmap entry assumes `noldor init` writes a `CLAUDE.md` next to `AGENTS.md`. It does not, and what it does is worse.

- For the default `claude` target, `init` writes `.claude/noldor.md` (plus `.claude/engineering-rules.md` and the skills). No runtime loads that file. Claude Code auto-loads only `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md` and `AGENTS.md` at the root or in `.claude/` ([memory docs](https://code.claude.com/docs/en/memory.md#agents-md)), and nothing imports `.claude/noldor.md` — not in this repo, not in charuy. Its `@docs/noldor/README.md` and `@.claude/engineering-rules.md` imports have never run.
- `AGENTS.md` ships only when `codex` or `opencode` is targeted (`src/templates/agent-filter.ts:12`). A default claude-only consumer therefore gets the framework's rules in no file Claude reads.
- Claude Code v2.1.277+ reads `AGENTS.md`, but only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` sits on the path. When one does, Claude reads the CLAUDE files only, and `AGENTS.md` arrives solely through an `@AGENTS.md` import. Claude Code ignores the setting that changes this (`instructionFiles`) in project settings, so a repo cannot opt in by config.
- `AGENTS.md` is a byte-identical synced twin. Shipping it to every target as-is would make `init` refuse (and `init --update` overwrite) any repo that already has its own `AGENTS.md` — common now that the file is a cross-tool convention.

This repo runs `AGENTS.md` (loaded; its first line wrongly says Claude reads `.claude/` instead) next to a dead `.claude/noldor.md`. charuy runs `.claude/CLAUDE.md` (its project overlay) next to a dead `.claude/noldor.md`, with no `AGENTS.md`.

## Goals

- `AGENTS.md` is the single framework rules file, scaffolded for every agent target, and it is the only place the framework's always-read rules live.
- A repo that already has an `AGENTS.md` or a `CLAUDE.md` keeps its own content: the framework owns a marked region, not the file.
- An existing consumer reaches the new layout through `noldor upgrade`: the dead `.claude/noldor.md` is removed, and a `CLAUDE.md` that would hide `AGENTS.md` from Claude gains the import.
- `noldor doctor` catches the one silent failure left: a `CLAUDE.md` that hides `AGENTS.md`.

## Non-goals

- Moving `.claude/skills/**`. Skills stay Claude-primary; `AGENTS.md` tells each runtime how to reach the same flows.
- Moving `.claude/engineering-rules.md` or shipping it to codex/opencode-only consumers.
- Folding a consumer's `CLAUDE.md` content into `AGENTS.md`. Only an import line is added; nothing is moved or deleted.
- A Claude Code version floor in `doctor`.
- Adding `AGENTS.md` to the `checks shared-files` block list. It changes whenever a CLI verb is added (the capability index), and those changes come from worktrees.
- Running the upgrade in charuy. That happens in charuy's own session after the release that carries this.

## Design

### Structural context

The candidate set step 1.5 derives is empty (the entry declares no `Touches:` and the FD has no `links.code` yet), so the digest below ran over the files grounding identified. Graph status: fresh.

- `src/templates/agent-filter.ts`, `src/templates/manifest.ts` and `src/cli/commands/init.ts` share community c17 with `src/checks/check-template-sync.ts` and `src/migrations/0.6.0.ts` — the template-sync neighbourhood, owned jointly by `noldor`, `version-aware-upgrade-and-migration-chain` and `make-noldor-agent-agnostic`.
- `src/cli/commands/doctor.ts` sits in c90 with the prerequisite and install-freshness checks; its only edges into c17 are its imports of the manifest and the agent filter.
- `src/migrations/registry.ts` sits in c65 with `chain.ts` and `upgrade.ts`.
- `src/core/agent-runner/capabilities.ts` sits in c48 (the runner registry); its `rulesFile` field has no runtime reader outside a test.
- No god node is defined in any of these files. The change is interior to four existing communities and adds no new cross-community edge beyond `doctor.ts` importing one more check.

### Unit 1 — AGENTS.md is the rules file for every runtime

`filterTemplatesByAgents` (`src/templates/agent-filter.ts`) passes `AGENTS.md` for every target. `templates/AGENTS.md` absorbs the lines of `.claude/noldor.md` it lacks: the route table (`docs/noldor/README.md`), the engineering baseline (a prose pointer to `.claude/engineering-rules.md`, worded as present on Claude targets, since codex- and opencode-only consumers do not receive it), and the `Noldor-Path-Override` rule. Its opening line says all three runtimes read it, and its skills section names each runtime's entry: `/noldor-*` skills for Claude, command shims for opencode, prose for codex. `templates/.claude/noldor.md` and this repo's `.claude/noldor.md` are deleted. `CAPABILITIES.claude.rulesFile` and `CAPABILITIES.stub.rulesFile` (`src/core/agent-runner/capabilities.ts`) become `'AGENTS.md'`, with the matching row in `docs/noldor/agent-runtimes.md`.

Pointers to the engineering rules and route table are prose, not `@` imports. An import would put about 10k tokens into every Claude session and every subagent, codex and opencode cannot expand it, and in practice no session has ever had these files auto-loaded.

### Unit 2 — a managed region keeps a consumer AGENTS.md intact

The framework owns a region of `AGENTS.md`, not the whole file. A new `src/templates/managed-region.ts` defines the markers (`<!-- noldor:rules:start -->` / `<!-- noldor:rules:end -->`) and three pure functions: extract a region, replace it, append it. `src/templates/manifest.ts` gains `REGION_MANAGED_TEMPLATES` (holding `AGENTS.md`), beside `SCAFFOLD_ONLY_TEMPLATES`. The template file stays whole: content outside its region is a starter a fresh consumer receives once; the region is the synced twin. This ownership rule binds every later file of the same shape, so it is recorded as `docs/adr/0006-framework-owns-a-region-not-the-file.md`.

For a region-managed path, `copyTemplate` (`src/templates/copy.ts`) writes the whole template when the file is absent, appends the region when the file has none (nothing is overwritten, so no `--update` is needed), reports `unchanged` when the regions match, and treats a differing region like any drifted twin: a conflict without `--update`, a region-only replacement with it. `computeDrift` (`src/templates/diff.ts`) compares regions only, so `doctor` and `checks template-sync` inherit the rule. Any marker sequence other than one start marker followed by one end marker is refused with the file's path; the code never guesses. `adoptTemplate` snapshots only the region back into the template, so a first-party repo's own outside content never becomes every consumer's starter. The capability index (`src/docs/capability-index.ts`) is untouched: its markers sit inside the region and travel with it.

### Unit 3 — the migration for existing consumers

A new `src/migrations/1.13.0.ts`, registered in `src/migrations/registry.ts`, follows the `0.6.0` pattern: idempotent, existence-guarded, and the same step list in `--dry-run`. Steps 2 and 3 run only when `agents.targets` includes `claude`.

1. Remove `.claude/noldor.md` when its content matches one of the two versions noldor shipped (a content-hash list in the migration). A modified copy stays and is reported, as `0.6.0` does for a consumer-owned homonym.
2. When step 1 removed the file, each `@.claude/noldor.md` import in `CLAUDE.md` and then `.claude/CLAUDE.md` becomes `@AGENTS.md` if neither file imports `@AGENTS.md` yet, and is deleted otherwise, so the two files end with exactly one import. A modified copy that step 1 kept keeps its import too.
3. When Unit 5's check reports the repo unwired, prepend `@AGENTS.md` to one of the two files (the root file when both exist). This is the mechanism Claude Code documents for a repo that keeps a `CLAUDE.md`, and it never reads `AGENTS.md` twice.
4. Bring `AGENTS.md` to the current region through Unit 2's rules, with replace semantics the way `0.6.0` syncs framework twins: absent means the whole template, no region means an appended one, a differing region is replaced.

### Unit 4 — the chain accepts an anchor between migrations

`resolveChain` (`src/migrations/chain.ts`) checks the first selected migration's `from` against the raw anchor. `init` and the empty-chain path of `runUpgrade` both stamp anchors that fall between migrations, and no migration has been registered since `1.0.0`, so today any consumer anchored at `1.0.1`–`1.12.x` would hit `migration chain gap` on this migration. The check compares against the greatest registered `to` at or below the anchor instead (the anchor itself when there is none): a tree at `1.5.0` has the `1.0.0` shape, because nothing was registered in between. The new migration declares `from: '1.0.0'`. An anchor below the earliest registered migration still errors, as the existing test requires.

### Unit 5 — doctor and init check that Claude can see AGENTS.md

A new `src/checks/check-agents-md-wiring.ts`, shaped like `check-lefthook-wiring.ts`, looks at the repo root, and runs only when `agents.targets` includes `claude`. Its exported predicate is the one definition of wired, and the migration's steps 2 and 3 call it rather than restating it. An import is a line whose whole content is `@AGENTS.md` or `@./AGENTS.md`, outside a fenced code block. When a `CLAUDE.md` or `.claude/CLAUDE.md` exists and neither carries an import (nor is a symlink to `AGENTS.md`), it reports `unwired`: Claude reads those files only, so the framework rules never reach it. The import has to sit in one of those two project files, because an import in one person's `CLAUDE.local.md` leaves every teammate unwired. `doctor` fails on the row, as it does for unwired hooks. When the only hiding file is `CLAUDE.local.md` and it lacks the import, the row is a warning. `init` prints the finding and edits nothing.

### Unit 6 — docs

`docs/noldor/agent-runtimes.md`, `docs/noldor/adoption-guide.md`, `docs/noldor/README.md` and `docs/noldor/rules.md` change together with their `templates/` twins: one rules file, the region, and the import rule for a repo that keeps a `CLAUDE.md`.

## Acceptance criteria

1. `noldor init` in a repo with no `AGENTS.md`, for any `--agents` set including the default, writes `AGENTS.md` with the managed region and writes neither `CLAUDE.md` nor `.claude/noldor.md`.
2. `noldor init` in a repo whose `AGENTS.md` has no region exits 0, appends the region, and leaves every pre-existing byte in place.
3. When the region differs from the template, `noldor init` exits 1 naming `AGENTS.md`, and `noldor init --update` replaces the region only; content outside it is byte-identical before and after.
4. `noldor doctor` and `checks template-sync` report `AGENTS.md` only when its region is absent or differs; edits outside the region never produce a row.
5. `noldor upgrade` on a tree anchored at `1.12.0` with a vendored `.claude/noldor.md` and a `.claude/CLAUDE.md` lacking the import removes the former, adds `@AGENTS.md` to the latter, and leaves `AGENTS.md` carrying the region. `--dry-run` lists the same steps and writes nothing; a second run lists none.
6. The migration leaves a modified `.claude/noldor.md` on disk and reports it.
7. After the vendored `.claude/noldor.md` is removed, its imports leave exactly one `@AGENTS.md` across the two CLAUDE files; a kept modified copy keeps its import.
8. `noldor upgrade` resolves the chain from any anchor in `1.0.0`–`1.12.x` without a gap error; an anchor below the earliest registered migration's `from` still errors.
9. In a claude-targeted repo, `noldor doctor` exits 1 when a `CLAUDE.md` or `.claude/CLAUDE.md` exists and neither imports `@AGENTS.md`, and passes that row when one does or when neither exists. A `CLAUDE.local.md`-only case warns without affecting the exit code. `noldor init` prints the finding, exits as it otherwise would, and edits nothing.
10. In this repo, `.claude/noldor.md` and `templates/.claude/noldor.md` are gone, the two `AGENTS.md` regions are identical, and `pnpm noldor doctor` passes.
11. `CAPABILITIES.claude.rulesFile` is `'AGENTS.md'`.
12. `pnpm noldor docs capability-index` passes after a region sync.

## Risks / trade-offs

- **Old or limited Claude Code sessions.** Before v2.1.277, in the first session after upgrading from v2.1.276 or earlier, and before v2.1.281 on Bedrock or with telemetry off, Claude reads CLAUDE files only. A consumer with no `CLAUDE.md` then gets no rules in those sessions. The remedy is a one-line `CLAUDE.md` holding `@AGENTS.md`, which the wiring check counts as wired. Accepted over scaffolding that stub everywhere (Non-goals keep a fresh repo at one file).
- **Hiding files `doctor` cannot see.** A `CLAUDE.md` in a directory above the repo also hides `AGENTS.md`. The check reads the repo root only.
- **`CLAUDE.local.md` warns instead of failing.** It is one person's uncommitted file and absent in CI, so failing on it would red only that person's local runs; the warning names the fix.
- **Editing a consumer's `CLAUDE.md`.** The migration adds one line. It is idempotent, shown by `--dry-run`, and `upgrade` refuses a dirty tree.
- **Worktree sessions load two `AGENTS.md` files** — the worktree's and the main checkout's, one directory up. This already happens in this repo today and is unchanged.
- **Region-level sync is new machinery** in a path every `init`, `doctor` and pre-commit run takes. It is limited to paths in `REGION_MANAGED_TEMPLATES`; every other template keeps whole-file semantics.

## User Story

As an adopter (human or agent) setting up Noldor in a repo, I want the framework to put its rules in the one `AGENTS.md` that Claude Code, Codex and opencode all read — without overwriting the `AGENTS.md` or `CLAUDE.md` I already have — so that every agent gets the same rules from one place and there is no second copy to drift.

## Usage

- Fresh repo: `pnpm noldor init` writes `AGENTS.md`. Put project rules outside the `noldor:rules` markers; everything between them is re-synced by `init --update`.
- Existing consumer: `pnpm noldor upgrade --dry-run`, then `pnpm noldor upgrade`, then `pnpm noldor init --update`, then `pnpm noldor doctor`.
- A repo that keeps a `CLAUDE.md` keeps it; its first line imports `@AGENTS.md` (the migration adds it, `doctor` checks it).

## Open questions (resolved)

1. *What happens to `.claude/skills/**`?* -> They stay where they are. They are Claude's native surface with no `AGENTS.md` equivalent; `AGENTS.md` names the skill for each flow. (D1)
2. *Does the migration rewrite an existing `CLAUDE.md` or leave it?* -> It adds one `@AGENTS.md` line and changes nothing else. Leaving it untouched would keep Claude from ever reading `AGENTS.md`; folding it in would move consumer-owned content. (D2)
3. *Import the engineering rules and route table, or point to them?* -> Point to them in prose. Imports cost about 10k tokens per session, codex and opencode cannot follow them, and they never ran. (D3)
4. *Fix the chain gap here or carve it out?* -> Fix it here. This is the first migration since `1.0.0`, so it is the one that makes the gap reachable. (D4)
5. *Should a fresh repo get a `CLAUDE.md` stub holding `@AGENTS.md`?* -> No. The entry asks for no `CLAUDE.md`, and Claude Code's own guidance is to remove a `CLAUDE.md` that holds nothing but the import. (D5)
6. *Where does `init` put the region in an existing `AGENTS.md`?* -> At the end, so the consumer's title and opening stay first. (D6)
7. *Should the wiring check block?* -> Yes for committed CLAUDE files, since the fix is always harmless; a warning for `CLAUDE.local.md`, which is one person's file. (D7)
