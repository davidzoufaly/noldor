---
status: accepted
date: 2026-09-24
---

# The framework owns a region of a consumer-edited file, not the file

## Context

Noldor distributes files into consumer repos from `templates/`. `init` copies them, `init --update` re-syncs them, and `doctor` and the `checks template-sync` pre-commit job compare them byte for byte (`copyTemplate` in `src/templates/copy.ts`, `computeDrift` in `src/templates/diff.ts`). That whole-file model assumes the consumer never edits the file. A file the consumer does edit is declared scaffold-only in `SCAFFOLD_ONLY_TEMPLATES` (`src/templates/manifest.ts`) and never synced again.

`scaffold-one-agent-rules-file-not-two` (Q-0252) makes `AGENTS.md` the framework's one rules file for every runtime. `AGENTS.md` is also a cross-tool convention that a repo often already carries, and it is where a consumer's own project rules belong, because Claude Code, Codex and opencode all read it. Neither existing kind fits. A synced twin makes `init` refuse, and `init --update` overwrite, a repo's own `AGENTS.md`. A scaffold-only starter never receives framework updates. A thin `AGENTS.md` pointing at a framework-owned file was also weighed and set aside: codex and opencode cannot expand an `@` import, so for them the rules would sit one hop away behind a sentence.

## Structural context

The decision lands in community c17 — `src/templates/manifest.ts`, `src/templates/copy.ts`, `src/cli/commands/init.ts` and `src/checks/check-template-sync.ts` — and reaches `src/cli/commands/doctor.ts` (c90) through its existing imports of the manifest and the agent filter. It defines no god node and adds no cross-community edge. `src/docs/capability-index.ts` already maintains a marker block inside `AGENTS.md`, so editing a region inside a distributed file is not new; synchronising by region is.

## Decision

When noldor must keep content current inside a file that a consumer is also expected to edit, the framework owns a marker-delimited region of that file and nothing outside it. The sync path — `init`, `init --update`, `doctor` and `checks template-sync` — writes the whole template only when the file is absent. Otherwise it appends the region when it is missing and replaces it when it drifts (under `--update`, as for any drifted twin), and drift is measured on the region alone. Nothing in that path rewrites, reorders or removes consumer content outside the markers, and a file whose markers do not pair is refused rather than guessed at. Such paths are declared in `REGION_MANAGED_TEMPLATES`; every other template keeps whole-file semantics.

One-time codemods in `noldor upgrade` remain the separate, explicit channel for changing a consumer-owned file, and they show every change in `--dry-run` first.

## Consequences

Easier: noldor can be adopted into a repo that already has the file, and a consumer's own rules live in the one file every runtime reads. A later framework file with the same shape gets the treatment by declaration rather than by a new mechanism.

Harder: sync and drift detection gain a second mode in a path that every `init`, `doctor` and pre-commit run takes. A consumer who deletes or damages a marker gets a refusal to repair by hand.

Ruled out: shipping a file that consumers edit as a whole-file synced twin, and using a scaffold-only starter for content the framework must keep current. Also ruled out is the sync path touching consumer content outside a region; a change there goes through a migration the operator runs.
