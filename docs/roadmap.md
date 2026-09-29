# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

File order tracks the **`pnpm noldor triage score`** ranking, not the raw `impact:` label. `effort` divides in that formula, so a cheap low-impact entry can outrank an expensive high-impact one — `XS/low/med` scores 150 against `M/med/med`'s 75. The score guides the insert position rather than enforcing it (nothing in `validate:triage` checks order, and the operator may override), so read a file-order question against the score before calling it an inversion. Weights, formula and range are documented once in [triage.md → Scoring rubric](noldor/triage.md#scoring-rubric); the implementation is [`scoreEntry()`](../src/triage/score.ts).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict` or the refs-only `--strict-refs`) while `/noldor-garden` flags circular chains. Retired entries stay resolvable: promotion carries `- id:` into the FD's `entry-id:`, and the no-FD paths (fast-track, attach) forward it via `.noldor/retired-entry-ids.json`, maintained by `roadmap remove-block`. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Release Pipeline Stamps Template Twins

- id: Q-0324
- area: tooling
- type: fix
- since: 2026-09-29
- size: S
- impact: high
- confidence: high

The release pipeline blocks itself on a new templated Noldor page. `fillAllNoldorMarkers` (called from `src/release/index.ts`) stamps `introduced:` only on `docs/noldor/*.md`, leaving the `templates/docs/noldor/*.md` twin behind, so `check-template-sync` rejects the release commit. Syncing the twin by hand then trips the release-surface guard on `--resume` (`RELEASE_SURFACE_PREFIXES` covers only `docs/features/` and `docs/noldor/`). v1.14.0 got past it with PR #648, which stamped both copies up front. Fix: stamp the twin in the same pass and add `templates/docs/noldor/` to the release surface.

### Render-Compare Checks the Canvas on Disk

- id: Q-0325
- area: tooling
- type: fix
- since: 2026-09-29
- size: S
- impact: high
- confidence: high
- parent: ui-design-review-lane

`render-compare`'s exporter child has the wrong-document hole the geometry reader had: pencil `execute({filePath})` answers from the editor's active canvas, so with the bridge on another `.pen` it exports a page from the wrong design and the pixel diff runs against it. The geometry fix checks the child's selected page id and `FINAL:` candidates against the `topLevelPages` of the `.pen` on disk; give render-export the same check in the shared `pen-dispatch.ts`. (Q-0180 verifier lane)

### Next-Priority Holds In-Progress Blockers

- id: Q-0326
- area: tooling
- type: fix
- since: 2026-09-29
- size: XS
- impact: med
- confidence: high

`next-priority`'s `findBlocked` treats a blocker as met the moment it leaves the queue. Promoting Q-0320 to an in-progress FD made Q-0321 (`blocked-by: Q-0320`) pickable again, although `resolveIsShipped` says in-progress is not shipped, so an XS/S drain can pick a dependent before its blocker ships. Fix: hold back an entry whose ref resolves to an FD that is not `phase: done`.

### Promote Does Not Retire the Entry Id

- id: Q-0327
- area: tooling
- type: fix
- since: 2026-09-29
- size: S
- impact: med
- confidence: high

`roadmap remove-block` on a promote scaffold records the entry ID in `.noldor/retired-entry-ids.json`, and `resolveIsShipped` reads a retired ID as shipped, so a `blocked-by:` dependent looks unblocked while the new FD is only in progress. `/noldor-promote` step 7 says "remove the block" without naming a command, and the CLI is the natural reach. Fix: promote names the command and a `--promoted` flag skips the record (the FD's `entry-id:` already carries the ID), or `remove-block` skips it when an FD with that `entry-id` exists.

### Test-Links Sync Restages the FD

- id: Q-0328
- area: tooling
- type: fix
- since: 2026-09-29
- size: S
- impact: med
- confidence: high

The pre-commit `test-links` sync writes an FD's `links.tests` when a commit adds a test file, but the FD was not staged, so `stage_fixed` does not re-stage it: every new test file leaves the FD dirty for the next commit to carry. Stage the FDs the sync rewrote in the same commit.

### Drain Prompt Points at Drain Mode

- id: Q-0329
- area: tooling
- type: refactor
- since: 2026-09-29
- size: S
- impact: med
- confidence: high
- parent: gate-skill-loads-only-the-branch-a-session-takes

The prose-runner drain prompt drifts from `docs/noldor/drain-mode.md`: `src/autonomous/gate-prompt.ts` tells codex/opencode children to force-recreate the branch unconditionally (the page runs `autonomous branch-state` first), and its CR command omits `--base-sha origin/main`, which the page calls mandatory on the first pass. Q-0320 made the page the only drain contract, so the prompt should shrink to a pointer at it.

### Blockers Md onBlockers Default Prose

- id: Q-0330
- area: tooling
- type: docs
- since: 2026-09-29
- size: XS
- impact: low
- confidence: high
- parent: gate-skill-loads-only-the-branch-a-session-takes

`.claude/skills/noldor-gate/blockers.md` still says the auto-fix seam is off unless `autonomous.onBlockers: 'auto-fix'` ("default `prompt`"), but an unset knob follows the session and reads as `auto-fix` in an autonomous one — `drain-mode.md` states it right. Q-0320 moved the sentence verbatim because the split changed no rule; correct it.
