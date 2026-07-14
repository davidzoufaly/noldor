# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).
>
> Section order = execution phases from the 2026-07-02 queue verification. Retired that day: `fd-complexity-tier-field` (shipped as `noldor-tier`), `runtime-architecture-invariant-expansion` + `dashboard-reference-api-subtree` (Charuy-only premises), `dispatch-next-priority-via-agent-window` (covered by `noldor autonomous run --max-features 1` + `/noldor-gate` Step 0 priority pickup). `prefix-skills-with-noldor` re-sized S→L and parked in backlog.

### State-File Fail-Open Hardening

- id: Q-0040
- area: tooling
- type: fix
- since: 2026-07-13
- size: M
- impact: critical
- confidence: high
- parent: noldor

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): state-file handling consistently fails *open* — corruption or a torn write silently resets toward permissive. Confirmed: crash-path `releaseLock` deletes a drain lock it doesn't own (two concurrent drains possible); corrupt rollout-marker lets every commit pass unchecked; torn `session.json` makes the pre-edit-guard exit 1 instead of 2 (gate silently bypassed); torn `watch-state.json` resets the daily cap + trip rail; torn `drain-park.json` unparks all known-failing entries. Root cause shared: plain `writeFileSync` + parse-error → permissive default, while `atomicWriteFile` and the O_EXCL lock primitive already exist but callers bypass them. Fix: ownership check in `releaseLock`, route state writers through `atomicWriteFile`, make enforcement-file corruption loud and fail toward enforcement, and bind the dashboard to 127.0.0.1 (today 0.0.0.0 no-auth composes with `bypassPermissions` drain agents into a LAN roadmap-inject → RCE chain).

### Consumer-Hygiene Batch

- id: Q-0041
- area: tooling
- type: fix
- since: 2026-07-13
- size: S
- impact: high
- confidence: high
- parent: noldor

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): self-host masks consumer breakage — everything works in the noldor repo, nobody validates the cold-consumer tree. Three confirmed-broken-live items, all cheap, one PR: (1) strip/redirect the 4 template doc links pointing at `../superpowers/specs/...` files that exist only in the noldor repo (confirmed broken in ps-offsite); (2) ship a `.claude/settings.json` template so consumers get the pre-edit-guard PreToolUse hook (today wired only in self-host — no consumer has live edit gating on any runner); (3) make the codex CR lane fall back to `AGENTS.md` when `.claude/engineering-rules.md` is absent (today silently degraded review on a codex-only tree).

### Validate Script-Catalog Gate

- id: Q-0042
- area: tooling
- type: fix
- since: 2026-07-13
- size: M
- impact: high
- confidence: high
- parent: noldor

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): gated docs stay true, ungated docs rot — `validate skill-catalog` keeps the skill catalog perfectly 1:1, while `docs/noldor/script-catalog.md` (self-declared canonical) is missing ~20 live subcommands and its promised `validate:script-catalog` gate was never implemented (the page falsely claims a backlog entry exists). Ship the `validate:script-catalog` pre-commit gate mirroring the skill-catalog one, do the one-time catch-up of the missing subcommands, fix the template twin, and resolve the detector-count contradiction (script-catalog says 19, garden-and-drift says 20, code has more).

- Consider an `fd-command-rot` garden detector alongside: done-FDs currently document 4 phantom CLI commands (`pnpm docs:build` among them) and nothing checks FD-documented commands still exist.

### README Rewrite — Consumer-Journey Order

- id: Q-0043
- area: tooling
- type: docs
- since: 2026-07-13
- size: M
- impact: med
- confidence: high
- parent: noldor

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`, `readme-quality.findings.md` has the proposed outline): README is not wrong post-PR#126 but covers only 5 of 34 CLI command groups, omits gate/drain/upgrade/`init --adopt`, never links the adoption guide, and enumerates a stale config field set. Rewrite in consumer-journey order (install from GH Packages → init/adopt → gate workflow → dashboard → drain → upgrade), link the adoption guide instead of duplicating it, stop enumerating config fields. Same pass: fix `docs/noldor/README.md` index staleness — it still calls the adoption guide a "stub — WIP" (it's a full 105-line guide with live consumers) and omits 4 existing pages (incl. agent-runtimes.md).

### Vendored Process Disciplines

Two process-discipline skills the deep-audit (batch `.noldor/research/2026-07-13-184850`) flagged as never vendored from the superpowers plugin: nothing in noldor references them, so they are not a dependency, but a consumer running `noldor init` without the plugin gets no equivalent discipline. Vendor both as first-class framework skills so the discipline ships with the framework instead of relying on a plugin being installed.

#### Vendored Verification-Before-Completion Discipline

- id: Q-0045
- area: tooling
- type: feat
- since: 2026-07-13
- size: S
- impact: med
- confidence: med
- parent: noldor

Vendor the `verification-before-completion` discipline as a framework skill (`noldor-verify` or baked into the gate ship/CR lane): before any "done / fixed / passing" claim, require running the verification command and confirming its output — evidence before assertions. Distinct from the existing acceptance-verify CR lane (PR #74, which verifies acceptance criteria) and `pnpm verify` (the aggregate check command): this is the *behavioral discipline* that gates completion claims, not a specific check. Decide the shape at spec time — standalone skill vs a mandatory step folded into the gate ship path — but the deliverable is that a consumer without superpowers still gets the "no unverified success claims" rule.

#### Vendored Systematic-Debugging Discipline

- id: Q-0044
- area: tooling
- type: feat
- since: 2026-07-13
- size: M
- impact: med
- confidence: med
- parent: noldor

Vendor the `systematic-debugging` discipline as a framework skill (`noldor-debug`): the disciplined loop — reproduce → minimise → hypothesise → instrument → fix → regression-test — invoked before proposing fixes for any bug, test failure, or unexpected behaviour. Today noldor has no debugging-discipline skill at all; consumers fall back to ad-hoc debugging. Author it in the vendored-skill style (self-contained SKILL.md, no plugin reference), register it in the skill-catalog (gated by `validate skill-catalog`), and reference it from the gate fast-track/fix paths so it's surfaced when a change is a bug fix.

### Non-Claude Runner Parity Follow-Ups

- id: Q-0025
- area: tooling
- type: feat
- since: 2026-07-07
- size: M
- impact: low
- parent: noldor
- confidence: med

Three deferred pieces from the make-noldor-agent-agnostic decision (PR #71, three peer runtimes: Claude Code / Codex / opencode): (a) deep skill parity for non-Claude implementers; (b) opencode `--format json` event parsing (today reserved, treated as prose v1); (c) `crLanes` → role-ref vocabulary migration. Elective — pick up only when a non-Claude implementer runtime is actually exercised end-to-end.

- Deep-audit 2026-07-13 (batch `.noldor/research/2026-07-13-184850`): headless parity is real (spawn/drain/CR/research three-runner via the registry), but interactive surface is 13 Claude skill shims vs 2 opencode vs 0 codex, and docs don't state the asymmetry. Decide the runner story honestly — either ship opencode/codex command shims for the 11 remaining skills, or scope the "three first-class peers" claim to headless in `agent-runtimes.md` (which is also missing from the docs index).

### Dashboard UI Polish (from ideas.md 2026-07-14)

Five operator-facing dashboard refinements captured from a live dogfood pass. All are self-host `src/dashboard/` tweaks with design decisions already settled with the operator (recorded per entry). Item 1 + the action-column item are one surface (roadmap/backlog table chrome) so they ride one entry.

#### Operator Spec/Plan Links on Feature Pages

- id: Q-0049
- area: tooling
- type: feat
- since: 2026-07-14
- size: S
- impact: med
- confidence: med
- parent: noldor

When running semi-autonomously (operator reviewing, not fully headless) the operator wants to open the written spec/plan for a feature to check the outcome against the artifact. The feature detail page (`renderFeatureDetail`) shows the frontmatter table + rendered FD body but no prominent link to the feature's spec/plan under `docs/superpowers/{specs,plans}/`. Surface clickable **Spec** / **Plan** links near the top of the feature detail page (resolve the artifact paths for the FD via the git-discovered paths the pr-flow already computes, or the `<date>-<slug>-design.md` / plan naming convention), rendering an em-dash / nothing when an artifact was never written (fast-track / specs-only features). Optional: a small spec/plan indicator column on the `/features` grid. Touches: `src/dashboard/views.ts` (`renderFeatureDetail`, optionally `renderFeatures`), `src/dashboard/data.ts` (resolve spec/plan paths for a `FeatureDetail`).

### Phase 2 — Enforcement Honesty

### Phase 3 — Adoption Chain

### Phase 4 — Consumer-Layout Correctness

### Phase 5 — Autonomy Observability

### Phase 6 — Structural

### Promoted from Backlog

### Framework Self-Ownership

### Drain Batch — Backlog Hardening (moved from backlog 2026-07-11)

### Trigger-Parked (revisit when the named trigger fires)

#### Graph-Freshness / Fmt-Collision Follow-Ups

- id: Q-0011
- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med
- parent: noldor

Residual design follow-ups from the v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json` vs fmt lefthook erroring on an all-ignored file set; immediate fix PR #114, broader all-ignored no-op guard shipped as `noldor fmt` in PR #184). Trigger: pick up only if the fmt/graph gate collision class recurs despite the PR #184 guard.

- (b) have the release-sweep own the graph commit end-to-end so the two gates can't deadlock.
- (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step.

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
