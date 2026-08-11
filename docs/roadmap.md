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

### Reviewer-Lane Dispatch Timeout Configurable

- id: Q-0088
- area: tooling
- type: fix
- since: 2026-08-11
- size: S
- impact: high
- confidence: high
- parent: specs-cr-gate-multi-reviewer

`subagent-dispatch.ts` hard-codes `timeoutMs: 600_000`, and a med-effort full-spec review that follows the verify-before-flag protocol (running typecheck and tests) can exceed 10 minutes — three consecutive `exit -1 (timeout)` failures in one session, each burning the full window and writing a synthetic red sink. Make the timeout configurable (`crReview.dispatchTimeoutMs`) and/or retry once with backoff; consider telling the reviewer prompt to skip long commands when the artifact is markdown-only. (surfaced shipping charuy agent-skill-bundle, charuy PR #91)

### Codex Lane Headless Dispatch Breakage

- id: Q-0089
- area: tooling
- type: fix
- since: 2026-08-11
- size: M
- impact: high
- confidence: high
- parent: specs-cr-gate-multi-reviewer

The codex CR lane is broken against codex-cli 0.133.0 in three distinct ways: (a) the `--base-sha` path errors and the fallback still exits 1; (b) passing the prompt as positional argv makes codex print `Reading additional input from stdin...` and hang or dump a 478KB models-cache error in headless runs — the prompt must go via stdin (`codex exec - <<EOF`); (c) expired ChatGPT auth surfaces as a bare exit 1 in the sink with no hint. Fix: stdin dispatch, an auth preflight that writes a clear `codex login` message into the sink, and a version probe of the installed CLI. This is the first real-codex run predicted by Q-0005, whose whole premise was that mocked lane tests cannot catch CLI drift. (surfaced shipping charuy agent-skill-bundle, charuy PR #91)

### Release Preflight Aggregate

- id: Q-0068
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: high
- confidence: med
- parent: release-sweep-process-hardening

Release prep aborts one gate at a time — stale `.noldor/session.json`, then stale graph, then stale garden receipt, then stale `docs/sdd-report.md` — and each abort costs a full re-run to discover the next one. Add a `release --preflight` first-rung aggregate that reports every failing gate at once and offers auto-remediation. (surfaced open-source publish, PRs #230-#237)

- probe npm name availability + moderation early, before tagging: npm new-package moderation blocks unscoped names too similar to popular packages (unscoped `noldor` was rejected as "too similar to `color`", forcing `@david.zoufaly/noldor`), so `noldor doctor` / preflight must check rather than let init and the docs promise a name nobody verified.

### Diff-Scoped Clone Gate

- id: Q-0066
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: high
- confidence: med
- parent: code-clone-detector

`clones check` gates on whole-corpus `clones.thresholdPct`, which is unusable for consumers: the percentage drifts as the repo grows, nobody tunes it, so it stays unset and the check is permanently green. Add `noldor clones check --against <base-sha>` — fail only on clone groups with at least one instance inside the diff and at least one outside it, reporting the duplicated span (`src/foo.ts:12-40`). Diff-scoping needs zero tuning and is safe to default-on in `templates/lefthook.yml` pre-push.

- clone-duplication ratchet as an alternative or complement: record a baseline in `.noldor/clones-baseline.json` and fail only on an increase, so consumers adopt the gate with no tuning and the number can only go down.

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
