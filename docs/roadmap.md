# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `deps:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).
>
> Section order = execution phases from the 2026-07-02 queue verification. Retired that day: `fd-complexity-tier-field` (shipped as `noldor-tier`), `runtime-architecture-invariant-expansion` + `dashboard-reference-api-subtree` (Charuy-only premises), `dispatch-next-priority-via-agent-window` (covered by `noldor autonomous run --max-features 1` + `/gate` Step 0 priority pickup). `prefix-skills-with-noldor` re-sized S→L and parked in backlog.

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

#### Real Consumer #2 Adoption Dogfood

- id: Q-0001
- area: tooling
- type: chore
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Both existing consumers are degenerate cases: Charuy is the origin monorepo Noldor was extracted from, and self-host is the framework itself. Neither exercises the adoption path the way a foreign repo would. Adopt Noldor into one real, structurally different project (single-package repo, different domain, ideally an existing repo of the operator's with live development) and drive real work through it. Template-layer blockers cleared by PR #119 (portable gate CLIs `features phase-flip-done` / `phase-revert` / `roadmap remove-block`, config scaffold, tolerant postinstall) — the documented path is now plausible end-to-end.

**What to do:**

- Pick the repo: criteria — actively developed, single package (not a monorepo, to stress the `lockstepPackages: [one]` shape), TS or close enough that stack assumptions hold (this dogfood validates the *adoption flow*, not yet stack-portability — that's `stack-assumption-audit-and-declared-prerequisites`).
- Run the documented path verbatim: install (registry if `registry-distribution-for-the-noldor-package` has shipped, `file:` otherwise), `pnpm noldor init --adopt`, fill `.noldor/config.json` `consumer:` block, `pnpm noldor doctor`. Every deviation from the adoption guide goes in the friction log — do not silently fix and move on.
- Drive ≥3 changes through the full lifecycle: one micro-chore, one fast-track, one specs-only or full feature with FD + spec. At least one of them via the autonomous drain (`noldor autonomous run --source roadmap`) end-to-end to PR merge.
- Maintain `friction.md` in the consumer repo during the run: every prompt that confused, every command that assumed Charuy/self-host context, every hard-coded path, every doc that lied. Date + exact error text.
- Close-out: `/triage` the friction log into Noldor's `ideas.md` → roadmap; fix the adoption-guide lies immediately (micro-chore class).

**What it enables:** ground-truth adoption backlog instead of speculation — this entry *generates* the precise work items for the rest of the adoption block; validates the guide line-by-line; produces the first consumer whose breakage matters for contract-CI fixture design.

**Open questions:** which repo (operator decision); whether the consumer keeps Noldor after the experiment or rolls back (rollback procedure is itself an undocumented gap — note it in the friction log).

**Acceptance sketch:** friction log exists with ≥10 dated entries; ≥3 changes shipped in consumer incl. ≥1 autonomous drain ship; ≥5 entries triaged back into Noldor's queue.

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

#### First-Class `blocked-by` Field

- id: Q-0002
- area: tooling
- type: refactor
- since: 2026-05-22
- size: S
- impact: med
- deps: stable-entry-ids-for-roadmap-backlog
- parent: noldor

`docs/noldor/triage.md:64` describes a `deps:` bullet (comma-separated kebab slugs) that `src/triage/score.ts` reads for dependency-weight scoring, but the field is silently optional in v1, undocumented in both `docs/roadmap.md` and `docs/backlog.md` preambles, and nearly unused across current entries. Promote it to a first-class `blocked-by:` field — name matches GitHub-issue + Jira convention and reads better in prose than `deps`. Document it in both file preambles, surface it on the dashboard as a dependency graph view, validate that each referenced ID exists, and have `/garden` flag circular chains. Accept `deps:` ↔ `blocked-by:` as aliases during a migration window, then deprecate `deps:`. Blocked by Stable Entry IDs — `blocked-by:` references should target stable IDs, not rename-fragile slugs. Work lands in the roadmap/backlog preambles, the triage skill, `src/triage/validate-triage.ts`, a new circular-blocked-by garden detector, and `docs/noldor/triage.md`.

### Trigger-Parked (revisit when the named trigger fires)

#### SDD Detector 5 — Idea-Merge Semantic Similarity

- id: Q-0003
- area: tooling
- type: feat
- since: 2026-05-07
- size: M
- impact: med

Standalone graphify enhancement (not in the substrate family). When `/triage` proposes targets for ideas in `ideas.md`, compute semantic similarity between idea text and existing FD names + community labels via graphify; surface top-3 `merge:<slug>` candidates ranked by similarity. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). Trigger: when next batch of ideas accumulates and triage feels noisy.

- Strengthen merge-first behavior — `/triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).
- When checking an FD, also scan backlog for other candidates for the same FD → suggest a new FD with higher confidence so it stays useful later too.

#### Noldor Section-Age Staleness Detector

- id: Q-0004
- area: tooling
- type: feat
- since: 2026-05-08
- size: M
- impact: low
- parent: noldor

Was originally Detector 14 in the Noldor extraction spec (`docs/superpowers/specs/2026-05-08-noldor-framework-extraction-design.md`); deferred during review because the value depends on actual drift accumulating, and the section-boundary detection is fiddly (header renames break the heuristic). Trigger: revisit if Detectors 14 (stub regrowth) + 15 (rule contradiction) prove insufficient — i.e. if framework drift slips past both gates and shows up as user-reported confusion or `/garden` blind spots. Implementation sketch: parse CLAUDE.md / README headers, run `git log -L /^## <Section>/,/^## /` per section, compare last-touched dates between CLAUDE.md side and `noldor/<page>.md` side, flag >30 day gaps in either direction.

#### Real-Codex Integration Smoke Test

- id: Q-0005
- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`src/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of the codex lane validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm noldor cr codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

#### Path Rename: docs/superpowers to docs/design

- id: Q-0006
- area: tooling
- type: refactor
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor
- recovered: 2026-06-11

Separable last step split out of `de-superpowers-vendor-spec-plan-and-worktree-flows` at its promotion: rename `docs/superpowers/` → `docs/design/{specs,plans}`. `src/core/doc-roots.ts:30-31` is the single code seam; everything else is prose/links. Ship as a migration (via the shipped `noldor upgrade` chain) that moves files and rewrites links; keep a transition alias in doc-roots for one release. Trigger: bundle with the next migration-bearing release rather than shipping alone — the rename is cheap but touches every spec/plan link, so ride a release that already asks consumers to run `noldor upgrade`.

- Still using the superpowers worktree path → move specs/plan out of the `superpowers/` folder as part of this rename.
