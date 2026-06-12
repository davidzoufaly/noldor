# Acceptance-Verify Lane — Design

**Slug:** acceptance-verify-lane
**FD:** docs/features/acceptance-verify-lane.md
**Date:** 2026-06-12
**Tier:** full

## Problem

Autonomous paths (drain, watch daemon, gate autonomous mode) merge on two signals: the test suite and code review. Both share a structural blind spot — the implementer agent writes the code *and* the tests, so a misunderstood requirement produces tests that assert the misunderstanding (green suite, wrong feature), and CR reads diffs and can ratify the same error. Nothing in the pipeline boots the shipped artifact and checks observed behavior against what the FD or roadmap entry actually promised. PR-#53/#55-class escapes ("does `/hot-zones?format=json` return the promised shape on a real server") pass tests and CR today.

## Goals

- An independent `verify` lane for `code` artifacts that boots the real artifact, exercises the *specific new behavior* through its real interface (CLI invocation, HTTP request, file output) — never by reading the code — and emits a verdict against the acceptance text.
- A feature-agnostic **smoke floor** that ships first: `noldor doctor` + boot every configured run surface + HTTP-200/exit-0 probe. Catches "build broken / server 500s" even for S-effort fast-tracks.
- Verdict `{ pass | fail | cannot-verify }` with quoted evidence (`command` + `observed`) and enumerated mismatches. `cannot-verify` is an honest first-class outcome, never a silent pass.
- Per-consumer policy: `autonomous.verifyMode: "blocking" | "advisory"`, default `advisory` for one bake-in release; blocking `fail` routes through the existing `cr escalate` flow.
- Zero new seams for the drain: the lane rides `crLanes.code` config, the existing orchestrate dispatch, the existing sink/aggregate/escalate machinery.

## Non-goals

- UI-only changes without an API/CLI surface — v1 emits `cannot-verify`.
- Spec/plan artifact kinds — verify is `code`-only; orchestrate rejects it for other kinds.
- Token accounting / cost rails for the verifier agent (no token accounting exists anywhere yet — see `autonomousConfigSchema` comment in `src/cr/config.ts`).
- Replacing tests or CR — verify is a third, behavioral signal, not a substitute.
- Roadmap-entry prose as acceptance input for FD-less fast-tracks (v1 uses commit messages as fallback; see D5).

## Design

Approach chosen: **mirror the subagent lane** — a new `RunLane` implementation registered in orchestrate's `LANES` dispatch, with the agent spawned headless through the agent-runner registry, plus a deterministic smoke module with its own CLI. Every existing seam (orchestrate, aggregate, escalate, pr-flow, drain) is reused untouched except for enum additions and the dispatch entry. Alternatives considered: a separate `noldor verify run` pipeline beside the CR lanes (duplicates sink/aggregate/escalate plumbing; drain gets nothing for free), and smoke-floor-only v1 (leaves the headline capability unshipped).

### Unit 1 — `verifyCommands` consumer config (`src/core/consumer-config.ts`)

Boot knowledge lives in the `consumer:` block of `.noldor/config.json`, beside `scopeAliases`:

```json
"verifyCommands": {
  "dashboard": {
    "command": "pnpm noldor dashboard server --port {port}",
    "kind": "server",
    "healthPath": "/"
  },
  "cli": { "command": "pnpm noldor --help", "kind": "cli" }
}
```

Schema (zod, in `ConsumerConfigSchema`):

```ts
verifyCommands: z.record(z.string(), z.object({
  command: z.string().min(1),          // {port} placeholder substituted at boot
  kind: z.enum(['server', 'cli']),     // server: boot+probe+kill; cli: run+exit-0
  healthPath: z.string().default('/'), // server-only probe path
  readyTimeoutMs: z.number().int().positive().default(30_000),
})).default({})
```

Tolerant loader `loadVerifyCommands(cwd)` following the `loadScopeAliases` pattern (`{}` on missing config). Self-host config seeds the `dashboard` and `cli` entries above.

### Unit 2 — smoke floor (`src/verify/smoke.ts` + CLI `noldor verify smoke`)

Deterministic, agent-free. Sequence:

1. `pnpm noldor doctor` — exit 0 required.
2. For each `verifyCommands` surface: `server` → spawn (detached, own process group), poll `http://127.0.0.1:{port}{healthPath}` until HTTP 200 or `readyTimeoutMs`, then `kill(-pid)`; `cli` → run, require exit 0.
3. Emit `SmokeReport { ok: boolean, surfaces: [{ name, ok, evidence: { command, observed } }] }` to stdout (`--json`) or human table; exit 0/1.

Port resolution: read `PORT` from `.env.local` at the worktree root (the port-per-tree convention from `docs/noldor/worktree-discipline.md`); when absent, bind port 0 via `net.createServer` to find a free one. Zero configured surfaces → `ok: true` with a `no surfaces configured` note (smoke is opt-in by config, not a trap for unconfigured consumers).

CLI registered in `src/cli/manifest.ts` as `verify smoke`. Reusable function `runSmoke(cwd): Promise<SmokeReport>` is what the lane (Unit 4) calls.

### Unit 3 — `verifier` agent role (`src/core/agent-runner/types.ts`)

`AGENT_ROLES` gains `'verifier'`. Distinct from `reviewer` because the fit profile differs: the verifier must execute commands (boot servers, curl endpoints), while reviewer is read-only over diffs. Role resolution and consumer `agents` config remapping work unchanged; default runner is `claude` like every unmapped role.

### Unit 4 — verify lane (`src/cr/lanes/verify.ts`, schema + dispatch edits)

Enum/schema edits in `src/cr/findings-schema.ts`:

- `laneSchema` gains `'verify'`.
- `laneFindingsSchema` gains optional fields:
  `verdict: z.enum(['pass', 'fail', 'cannot-verify']).optional()`,
  `evidence: z.array(z.object({ command: z.string(), observed: z.string() })).optional()`,
  `mismatches: z.array(z.string()).optional()`.

`runVerify(input: LaneInput): Promise<LaneResult>` (registered in orchestrate's `LANES` record, which currently maps `manual | codex | subagent` — `Exclude<Lane, 'standalone'>` extends naturally):

1. **Kind guard.** `verify` is only valid for `kind === 'code'`; `orchestrate.run()` rejects it for `spec`/`plan` at entry, same pattern as the existing `standalone` rejection at `src/cr/orchestrate.ts:169`.
2. **Smoke first.** Call `runSmoke(input.repoRoot)`. Smoke fail → verdict `fail` with smoke evidence, no agent tokens spent.
3. **Acceptance text.** Read the FD's `## Usage` + `## Summary` via the `read-fd-summary.ts` pattern. Missing FD (fast-track) → fall back to `git log <base>..<head> --format='%s%n%b'` commit prose; if that is empty too → `cannot-verify`.
4. **Agent dispatch.** `spawnAgent(prompt, { role: 'verifier', timeoutMs, site: 'cr.verify-dispatch' })` mirroring `subagent-dispatch.ts`, with a `setDispatcher()` injection point for tests. Prompt carries: acceptance text, the diff range (`baseSha..headSha`), the `verifyCommands` surfaces as boot instructions, the worktree port, and the hard rule *"exercise the new behavior through the real interface; never conclude from reading source"*. Output contract: a single fenced JSON block `{ verdict, evidence: [{command, observed}], mismatches: [] }`, zod-validated. Malformed output → `cannot-verify` with the raw head quoted in a note (an advisory outcome, not a lane error — contrast subagent's parse-error-as-blocker, which is correct for a blocking-by-design lane).
5. **Verdict mapping** (the only place `verifyMode` is read — `loadConfig().autonomous.verifyMode`, default `advisory`):
   - `pass` → `ok: true`, evidence recorded.
   - `fail` + `blocking` → mismatches projected into `blockers` (severity `high`, file = artifact) → `ok: false` → orchestrate exit 1 → existing escalate `cr-red` flow.
   - `fail` + `advisory` → mismatches projected into `suggestions`, `ok: true`, summary prefixed `ADVISORY FAIL:`.
   - `cannot-verify` → `ok: true` always, reason in `notes`.
6. **Sink.** `.noldor/cr/<slug>-code-verify.json`, written via `writeJsonAtomic`. `aggregate`, `guardLaneOverwrite`, archive flow all work unchanged since the sink is a `LaneFindings`.

Receipt amend (`amendSubagentReceipt`) stays subagent-only — verify produces no review receipt trailer.

### Unit 5 — policy config (`src/cr/config.ts`)

`autonomousConfigSchema` gains `verifyMode: z.enum(['blocking', 'advisory']).default('advisory')`. Drain's `assertConfig` (`src/autonomous/queue-drain.ts:70`) needs no change — blocking-mode failures surface as ordinary orchestrate exit-1 → `onFailure: abort`. Self-host `.noldor/config.json` opts in: `crLanes.code: ["subagent", "verify"]`, `verifyMode` left at default (`advisory`) for one bake-in release, then flipped to `blocking`.

### Unit 6 — hygiene rails (inside Units 2/4)

- All spawned processes start detached in their own process group; cleanup is `process.kill(-pid)` in a `finally`.
- Wall-clock cap: smoke per-surface `readyTimeoutMs`; whole-lane cap via the `spawnAgent` `timeoutMs` (default 10 min, matching the subagent lane's 600 000 ms).
- Verify runs in the feature worktree (`input.repoRoot`) on the per-tree port — no contention with the main tree's dev server.

### Unit 7 — docs

- `docs/noldor/cr-pipeline.md`: new "verify lane" section (verdict semantics, blocking vs advisory, `cannot-verify` routing).
- `docs/noldor/adoption-guide.md`: `verifyCommands` + `verifyMode` config reference.
- FD `docs/features/acceptance-verify-lane.md`: Usage filled via `/draft-feature-md --from-spec`.

### Data flow

```
gate Step 4 / drain-spawned gate
  └─ pnpm noldor cr orchestrate --kind code [--autonomous]
       ├─ resolveLanes → crLanes.code = ["subagent", "verify"]
       ├─ runSubagent ──────────────► <slug>-code-subagent.json
       └─ runVerify
            ├─ runSmoke (doctor + boot surfaces + probe)
            ├─ acceptance text (FD Usage/Summary | commit prose)
            ├─ spawnAgent(role: verifier) → fenced JSON verdict
            └─ verdict × verifyMode ─► <slug>-code-verify.json
  └─ pnpm noldor cr aggregate --kind code  (exit 1 on blockers → escalate cr-red)
```

### Error handling

- Smoke: doctor failure, boot timeout, non-200 probe, non-zero CLI exit → surface-level `ok: false` with the observed output quoted; lane maps per verifyMode.
- Lane: agent spawn failure/timeout → `cannot-verify` (advisory) with the error in notes — an infra failure must not block a merge in advisory mode and must not silently pass in blocking mode either: in `blocking` mode, spawn failure maps to one blocker `verify lane errored: <msg>` (fail-closed).
- Malformed agent JSON → `cannot-verify` + raw output head in notes.
- Missing `verifyCommands` → smoke trivially green (with a `no surfaces configured` note). The agent receives only configured surfaces — it never invents boot commands; zero surfaces typically yields `cannot-verify`, which is the honest outcome.

### Testing

- Unit: schema parses (`verifyCommands`, `verifyMode`, extended `laneFindingsSchema`); verdict-mapping matrix (verdict × mode → blockers/suggestions/ok); acceptance-text fallback chain (FD → commit prose → cannot-verify); smoke with stub commands (`node -e "process.exit(0)"`, tiny `node:http` server) — boot, probe, kill, timeout paths; orchestrate kind guard (verify + kind=spec throws); dispatcher injection (mirror `subagent.test` pattern).
- Acceptance (from the entry's sketch): seeded wrong implementation (endpoint returns array, FD promises object) with passing self-written tests → verify emits `fail` with quoted mismatch; honest implementation → `pass` with evidence; blocking mode → orchestrate exit 1.

## Acceptance criteria

- `pnpm noldor verify smoke` exists; with self-host config it runs doctor, boots the dashboard surface on the per-tree port, probes HTTP 200, runs the CLI surface, exits 0; with a broken build it exits 1 quoting the failing surface's output.
- `crLanes.code: ["subagent", "verify"]` makes `pnpm noldor cr orchestrate --kind code --autonomous` run both lanes and write `.noldor/cr/<slug>-code-verify.json` containing `verdict`, `evidence`, `mismatches`.
- Deliberately-wrong seeded implementation (endpoint returns array, FD promises object) with a green self-written test suite → verify verdict `fail`, mismatch quoted, and with `verifyMode: "blocking"` orchestrate exits 1 → `cr escalate --reason cr-red` fires.
- Honest implementation → verdict `pass` with at least one `{command, observed}` evidence pair.
- No boot path for the changed behavior → verdict `cannot-verify` with reason; aggregate stays green in both modes.
- `verifyMode` default is `advisory`: a `fail` verdict lands in `suggestions`, exit 0, summary prefixed `ADVISORY FAIL:`.
- `cr orchestrate --kind spec --lanes verify` errors at entry (kind guard).
- Existing suites stay green; `pnpm noldor validate features` passes.

## Risks / trade-offs

- **Judge variance.** Intent-level judgment means two runs can disagree on borderline mismatches. Mitigation: evidence + mismatches must be quoted verbatim, and one bake-in release in advisory mode calibrates strictness before anything blocks.
- **Verifier can be fooled too.** It reads acceptance text written by the same pipeline; a wrong FD yields a confidently-wrong verdict. The lane narrows the blind spot (independent agent, real interface), it doesn't eliminate it.
- **Wall-clock cost.** Boot + probe + agent judgment adds minutes per code-stage orchestrate. Acceptable for autonomous paths; interactive operators can omit `verify` from `--lanes`.
- **Port/process hygiene.** A leaked server process breaks subsequent runs on the same tree. Mitigated by process-group kill in `finally` + per-tree ports; residual risk on SIGKILL of the lane itself.
- **Advisory mode can be ignored.** `ADVISORY FAIL` in a sink nobody reads is the failure mode of the bake-in release. Mitigation: orchestrate's summary table surfaces it in gate chat; flip to blocking is the planned follow-up.

## User Story

As an operator running autonomous paths (drain, watch, gate autonomous mode), I want an independent verify lane that boots the shipped artifact and checks its real behavior against the FD's acceptance text, so that a misunderstood requirement with self-confirming tests cannot merge unnoticed.

## Usage

- Configure boot surfaces once per consumer in `.noldor/config.json` → `consumer.verifyCommands` (`server` surfaces get `{port}` + health probe, `cli` surfaces get exit-0 check).
- Opt the lane in: `crLanes.code: ["subagent", "verify"]`; choose policy via `autonomous.verifyMode: "advisory" | "blocking"` (default advisory).
- Smoke floor standalone: `pnpm noldor verify smoke [--json]` — doctor + boot every surface + probe; exit 0/1.
- Full lane rides the existing flow: `pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --autonomous` → verdict sink at `.noldor/cr/<slug>-code-verify.json`; `pnpm noldor cr aggregate --slug <slug> --kind code` turns blocking failures into the escalate flow.
- Drain/watch need no flags — they inherit `crLanes.code` from config.

## Open questions (resolved)

1. *Judge strictness — exact-shape matching or intent-level judgment?*
   -> Intent-level, with evidence quoted verbatim and mismatches enumerated (D1). Exact-shape matching reproduces the brittleness of self-written assertions; the lane's value is an independent reading of intent.
2. *UI-only changes without an API/CLI surface?*
   -> Out of scope v1; verdict `cannot-verify` (D2). Honest signal beats a fake pass; a browser-driving verifier is a follow-up entry.
3. *Should verify evidence attach to the PR body?*
   -> Yes, follow-up slice (D3): pr-flow already derives the body from session + FD; appending the verify evidence block is a small `pr-flow.ts` change but rides better as its own fast-track after the lane bakes — keeps this FD's diff focused.
4. *Acceptance source for FD-less fast-tracks — roadmap-entry prose?*
   -> v1 falls back to commit subject+body for the range, then `cannot-verify` (D5). The roadmap block is being mutated/retired by the very drain run that needs it; commit prose is always present and describes the promised change.
5. *Where does the smoke floor run when no per-FD lane is configured?*
   -> `pnpm noldor verify smoke` is independently callable and cheap (D4); autonomous gate Step 4 can adopt it as a fixed pre-merge step in a later policy change — v1 keeps it lane-embedded + standalone CLI only.
6. *New agent role or reuse `reviewer`?*
   -> New `verifier` role (D6): the capability profile differs (execute vs read-only) and role-resolution fit checks + consumer remapping need to distinguish them.
