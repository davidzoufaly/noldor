# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

- merge hot zones to wip age dashboard
- merge skills to framework
- task ID move under task title in dashboard table [triaged 2026-07-11 → dashboard-task-id-under-task-title]
- fix dashboard many pages are broken + live drain observation is not in main menu? and not working anyway [triaged 2026-07-11 → dashboard-broken-pages-audit]
- odebrat add entry to the top and add entry to the bottom z roadmapy -> přesunout je do action column jako 2 tlačítka u každého entry (může se posunout úplně nahoru nebo úplně dolů) [triaged 2026-07-11 → dashboard-entry-move-to-top-bottom-actions]
- rozpracovat všechny claude memories přímo do frameworku aby nebyly potřeba [triaged 2026-07-11 → memory-intake-lessons-learned-pipeline]

## Not groomed

- Skill-vs-code drift detector — skills reference CLI commands, `package.json` scripts, and `src/` paths that rot after reorgs (release-sweep needed a full path audit, PR #124; gate skill body has the same class of drift per the gate-doc-truth roadmap entry). Candidate garden detector: scan `.claude/skills/**/SKILL.md` + `templates/.claude/skills/**` for `pnpm <script>` invocations not in `package.json` scripts, `noldor <sub>` commands not in the CLI manifest, and repo-relative paths that don't exist. Carried out of the drained release-sweep-skill-path-audit roadmap entry ("candidate follow-up, not in scope"). [triaged 2026-07-11 → skill-vs-code-drift-detector]
- Agent-events log rotation/retention — deferred from the /agents entry (spec D5): `.noldor/agent-events.jsonl` grows without bound (phase rows add ~4 lines per slug per run). Rotation adds file-swap complexity to a fail-open writer; design size-or-age-based rotation (keep last N runs readable for the /agents timeline) as its own entry. Touches: `src/core/agent-events.ts`, `src/dashboard/data.ts` readers. [triaged 2026-07-11 → agent-events-log-rotation]

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

#### Next

#### Later

- One-time migration of the existing Claude assistant memories (~90 files under the per-project memory dir) into the framework via the `/noldor-absorb` loop — fold live-value gotchas/feedback into `docs/noldor/` runbooks, classify shipped-historical markers as `drop`, report which memories are redundant (no source deletion). Split out of `memory-intake-lessons-learned-pipeline` (Q-0026), which shipped the mechanism only.

### Core Product

#### Now

- Embeddings infra for the framework — one shared vector-embedding capability with two consumers: (a) FD/feature-description similarity (the semantic idea-merge path detector-5 dropped because "AST graph has no feature embeddings"), and (b) semantic (Type-4) code-duplicate detection — same-behavior/different-code clones the token/AST clone detector can't catch. Build once: an embed step over FD prose + code units, a vector store, and cosine-similarity queries feeding both the `/triage` merge shortlist and the clone signal. Speculative — no active trigger; revisit if deterministic token/AST clone detection proves insufficient or triage-merge noise justifies semantic ranking. Touches: new `src/` embeddings module + store, `/triage` merge-candidates, clone-detector signal. [triaged 2026-07-11 → embeddings-infra-for-the-framework]

- Code-clone detector (token/AST-based, Type-1/2/3 clones — copy-paste dup detection, à la `jscpd`). Deterministic corpus over `scanPaths`, no LLM. Surface duplicate blocks as a new signal in `sdd-report` + feed `/refactor`; optional CR-gate block above a configurable clone threshold. Fits the "deterministic detector + optional LLM triage" pattern (same shape as detector-5 idea-merge). Distinct from existing pieces: `/refactor` finds consolidation opportunities from god-nodes/cohesion but doesn't do line/token clone matching; `graphify` AST graph has structural similarity signal but no clone report. Semantic (Type-4) clones out of scope — same embeddings wall detector-5 hit ("AST graph has no feature embeddings"). Touches: new `src/` detector, `src/features/sdd-report.ts` (report section), `/refactor` skill signal input, CR-gate threshold config. [triaged 2026-07-11 → code-clone-detector]

#### Next

- E2E testy support [triaged 2026-07-11 → e2e-test-support]

#### Later
