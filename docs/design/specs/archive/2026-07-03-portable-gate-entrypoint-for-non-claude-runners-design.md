# Portable Gate Entrypoint for Non-Claude Runners — Design

**Slug:** portable-gate-entrypoint-for-non-claude-runners
**FD:** docs/features/portable-gate-entrypoint-for-non-claude-runners.md
**Date:** 2026-07-03
**Tier:** specs-only

## Problem

The drain's *spawn layer* is runner-agnostic — `spawnGate` (`src/autonomous/drain-io.ts:193`) delegates to `spawnAgent` (`src/core/agent-runner/registry.ts:93`), which resolves the `implementer` role via `.noldor/config.json`'s `agents:` block and builds runner-specific argv (`buildClaudeArgv` / `buildCodexArgv` / `buildOpencodeArgv`). But the *prompt* is not: `roadmapSource.gatePrompt` returns `/gate --drain <slug>` (`src/autonomous/drain-source.ts:97-99`) and `plansSource.gatePrompt` returns `/gate --resume <slug> --autonomous` plus prose (`drain-source.ts:170-187`). Both lean on the Claude Code slash-command system to expand `.claude/skills/gate/SKILL.md`.

On codex the prompt rides stdin into `codex exec` (`runners/codex.ts` — `CODEX_PROMPT_VIA = 'stdin'`); there is no slash-command system, so `/gate --drain <slug>` is literal prose with no referent — no gate runs, the child burns a timeout, the supervisor retries then skips. On opencode (`opencode run <prompt>`) a `/gate` custom command would need to be vendored and executable via `run`; the vendored template `templates/.opencode/command/gate.md` exists but is a 651-byte interactive summary with **no drain-mode semantics** (no `--drain`, no `fast/<slug>` branch discipline, no zero-question contract), and command-invocation through `opencode run` is version-dependent. `docs/noldor/agent-runtimes.md:60` states the gap explicitly: "a non-Claude implementer cannot drive the full `/gate` skill flow yet."

PR #119's portable CLIs (`noldor features phase-flip-done`, `features phase-revert`, `roadmap remove-block` — all in `src/cli/manifest.ts`) made the gate's *manual steps* runner-neutral. The remaining Claude-only artifact is the drain **entry prompt itself**. Strategic per the 2026-07 audit: harness-neutrality is the defensible layer.

## Goals

- A drain configured with `agents.roles.implementer.runner: 'codex' | 'opencode'` spawns a gate child that actually executes the drain flow — no slash-command dependency in the prompt it receives.
- Prompt shape is decided by a declared runner capability, not by string-sniffing or per-source hacks.
- Claude behavior is byte-identical to today (default config ≡ claude everywhere; the battle-tested `/gate --drain <slug>` path must not churn).
- Both drain sources covered: `roadmapSource` (fast-track) and `plansSource` (resume of designed FDs).
- The prose entry has a canonical, runner-neutral instruction page so the prompt stays a thin pointer, not a second copy of the gate skill.

## Non-goals

- A deterministic `noldor gate` CLI that *executes* the gate flow itself (full option (a) of the roadmap entry). The gate is an LLM-judgment flow (implement the entry, judge CR findings, resolve escalations); the established posture is "fat CLI, thin skills" (`agent-runtimes.md`). This spec ports the *entrypoint*, not the flow.
- Runner parity certification for `implementer`. Rollout guidance (`agent-runtimes.md` §Rollout) still says implementer-last, telemetry-gated; this spec removes the hard blocker, not the caution.
- Migrating the interactive `/gate` (human-driven) to other runners.
- CR-lane or research-fanout prompt portability (already runner-native or prose).

## Design

### Unit 1 — `promptDispatch` capability (`src/core/agent-runner/capabilities.ts`, `types.ts`)

Add one field to `RunnerCapabilities`:

```ts
/** How framework entry prompts are dispatched: 'slash-command' expands a
 *  vendored skill/command; 'prose' must be self-contained instructions. */
promptDispatch: 'slash-command' | 'prose';
```

Values: `claude: 'slash-command'`, `codex: 'prose'`, `opencode: 'prose'`, `stub: 'slash-command'` (the stub e2e harness of the consumer-contract CI replays canned work against today's prompt shapes; keeping it on the claude shape leaves those fixtures untouched — see D5). Doc twin `docs/noldor/agent-runtimes.md` capability table gains the row.

### Unit 2 — gate-prompt builder (`src/autonomous/gate-prompt.ts`, new)

```ts
export type PromptDispatch = 'slash-command' | 'prose';
export function buildDrainGatePrompt(slug: string, dispatch: PromptDispatch): string;
export function buildResumeGatePrompt(slug: string, dispatch: PromptDispatch): string;
```

- `'slash-command'` returns today's strings **verbatim** (moved, not rewritten, from `drain-source.ts:98` and `drain-source.ts:177-186`).
- `'prose'` returns a self-contained directive block, honoring the PR #33 rule (directives ride the prompt, never env). Drain shape, roughly:

  ```
  Autonomous Noldor drain run. Read docs/noldor/drain-mode.md and follow it exactly.
  Ship roadmap entry '<slug>' end-to-end on branch 'fast/<slug>' with ZERO interactive
  questions: force-recreate the branch, implement the entry, remove its roadmap block
  (`pnpm noldor roadmap remove-block <slug>`), mark the session autonomous
  (`pnpm noldor noldor set-autonomous`), run code-stage CR
  (`pnpm noldor cr orchestrate ... --autonomous`), ship via `pnpm noldor pr-flow`.
  On CR-red or test-red run `pnpm noldor cr escalate --autonomous` and exit non-zero.
  ```

  The resume variant mirrors `plansSource`'s existing prose context (spec+plan must exist, branch `feat/<slug>`, never pause for lane picker / PR approval) minus the `/gate --resume` first line, plus the same `drain-mode.md` pointer.

The env contract is untouched: the loop still sets `NOLDOR_DRAIN=1` / `NOLDOR_DRAIN_SKIP` / `NOLDOR_DRAIN_SLUG` / `NOLDOR_DRAIN_OPEN_ONLY` (`envFor`, `src/autonomous/drain-loop.ts`), and the prose prompt restates the slug so a runner that ignores env still binds to the right entry.

### Unit 3 — dispatch resolution at source construction (`src/autonomous/drain-source.ts`)

`roadmapSource(cwd)` and `plansSource(cwd)` resolve dispatch once at construction:

```ts
const cfg = loadAgentsConfig(cwd);
const dispatch = CAPABILITIES[resolveRunner('implementer', cfg).runner].promptDispatch;
```

and their `gatePrompt(slug)` implementations delegate to Unit 2 with that dispatch. The `DrainSource` interface (`drain-source.ts:30-40`), `spawnGate` (`drain-io.ts:193`), and the loop's spawn site (`drain-loop.ts:250-253`) are all unchanged — the seam stays "source produces prompt string, loop passes it through." A per-spawn `opts.runner` pin never occurs on the drain path (`spawnGate` passes only `role: 'implementer'`), so construction-time resolution cannot disagree with spawn-time resolution.

Also fix the latent Claude-only default in `spawnGate` (`drain-io.ts:197`, `prompt = '/gate'`): drop the default and require the caller's prompt (its only caller, `queue-drain.ts:169`, always passes one), so no `/gate` literal survives outside the builder.

### Unit 4 — runner-neutral drain-mode page (`docs/noldor/drain-mode.md` + twin `templates/docs/noldor/drain-mode.md`)

New `noldor-page` doc porting the gate skill's **Drain mode** section (`.claude/skills/gate/SKILL.md:333-373`) into runner-neutral language: slug binding and `NOLDOR_DRAIN_SKIP` honoring, `fast/<slug>` deterministic branch + force-recreate discipline, roadmap-block retirement via `pnpm noldor roadmap remove-block`, autonomous end-of-flow (`set-autonomous`, `cr orchestrate --profile fast-track --autonomous`, `pr-flow`, `NOLDOR_DRAIN_OPEN_ONLY` semantics), resume-path artifact preconditions (spec + plan present, else exit non-zero), exit-code contract. "Zero `AskUserQuestion`s" is phrased tool-neutrally ("never ask interactive questions; runners enforce this via their kill-switch — see agent-runtimes.md flag mapping"). The gate skill's drain-mode section stays authoritative for the Claude path and gains a one-line cross-link; this page is the prose-dispatch entrypoint's canonical referent, so the prompt (Unit 2) stays a pointer and drift risk concentrates in one doc.

### Unit 5 — opencode command refresh (`templates/.opencode/command/gate.md`)

Small parity touch for *interactive* opencode use: add a drain/resume paragraph pointing at `docs/noldor/drain-mode.md`. Headless drain on opencode does not depend on this (prose dispatch, D3), so this stays a doc-template edit gated by the template-sync check (`src/checks/check-template-sync.ts`).

### Unit 6 — tests (`src/autonomous/__tests__/drain-source.test.ts` + new `gate-prompt.test.ts`, `src/core/agent-runner/__tests__`)

- Builder matrix: `buildDrainGatePrompt(slug,'slash-command')` === today's literal; `'prose'` output contains the slug, `fast/<slug>`, `drain-mode.md`, and does **not** contain the token `/gate`. Same matrix for the resume builder (`feat/<slug>`, autonomous directives).
- Source wiring: with a fixture `.noldor/config.json` pinning `agents.roles.implementer.runner: 'codex'`, `roadmapSource(cwd).gatePrompt(slug)` is the prose form; with no `agents:` block it is byte-identical to the pre-change string (regression lock).
- Capabilities: every `RUNNER_NAMES` member has a `promptDispatch` (type-enforced; table snapshot updated).

## Acceptance criteria

- `CAPABILITIES[r].promptDispatch` defined for all four runners; `docs/noldor/agent-runtimes.md` table row added.
- With `agents.roles.implementer.runner: 'codex'` (or `'opencode'`), `roadmapSource(cwd).gatePrompt(slug)` and `plansSource(cwd).gatePrompt(slug)` return prose containing the slug and correct branch prefix and containing no `/gate` token.
- With no `agents:` block (claude default), both `gatePrompt` outputs are byte-identical to current main (verified by regression test).
- `docs/noldor/drain-mode.md` exists with `noldor-page` frontmatter, has a matching `templates/docs/noldor/` twin, and `pnpm noldor checks template-sync` passes.
- `spawnGate` no longer defaults `prompt = '/gate'`.
- `.claude/skills/gate/SKILL.md` drain-mode section cross-links `drain-mode.md`; skill-twin sync (template copy) updated in the same PR.
- `pnpm verify` green (unit tests above + existing drain suite unchanged).

## Risks / trade-offs

- **Two renderings of drain semantics** (gate skill for claude, drain-mode.md for prose) can drift. Mitigation: drain-mode.md is the single prose referent (prompt is a pointer, not a copy), and both cite the portable CLIs rather than restating their behavior; a future garden detector could diff the two sections.
- **Prose-dispatch drain is untested end-to-end on real codex/opencode.** This spec makes the entry *possible*, not *proven*; rollout guidance (implementer-last, telemetry-gated) still applies. The stub runner cannot cover LLM-judgment fidelity.
- **opencode permission surface**: headless drain relies on `--dangerously-skip-permissions` respecting explicit `deny` rules (`runners/opencode.ts` comment); a consumer without the generated deny template could let a drain child edit shared files. Unchanged from today's opencode posture, but the drain path newly exercises it.
- **Prompt-size asymmetry**: prose entry is longer than `/gate --drain <slug>` but far smaller than inlining the skill; pointing at drain-mode.md keeps it bounded.

## User Story

As an operator whose `.noldor/config.json` maps the `implementer` role to codex or opencode, I want `noldor autonomous run` to spawn gate children with a prompt those runners can actually execute, so that the autonomous drain works on my configured runner instead of silently degrading to a literal-text prompt that ships nothing.

## Usage

```bash
# Configure a non-claude implementer (consumer repo)
# .noldor/config.json → "agents": { "roles": { "implementer": { "runner": "codex" } } }

# Drain exactly as today — prompt shape now follows the resolved runner:
pnpm noldor autonomous run --source roadmap        # codex child gets prose drain directive
pnpm noldor autonomous run --source plans          # prose resume directive (feat/<slug>)
pnpm noldor autonomous run --source roadmap --dry-run   # unchanged; prompts not spawned

# Claude consumers: zero change — children still get `/gate --drain <slug>`.

# Canonical prose referent (what a non-claude child is told to read):
docs/noldor/drain-mode.md
```

Agent API: none new — `DrainSource.gatePrompt(slug)` keeps its signature; `buildDrainGatePrompt` / `buildResumeGatePrompt` exported from `src/autonomous/gate-prompt.ts` for tests and future entry points.

## Open questions (resolved)

1. *(D1)* *Full portable CLI (`noldor gate --drain <slug>` that orchestrates the flow) or portable prompt?*
   -> Portable **prompt** (builder + capability dispatch + doc referent); no gate-executing CLI.
   The gate is an LLM-judgment flow and the framework posture is already "fat CLI, thin skills" (`agent-runtimes.md:60`); after PR #119 the prompt is the only non-portable link left, so porting it is the minimal defensible unit.

2. *(D2)* *Where does runner-awareness live — in `spawnGate`, in the loop, or in the sources?*
   -> Resolve `promptDispatch` once at source construction (`roadmapSource(cwd)` / `plansSource(cwd)`) via `loadAgentsConfig` + `resolveRunner('implementer', …)` + `CAPABILITIES`.
   Keeps the `DrainSource` seam and `spawnGate` signatures unchanged, and the drain path never pins `opts.runner`, so construction-time and spawn-time resolution cannot diverge.

3. *(D3)* *Should opencode use its vendored `/gate` command (option b) instead of prose?*
   -> Prose. The vendored `templates/.opencode/command/gate.md` is an interactive summary with no drain semantics, and command invocation through `opencode run` is version-dependent; prose dispatch is deterministic across opencode versions. Revisit only if command-exec proves reliable and token savings matter.

4. *(D4)* *Does `plansSource` convert too, or roadmap-only first?*
   -> Both in this feature. `plansSource.gatePrompt` has the identical defect (`/gate --resume` first line), its prose context already exists to adapt, and shipping roadmap-only would leave the multi-runner promise half-kept for designed FDs.

5. *(D5)* *What dispatch does the `stub` runner get?*
   -> `'slash-command'` (mirror claude). The consumer-contract CI's drain e2e replays canned work against today's prompt shapes; keeping stub on the claude shape leaves those fixtures byte-identical and tests the default-path regression for free.
