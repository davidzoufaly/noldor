# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Noldor Framework

#### Make Noldor Agent-Agnostic

- area: tooling
- type: refactor
- since: 2026-05-10
- size: XL
- impact: med
- parent: noldor

Noldor today assumes Claude Code as the operating agent (skill names, hook patterns, transcript layout). Lift the assumptions so Codex, Gemini, or other agents can drive the same framework with equivalent gates. Concrete asks: (1) abstract skill invocation (`Skill` tool vs `activate_skill` vs raw markdown read), (2) abstract hook triggers (the `lefthook` pre-commit chain works for all, but the auto-gate behavior is Claude-only), (3) document the agent-equivalence matrix in `docs/noldor/`. Trigger: when a second agent adopts Noldor in earnest (today's automated-cr-pipeline already runs Codex as a reviewer; controller is still Claude).

- triage 2026-05-11: strategic but premature pre-1.0. Impact rated med (not high) because external agent adoption is not yet a live constraint.

#### Continuous Drain Daemon and Escalation Inbox

- area: tooling
- type: feat
- since: 2026-06-11
- size: XL
- impact: high
- deps: agent-events-log-and-agents-dashboard-page, acceptance-verify-lane
- parent: noldor

Every autonomous stage is one-shot and operator-fired: someone types `noldor autonomous run`, watches (or returns later), handles failures by reading logs, salvages stale bases by hand from a memory recipe. The vision sentence — agents ship unsupervised — currently means "unsupervised per invocation". Make autonomy *continuous*: a long-running (or cron-fired) mode that keeps draining the queue, repairs its own known failure modes, and escalates the rest to a structured inbox instead of dying or blocking.

**What to do:**

- `noldor autonomous watch` mode: wraps the existing drain loop (`src/autonomous/drain-loop.ts`) in a scheduler — `--interval <min>` polling or long-lived daemon; each cycle: refresh main, re-read queue, run a bounded drain (`--max-features` per cycle), sleep. Reuses `drain.lock` semantics; a second watcher refuses to start.
- Auto-salvage: codify the stale-base recipe as code, not operator lore — detect on pickup: existing `fast/<slug>` branch whose base is behind main, or a closed-unmerged PR for the slug → rebuild worktree from fresh main, **re-apply** the change (not cherry-pick), retire stale branch + remote; emit `salvaged` event. The 2026-06-10/11 drain runs proved the recipe manually (PR #49→#55 case); this entry mechanizes it.
- Escalation inbox: when an item exhausts retries, hits a verify/CR blocking fail with `onFailure` not resolvable headlessly, or trips an unknown git state → write `.noldor/escalations.jsonl` (`{ ts, slug, reason, evidence, state-snapshot, suggested-action }`), mark the item parked (skip-list with reason), **continue with the next item** — park-and-continue replaces today's abort-or-prompt at the loop level. Dashboard inbox page (or `/agents` tab): open escalations with one-glance reason + evidence, operator resolves → unpark (`noldor autonomous unpark <slug>`).
- Notification: pluggable notify hook on escalation + cycle summary (shipped/parked counts) — shell command in consumer config (`autonomous.notifyCommand`), so Slack/push/mail is the consumer's one-liner, not framework scope.
- Safety rails, all consumer-config with conservative defaults: `maxFeaturesPerDay`, `maxConsecutiveFailures` (trip → pause whole watcher + escalate), wall-clock cap per item, `pause` switch (file-based `.noldor/drain.pause` honored mid-cycle), budget cap hook if token accounting exists by then. A paused or tripped watcher is loud — notify + dashboard banner, never silent.
- Run placement: local daemon first (operator's machine, simplest trust model); CI-cron variant documented as a follow-up once contract-CI exists (needs secrets + checkout strategy decisions).

**What it enables:** the vision claim made literal — queue drains continuously, operator's job collapses to feeding triage and clearing an inbox; combined with verify-lane + telemetry, "unsupervised" becomes defensible: continuously shipped, independently verified, measurably tracked.

**Open questions:** daemon vs cron-fired (lean: same code, `--once` flag makes cron trivial); interaction with release cadence (auto-release-candidate after N ships? — explicitly out of scope v1, release stays operator-fired); multi-repo watchers later (one per consumer, no coordination v1); how `watch` coexists with an operator working in the same repo (lock + pause conventions probably suffice — document).

**Touches:** `src/autonomous/` (watch loop, salvage module, escalations, unpark), `src/core/consumer-config.ts` (`autonomous.*` rails), `src/dashboard/` (inbox surface), `src/cli/manifest.ts`, `docs/noldor/cr-pipeline.md` + new `docs/noldor/autonomy.md`, `script-catalog.md`.

**Acceptance sketch:** seed queue with 3 entries incl. one engineered stale-base and one destined-to-fail → `noldor autonomous watch --interval 5 --max-features 1`: two ship across cycles (one via auto-salvage, `salvaged` event present), one lands in escalations with evidence and the watcher keeps running; `drain.pause` halts next cycle; notify hook fired on the escalation.

#### Outcome Telemetry and Effectiveness Metrics

- area: tooling
- type: feat
- since: 2026-06-11
- size: L
- impact: high
- deps: agent-events-log-and-agents-dashboard-page
- parent: noldor

The framework enforces process and never measures whether the process works. Every tuning decision (gate strictness, size-routing thresholds, CR lane composition, drain retry caps) is currently vibes. The raw data already exists — git trailers, FD frontmatter (`since` / `introduced` / `phase`), PR history, drain logs, and (once shipped) agent-events. Build the derivation layer.

**What to do:**

- Metric set v1, each derived reproducibly from repo history + `.noldor/` artifacts:
  - **Cycle time** — `since:` (roadmap intake) → `introduced:` (release) per FD; segmented by path (`Noldor-Path:` trailer) and by autonomous vs operator-driven.
  - **Size-routing accuracy** — `sizeToPath()` suggestion vs actual: diff stats + path taken per shipped entry; surfaces systematic over/under-sizing at triage.
  - **CR effectiveness** — findings per lane (from `.noldor/cr/` artifacts) vs post-merge corrective commits (`fix:` touching same FD within N days) and reverts; approximates catch-rate vs noise.
  - **Drain reliability** — per-run: shipped / skipped / retried / escalated / salvaged counts, retry distribution, mean time per feature (from agent-events).
  - **Override pressure** — trailer-override usage by detector over time (extends the existing override-audit data); rising overrides = a gate that fights the team.
  - **Token cost per feature** — if obtainable from agent transcripts/logs; explicitly optional v1, schema reserves the field.
- `noldor metrics compute` CLI: scans history, emits `metrics.json` (derive-on-demand; no persistent aggregate store in v1 — git is the store, computation is the cache).
- Dashboard `/metrics` page: headline cards (median cycle time, autonomous-ship share, drain success rate), per-path breakdown table, trend over releases. Reuses the `/agents` data plumbing.
- Release integration: `sdd-report.md` gains a metrics section per release cut, so every release answers "is the framework getting faster/safer or just heavier".
- Honesty rails: every metric documents its derivation + known blind spots in `docs/noldor/` (e.g. CR catch-rate is an approximation); no metric without a documented formula — this framework audits itself, the metrics must be auditable too.

**What it enables:** gate tuning with data (e.g. "fast-track reverts ≈ full-path reverts → loosen routing"); a testable version of the vision claim "agents ship production-quality changes unsupervised"; the adoption pitch for other projects becomes numbers ("N features, X% fully autonomous, median 2 days intake→release") instead of assertion.

**Open questions:** token-cost source (Claude Code transcript JSONL? drain could record usage per spawn into agent-events); how far back to backfill (pre-event-log history supports cycle-time + routing metrics only — fine, label it); metric stability across the consumer/self-host split (compute per-repo, never blended).

**Touches:** new `src/metrics/`, `src/cli/manifest.ts`, `src/dashboard/` (route + view), `src/garden/sdd-report` integration, `docs/noldor/` new page `metrics.md`, `script-catalog.md`.

**Acceptance sketch:** `noldor metrics compute` on this repo emits cycle-time for every `introduced:` FD + routing-accuracy table for the last 10 shipped entries; `/metrics` renders headline cards; sdd-report section appears at next release.

#### Multi-Runner Agent Runtime (Claude Code, Codex, opencode)

- area: tooling
- type: feat
- since: 2026-06-11
- size: L
- impact: high
- deps: de-superpowers-vendor-spec-plan-and-worktree-flows
- parent: noldor

Decision (2026-06-11): Noldor supports **three agent runtimes as simultaneous first-class peers — Claude Code, Codex, opencode**. Not a migration off Claude; a registry where every spawn site resolves a runner per role, and a consumer (or a single repo, per role) can mix all three. Codex already proves the seam works: `src/cr/run-codex.ts` spawns `codex exec --sandbox --output-schema` headless today — but only inside the CR lane; it graduates to a general runner. opencode brings the multi-provider layer (anthropic / openai / ollama / openrouter via `opencode.json`), so local models come free through it. Today the Claude CLI is hard-coded at five spawn sites with Claude-specific flags; Codex is welded into one lane.

**Flag mapping** (opencode verified against opencode.ai docs 2026-06-11; Codex column proven in-repo by `run-codex.ts`):

| Noldor need | Claude Code | Codex | opencode |
| --- | --- | --- | --- |
| headless spawn | `claude --print "<prompt>"` | `codex exec "<prompt>"` | `opencode run "<prompt>"` |
| auto-permissions | `--permission-mode bypassPermissions` | `--sandbox workspace-write` + never-ask approval policy (read-only sandbox for review roles) | `--dangerously-skip-permissions` (still respects explicit `deny`) or `permission: "allow"` |
| no-questions kill-switch | `--disallowed-tools AskUserQuestion` | non-interactive by design (`exec` + approval policy) | `permission.question: "deny"` |
| model / role selection | session model | `--model` / `config.toml` | `--model <provider/model>` + `--agent <name>` |
| structured output | parse stdout prose | `--output-schema <json-schema>` (strongest — already used by CR lane) | `--format json` (raw event stream) |
| rules file | `CLAUDE.md` | `AGENTS.md` (native) | `AGENTS.md` |
| guards / hooks | Claude hooks + `src/hooks/` pre-edit guards | sandbox modes (coarse: read-only / workspace-write) | plugins (JS event hooks) + granular glob permission rules |
| local models | no | no | yes (ollama et al.) |

**What to do:**

- Runner registry: `src/core/agent-runner.ts` — `spawnAgent(prompt, { role, cwd, env, timeoutMs })` resolving role → runner config → argv shape, with three built-in runners: `claude`, `codex`, `opencode`. Extract the Codex argv shape out of `src/cr/run-codex.ts` into the codex runner module (CR lane becomes a consumer of the registry, not the owner of the spawn). Refit the Claude-welded sites: `src/autonomous/drain-io.ts` `spawnGate`, `src/prep/spawn.ts` `spawnClaude`, `src/cr/lanes/subagent-dispatch.ts`, `src/release/llm-polish-summary.ts`. Drop or rewrite `src/cr/lanes/standalone.ts` (osascript + Claude double-coupled; headless lanes cover the need). Timeout backstop stays universal. PR-#33 rule holds for all three: directives ride the prompt, never env/flags.
- Capability matrix as code + doc: runners differ (structured output strength, sandbox granularity, local-model support, question-suppression mechanism). Encode per-runner capabilities in the registry (`supportsLocalModels`, `structuredOutput: schema | events | prose`, `sandbox: fine | coarse | none`) so role-resolution can validate fit (e.g. a role requiring `--output-schema`-grade output refuses a prose-only runner); publish the same matrix as `docs/noldor/agent-runtimes.md` — this fulfills ask (3) of the existing `make-noldor-agent-agnostic` roadmap entry.
- Config: `.noldor/config.json` `agents:` block — `{ "default": "claude", "roles": { "implementer": { "runner": "claude" }, "reviewer": { "runner": "codex" }, "second-opinion": { "runner": "opencode", "model": "ollama/<local>" }, "polish": { "runner": "opencode", "model": "ollama/<small>" } } }`. Every spawn site declares its role; resolution falls back to `default`. All fields optional — absent block ≡ today's behavior (claude everywhere, codex where `crLanes` says so).
- Mixed-fleet rollout by risk tier: `polish` first (pure text, no tools — cheapest local win), then CR lanes (already multi-runner in spirit — generalize `crLanes` vocabulary from hardcoded `subagent`/`codex` lane names to role refs), implementer **last** and per-runner: telemetry (ship/retry/revert rates from outcome-telemetry, segmented by runner) decides which runners graduate to implementer duty.
- Guards per runner: opencode → generated glob permission blocks in the worktree's `opencode.json` (shared-files guard → `edit: { "docs/roadmap.md": "deny" }`); Codex → sandbox mode per role (read-only for reviewers, workspace-write for implementers); Claude → existing `src/hooks/` guards. Hard floor for all three stays lefthook git hooks (trailer inject/validate, pre-commit session-marker check) — agent-neutral by construction, the only layer that *must* hold.
- Interactive plane: per-driver shims from one source — Claude `.claude/skills/`, opencode `.opencode/command/*.md` + agent definitions, Codex `AGENTS.md` + custom prompts. Direction stays **fat CLI, thin skills** — every flow step that moves into a `noldor` subcommand is written once and shimmed three times trivially. `noldor init` gains `--agents claude,codex,opencode` target selection (writes the chosen shim sets + `AGENTS.md`/`opencode.json`/`CLAUDE.md` overlays from one template source).
- Events: opencode `--format json` and codex `--output-schema` map into `agent-events.jsonl` richer than Claude stdout scraping — wire through the agent-events writer; runner field on every event enables the per-runner telemetry cut.
- Pin + verify: all three CLIs move fast — record validated version floors per runner in consumer config; `doctor` checks presence + version for each *configured* runner only (extends stack-assumption-audit prerequisites matrix).

**What it enables:** consumer picks their driver — or mixes: Claude implements, Codex reviews, local-model-via-opencode polishes; local models (the original ask) via the opencode runner; per-role model economics; no single-vendor dependency for the framework's autonomy story; three concurrent runners keep the seam honest — Claude-coupling can't silently regrow when CI exercises all three.

**Open questions:** opencode skills/commands semantics vs Claude Skill tool (model-invoked skill parity needs verification on current opencode version); Codex custom-prompt surface as skill-shim target vs AGENTS.md-only (verify against current codex CLI); whether drain implementers use named agent definitions with scoped permissions instead of broad bypass flags (lean yes where the runner supports it — opencode `--agent`, codex sandbox; Claude lacks the granular equivalent); session continuity for retry flows (`--session`/`--continue` on opencode, `codex exec resume` — could replace fresh-spawn retries; defer).

**Touches:** new `src/core/agent-runner.ts` + per-runner modules, `src/cr/run-codex.ts` (extract spawn), `src/autonomous/drain-io.ts`, `src/prep/spawn.ts`, `src/cr/lanes/subagent-dispatch.ts` + `standalone.ts`, `src/release/llm-polish-summary.ts`, `src/core/consumer-config.ts` (`agents:` block), `src/cli/commands/init.ts` (multi-target), templates (shim sets, `opencode.json`, `AGENTS.md`), new `docs/noldor/agent-runtimes.md`, `docs/noldor/{cr-pipeline,adoption-guide}.md`, doctor checks.

**Acceptance sketch:** fixture consumer configured `implementer: claude`, `reviewer: codex`, `polish: opencode+ollama` → drain ships a seeded XS entry using all three runners in one pass, agent-events carries a `runner` field per spawn; swapping `implementer` to `opencode` ships the same entry with no code change; `grep -rn "spawn('claude'\|execFileP('claude'\|'codex'" src` → hits only inside `src/core/agent-runner/` runner modules.

#### Acceptance-Verify Lane

- area: tooling
- type: feat
- since: 2026-06-11
- size: L
- impact: high
- parent: noldor

Autonomous paths merge on tests + CR. Both have a structural blind spot: the implementer agent writes the code *and* the tests, so a misunderstood requirement produces tests that assert the misunderstanding — green suite, wrong feature. CR reads diffs and can ratify the same error. Nobody runs the artifact and checks it against what the FD/entry actually promised. Add a `verify` lane: an independent agent that boots the real artifact and judges the shipped behavior against the acceptance text.

**What to do:**

- Lane plumbing: extend the `crLanes` config vocabulary with a `verify` lane kind for `code` artifacts (`"code": ["subagent", "verify"]`), riding the existing lane-runner machinery in `src/cr/` — same verdict-artifact pattern into `.noldor/cr/`, same orchestrate consumption, so the drain merge gate gets it for free.
- Verify agent contract: input = FD acceptance criteria / Usage section (or the roadmap-entry prose for FD-less fast-tracks) + the diff + boot instructions; it must (1) start the artifact, (2) exercise the *specific new behavior* through the real interface — CLI invocation, HTTP request, file output — never by reading the code, (3) compare observed vs promised, (4) emit verdict `{ pass | fail | cannot-verify, evidence: [command + observed output], mismatches: [] }`. `cannot-verify` is an honest first-class outcome (no boot path, behavior needs external services) and routes to advisory, not silent pass.
- Boot knowledge: new consumer-config block `verifyCommands` — named run surfaces (`{ "dashboard": "pnpm noldor dashboard server --port {port}", "cli": "pnpm noldor {args}" }`) + health-check hints. Self-host config seeds dashboard + CLI entries.
- Smoke floor (sub-item, ships first): a fixed, feature-agnostic pre-merge check for autonomous paths — `noldor doctor` + boot each `verifyCommands` surface + HTTP 200/exit-0 probe. Catches "build broken / server 500s" for S-effort before the per-FD lane lands.
- Policy: blocking vs advisory per consumer (`autonomous.verifyMode: "blocking" | "advisory"`, default advisory for one bake-in release, then flip self-host to blocking); `fail` on blocking → same flow as CR fail (`onFailure`: prompt / spawn-deep-review / abort).
- Sandboxing + hygiene: verify runs in the feature worktree on a per-tree port (worktree-discipline port convention already exists); must clean up spawned processes; wall-clock cap per verify.

**What it enables:** breaks the implementer self-confirming-test loop — the riskiest failure mode of unsupervised shipping; concrete catches of the PR-#53/#55 class ("does `/hot-zones?format=json` return the promised shape on a real server", "is `/features` actually ordered by commit date"), not just fixture assertions; raises the trust ceiling enough to make the [continuous-drain-daemon](#continuous-drain-daemon-and-escalation-inbox) responsible.

**Open questions:** judge strictness — exact-shape matching vs intent-level judgment (lean intent-level with evidence quoted, mismatches enumerated); UI-only changes without an API surface (out of scope v1 — `cannot-verify`); whether verify evidence gets attached to the PR body (probably yes — it's the best reviewer aid in the whole pipeline).

**Touches:** `src/cr/` (lane kind, runner, verdict schema), `src/core/consumer-config.ts` (`verifyCommands`, `autonomous.verifyMode`), drain merge gate consumption in `src/autonomous/`, `docs/noldor/cr-pipeline.md`, `adoption-guide.md` (config reference), self-host `.noldor/config.json`.

**Acceptance sketch:** seed a deliberately-wrong implementation (endpoint returns array, FD promises object) with passing self-written tests → verify lane boots server, curls endpoint, emits `fail` with quoted mismatch; honest implementation → `pass` with evidence; drain respects blocking mode.

#### Drop Branched Worktrees — Single Dev Branch Workflow

- area: tooling
- type: refactor
- since: 2026-05-10
- size: L
- impact: low
- parent: noldor

Re-evaluate the always-branch worktree discipline (per `docs/noldor/worktree-discipline.md`). Today every active task lives in its own branch worktree. The proposal: collapse to a single shared dev branch — still in worktrees for parallelism, but not separate branches — with all task work landing on one rolling branch and merging to main on release. Trade-off: simpler integration story (no per-task rebase, fewer divergent histories) at the cost of losing the per-task isolation that lets `/gate` and `/promote` reason about scope. Trigger: when per-branch overhead (rebase storms, cross-branch lint regen, merge order ambiguity) outweighs the isolation benefit.

#### Per-Task Dev Environment Bootstrap

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: med
- parent: parallel-worktree-workflow

Extend the worktree workflow with full per-task environment scaffolding: open IDE on the worktree folder/file, spawn a new terminal per task (already done), boot an internal web server scoped to the task's port, and start a local Charuy app instance per task. Today only the terminal spawn is automated; IDE focus and per-task app instances are manual. Goal: a single command takes an operator from "branch checked out" to "fully usable dev surface" without manual port-juggling. Pairs with the worktree port-per-tree convention from `docs/noldor/worktree-discipline.md`.

#### Dynamic FD ↔ File Pointers via Frontmatter

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: high
- parent: noldor

Replace the manual `links.code` / `links.tests` / `links.docs` arrays in FD frontmatter with dynamic frontmatter on the source files themselves — each code/test/doc file declares its FD slug, and the FD's link arrays derive from a scan. Also: brainstorm with an LLM at FD-creation time to propose initial pointers from imports + community membership. Reduces drift between FDs and their backing files. Open question: keep the FD-side arrays as a cached projection for `pnpm validate:features` speed, or always scan? Trigger: when manual FD link maintenance overtakes the value of having explicit link arrays — likely once FD count exceeds ~50 or after a refactor produces N broken links across many FDs.

#### Version-Aware Upgrade and Migration Chain

- area: tooling
- type: feat
- since: 2026-06-11
- size: L
- impact: high
- deps: registry-distribution
- parent: noldor

`noldor init --update` re-pulls current templates, but nothing handles *schema* evolution between framework versions: FD frontmatter shape changes, `consumer:` config field renames, skill-twin contract changes, trailer-format changes. With one consumer that's hand-migration; with N consumers on mixed pinned versions it's the biggest structural risk of the multi-project goal. Build `noldor upgrade`: a version-aware chain that takes a consumer from its current framework version to the installed one by running ordered codemods.

**What to do:**

- Version anchoring: record the framework version a consumer was last migrated to — `.noldor/config.json` `frameworkVersion:` field (written by `init` and `upgrade`), compared against the installed package version. `doctor` gains a skew check: installed ≠ migrated → warn, point at `upgrade`.
- Migration registry: `src/migrations/<version>.ts` modules, each exporting `{ from, to, description, migrate(cwd, config), dryRun(cwd, config) }`. Migrations are pure file transforms over the consumer tree (FD frontmatter rewrites, config key renames, template re-syncs with content-preserving merges) — same codemod discipline the Charuy→standalone extract used by hand.
- `noldor upgrade` command: resolves the chain `frameworkVersion → installed`, runs each migration sequentially, `--dry-run` prints the planned diffs per step, writes `frameworkVersion` only after the full chain succeeds. Refuses on dirty git tree; recommends a branch.
- Authoring discipline: a framework PR that changes any consumer-facing schema MUST ship the matching migration in the same PR — enforce via a `/garden` detector or a release gate that diffs `feature-md-schema.md` / `consumer-config.ts` against `src/migrations/` coverage.
- Codemod tests: fixture consumer trees per from-version under `src/migrations/__tests__/fixtures/`, snapshot the post-migration tree. The [consumer-contract-ci](#consumer-contract-ci-and-headless-gate-e2e-harness) fixture doubles as the live test bed.

**What it enables:** the framework can keep evolving its schemas without freezing or hand-walking every consumer; consumers upgrade with one command and a reviewable diff; removes the "Charuy is three versions behind and nobody dares sync it" failure mode before it exists.

**Open questions:** migration granularity — per release version vs per schema-change id (lean per-release, matches semver discipline in `versioning.md`); downgrade support (no — document as unsupported); how template re-sync merges consumer-local edits to twin files (three-way merge vs ours/theirs prompt — connects to the existing skill-twin drift pain).

**Touches:** new `src/migrations/`, `src/cli/manifest.ts` (+`upgrade` group), `src/cli/commands/init.ts` (write `frameworkVersion`), `src/core/consumer-config.ts` (schema field), doctor checks, `docs/noldor/adoption-guide.md`, `docs/noldor/versioning.md`.

**Acceptance sketch:** fixture consumer pinned at v0.2.0 shape + installed v0.4.0 → `noldor upgrade --dry-run` lists 2 steps with diffs; `noldor upgrade` lands both; `doctor` green; re-run is a no-op.

#### Framework Milestones Support (POC / MVP / 1.0.0)

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

Add a milestones layer to Noldor — tracking which features belong to which milestone (POC / MVP / 1.0.0 today; arbitrary names if `decouple-milestones-from-semver` lands first). Surfaces in `/triage` (proposed milestone per bullet), in FD frontmatter (`milestone: <name>`), in `/garden` (flag features whose milestone has shipped but phase is not done), and in dashboard pages. Pairs with `vision.md`'s current-milestone field.

- Optional, not mandatory — apps can grow organically without a milestone plan; the framework should not force the abstraction. When milestones are declared, the rest of the wiring activates; otherwise the field stays absent and detectors stay silent.

#### Parallel-Drain `roadmap.md` Conflict Auto-Resolution

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: parallel-drain

Under `--concurrency >1`, every fast-track child removes its own block from the shared `docs/roadmap.md`; the serialized merge coordinator rebases each PR onto the prior merge, but git cannot auto-merge *adjacent* block removals → the PR goes `DIRTY`, the coordinator skips it, and the worktree + open PR are orphaned. Hit live during a 23-entry drain: ~5 of the K=3 PRs went DIRTY, forcing a fall back to `--concurrency 1` (sequential is conflict-free by construction — each merges before the next branch is cut). Block-removal is deterministic, so the coordinator should re-apply "remove `<slug>`'s block" against the freshly-rebased base (parse + drop the block, not a textual 3-way merge) rather than letting git's line-merge fail. Without this, `--concurrency >1` is effectively unusable for roadmap-source drains. Touches: `src/autonomous/drain-io.ts`, `src/autonomous/drain-loop.ts`, `src/utils/parse-blocks.ts`.

### PR-Flow Tree-Shape Validation (auditReleasePushes)

- area: tooling
- type: feat
- since: 2026-05-15
- size: S
- impact: med
- parent: framework-pr-flow-agent-auto-merge

`scripts/garden/detectors/override-audit.ts`'s `auditReleasePushes` only validates the receipt-log format today (per spec §7 of `framework-pr-flow-agent-auto-merge`). Extend the detector to cross-check each receipt SHA against the canonical release-commit signature: `git show --name-only <sha>` must include `package.json` and `docs/release-notes.md`. Suspicious receipts (env-var-bypass written but commit doesn't match release shape) get downgraded to WARN. Closes the spec gap noted as a TODO comment above `auditReleasePushes`.

#### Drain Startup Reconciliation of a Prior Dead Run

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: autonomous-queue-drain-runner

When a drain dies mid-run (session pause / crash / SIGKILL) it leaves orphaned `fast/<slug>` worktrees, leftover branches, open PRs (clean *and* DIRTY), and a stale `.noldor/drain.lock`. Today a fresh drain does not reconcile these — the operator must manually merge clean open PRs, close/rebuild DIRTY ones, prune worktrees, and clear the stale lock (done by hand 3× in one session). Add a startup reconciliation pass: for each in-roadmap slug with an open PR, merge it when CLEAN (advance the oracle) or close + flag-for-rebuild when DIRTY; `git worktree prune` + remove orphaned `fast/*` worktrees whose slug is already shipped; reclaim a stale lock whose pid is dead. Makes the drain crash-recoverable instead of leaving a mess. Touches: `src/autonomous/queue-drain.ts`, `src/autonomous/drain-io.ts`, `src/autonomous/drain-lock.ts`.

#### micro-chore `reset --hard` Must Stash Uncommitted Work First

- area: tooling
- type: fix
- since: 2026-06-11
- size: S
- impact: high
- parent: noldor

The micro-chore temp-branch handoff (`/gate` Step 2) runs `git reset --hard origin/main` to rewind local main — which silently discards *any* uncommitted working-tree edits to unrelated tracked files. Hit live: a drain's micro-chore iteration destroyed uncommitted `ideas.md` edits (recovered only via VSCode Local History; uncommitted content never enters git's object store, so `git fsck` could not help). Fix: `git stash --include-untracked` before the reset and `git stash pop` after — or refuse the reset when the working tree carries unrelated dirty files, surfacing them to the operator. Real data-loss hazard on every micro-chore run started from a dirty tree. Touches: `.claude/skills/gate/SKILL.md` (Step 2 micro-chore handoff), the temp-branch scaffold.

### Trailer Scope-Alias Map

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: high
- parent: noldor

`scripts/garden/detectors/trailer-scope-mismatch.ts` rejects commits where the Conventional Commits scope doesn't equal (or end with `:`) the `Noldor-FD:` slug. v0.4.0 release surfaced 24 such mismatches: `feat(sdd):` commits tagged to FD `sdd-co-tag-detector`, `feat(cr):` commits tagged to FD `noldor`, etc. — the team has informally adopted shorter scope tokens. Required `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass. Fix: add a config-driven alias map (`scope-aliases.json` or detector frontmatter) where `sdd → sdd-co-tag-detector`, `cr → noldor`, etc., so the detector accepts the team's actual usage instead of demanding artificial scope expansion.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

#### `isDrainEligible`: Skip `blocked-by` + Match `Touches:` Anywhere

- area: tooling
- type: fix
- since: 2026-06-11
- size: S
- impact: med
- parent: autonomous-queue-drain-runner

`isDrainEligible` (`src/autonomous/drain-eligibility.ts`) today only inspects a block's `Touches:` prefix + top-level-bullet count. A fast-track entry that is `blocked-by` / `deps`-on an entry still present in roadmap/backlog is not shippable in isolation, but the drain still spawns it, lets the gate child fail deliberately, then burns `--max-retries` before skipping. Hit live: `first-class-blocked-by-field` (blocked by `stable-entry-ids-for-roadmap-backlog`, a size-M specs-only entry) burned retries each pass. Make it ineligible upfront: return false when `blocked-by:`/`deps:` references a slug still in the queue, and match `Touches:` anywhere in the body (not only at line-start). The gate child already specced this exact fix during the drain. Touches: `src/autonomous/drain-eligibility.ts`, `src/autonomous/drain-source.ts`.

#### `noldor autonomous status` + Robust Lock Read

- area: tooling
- type: feat
- since: 2026-06-11
- size: XS
- impact: low
- parent: autonomous-queue-drain-runner

There is no first-class way to ask "is a drain running, and where is it?" — operators read `.noldor/drain-state.json` + `.noldor/drain.lock` by hand, and a transient empty/partial read of the lock's `pid` field reads as "dead" (caused a live drain to be misjudged dead and interfered with mid-run). Add `noldor autonomous status`: report liveness from the actual process (`pgrep` / `kill -0` on the lock pid, with a robust JSON read) plus shipped / skip / in-flight from drain-state. Cheap operator-safety win that would have prevented the worst incident of the 2026-06-11 drain. Touches: `src/autonomous/drain-state.ts`, `src/autonomous/drain-lock.ts`, `src/cli/manifest.ts`.

#### Graphify `plan-of` edges + nodes for plans/specs

- area: tooling
- type: feat
- since: 2026-05-17
- size: M
- impact: med
- parent: graphify

Extend graphify to emit nodes for `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md`, plus `plan-of` / `spec-of` relations linking them to owning FD nodes. Today's graph tracks `imports` / `imports_from` between source files only; plans/specs aren't represented. Once available, enables `scripts/garden/garden-detect.ts:detectStalePlans` graph-adjacency fallback (originally fallback B from release-sweep-process-hardening; deferred from that FD when audit confirmed the graph schema didn't support it). Touches: `scripts/graphify/**`, `scripts/garden/garden-detect.ts`, `scripts/garden/plan-resolution.ts`.

#### Bootstrap-Immunity for Self-Gating Features

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: high
- parent: noldor

When a feature adds a new release-time gate, the feature's own implementation commits cannot satisfy that gate (the enforcement code didn't exist when they were authored). Hit live during automated-cr-pipeline: the new `release-cr-gate.ts` requires `Noldor-Reviewed-Codex` on every code-touching commit in the release range, but none of the 22 feature-branch commits have it because `pnpm cr:codex` was added by those very commits. Operator currently must hand-add `Noldor-CR-Override-Codex: bootstrap` to each commit before next release, or extend the gate to skip pre-feature SHAs. Framework-level fix: when a gate-introducing FD is detected (graph annotation? FD frontmatter `introduces-gate: <name>`?), `/gate` end-of-flow auto-injects matching `Noldor-<gate>-Override: bootstrap — feature added the gate that would block its own commits` on every commit on the worktree branch. Audited by `/garden`'s override detectors so it can't be silently abused on non-bootstrap work.

- v0.4.0 release shipped with `RELEASE_SKIP_CR_GATE=1` bypass for the same reason — 34 commits in `v0.3.0..v0.4.0` predate the CR pipeline. Retire the env-var bypass next cycle once bootstrap-immunity lands so v0.5.0 doesn't ship the escape hatch as routine. Track via a `chore` to verify `pnpm release` succeeds without the flag.

#### `pnpm release --resume`

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high
- parent: noldor

`pnpm release` is not idempotent when the final `git commit` step fails. v0.4.0 release hit this when the release commit's pre-commit hook rejected the diff (micro-chore session active): all package.json bumps, CHANGELOG entry, release-notes entry, FD `introduced:` markers were already written + staged, but the commit failed. Re-running the script would derive a new (wrong) version. Manual recovery required (`git reset`, fix root cause, re-run). Fix: either (a) `pnpm release --resume` flag that skips precondition + version-derive and goes straight to commit-tag-push when staged files match the in-progress release shape, or (b) wrap the file-mutation phase in a temp staging area committed atomically only after precondition success — so a failed commit leaves an empty tree.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

#### FD Complexity-Tier Field

- area: tooling
- type: feat
- since: 2026-05-06
- size: M
- impact: med

The `Features without spec` SDD detector flags every FD with empty `links.spec`, but the framework explicitly permits spec-less FDs in three of four complexity tiers (`skip-brainstorm`, `attach-to-parent`, and the no-MD chore — the last doesn't even produce an FD). Today three FDs are flagged as a "gap" purely because the detector has no signal for which tier the work shipped under. Proposal: add a `tier: <brainstorm-first | skip-brainstorm | attach-to-parent>` field to FD frontmatter, written by `/promote` (and required by `/new-feature`). The `Features without spec` detector then only flags `tier: brainstorm-first` FDs missing `links.spec`. Open design questions for brainstorm: (a) backfill rules for ~30 existing FDs — has-spec → `brainstorm-first`, has-`parent` → `attach-to-parent`, else → `skip-brainstorm`?; (b) is `tier` advisory or does `/promote` block save without it?; (c) does `tier: brainstorm-first` enforce `links.spec` non-empty at FD save time, or only at release?; (d) dashboard surface — per-tier pie / counts on `/features` so we see how often each path actually gets used. Trigger: live now — dashboard noise from the false-positive gap, plus the tier verdict already exists conceptually in CLAUDE.md so making it explicit unlocks per-tier metrics.

#### SDD Detector 5 — Idea-Merge Semantic Similarity

- area: tooling
- type: feat
- since: 2026-05-07
- size: M
- impact: med

Standalone graphify enhancement (not in the substrate family). When `/triage` proposes targets for ideas in `ideas.md`, compute semantic similarity between idea text and existing FD names + community labels via graphify; surface top-3 `merge:<slug>` candidates ranked by similarity. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). Trigger: when next batch of ideas accumulates and triage feels noisy.

- Strengthen merge-first behavior — `/triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).

#### Runtime Architecture Invariant Expansion

- area: tooling
- type: chore
- since: 2026-05-05
- size: M
- impact: med

Extend architecture invariants beyond package direction checks to catch runtime-boundary drift: production app imports from `@charuy/test-fixtures`, package consumers bypassing public `src/index.ts` exports, debug-only modules included in public builds, and agent API modules importing UI components directly. Add these as advisory `/garden` findings first, then promote the highest-signal ones to `pnpm check:invariants` once false positives are burned down.

#### Framework Auto-Split Suggestion for Big Features and Plans

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

When a feature or plan grows past size thresholds, the framework should suggest a split rather than letting work calcify around an oversized FD or unwieldy plan. Heuristics: word count, scope-bullet count, file-touch breadth (from `links.code`), or for plans the row count. The suggestion surfaces in `/promote` (feature) and `superpowers:writing-plans` (plan) before the operator commits to the path. Today the operator is on their own to spot oversized scope.

- Plan threshold — suggest split when a plan exceeds ~1000 rows (one part = ~1000 rows). Use this as the initial heuristic and tune with experience.

#### Noldor Section-Age Staleness Detector

- area: tooling
- type: feat
- since: 2026-05-08
- size: M
- impact: low
- parent: noldor

Was originally Detector 14 in the Noldor extraction spec (`docs/superpowers/specs/2026-05-08-noldor-framework-extraction-design.md`); deferred during review because the value depends on actual drift accumulating, and the section-boundary detection is fiddly (header renames break the heuristic). Trigger: revisit if Detectors 14 (stub regrowth) + 15 (rule contradiction) prove insufficient — i.e. if framework drift slips past both gates and shows up as user-reported confusion or `/garden` blind spots. Implementation sketch: parse CLAUDE.md / README headers, run `git log -L /^## <Section>/,/^## /` per section, compare last-touched dates between CLAUDE.md side and `noldor/<page>.md` side, flag >30 day gaps in either direction.

#### Dashboard Reference API Subtree

- area: tooling
- type: feat
- since: 2026-05-09
- size: M
- impact: low
- parent: project-tracking-dashboard

Render `docs/user/reference/api/` (typedoc-generated `engine` + `format` API trees) as nested dashboard pages. Deferred from the v1 doc-surface pass because the typedoc tree has its own deep-nesting + cross-link conventions that don't cleanly fit the flat `/docs/<category>/<slug>` route shape used for top-level user docs. Approach options at trigger time: (a) mount typedoc HTML output directly under `/docs/reference/api/*` as static-file pass-through; (b) parse the markdown subtree recursively into a tree-shaped surface keyed by module path. Trigger when an agent or user actually hits the API reference often enough that its absence from the dashboard is friction.

#### Real-Codex Integration Smoke Test

- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`scripts/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of `pnpm cr:codex` validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm cr:codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

#### Framework Script + Test Migration Cleanup

- area: tooling
- type: chore
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The migration-only scripts add maintenance load; the gaps add risk. One-pass sweep — possibly a `/garden` detector that flags scripts referenced only in commits with `chore(framework):` or `refactor:` migration messages and not in any current pipeline.

#### Scope Sibling Trailer for Doc-Sync Commits

- area: tooling
- type: feat
- since: 2026-05-12
- size: M
- impact: med
- parent: noldor

`scripts/noldor/validate-noldor-scope.ts` rejects multi-scope commits, so one logically-coherent change (feat in `scripts/triage/`, tests in `scripts/triage/__tests__/`, sibling doc syncs in `docs/noldor/triage.md` and `docs/features/<slug>.md`) must split into separate commits per scope. Mechanically correct, but the same logical change becomes 3 entries in `git log` and 3× the gate dance (session, hook, trailer). 2026-05-12 roadmap-priority follow-up hit this — `feat(scripts:roadmap-priority-ordering)` + `docs(noldor:triage)` + `docs(features:roadmap-priority-ordering)` split forced. Proposal: introduce a `Noldor-Sibling-Scope: <scope-list>` trailer that lets the validator accept files mapping to listed sibling scopes, keeping the work as one atomic commit. Alternative: validator auto-detects "doc-sync-for-this-feat" patterns (FD doc + framework page in same commit as the code) and waives the split heuristically. Either way: a single commit makes the change easier to revert + easier to read in `git log` + cheaper to author.

#### Stable Entry IDs for Roadmap + Backlog

- area: tooling
- type: feat
- since: 2026-05-22
- size: M
- impact: med
- parent: noldor

Every roadmap and backlog entry is identified today by its kebab-slug derived from the heading. Slugs are rename-fragile — renaming an entry breaks every `deps:`, `parent:`, commit trailer, and dashboard link that targets it; moving an entry between roadmap ↔ backlog preserves the slug but loses heading-evolution traceability. Introduce a stable short ID minted at first triage and never rewritten: e.g. `R-0042` for roadmap and `B-0042` for backlog, or a single `Q-0042` namespace that survives cross-file moves. The ID becomes the canonical reference for `blocked-by:` / `parent:` / commit trailers / dashboard links / garden detectors. Slug stays a human-readable alias that can be rewritten without breakage. Counter persists in `.noldor/id-counter.json`; `/triage` and `/new-feature` mint IDs at creation. Migration: one-sweep backfill across existing ~80 backlog + ~60 roadmap entries. Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `scripts/triage/score.ts`, `scripts/validate/validate-triage.ts`, `docs/noldor/triage.md`, `docs/noldor/feature-md-schema.md`.

#### First-Class `blocked-by` Field

- area: tooling
- type: refactor
- since: 2026-05-22
- size: S
- impact: med
- deps: stable-entry-ids-for-roadmap-backlog
- parent: noldor

`docs/noldor/triage.md:64` describes a `deps:` bullet (comma-separated kebab slugs) that `scripts/triage/score.ts` reads for dependency-weight scoring, but the field is silently optional in v1, undocumented in both `docs/roadmap.md` and `docs/backlog.md` preambles, and unused across every current entry. Promote it to a first-class `blocked-by:` field — name matches GitHub-issue + Jira convention and reads better in prose than `deps`. Document it in both file preambles, surface it on the dashboard as a dependency graph view, validate that each referenced ID exists, and have `/garden` flag circular chains. Accept `deps:` ↔ `blocked-by:` as aliases during a migration window, then deprecate `deps:`. Blocked by Stable Entry IDs — `blocked-by:` references should target stable IDs, not rename-fragile slugs. Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `scripts/validate/validate-triage.ts`, `scripts/garden/detectors/*` (new circular-blocked-by detector), `docs/noldor/triage.md`.

### Post-Queue Opportunities — Adoption, Autonomy & Verification

Strategic cluster drafted 2026-06-11 from a framework-wide evaluation that assumes the current queue ships. The queue buys internal hygiene; these buy what it does not — **adoption by other projects** (confirmed goal), **measurement**, **continuity of autonomy**, and **independent verification**. Larger and mostly interdependent (see each `deps:`); take to `/promote` + spec/plan when picked up. File order within the section is suggested priority.

#### Registry Distribution for the Noldor Package

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Today a consumer installs Noldor as a `file:` dependency and must keep a clone of `noldor/` as a sibling directory of their repo (README quick-start, `docs/noldor/adoption-guide.md` Bootstrap §1). That is the single hardest blocker for any project that is not on this machine. Publish the package to a registry so adoption starts with `pnpm add -D noldor`.

**What to do:**

- Package hygiene: audit `package.json` `files` / `exports` / `bin` so the published tarball carries `dist/`, `bin/noldor.mjs`, `templates/`, and the skill bundle — everything `noldor init` scaffolds from — and nothing else (no `graphify-out/`, no `docs/features/`). Verify with `pnpm pack` + a scratch-dir install.
- Decide registry: public npm vs GitHub Packages. Check name availability (`noldor` on npm); fall back to a scoped name if taken — scoped name ripples into `consumer-config` docs and `init` output, so decide before publishing anything.
- Extend `src/release/` so `pnpm release` gains a publish step (or a separate `release publish` subcommand): build → pack → publish with provenance, tag-driven, after the existing commit-tag-push succeeds. Must respect the existing release gates; publishing is the new last step, never runs on a dirty tree.
- `postinstall` review: today `lefthook install` runs on consumer install — confirm it behaves when installed from a registry tarball (no `.git` in the package, consumer's `.git` is the target).
- Docs: rewrite README Quick start and adoption-guide Bootstrap §1 for the registry path; keep `file:` documented as the contributor/dev path.

**What it enables:** any repo anywhere adopts without cloning the framework; precondition for [version-migration-chain](#version-aware-upgrade-and-migration-chain) (versions must be pinnable and resolvable) and for a credible [consumer-two-adoption-dogfood](#real-consumer-2-adoption-dogfood) on a machine that isn't this one.

**Open questions:** npm public vs GitHub Packages (private-first?); whether `templates/` ships in the tarball or `init` downloads them; semver tag → npm dist-tag mapping (`latest` only pre-1.0?).

**Touches:** `package.json`, `src/release/`, `bin/`, `README.md`, `docs/noldor/adoption-guide.md`, `docs/noldor/versioning.md`.

**Acceptance sketch:** fresh temp dir, `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → green, no sibling clone present.

#### Real Consumer #2 Adoption Dogfood

- area: tooling
- type: chore
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Both existing consumers are degenerate cases: Charuy is the origin monorepo Noldor was extracted from, and self-host is the framework itself. Neither exercises the adoption path the way a foreign repo would. Adopt Noldor into one real, structurally different project (single-package repo, different domain, ideally an existing repo of the operator's with live development) and drive real work through it.

**What to do:**

- Pick the repo: criteria — actively developed, single package (not a monorepo, to stress the `lockstepPackages: [one]` shape), TS or close enough that stack assumptions hold (this dogfood validates the *adoption flow*, not yet the stack-portability — that's [stack-assumption-audit](#stack-assumption-audit-and-declared-prerequisites)).
- Run the documented path verbatim: install (registry if [registry-distribution](#registry-distribution-for-the-noldor-package) has shipped, `file:` otherwise), `pnpm noldor init --adopt`, fill `.noldor/config.json` `consumer:` block, `pnpm noldor doctor`. Every deviation from the adoption guide goes in the friction log — do not silently fix and move on.
- Drive ≥3 changes through the full lifecycle: one micro-chore, one fast-track, one specs-only or full feature with FD + spec. At least one of them via the autonomous drain (`noldor autonomous run --source roadmap`) end-to-end to PR merge.
- Maintain `friction.md` in the consumer repo during the run: every prompt that confused, every command that assumed Charuy/self-host context, every hard-coded path, every doc that lied. Date + exact error text.
- Close-out: `/triage` the friction log into Noldor's `ideas.md` → roadmap; fix the adoption-guide lies immediately (micro-chore class).

**What it enables:** ground-truth adoption backlog instead of speculation — this entry *generates* the precise work items for the rest of the adoption block; validates the guide line-by-line; produces the first consumer whose breakage matters for [consumer-contract-ci](#consumer-contract-ci-and-headless-gate-e2e-harness) fixture design.

**Open questions:** which repo (operator decision); whether the consumer keeps Noldor after the experiment or rolls back (rollback procedure is itself an undocumented gap — note it in the friction log).

**Touches:** nothing in-repo up front — output is the friction log plus triaged entries; immediate doc fixes touch `docs/noldor/adoption-guide.md`, `README.md`.

**Acceptance sketch:** friction log exists with ≥10 dated entries; ≥3 changes shipped in consumer incl. ≥1 autonomous drain ship; ≥5 entries triaged back into Noldor's queue.

#### Consumer-Contract CI and Headless Gate E2E Harness

- area: tooling
- type: test
- since: 2026-06-11
- size: L
- impact: high
- parent: noldor

164 unit-test files, zero end-to-end coverage of the flows autonomy actually depends on: the skill-markdown gate paths, drain loop against a real repo, init/upgrade against a real consumer tree. The PR #33 bug class (headless gate silently ignoring env-only signals) lived exactly in this blind spot and shipped broken. Build one harness that covers both needs: a fixture consumer repo as the *contract*, and headless skill-flow runs as the *e2e layer*.

**What to do:**

- Fixture consumer: a minimal single-package TS app (`fixtures/consumer/` in-repo, or generated into a temp dir by a builder script — temp-dir generation avoids fixture rot and `.git`-in-`.git` issues; lean that way). Contains: `.noldor/config.json`, a tiny `src/`, `docs/` skeleton with vision/roadmap/ideas, one seeded roadmap entry sized XS, lefthook wired. A builder util makes it a real git repo with an initial commit.
- Contract layer: CI job — install framework *from the working tree* into the fixture (`pnpm pack` + install tarball), run `noldor init`, `noldor doctor`, `noldor validate features`, `noldor garden detect`. Assert exit codes + key artifacts. Any framework PR that breaks this fails before merge — consumers are protected without being in the loop.
- Headless flow layer: drive real flows non-interactively and assert *outcomes*, not transcripts:
  - drain a seeded XS roadmap entry: `noldor autonomous run --source roadmap --max-features 1` → assert roadmap entry retired, commit carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, branch merged, worktree cleaned.
  - micro-chore and fast-track gate sessions: marker files written, scope validator accepts/rejects per the rules.
  - failure-path probes: dirty main, locked drain (`drain.lock` present), stale `fast/<slug>` branch (the salvage case) — assert the loop surfaces/parks instead of corrupting state.
- Agent-call seam: headless runs that would spawn an LLM agent need a stub mode (deterministic canned implementer/reviewer responses keyed by slug) so CI is hermetic + free; one opt-in non-stubbed nightly/manual lane runs a real model for true end-to-end (pairs with the existing roadmap entry "Real-Codex Integration Smoke Test" — same gating pattern, `NOLDOR_RUN_REAL_*=1`).
- Wire into CI config + `script-catalog.md`; failures must print the fixture-repo git log + `.noldor/` state for debuggability.

**What it enables:** framework changes can't silently break consumers (the contract half) or the autonomous paths (the e2e half); regression net for every PR-#33-class bug; the fixture doubles as the test bed for [version-migration-chain](#version-aware-upgrade-and-migration-chain) codemods and the demo ground for adoption docs.

**Open questions:** in-repo fixture vs generated-on-the-fly (lean generated); how the agent-stub seam is injected (env var + stub binary on PATH vs a `DrainSource`-style interface — the `DrainSource` seam from plan-runner suggests the pattern); CI provider/workflow file location for the standalone repo.

**Touches:** new `fixtures/` or `src/testing/consumer-fixture.ts`, CI workflow, `src/autonomous/` (stub seam), `docs/noldor/testing-principles.md`, `docs/noldor/script-catalog.md`.

**Acceptance sketch:** `pnpm test:contract` locally green in <5 min; intentionally breaking `consumer-config.ts` field name fails the contract job; drain e2e asserts trailers + retired entry on the fixture repo.

#### Stack-Assumption Audit and Declared Prerequisites

- area: tooling
- type: chore
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor

Noldor hard-assumes its home stack: pnpm (`pnpmStderrPrefix` is literally a consumer-config field), lefthook, TypeScript + vitest, Conventional Commits, `gh` CLI, Claude Code as the driving agent. Opinionated is the stated posture ("opinionated, not configurable" — vision.md), but the opinions are currently *undocumented*, so a mismatched adopter discovers them one runtime error at a time, mid-gate.

**What to do:**

- Sweep `src/` + skills + lefthook templates for every environmental assumption: package manager invocations, hook runner, test runner, formatter (oxfmt), commit-format parsing, `gh` calls, Claude-specific paths (`.claude/`, skill names, transcript layout). Output: a prerequisites matrix — tool, where assumed, hard requirement vs swappable, failure mode if absent.
- Publish the matrix as a **Prerequisites** section at the top of `docs/noldor/adoption-guide.md`: "Noldor requires: pnpm ≥X, lefthook, vitest, Conventional Commits, gh, Claude Code. Not negotiable pre-1.0."
- Teach `noldor doctor` to check each prerequisite explicitly (binary present, version floor) and fail with the matrix link — adoption failures move from mid-gate mystery to minute-one diagnosis.
- Explicitly do NOT abstract anything in this entry — abstraction decisions (other package managers, other agents) stay with the existing `make-noldor-agent-agnostic` roadmap entry. This entry only makes the floor visible.

**What it enables:** honest adoption surface; failed adoptions fail fast at `doctor` with a named missing prerequisite; the matrix becomes the scoping document for any future portability work.

**Touches:** `docs/noldor/adoption-guide.md`, `src/cli/commands/doctor` checks, possibly `README.md`.

**Acceptance sketch:** removing `gh` from PATH → `doctor` names it + links the matrix; matrix lists ≥6 prerequisites with where-assumed pointers.

#### Agent-Events Log and `/agents` Dashboard Page

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: project-tracking-dashboard

Operator cannot see which agents are running, on what, since when. `drain-state.json` is a best-effort heartbeat with slug + coarse phase, overwritten per run; prep fanout, plan-runner and CR-lane spawns aren't tracked anywhere. The dashboard already exists and is the right surface. Build the unified event log first — it is also the data spine for [outcome-telemetry](#outcome-telemetry-and-effectiveness-metrics).

**What to do:**

- Event log: append-only `.noldor/agent-events.jsonl`. Schema per line: `{ ts, run: <drain-run-id>, event: "spawned" | "phase" | "exited", kind: "drain-implementer" | "plan-runner" | "prep-drafter" | "cr-<lane>" | "merge-coordinator", slug, lane, pid, worktree, logfile, phase?, outcome?: "shipped" | "skipped" | "retry" | "escalated" | "failed", detail? }`. Writer util in `src/core/agent-events.ts` — best-effort like `writeState` (never throws into the loop), one JSON line per write, no rotation in v1 (size-cap note in v2).
- Instrument every spawner: drain loop + parallel pool (`src/autonomous/drain-loop.ts`, `queue-drain.ts` — spawn/phase/exit + retries), plan-runner source, `src/prep/spawn.ts`, CR lane runners in `src/cr/`. Each spawn writes `spawned` with its logfile path; exits write `outcome`.
- Keep `drain-state.json` as-is (cheap current-state projection); events are the history.
- Dashboard `/agents` page (`src/dashboard/`): **Live board** — currently-running agents (spawned without exited, pid-liveness-checked): kind, slug, lane, phase, runtime, retry count, merging indicator; link per row to a log-tail view (last ~100 lines of `logfile`). **Run timeline** — per drain-run grouped history: spawned→exited bars per agent, outcomes color-coded, shipped/skipped/escalated totals.
- Transport: poll every ~2s in v1 (matches existing dashboard JS simplicity); SSE upgrade noted as follow-up, not in scope.
- MVP fallback if sequencing demands: a `/agents` page reading only `drain-state.json` + `drain-k*.log` tail ships in days (size S) — but the event log is the part that compounds; don't ship the fallback alone unless urgent.

**What it enables:** the operator ask verbatim — see which agent is spawned and working; debugging K>1 parallel drains (today: one interleaved log); post-run audit without scrolling narrative logs; the event stream [outcome-telemetry](#outcome-telemetry-and-effectiveness-metrics) aggregates and the [continuous-drain-daemon](#continuous-drain-daemon-and-escalation-inbox) inbox consumes.

**Open questions:** pid liveness vs heartbeat events for crash detection (lean pid-check in v1); whether CR-lane subagents inside a single Claude session are observable as separate "agents" or only as phases of their parent (likely phases — be honest about granularity); gitignore `.noldor/agent-events.jsonl` (yes — operator-local, like `drain-k1.log` should be).

**Touches:** new `src/core/agent-events.ts`, `src/autonomous/drain-loop.ts` + `queue-drain.ts` + `drain-source.ts`, `src/prep/spawn.ts`, `src/cr/`, `src/dashboard/` (server route, view, static JS), `.gitignore`, `docs/noldor/script-catalog.md`.

**Acceptance sketch:** run `noldor autonomous run --concurrency 2 --max-features 2`; `/agents` shows 2 live implementer rows with distinct lanes, then a timeline with 2 shipped outcomes; events file has spawned/exited pairs for every agent incl. CR lanes.

#### De-Superpowers: Vendor Spec, Plan and Worktree Flows

- area: tooling
- type: refactor
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

The framework's core flows depend on the third-party `superpowers` Claude Code plugin. Four load-bearing uses: `superpowers:brainstorming` produces every spec (gate SKILL.md Steps for all spec paths), `superpowers:writing-plans` produces every plan, `superpowers:using-git-worktrees` does worktree creation, and — worst — `src/prep/draft.ts:18` bakes a "REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans" blockquote **into every generated plan**, so the dependency propagates into consumer repos at plan-execution time. Everything else is path naming (`docs/superpowers/specs|plans`). A consumer without the plugin cannot run the gate's spec/plan paths; an upstream plugin edit can silently change framework behavior. Vendor the flows.

**What to do:**

- `noldor-spec` skill (vendored brainstorming): distill the question-loop → spec-document flow into a noldor-owned skill + spec template. Evidence it's template-able: `prep/draft.ts` already reproduces the spec format headless via prompt instructions — the plugin's value here is the *format and sequence*, both extractable. Keep the operator-dialog version (interactive gate paths) and the headless version (prep fanout) sourced from one template.
- `noldor-plan` skill (vendored writing-plans): the plan format is already mirrored verbatim in `draft.ts` `PLAN FORMAT` const — extract to `templates/`, single-source both the skill and the prep prompt from it.
- Worktree creation → CLI, not skill: `noldor worktree create <slug>` subcommand implementing the mechanical steps (`.worktrees/<slug>`, branch naming, `pnpm install`, port assignment per `worktree-discipline.md`). Code beats prose; `src/worktrees/` already exists as home. Gate SKILL.md calls the command.
- Rewrite the plan blockquote in `draft.ts` to noldor-owned execution instructions: "execute task-by-task inline, commit at each task boundary, tick `- [x]`" — the gate's autonomous mode already executes plans exactly this way without the superpowers executors (gate SKILL.md explicitly forbids invoking them); make inline execution the canonical documented mode for interactive too.
- Sweep remaining prose references in `gate` / `garden` / `draft-feature-md` SKILL.md + their `templates/` twins (template-sync gate distributes to consumers).
- **Separable last step** — path rename `docs/superpowers/` → `docs/design/{specs,plans}`: `src/core/doc-roots.ts:30-31` is the single code seam; everything else is prose/links. Ship as a migration (see version-migration-chain) that moves files and rewrites links; keep a transition alias in doc-roots for one release.

**What it enables:** adoption without any plugin prerequisite (today's hidden install step); immunity to upstream skill drift; precondition for the opencode interactive plane (opencode-side flows cannot reference a Claude-only plugin); generated plans become self-contained artifacts any agent can execute.

**Open questions:** how much of brainstorming's dialog discipline to keep in the vendored version (lean: keep the question-first loop, drop the plugin's meta-machinery); whether `/promote`'s tier vocabulary references the new skills by name (yes — update `complexity-gating.md` table).

**Touches:** new `.claude/skills/noldor-spec/`, `.claude/skills/noldor-plan/`, `src/worktrees/` (+CLI manifest entry), `src/prep/draft.ts`, `.claude/skills/{gate,garden,draft-feature-md}/SKILL.md` + template twins, `docs/noldor/{complexity-gating,workflow,skill-catalog}.md`; path-rename step: `src/core/doc-roots.ts`, `src/migrations/`.

**Acceptance sketch:** fresh consumer without superpowers installed runs a full `specs-only-new` gate path to merge; generated plan contains no `superpowers:` reference; `grep -r "superpowers" .claude/skills templates src` → only the historical specs/plans path (or nothing, post-rename).
