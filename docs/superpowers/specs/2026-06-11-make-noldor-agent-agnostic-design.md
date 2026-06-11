# Make Noldor Agent-Agnostic — Design

**Slug:** make-noldor-agent-agnostic
**FD:** docs/features/make-noldor-agent-agnostic.md
**Date:** 2026-06-11
**Tier:** full
**Deps:** de-superpowers-vendor-spec-plan-and-worktree-flows (shipped PR #70)

> Scope note: this spec absorbs the `Multi-Runner Agent Runtime (Claude Code, Codex, opencode)` roadmap entry (2026-06-11) as the ratified design for this FD's three original asks. That roadmap block is removed in the same commit as this spec; its flag-mapping table and rollout guidance live on here and in `docs/noldor/agent-runtimes.md`.

## Problem

The framework hard-codes its agent runtimes at the spawn level. The Claude CLI is welded into five sites with Claude-specific flags, and Codex is welded into one CR lane:

- `src/autonomous/drain-io.ts:148` `spawnGate` — `claude --print <prompt> --disallowed-tools AskUserQuestion --permission-mode bypassPermissions`, stdio inherit
- `src/prep/spawn.ts:22` `spawnClaude` — same argv shape, stdout piped, timeout kill
- `src/cr/lanes/subagent-dispatch.ts:50` — `claude -p <prompt> --dangerously-skip-permissions` via `execFile`
- `src/release/llm-polish-summary.ts:71` `runClaudePolish` — `claude -p <prompt>`, pure text
- `src/cr/lanes/standalone.ts` — osascript + iTerm + `claude --dangerously-skip-permissions [--max-thinking]`, double-coupled (macOS GUI **and** Claude)
- `src/cr/run-codex.ts:32` — `codex exec --sandbox read-only --skip-git-repo-check --output-schema <path>`, the only Codex call, owned by the CR lane instead of a shared runner layer

Consequences: a consumer cannot pick or mix runtimes, local models are impossible (Claude/Codex don't do local), the autonomy story has a single-vendor dependency, and Claude-coupling regrows silently because nothing exercises an alternative path.

Decision (2026-06-11, ratified): **Claude Code, Codex, and opencode are three first-class simultaneous runtimes.** Not a migration — a registry where every spawn site resolves a runner per role, and one repo can mix all three. Local models arrive via the opencode runner (ollama et al. through `opencode.json` providers).

## Goals

1. **Runner registry** — `src/core/agent-runner/` with `spawnAgent(prompt, opts)` resolving role → runner → argv; three built-in runners (`claude`, `codex`, `opencode`); Codex argv shape extracted out of `src/cr/run-codex.ts` (the CR lane becomes a registry consumer).
2. **Capability matrix as code + doc** — per-runner capabilities (`structuredOutput`, `sandbox`, `supportsLocalModels`, question-suppression mechanism, rules file) validated at role-resolution time; published as `docs/noldor/agent-runtimes.md` (fulfills original ask 3).
3. **Config** — optional top-level `agents:` block in `.noldor/config.json`: `default` runner + per-role `{ runner, model? }`. Absent block ≡ today's behavior exactly (claude everywhere, codex where `crLanes` says so).
4. **Refit the four headless Claude sites** (`spawnGate`, `prep/spawn`, `subagent-dispatch`, `llm-polish-summary`) onto the registry; preserve each site's timeout/stdio/error semantics.
5. **Standalone lane disposition** — drop `standalone` from the orchestrate-runnable lane set; the iTerm deep-review spawn survives only at the `cr escalate spawn-deep-review` seam, argv built via the registry's claude runner (fulfills original ask 2's worst offender).
6. **Agent-events writer** — minimal `.noldor/agent-events.jsonl` appender; one event per spawn with a `runner` field. The `/agents` dashboard page stays in the `agent-events-log-and-agents-dashboard-page` roadmap entry; only the writer seam lands here.
7. **Doctor runner checks** — `noldor doctor` verifies presence (+ optional version floor) of every *configured* runner CLI.
8. **Interactive-plane shims** — `noldor init --agents claude,codex,opencode` writes per-driver shim sets from one template source: `.claude/` (existing), `.opencode/command/*.md` + `opencode.json`, `AGENTS.md` (fulfills original ask 1). Direction stays **fat CLI, thin shims**.

## Non-goals

- **Implementer graduation policy** — which runners are trusted to implement is telemetry-driven (`outcome-telemetry-and-effectiveness-metrics` entry). v1 ships the seam; default config keeps `implementer: claude`.
- **Dashboard `/agents` page, event rotation/retention** — `agent-events-log-and-agents-dashboard-page` entry owns those; this FD only writes the JSONL.
- **Real-CLI CI smoke tests** — `real-codex-integration-smoke-test` entry's territory; all tests here are fixture/mock-based.
- **Session continuity for retries** (`opencode --session`, `codex exec resume`) — deferred, fresh-spawn retries stay.
- **Full skill parity on Codex/opencode** — v1 shims are thin command pointers; deep gate-flow parity on non-Claude drivers is a follow-up once the seam exists.
- **crLanes vocabulary generalization** (lane names → role refs) — deferred; `crLanes` keeps its current lane enum, only the lanes' *internals* route through the registry.

## Design

### Unit 1 — `src/core/agent-runner/` (registry + runners)

```
src/core/agent-runner/
  types.ts          — roles, runner names, capabilities, spawn opts/result
  capabilities.ts   — CAPABILITIES: Record<RunnerName, RunnerCapabilities>
  registry.ts       — resolveRunner(role, config) + spawnAgent(prompt, opts)
  runners/claude.ts — argv builder
  runners/codex.ts  — argv builder (extracted from run-codex.ts)
  runners/opencode.ts — argv builder
```

Types (exact shapes):

```ts
export type AgentRole = 'implementer' | 'reviewer' | 'second-opinion' | 'polish';
export type RunnerName = 'claude' | 'codex' | 'opencode';

export interface RunnerCapabilities {
  structuredOutput: 'schema' | 'events' | 'prose';
  sandbox: 'fine' | 'coarse' | 'none';
  supportsLocalModels: boolean;
  questionSuppression: 'flag' | 'non-interactive' | 'permission-config';
  rulesFile: 'CLAUDE.md' | 'AGENTS.md';
}

export interface SpawnAgentOpts {
  role: AgentRole;
  runner?: RunnerName;               // pin a runner, bypassing role resolution (codex CR lane)
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdio?: 'pipe' | 'inherit';        // OUTPUT handling only (stdout/stderr); default 'pipe'.
                                     // stdin is always owned by the runner's prompt-delivery
                                     // channel: argv-runners → 'ignore', stdin-runners → 'pipe'
                                     // (prompt written then closed) — so 'inherit' + codex still works.
  schemaPath?: string;               // requires a schema-grade runner (codex)
  needsWrite?: boolean;              // drives codex sandbox mode + opencode permissions
  site?: string;                     // caller tag for agent-events, e.g. 'drain.spawnGate'
}

export interface AgentResult {
  exitCode: number;
  stdout: string;                    // '' under stdio: 'inherit'
  timedOut: boolean;
}
```

Argv builders (per runner; prompt delivery differs and is part of the builder contract):

| Runner | argv | prompt via | notes |
| --- | --- | --- | --- |
| claude | `--print <prompt> --disallowed-tools AskUserQuestion --permission-mode bypassPermissions [--model <m>]` | argv | canonical shape (PR #28/#33) — see normalization note below |
| codex | `exec --sandbox <read-only\|workspace-write> --skip-git-repo-check [--output-schema <path>] [--model <m>]` | stdin | extracted verbatim from `run-codex.ts:39-48`; `needsWrite` picks the sandbox |
| opencode | `run <prompt> --dangerously-skip-permissions [--model <provider/model>]` | argv | flag mapping verified against opencode.ai docs 2026-06-11; re-verify against the installed CLI (`opencode --help`) at implementation time |

**Claude argv normalization.** The five live sites use three claude shapes today: `--print … --disallowed-tools AskUserQuestion --permission-mode bypassPermissions` (drain, prep), `-p … --dangerously-skip-permissions` (subagent-dispatch), and bare `-p …` (polish). The registry deliberately unifies on the canonical shape above for all sites: `-p` ≡ `--print`, `--dangerously-skip-permissions` ≡ `--permission-mode bypassPermissions`, and adding the AskUserQuestion kill-switch to dispatch/polish is a strict robustness upgrade (their prompts never legitimately ask questions; a hallucinated prompt now fails fast instead of hanging). Back-compat goldens therefore pin **byte-identity for drain + prep** (already canonical) and **the new canonical argv for dispatch + polish** with this normalization documented as intentional.

`spawnAgent` behavior: resolve the runner as `opts.runner ?? resolveRunner(opts.role, config)` — an explicit pin short-circuits role resolution entirely (Unit 3 config is consulted only when no pin is given) → capability-fit check (`schemaPath` set but runner's `structuredOutput !== 'schema'` → throw `capability-mismatch` with the runner name and required grade) → build argv → `child_process.spawn` with the timeout-SIGKILL pattern lifted from `src/prep/spawn.ts:42-48` → append one agent-event (Unit 5, fail-open) → resolve `AgentResult`. Spawn `error` events reject with `spawn-failed: <msg>` preserving `drain-io.ts`'s abort-the-drain contract. The PR #33 rule holds for all three runners: **directives ride the prompt, never env/flags.**

### Unit 2 — capability matrix (code + doc)

`capabilities.ts` encodes the table below; `docs/noldor/agent-runtimes.md` publishes it with the full flag mapping and role-config examples.

| capability | claude | codex | opencode |
| --- | --- | --- | --- |
| structuredOutput | prose | schema | events |
| sandbox | none | coarse | fine |
| supportsLocalModels | no | no | yes |
| questionSuppression | flag (`--disallowed-tools`) | non-interactive by design | permission-config (`permission.question: "deny"`) |
| rulesFile | CLAUDE.md | AGENTS.md | AGENTS.md |

### Unit 3 — `agents:` config block

Extends `noldorConfigSchema` (`src/cr/config.ts:44-48` — the file already hosts the top-level `.noldor/config.json` schema; `agents` joins `crLanes`/`autonomous`/`gate`):

```jsonc
"agents": {
  "default": "claude",                                   // optional, default "claude"
  "roles": {                                             // optional, all keys optional
    "implementer":   { "runner": "claude" },
    "reviewer":      { "runner": "codex" },
    "second-opinion":{ "runner": "opencode", "model": "ollama/qwen3" },
    "polish":        { "runner": "opencode", "model": "ollama/llama3.2" }
  },
  "versionFloors": { "opencode": "0.6.0" }               // optional, per-runner
}
```

Zod schema in `src/core/agent-runner/types.ts`, wired `.optional()` into `noldorConfigSchema` (same no-default posture as `crLanes` — never synthesized onto configs that didn't declare it). Resolution: `opts.runner ?? (roles[role] ?? { runner: default ?? 'claude' }).runner` — the pin always wins; role config applies only to unpinned spawns.

### Unit 4 — site refits

- **`drain-io.ts` `spawnGate`** → `spawnAgent(prompt, { role: 'implementer', cwd, env, timeoutMs, stdio: 'inherit', needsWrite: true })`. Keeps `iteration-timeout` reject + `spawn-failed` reject semantics (registry's result maps onto them: `timedOut: true` → throw `iteration-timeout` at the call site).
- **`prep/spawn.ts` `spawnClaude`** → thin wrapper over `spawnAgent(prompt, { role: 'implementer', … , stdio: 'pipe' })`, renamed `spawnAgent` re-export retired gradually; `runWithConcurrency` unchanged.
- **`subagent-dispatch.ts`** default dispatcher → `spawnAgent(buildPrompt(input), { role: 'reviewer', timeoutMs: 600_000 })`. Markdown Strengths/Issues contract unchanged (prose-grade, all runners qualify). `setDispatcher()` injection seam stays for the gate skill and tests.
- **`llm-polish-summary.ts` `runClaudePolish`** → `runPolish` via `spawnAgent(prompt, { role: 'polish', timeoutMs: 60_000 })`. Deterministic fallback + `NOLDOR_NO_LLM` short-circuit unchanged.
- **`run-codex.ts`** — keeps `CrRecord` parsing, prompt formatting, and the `Spawn` injection type for tests; the *default* spawn impl moves to the codex runner module via `spawnAgent(prompt, { role: 'second-opinion', runner: 'codex', schemaPath: cr-record.schema.json, needsWrite: false })`. The **`runner: 'codex'` pin** is load-bearing: the `crLanes` `codex` lane is codex *by name*, so it bypasses role resolution entirely — a consumer mapping `second-opinion → opencode` re-routes other second-opinion spawns but can never push a `schemaPath` onto a non-schema runner here. Behavior identical when `agents:` absent.
- **`standalone.ts`** — `laneSchema` keeps the `'standalone'` enum value (existing `.noldor/cr/*-standalone.json` sinks must still parse), but orchestrate's runnable-lane set excludes it (attempting `--lanes standalone` → clear error naming the escalate path). The osascript spawn + `claudeSupportsMaxThinking` probe move to `src/cr/deep-review-spawn.ts`, consumed only by `src/cr/escalate.ts`; its interactive command string is composed from the claude runner's binary name + permission flag so the coupling is single-sourced. macOS/iTerm requirement documented in `agent-runtimes.md`.

### Unit 5 — agent-events writer

`src/core/agent-events.ts`: `appendAgentEvent(cwd, event)` — append one JSON line to `.noldor/agent-events.jsonl`. Event shape: `{ ts, runner, role, site, exitCode, durationMs, timedOut }` (`site` = caller tag like `drain.spawnGate`, passed via `SpawnAgentOpts`... carried as optional `site?: string`). **Fail-open**: any fs error is swallowed — an events-write failure must never break a spawn. Rotation, schema versioning, and the dashboard reader belong to the `agent-events` roadmap entry.

### Unit 6 — doctor runner checks

`src/cli/commands/doctor.ts` gains a second phase after template drift: load `agents:` config; for each *referenced* runner (default + every role), run `<cli> --version` (5s timeout). Missing CLI → drift-style line + exit 1. Version below the configured floor (numeric per-segment compare of dotted versions — `0.10.0 > 0.6.0`; no range syntax) → exit 1. No `agents:` block → check `claude` only (it's the implicit default). Output joins the existing drift report format.

### Unit 7 — interactive-plane shims (`init --agents`)

`noldor init` gains `--agents <list>` (default `claude` — today's behavior). Template source extends `templates/` (enumerated by `src/templates/manifest.ts` walk — new files are picked up automatically by `templateFiles()`):

- `templates/AGENTS.md` — gate workflow summary + `pnpm noldor` command catalog (Codex + opencode both read it natively).
- `templates/.opencode/command/*.md` — thin command shims (`/gate` → "run `pnpm noldor …` per docs/noldor/workflow.md", etc.) mirroring the `.claude/skills/` catalog entries that are pure CLI pointers.
- `templates/opencode.json` — provider placeholder + generated permission block: `permission.question: "deny"` and `edit` denies for the shared-files guard list (the opencode equivalent of `src/hooks/` pre-edit guards).

Selection logic: `--agents` filters which template subtrees `copyTemplate` writes (`.claude/**` ↔ claude, `.opencode/**` + `opencode.json` ↔ opencode, `AGENTS.md` ↔ codex or opencode). `doctor`'s template-drift phase respects the same filter (a consumer who never opted into opencode isn't flagged for missing `.opencode/`): the chosen agent list is recorded in `agents.targets` (string array, default `["claude"]`) so `doctor`/`init --update` stay deterministic. Guard floor for all three runners stays the lefthook git-hook chain (trailer inject/validate, session-marker pre-commit) — agent-neutral by construction.

### Data flow

```
caller (drain | prep | CR lane | release)
  → spawnAgent(prompt, { role, … })
    → opts.runner ?? resolveRunner(role, loadConfig().agents)   (pin wins; claude when absent)
    → capability-fit check (schemaPath ⇒ schema grade)
    → runners/<name>.buildArgv(prompt, opts)
    → child_process.spawn + timeout SIGKILL
    → appendAgentEvent(...)                            (fail-open)
  ← AgentResult { exitCode, stdout, timedOut }
```

### Error handling

- Runner CLI missing (`ENOENT`) → reject `spawn-failed: …` — preserved drain contract (abort whole drain, no retry churn).
- Capability mismatch at resolve time → throw with runner name + required capability + the config path to fix (`agents.roles.<role>.runner`).
- Malformed `agents:` block → zod parse error at `loadConfig` (strict, same as existing blocks).
- Timeout → SIGKILL + `timedOut: true`; call sites keep their existing per-site semantics (drain: `iteration-timeout`; polish: falls into deterministic fallback via throw).
- Events append failure → swallowed.

### Testing

All mock-spawn, zero real CLIs (real-CLI smoke is a separate roadmap entry):

- Golden argv tests per runner builder, incl. sandbox flip on `needsWrite`, `--output-schema` injection, `--model` pass-through.
- Registry: role resolution (configured / default-fallback / absent block), capability-mismatch throw, timeout kill, spawn-error reject, event emitted per spawn.
- **Back-compat goldens:** with no `agents:` block, each refit site produces argv byte-identical to today's literals (the five sites' current shapes captured as fixtures).
- Refit sites: existing test seams reused (`DrainDeps` mocks in `run-drain.test.ts`, `setDispatcher`, `PolishRunner`, run-codex `Spawn` injection).
- Events writer: appends valid JSONL, swallows fs errors.
- Doctor: fake-PATH fixtures for present/missing/below-floor runners; no `agents:` block → claude-only check.
- Init: `--agents` subtree filtering matrix (claude-only writes no `.opencode/`; full list writes all).
- `laneSchema` still parses legacy `standalone` sink JSON; orchestrate rejects `--lanes standalone` with the escalate pointer.

## Acceptance criteria

- Architecture-invariant test `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`: scans every `src/**/*.ts` (excluding `__tests__`, `src/core/agent-runner/`, and `src/cr/deep-review-spawn.ts`) with the multiline-tolerant regex `/\b(?:spawn|spawnSync|execFile|execFileSync|execFileP|exec)\s*\(\s*['"](?:claude|codex|opencode)['"]/m` over file contents — zero matches. (A shell grep can't see `spawn(\n  'claude'` split across lines and a bare `'codex'` pattern over-matches runner-name literals in types/config; the invariant test is the guard.)
- With no `agents:` config block: full test suite green; golden-argv tests pin drain + prep byte-identical to pre-refit argv, and dispatch + polish to the documented canonical normalization (Unit 1).
- `agents.roles.reviewer = { runner: 'codex' }` routes `subagent-dispatch` through codex argv (golden test).
- `agents.roles.polish = { runner: 'opencode', model: 'ollama/x' }` produces `opencode run … --model ollama/x` (golden test).
- Every `spawnAgent` call appends one `.noldor/agent-events.jsonl` line carrying `runner`, `role`, `site`.
- `noldor doctor` exits 1 naming the runner when a configured runner CLI is absent or below its version floor; exits 0 on this repo's default config.
- `noldor init --agents claude,codex,opencode` writes `.opencode/command/`, `opencode.json`, `AGENTS.md`; `--agents claude` writes none of them.
- `pnpm noldor cr orchestrate --lanes standalone` errors with a message pointing at `cr escalate`; `cr escalate` deep-review spawn still works (mock osascript test).
- `pnpm noldor validate features` green; `pnpm test` + `pnpm typecheck` green.
- `docs/noldor/agent-runtimes.md` exists with the flag mapping + capability matrix + config examples.

## Risks / trade-offs

- **CLI flag drift** (all three move fast) — mitigated by version floors in config + doctor checks; argv builders are single files to patch.
- **Thin shims ≠ skill parity** — a non-Claude implementer can't drive the full `/gate` skill flow v1. Accepted: rollout is polish/reviewer-first, implementer-last (telemetry-gated, separate entry); the seam still lands so coupling can't regrow.
- **`laneSchema` keeps a non-runnable value** — slight enum impurity traded for sink back-compat; revisit when `crLanes` vocabulary generalizes to roles.
- **Events file unbounded growth** — accepted v1; rotation is the agent-events entry's concern.
- **opencode `--format json` event-stream parsing deferred** — v1 treats opencode output as prose (capability `events` reserved for richer wiring later); no consumer in this slice needs structured opencode output.

## User Story

As a Noldor consumer (human operator or autonomous agent), I want every framework agent spawn to resolve through a role-based runner registry covering Claude Code, Codex, and opencode, so that I can pick or mix runtimes per role — including local models via opencode — without touching framework code, and without the framework silently re-welding itself to one vendor.

## Usage

```jsonc
// .noldor/config.json — opt-in; absent block keeps today's behavior
"agents": {
  "default": "claude",
  "roles": {
    "reviewer": { "runner": "codex" },
    "polish":   { "runner": "opencode", "model": "ollama/llama3.2" }
  },
  "versionFloors": { "opencode": "0.6.0" },
  "targets": ["claude", "codex", "opencode"]
}
```

- `noldor init --agents claude,codex,opencode` — write the per-driver shim sets (`.claude/`, `.opencode/command/` + `opencode.json`, `AGENTS.md`).
- `noldor doctor` — template drift + presence/version check for every configured runner.
- Framework code: `import { spawnAgent } from 'src/core/agent-runner/registry.js'` → `await spawnAgent(prompt, { role: 'reviewer', timeoutMs: 600_000 })`.
- Inspect spawns: `tail .noldor/agent-events.jsonl` — one line per spawn with `runner` / `role` / `site` / `exitCode`.

## Open questions (resolved)

1. *(D1) Which role does `prep/spawn.ts` map to — its children draft specs/plans, not code?*
   -> `implementer`. Same permission class (writes files unattended); a fifth `drafter` role adds vocabulary without a behavioral difference today.
2. *(D2) Drop `'standalone'` from `laneSchema` or keep it?*
   -> Keep the enum value, exclude it from orchestrate's runnable set. Existing sink JSONs must keep parsing; aggregate/garden read old runs.
3. *(D3) Where do agent events live and who owns rotation?*
   -> `.noldor/agent-events.jsonl`, append-only, fail-open. Rotation + dashboard = `agent-events-log-and-agents-dashboard-page` entry (kept in roadmap, its scope shrinks by the writer).
4. *(D4) Doctor on below-floor version: warn or error?*
   -> Error (exit 1). A floor exists because something is known-broken below it; a warning would scroll past in autonomous runs.
5. *(D5) Codex sandbox mode selection?*
   -> `needsWrite` opt: `workspace-write` for implementer-class spawns, `read-only` otherwise. Explicit boolean beats inferring from role names.
6. *(D6) opencode question suppression mechanism?*
   -> Generated `opencode.json` `permission.question: "deny"` + `--dangerously-skip-permissions` at spawn (still respects explicit `deny` rules — verified against opencode docs 2026-06-11).
7. *(D7) Shim depth for v1?*
   -> Thin command pointers + `AGENTS.md` only (fat CLI, thin shims). Deep skill parity is a follow-up after the seam exists; implementer-last rollout makes this safe.
8. *(D8) Does the claude runner accept per-role models?*
   -> Yes — pass `--model` when `roles.<role>.model` is set; omitted otherwise (session default).
9. *(D9) What happens to the multi-runner roadmap entry's "mixed-fleet rollout" bullet?*
   -> Becomes guidance prose in `agent-runtimes.md` (rollout order: polish → CR lanes → implementer). The telemetry gating itself already lives in the `outcome-telemetry-and-effectiveness-metrics` entry; no residue entry needed.
10. *(D10) Where does the `agents:` zod schema live — `src/cr/config.ts` hosts `noldorConfigSchema` today?*
    -> Schema defined in `src/core/agent-runner/types.ts`, imported into `noldorConfigSchema` in `src/cr/config.ts`. Keeps runner types self-contained; avoids a config-module reshuffle in this slice.
11. *(D11) Can role-config remaps break spawns that require schema-grade output?*
    -> No: such call sites pin `runner: 'codex'` (bypassing role resolution — see the run-codex refit). The capability-mismatch throw remains as a defensive backstop for future unpinned `schemaPath` callers.
12. *(D12) How does `stdio: 'inherit'` coexist with codex's stdin prompt delivery?*
    -> `stdio` governs stdout/stderr only; stdin is always owned by the runner's prompt-delivery channel (argv-runners `ignore`, stdin-runners `pipe` + write + close). `inherit` + codex therefore streams output live while the prompt still arrives.
