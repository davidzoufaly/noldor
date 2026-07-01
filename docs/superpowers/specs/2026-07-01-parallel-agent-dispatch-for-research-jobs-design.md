# Parallel-Agent Dispatch for Research Jobs — Design

**Slug:** parallel-agent-dispatch-for-research-jobs
**FD:** docs/features/parallel-agent-dispatch-for-research-jobs.md
**Date:** 2026-07-01
**Tier:** full
**Deps:** none

## Problem

Noldor fans out parallel _build_ agents (K-concurrent drain, `prep fanout` draft agents) but has no first-class primitive for parallel _read/research_ agents — codebase research, multi-subsystem investigation, cross-file audits, "understand X before we spec it." Today the driving session (operator, gate spec-stage, plan investigation, `/garden` deep-dive) investigates sequentially in one context: wall-clock is serialized and every intermediate file dump pollutes the driving session's context window. `superpowers:dispatching-parallel-agents` codifies the pattern (one context-isolated subagent per independent problem domain, self-contained prompt, required structured return, synthesis) but only for the harness-native Agent tool — nothing reusable from headless flows, no runner-agnosticism, no telemetry.

## Goals

- A `noldor research fanout` CLI that takes N independent research task specs, spawns one **read-only** researcher agent per task (max K concurrent), enforces a structured stdout return, and writes findings + a deterministic `INDEX.md` to a staging batch dir.
- Opt-in `--synthesize`: one extra agent merges the N findings into `SYNTHESIS.md` so a headless caller (or context-poor driving session) reads exactly one artifact.
- Runner-agnostic via the existing `spawnAgent` seam (`src/core/agent-runner/registry.ts`) with a new `researcher` role; per-spawn telemetry lands in the agent-events log for free.
- A thin `noldor-research` skill that codifies the driving-agent discipline: decompose into independent tasks → write tasks file → invoke CLI → read INDEX (+ selected findings) → synthesize into the driving artifact.
- Reuse existing infra: `runWithConcurrency` (today in src/prep/spawn.ts; hoisted to src/core/concurrency.ts as part of this work), prep's staging/manifest/INDEX pattern (src/prep/staging.ts), the timeout-SIGKILL spawn pattern.

## Non-goals

- **No worktree / merge coordination.** Researchers are read-only; nothing to serialize. The merge-coordinator stays untouched.
- **No auto-wiring into gate/plan/garden flows.** This ships the primitive + documents the integration points; callers invoke the CLI (or skill) explicitly. Wiring `/gate` spec-stage or `/garden` to auto-fanout is a follow-up entry.
- **No streaming or partial results.** A batch runs to completion (or per-task timeout), then reports.
- **No new runner capabilities.** The stdout envelope is a prompt-level convention, not a schema-enforced contract (claude's `structuredOutput` grade is `prose`).
- **No `research` subcommands beyond `fanout`.** (`research synth <batch>`, re-runs, resume — YAGNI until a real consumer asks.)

## Design

### Unit 1 — `src/research/types.ts` (schemas)

```ts
export const taskSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), // filename-stem for findings
    question: z.string().min(1), // the one thing this agent answers
    scope: z.array(z.string().min(1)).default([]), // paths/globs to focus on (hint, not sandbox)
    context: z.string().optional(), // self-contained background (child never inherits session history)
    expects: z.string().optional(), // what a good answer contains
  })
  .strict();
export const tasksFileSchema = z.object({ tasks: z.array(taskSpecSchema).min(1) }).strict();

export const researchMetaSchema = z
  .object({
    status: z.enum(['answered', 'partial', 'blocked']),
    headline: z.string().min(1), // one-line answer for INDEX
    confidence: z.enum(['low', 'med', 'high']).default('med'),
    refs: z.array(z.string()).default([]), // file paths / symbols the findings cite
  })
  .strict();
```

`ResearchResult` (per task, computed by the CLI): `{ id, question, ok, spawnStatus, meta, findingsFile }` where `meta` falls back to `{ status: 'blocked', headline: 'unparsed output', confidence: 'low', refs: [] }` when the envelope parse fails (mirrors prep's `draftMetaSchema` fallback). `ResearchManifest`: `{ startedAt, batchDir, results }`, written as `manifest.json`.

Duplicate task `id`s in one batch are a usage error (they'd collide on `<id>.findings.md`).

### Unit 2 — `src/research/prompt.ts` (child prompt + envelope parse)

`buildResearchPrompt(task, cwd)` produces a **self-contained** prompt:

- Role framing: "You are a read-only research agent. Investigate and answer ONE question. Do NOT edit, write, create, or delete any file; do not run state-changing commands. Your entire deliverable is your final message."
- The task's `question`, `context`, `scope` (as "start here" hints), `expects`.
- Return contract: final message = markdown findings (answer first, evidence after, cite real `file:line` paths), terminated by exactly one fenced ` ```json ` block holding the meta object (`status`, `headline`, `confidence`, `refs`).

`parseResearchStdout(stdout)` — pure function: take the **last** fenced ` ```json ` block as meta (zod-validated), everything before it as findings markdown. No fence / invalid JSON / bad shape → whole stdout saved as findings + fallback meta. Never throws; the raw output is always preserved on disk.

Directives ride the prompt, never env/flags (PR #33 rule, enforced at the `spawnAgent` seam).

### Unit 3 — `src/research/fanout.ts` (CLI)

Mirrors `src/prep/prep-fanout.ts` structure (parseArgs → validate → dry-run → concurrency spawn → collect → render → exit code):

- **Args:** `--tasks <file.json>` (zod `tasksFileSchema`), repeatable `--task "<question>"` (sugar → `{ id: 'cli-task-<n>', question }` — namespaced so a tasks file legitimately containing `task-1` never trips the duplicate-id error); both sources concatenate. `--max <n>` (default 4), `--timeout <ms>` (default 900000, per task), `--synthesize`, `--dry-run`, `--json`. No tasks from either source → usage error. Unknown flag → throw (prep parity).
- **Batch dir:** `.noldor/research/<YYYY-MM-DD-HHMMSS>/` (UTC, seconds-resolution — multiple fanouts per day must not collide; prep's date-only `batchDirFor` is not reused). Same-second collision (two batches launched concurrently — the primary use case): atomic create — `fs.mkdirSync` **non-recursive** (parent ensured first), catch `EEXIST`, retry with `-2`, `-3`… suffix; no exists-check (check-then-act races for exactly this scenario). Add `.noldor/research/` to `.gitignore`.
- **Concurrency util hoist:** `runWithConcurrency` moves from `src/prep/spawn.ts` to `src/core/concurrency.ts`; prep call sites update their import (same relocation rationale as the PR #106 phase-flip move — a second consumer means the util belongs in core, and `src/research` must not couple to the prep module).
- **Spawn:** `spawnAgent(prompt, { role: 'researcher', needsWrite: false, stdio: 'pipe', site: 'research.fanout', timeoutMs, cwd })` through `runWithConcurrency(tasks, max, …)`, each task body wrapped in try/catch (prep-fanout parity, `src/prep/prep-fanout.ts:145-152`): a rejected spawn (capability-mismatch, ENOENT `spawn-failed`) records `spawnStatus: 'error: <msg>'` + fallback meta and the batch continues — `runWithConcurrency` rejects the whole run on an uncaught throw, so one bad spawn must never lose the in-flight results. Each completed spawn already appends an agent-event (runner, role, site, exitCode, durationMs, tokens) — no extra telemetry code.
- **Collect:** per task, `parseResearchStdout`; write `<id>.findings.md` (findings + an HTML comment header carrying only machine fields — id/status/spawnStatus; the free-text `question` lives verbatim in `manifest.json` and INDEX, never inside the comment, so no escaping/mangling is needed); timeout/non-zero exit recorded in `spawnStatus`, meta forced to fallback when stdout empty.
- **Guards:** `git status --porcelain` snapshot before/after spawn; diff → loud WARNING listing the delta (children are prompt-constrained LLMs with bash — verify, don't trust). Task-count > 8 → stderr cost warning (proceed anyway).
- **Render:** `INDEX.md` — one table row per task: id, status, confidence, headline, findings link; failures flagged. `manifest.json` alongside.
- **Exit code:** 0 when every task is `ok` (spawn succeeded + envelope parsed), 1 otherwise, throw → 1 with message (prep parity).

### Unit 4 — synthesis pass (inside fanout, `--synthesize`)

After collection, when ≥ 2 tasks are `ok`: one `spawnAgent` (same role/site `research.synthesize`), prompt = the original questions + the batch dir **file paths** (agent reads findings from disk — read-only reads, keeps the prompt small), return contract = plain markdown synthesis via stdout (no meta fence). CLI writes `SYNTHESIS.md`. Synthesis failure (timeout/exit≠0/empty) degrades to a WARNING — the findings + INDEX already stand alone; exit code unaffected. With < 2 `ok` findings the pass is skipped with a notice.

### Unit 5 — `researcher` role

- Append `'researcher'` to `AGENT_ROLES` (src/core/agent-runner/types.ts). Role resolution, agents-config zod, doctor, and capability checks all iterate the const generically — no per-role code. Default runner: claude (schema default).
- Docs: add the role row to `docs/noldor/agent-runtimes.md` + its `templates/docs/noldor/` twin.

### Unit 6 — CLI manifest + skill + docs

- `src/cli/manifest.ts`: new top-level `research` group, sub `fanout` → `research/fanout.ts`.
- Skill `.claude/skills/noldor-research/SKILL.md` + `templates/.claude/skills/noldor-research/SKILL.md` twin (shared-files guard: commit with `NOLDOR_ALLOW_SHARED`). Content: when to fan out (≥ 2 independent read-only questions), decomposition rules (independent — no task consumes another's output; self-contained context; one question each), tasks-file authoring, CLI invocation, reading INDEX/findings, synthesis discipline, and "never fan out write-work — that's the drain's job."
- `docs/noldor/skill-catalog.md` row (+ twin) — `pnpm noldor validate skill-catalog` enforces the listing.
- New `docs/noldor/research-fanout.md` page (+ twin, `noldor-page: research-fanout` frontmatter, `docs(noldor:research-fanout)` commit scope): CLI reference, envelope contract, integration points (gate spec-stage, plan investigation, garden deep-dives, standalone). Must state explicitly: exit code 0 means every agent ran and parsed, **not** that questions were answered — a batch of all-`blocked` findings still exits 0; headless callers read the INDEX status column, not just the exit code.

### Data flow

```
driving agent/operator
  └─ writes tasks.json (or --task flags)
  └─ pnpm noldor research fanout --tasks tasks.json [--synthesize]
       ├─ zod-validate tasks → batch dir .noldor/research/<ts>/
       ├─ runWithConcurrency(max 4): spawnAgent(researcher, pipe, needsWrite:false)
       │    └─ child investigates read-only → stdout: findings md + ```json meta
       ├─ parseResearchStdout → <id>.findings.md   (CLI is the only writer)
       ├─ INDEX.md + manifest.json (deterministic)
       └─ [--synthesize] 1 agent reads findings files → stdout → SYNTHESIS.md
  └─ driving agent reads INDEX.md (+ SYNTHESIS.md / selected findings)
```

### Error handling

- Bad tasks file / no tasks / duplicate ids / unknown flag → usage error, exit 1, nothing spawned.
- Rejected spawn promise (capability-mismatch, `spawn-failed` ENOENT) → caught per task, `spawnStatus: 'error: <msg>'`, fallback meta, batch continues (never aborts the run).
- Per-task timeout → SIGKILL process group (existing `spawnAgent` pattern), task marked failed, batch continues.
- Unparseable child output → raw stdout preserved as findings, fallback meta, INDEX flags it, exit 1.
- Dirty-tree delta after spawn → WARNING with `git status` output (never fatal — mirrors prep D3).
- Synthesis failure → WARNING, findings remain authoritative.

### Testing

Vitest, mirroring prep's tests: pure units (`parseArgs`, task loading, `parseResearchStdout` happy/fence-missing/bad-JSON/bad-shape, INDEX render, batch-dir naming incl. same-second suffix) get direct unit tests; `run()` gets an injected-spawn test double (DI seam like prep's `spawnClaude` import — export a `deps` param taking `spawnImpl`) covering: all-ok exit 0, one-failed exit 1, one-**rejected**-spawn → batch still completes with `error:` status, dry-run spawns nothing, `--synthesize` writes SYNTHESIS.md, duplicate-id rejection. Role addition: `resolveRunner('researcher', defaults)` → claude. `runWithConcurrency` (previously untested) gains unit tests in `src/core/__tests__/concurrency.test.ts` with the hoist (limit respected, order-independent completion, empty input). No live-LLM tests; the `stub` runner covers any e2e appetite later.

## Acceptance criteria

- `pnpm noldor research fanout --task "q1" --task "q2"` spawns 2 researcher agents (≤ 4 concurrent), writes `.noldor/research/<ts>/` with 2 findings files + `INDEX.md` + `manifest.json`, exits 0 when both parse.
- `--tasks <file>` validates against `tasksFileSchema`; malformed file or duplicate ids → usage error, exit 1, no spawns.
- Child output without a valid meta fence → raw findings preserved, fallback meta, flagged row in INDEX, exit 1.
- A spawn that rejects outright (e.g. runner binary missing) fails only its own task; the batch completes and reports `error: <msg>` for that row.
- `--synthesize` with ≥ 2 ok findings spawns exactly one synthesis agent and writes `SYNTHESIS.md`; its failure degrades to a warning.
- `--dry-run` lists tasks + batch dir, spawns nothing, exits 0.
- Agent-events log gains one row per spawn with `site: 'research.fanout'` / `'research.synthesize'`, `role: 'researcher'`.
- `researcher` accepted in `.noldor/config.json` `agents.roles`; `pnpm noldor doctor` passes with it configured.
- Skill + templates twin + skill-catalog row + `docs/noldor/research-fanout.md` (+ twin) land; `pnpm noldor validate skill-catalog`, `validate features`, full `pnpm test` green.

## Risks / trade-offs

- **Envelope is convention, not schema.** Claude headless is `prose`-grade; a child may ramble past the contract. Mitigated: lenient last-fence parse + raw-output fallback — data is never lost, only flagged.
- **Read-only is prompt-enforced, not sandboxed.** claude runner has `sandbox: 'none'`; a misbehaving child could write. Mitigated: `needsWrite: false` (sandboxes codex/opencode where supported) + before/after porcelain diff WARNING. Accepted residual risk, same as prep fanout today.
- **Token cost scales with N.** Guardrails: `--max` 4 default, > 8-task warning, synthesis opt-in. No hard budget cap (operator judgment).
- **Large findings ride process stdout.** Node buffers the full string; multi-MB findings are fine but pathological output is unbounded. Accepted (same exposure as every `stdio: 'pipe'` site).

## User Story

As a driving agent or operator facing several independent read-only questions (codebase research, multi-subsystem investigation, pre-spec understanding), I want to dispatch one context-isolated researcher agent per question in parallel and get back structured findings plus a synthesized index, so that wall-clock shrinks and my own context window stays clean for design work.

## Usage

**CLI — quick questions:**

```bash
pnpm noldor research fanout --task "How does the CR overwrite-guard decide archive vs skip?" --task "Where are drain eligibility rules enforced?"
```

**CLI — full task specs (+ synthesis):**

```bash
pnpm noldor research fanout --tasks tasks.json --synthesize --max 4 --timeout 900000
# → .noldor/research/2026-07-01-142233/{INDEX.md,SYNTHESIS.md,<id>.findings.md,manifest.json}
```

`tasks.json`: `{ "tasks": [{ "id": "cr-guard", "question": "…", "scope": ["src/cr/"], "context": "…", "expects": "…" }] }`

**Skill (driving agent):** invoke `noldor-research` → decompose into independent questions → write tasks file → run fanout → read `INDEX.md`, pull selected findings, synthesize into the spec/plan/audit being written.

## Open questions (resolved)

1. _Skill vs CLI vs both?_ -> Both, CLI as core + thin skill (D1: the CLI compounds — headless flows, runner-agnostic, telemetry; the skill carries the decomposition discipline). **Ratified by operator.**
2. _How do children return findings?_ -> stdout envelope; CLI is the only writer (D2: keeps researchers truly read-only — "read agents don't write" — and kills the tree-guard complexity prep needs). **Ratified by operator.**
3. _Synthesis model?_ -> Deterministic INDEX always + `--synthesize` opt-in synth agent (D3: interactive callers synthesize themselves; headless callers pay +1 agent only when asked). **Ratified by operator.**
4. _Task input format?_ -> `--tasks` JSON file canonical + repeatable `--task` sugar (D4: file carries full specs for agents; flags serve operator one-liners). **Ratified by operator.**
5. _Batch dir naming?_ -> `.noldor/research/<YYYY-MM-DD-HHMMSS>/` (D5: research runs several times a day; prep's date-only dir would collide).
6. _Role name?_ -> `researcher` appended to `AGENT_ROLES` (D6: role list is the seam; resolution/doctor/config generic over it).
7. _Skill name?_ -> `noldor-research` (D7: symmetry with vendored `noldor-spec` / `noldor-plan`).
8. _Do read-agents surface in agent-events?_ -> Yes, automatically — `spawnAgent` appends per spawn; distinct `site` values make them filterable (D8: zero extra code).
9. _Wire into gate/plan/garden now?_ -> No — document integration points in `research-fanout.md`; wiring is a follow-up roadmap entry per consumer (D9: YAGNI; the primitive must exist before flows adopt it).
10. _Cost guardrails?_ -> `--max` 4 default + task-count > 8 warning + synthesis opt-in; no hard token budget (D10: matches prep's posture; budget enforcement is a framework-wide concern, not this unit's).
