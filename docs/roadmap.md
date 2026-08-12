# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

File order tracks the **`pnpm noldor triage score`** ranking, not the raw `impact:` label. `effort` divides in that formula, so a cheap low-impact entry can outrank an expensive high-impact one — `XS/low/med` scores 150 against `M/med/med`'s 75. The score guides the insert position rather than enforcing it (nothing in `validate:triage` checks order, and the operator may override), so read a file-order question against the score before calling it an inversion. Weights, formula and range are documented once in [triage.md → Scoring rubric](noldor/triage.md#scoring-rubric); the implementation is [`scoreEntry()`](../src/triage/score.ts).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Diff-Scoped Clone Gate Flags Mere Adjacency

- id: Q-0095
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: high
- confidence: high
- parent: code-clone-detector

`flaggedGroups` ([`src/clones/diff-scope.ts:187`](../src/clones/diff-scope.ts)) reds when **any single instance of a clone group overlaps a changed line at all**, so a three-line graze counts the same as writing the whole copy. Against the module's own stated intent ("did you just write a copy of something that already exists?") that is a false positive, and it fired three times in one session: a one-line `desc:` edit inside the `src/cli/manifest.ts` data table (Q-0094, which had to abandon the edit and ship `noldor help` stale); three added import lines landing inside an import block that matches `src/cr/lanes/verify.ts`; and the tail of a newly inserted function abutting the lane sink-path prologue in `src/cr/lanes/subagent.ts`. Registering a CLI subcommand necessarily edits the manifest table, so the gate blocks a whole class of legitimate change with no ignore knob and no per-finding override — the author-side-rule-injection PR had to push with `LEFTHOOK_EXCLUDE=noldor-clones`.

**The naive fix is wrong**: requiring ≥2 overlapping instances would break the primary case, since pasting an existing block into a new file changes exactly one instance. The predicate needs to be coverage-based — flag when changed lines cover a substantial fraction of some instance, so "I wrote this copy" fires and "my edit abuts a pre-existing clone" does not. Pick the threshold against the three recorded cases (37%, 25%, ~55% coverage) plus a real paste (100%). Worth considering alongside: an inline `// noldor:clone-ok <reason>` marker for the irreducible cases (data tables, import blocks), mirroring how `noldor:cut` waives minimalism findings.

### Spec-Lint Prior-Art Requirement

- id: Q-0067
- area: tooling
- type: feat
- since: 2026-08-05
- size: S
- impact: med
- confidence: med
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

`pnpm noldor design log --support` (Q-0053) already captures prior art into the design ledger, but nothing enforces that it was used — a spec whose ledger renders `Existing support (0) - (none recorded)` passes silently, which means the reuse question was never asked. Spec-lint should reject an approved spec with zero support anchors unless the operator records an explicit `--support "none: <reason>"`. The side benefit is that the CR `reuse` dimension gains a falsifiable claim to check against instead of reviewing in the dark.

### Doctor Ahead-Anchor Dead End

- id: Q-0082
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: med
- confidence: med
- parent: version-aware-upgrade-and-migration-chain

`doctor`'s framework-skew check compares the anchor by string `!==` (`src/cli/commands/doctor.ts:63`), so an anchor _ahead_ of the installed version prints `run 'noldor upgrade'` forever while `upgrade` correctly refuses to rewrite it backwards — an advisory dead end with no CLI exit, the same shape as Q-0076 in the opposite direction. Reachable after a downgrade (`pnpm add @david.zoufaly/noldor@<older>`) or a hand-edited anchor. Fix: compare with `semver.lt(anchored, installed)` and give the ahead case its own message (`anchored <a> is ahead of installed <i> — the install is behind, not the anchor`) rather than pointing at a command that cannot help. (surfaced in the code-stage CR of Q-0076, PR #270)

### Triaged-Bullet Archive Section

- id: Q-0090
- area: tooling
- type: feat
- since: 2026-08-11
- size: XS
- impact: low
- confidence: med

Triaged bullets should stay in `ideas.md` for traceability but drop out of the live phase sections into their own heading, so a `#### Later` scan shows only what is still raw instead of a mixed pile where every stamped bullet has to be skipped by eye. Have `/noldor-triage` relocate a bullet under a dedicated archive heading as it stamps `[triaged … → slug]`. Adjacent seam worth settling in the same pass: the `extractUntriagedBullets` JSDoc (`src/triage/triage-list-untriaged.ts`) already documents skipping `## Not groomed` as deliberate ("not triage material"), yet the 2026-08-11 batch triaged six bullets straight out of that section and had to scan it by hand — so practice contradicts the recorded decision. Reconcile the two in prose: either the section is a staging area `list-untriaged` should surface, or operators must park raw bullets under a phase heading instead. No parser change is implied by this entry; if the resolution turns out to need one, split it out.

### Prose Rules → Enforce Cascade Rules

- id: Q-0069
- area: tooling
- type: refactor
- since: 2026-08-05
- size: M
- impact: med
- confidence: med
- parent: rules-cascade-v1

The dimensions that are prose-only today sit buried in a 181-line baseline: error flow (result types, throw only for programmer errors, catch external at the boundary, never swallow) is at line 137 and is machine-unchecked. Migrate them into scoped rule files — `.noldor/rules/error-result-types.md` with `applies-to: ["src/**/*.ts"]`, `stage: [code]`, `enforce: true` — so the rule lands in the enforce bucket exactly on the files being edited rather than in a wall of text the author has to filter mentally. Same treatment for state discipline and concurrency.

### Mandatory Codex Review Round

- id: Q-0091
- area: tooling
- type: feat
- since: 2026-08-11
- size: S
- impact: med
- confidence: med
- blocked-by: Q-0089
- parent: specs-cr-gate-multi-reviewer

The codex lane is opt-in per `crLanes` today, so a big change can ship having been reviewed by exactly one model family. Require at least one codex round on bigger tasks — gate it on the same `size:` signal the routing policy already uses (L/XL, or the split-check verdict) rather than on operator memory. Blocked until the codex lane actually works headlessly again.
