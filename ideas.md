# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

- no `--help` guard on any `autonomous` subcommand (run/watch) — `--help` runs the real drain/daemon instead of printing usage; probes spawned 3 colliding drains on one slug [triaged 2026-06-12 → autonomous-subcommand-help-guard]
- drain has no startup sync-check: an un-pushed local-main-ahead-of-origin commit blocks the whole drain, but only after the gate already did the work — pre-flight origin/main == queue-source before spawning [triaged 2026-06-12 → drain-startup-reconciliation-of-a-prior-dead-run]
- orphan gate child survives runner SIGTERM: parent (autonomous run) killed but `claude --print /gate` child keeps running + holds context; kill children as a process group + reconcile dead-run children at startup [triaged 2026-06-12 → drain-startup-reconciliation-of-a-prior-dead-run]
- no idempotency guard for already-mirrored local commits: a triage commit un-pushed locally got delivered twice (#76 + #77, identical) by a concurrent process — detect "this local commit already on origin under a different sha" before re-delivering [triaged 2026-06-12 → idempotent-drain-delivery-guard]
- daemon-style drain gets SIGTERM-reaped (exit 143) under harness run_in_background/managed-task lifecycle; needs nohup/detach or cron/systemd. Document the supported unattended launch path [triaged 2026-06-12 → unattended-drain-launch-path]
- /gate not runtime-portable: drain spawns prompt `/gate --drain <slug>` (claude slash-command); spawn layer is agent-agnostic (registry picks bin+argv for claude/codex/opencode) but codex (stdin, no slash-cmds) + opencode (no vendored /gate) can't honor it — need a portable `noldor gate` CLI entry or per-runtime gate vendoring [triaged 2026-06-12 → portable-gate-entrypoint-for-non-claude-runners]
- prefix skills "noldor:" [triaged 2026-06-12 → prefix-skills-with-noldor]
- when I should verify the input the framework needs to help localize the file / open the file [triaged 2026-06-12 → reduce-gate-flow-confirmation-friction]
- still used superpowers worktree -> remove specs plan to different folder [triaged 2026-06-12 → path-rename-docs-superpowers-to-docs-design]
- do not ask for commiting the plan -> commit autonomously [triaged 2026-06-12 → reduce-gate-flow-confirmation-friction]
- po vyběru cesty -> zbytečná otázka pro potvrzení [triaged 2026-06-12 → reduce-gate-flow-confirmation-friction]
- next priority -> be able o dispatch next priority via agent window [triaged 2026-06-12 → dispatch-next-priority-via-agent-window]
- when checking FD also consider checking backlog/if there might be other candidates for the same FD so it can suggest new FD with higher confidence so it will be usefull also later [triaged 2026-06-12 → sdd-detector-5-idea-merge-semantic-similarity]
- milestones to dashboard web [triaged 2026-06-12 → framework-milestones-support-poc-mvp-1-0-0]
- where are milestones documented? [triaged 2026-06-12 → framework-milestones-support-poc-mvp-1-0-0]
- is gate function properly documented [triaged 2026-06-12 → audit-gate-documentation]
- roadmap nové akce -> top and bottom [triaged 2026-06-12 → dashboard-roadmap-backlog-row-actions]
- add "remove" button from backlog and roadmap to action column rename it to "actions" [triaged 2026-06-12 → dashboard-roadmap-backlog-row-actions]

^^^^

- code reviewer 2.0 -> inspiration from MC Code Reviwer  [triaged 2026-06-12 → code-reviewer-2-0]
- in autonomous mode summary of PR is: Micro-chore: docs(roadmap): retire dashboard-auto-start-on-project-load — shipped via fast-track (no FD) [triaged 2026-06-12 → fast-track-pr-summary-mislabels-as-micro-chore]

but its not micro-chore but gate is fast track

- code reviewer configuration for fast-track [triaged 2026-06-12 → code-reviewer-2-0]

release hardening (found shipping v0.2.0, 2026-06-01):
- codex CR gate unsatisfiable — 18 commits since v0.1.0 lack codex receipts; release needs RELEASE_SKIP_CR_GATE=1 until codex CR operationalized or pre-v0.1.0 grandfathered [triaged 2026-06-12 → bootstrap-immunity-for-self-gating-features]
- graphify writes cache to src/graphify-out/ when scanned on src -> breaks fmt:check every run (had to mv to /tmp 3x); make it write under graphify-out/ or exclude from fmt [triaged 2026-06-12 → graphify-out-breaks-fmt-check]
- GARDEN_SRC_PATHS = apps/packages/scripts/ (not src/) -> garden-receipt freshness doesn't track this repo's source; mirror scanPaths [triaged 2026-06-12 → graph-freshness-scanpaths-drift-in-standalone-repo]
- every src-touching fast-track re-stales the graph (scanPaths=src) -> forces a graph-refresh sweep before each release; consider auto-regen in release or relax freshness for test-only diffs [triaged 2026-06-12 → graph-freshness-scanpaths-drift-in-standalone-repo]
- pnpm toon script omits required graph.json arg (bare `pnpm toon` fails; src/garden/graph-fd-lookup.ts tells users to run it) [triaged 2026-06-12 → pnpm-toon-omits-required-graph-json-arg]
- README Status section stale -> claims pre-extract, lives in Charuy monorepo; we're standalone now [triaged 2026-06-12 → readme-status-section-stale]
- graphify-out/graph.html oxfmt churn ~41k lines/sweep -> gitignore graph.html or exclude from fmt [triaged 2026-06-12 → graphify-out-breaks-fmt-check]
- .noldor/release-pushes.log not gitignored (operator-local release audit, like garden-receipt) [triaged 2026-06-12 → gitignore-noldor-release-pushes-log]
- sdd-report review-skip count non-idempotent: bumps per fast-track commit, re-fires release gate once (roadmap: skip-if-only-count-line-changed) [triaged 2026-06-12 → sdd-report-review-skip-count-non-idempotent]

^^^


#### Next

- still does it make sense to introduce SQL into a framework? [triaged 2026-06-12 → does-sql-in-a-framework-make-sense]
- CLI standalone tool [triaged 2026-06-12 → cli-standalone-tool]

#### Later

### Core Product

#### Now


#### Next


#### Later
