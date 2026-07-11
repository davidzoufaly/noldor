# Portable Gate Entrypoint for Non-Claude Runners Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A drain configured with `agents.roles.implementer.runner: 'codex' | 'opencode'` spawns gate children whose prompt those runners can actually execute: a new `promptDispatch` runner capability picks between today's slash-command strings (claude, stub — byte-identical, regression-locked) and a self-contained prose directive pointing at a new canonical `docs/noldor/drain-mode.md` page. Both drain sources convert (`roadmapSource` fast-track + `plansSource` resume), and the latent `prompt = '/gate'` default in `spawnGate` dies so no `/gate` literal survives outside the builder.

**Architecture:** Spec Units 1–6 (implement faithfully, no redesign): (1) `promptDispatch: 'slash-command' | 'prose'` added to `RunnerCapabilities` (`src/core/agent-runner/types.ts`) and all four `CAPABILITIES` entries (claude/stub → `'slash-command'`, codex/opencode → `'prose'`; stub mirrors claude per spec D5 so contract-CI fixtures stay byte-identical). (2) New `src/autonomous/gate-prompt.ts` exporting `buildDrainGatePrompt(slug, dispatch)` / `buildResumeGatePrompt(slug, dispatch)`; the slash-command branches are today's `drain-source.ts` strings moved verbatim (bytes captured in a green-first regression lock BEFORE the refactor), the prose branches are self-contained directives (PR #33 rule: directives ride the prompt, never env) restating slug + branch and pointing at drain-mode.md. (3) `roadmapSource(cwd)` / `plansSource(cwd)` resolve dispatch ONCE at construction via `CAPABILITIES[resolveRunner('implementer', loadAgentsConfig(cwd)).runner].promptDispatch` (spec D2 — the drain path never pins `opts.runner`, so construction-time and spawn-time resolution cannot diverge); `DrainSource`/`spawnGate`/loop seams unchanged except dropping the `'/gate'` default (`drain-io.ts:197`). (4) `docs/noldor/drain-mode.md` + byte-identical `templates/docs/noldor/` twin ports the gate skill's drain-mode section (`.claude/skills/gate/SKILL.md:332-374`) into runner-neutral language. (5) Gate skill gains a one-line cross-link (+ `templates/.claude/skills/gate/SKILL.md` twin); `templates/.opencode/command/gate.md` gains a drain/resume paragraph (template-only — this repo's `agents.targets` defaults to `['claude']`, so template-sync ignores the `.opencode/` subtree here). (6) Builder-matrix + wiring + regression tests.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100 — run `pnpm fmt` before every commit), zod agents-config, vitest (`pnpm vitest run <path>`, mkdtemp fixtures per `src/autonomous/__tests__/drain-source.test.ts`), lefthook gates (commit staging `docs/noldor/*.md` needs a `noldor` / `noldor:<slug>` scope; `.claude/skills/**` commits from a `.worktrees/` checkout need `NOLDOR_ALLOW_SHARED=1`; `sync test-links`/`doc-links` pre-commit hooks auto-update + auto-stage FD `links.tests`/`links.docs` — expected, don't fight it).

Spec: [docs/superpowers/specs/2026-07-03-portable-gate-entrypoint-for-non-claude-runners-design.md](../specs/2026-07-03-portable-gate-entrypoint-for-non-claude-runners-design.md) · FD: [docs/features/portable-gate-entrypoint-for-non-claude-runners.md](../../features/portable-gate-entrypoint-for-non-claude-runners.md)

---

## File Structure

- `src/core/agent-runner/types.ts` — modify; `promptDispatch` field on `RunnerCapabilities` (spec Unit 1)
- `src/core/agent-runner/capabilities.ts` — modify; `promptDispatch` value for all four runners
- `src/core/agent-runner/__tests__/runners.test.ts` — modify (test); capability-matrix assertions for `promptDispatch`
- `src/autonomous/__tests__/drain-source.test.ts` — modify (test); green-first byte lock of today's gatePrompt strings + codex/opencode/stub wiring matrix
- `docs/noldor/drain-mode.md` — create; canonical runner-neutral drain contract page (`noldor-page` frontmatter, spec Unit 4)
- `templates/docs/noldor/drain-mode.md` — create; byte-identical template twin (template-sync)
- `docs/noldor/agent-runtimes.md` — modify; flag-mapping row "drain entry prompt" + §Rollout stale-sentence fix
- `templates/docs/noldor/agent-runtimes.md` — modify; byte-identical template twin
- `src/autonomous/gate-prompt.ts` — create; `PromptDispatch` type + `buildDrainGatePrompt` / `buildResumeGatePrompt` (spec Unit 2)
- `src/autonomous/__tests__/gate-prompt.test.ts` — create (test); builder matrix (slash-command verbatim literals, prose content, no-`/gate` guard)
- `src/autonomous/drain-source.ts` — modify; construction-time dispatch resolution, gatePrompt delegates to builders (spec Unit 3)
- `src/autonomous/drain-io.ts` — modify; drop `prompt = '/gate'` default in `spawnGate` (prompt becomes required)
- `.claude/skills/gate/SKILL.md` — modify; one-line cross-link in the Drain mode section (spec Unit 5)
- `templates/.claude/skills/gate/SKILL.md` — modify; byte-identical skill twin
- `templates/.opencode/command/gate.md` — modify; drain/resume paragraph pointing at drain-mode.md
- `docs/features/portable-gate-entrypoint-for-non-claude-runners.md` — modify; `links.code` records the new/touched modules

---

## Task 1: `promptDispatch` runner capability

**Files:**

- Modify: `src/core/agent-runner/types.ts`
- Modify: `src/core/agent-runner/capabilities.ts`
- Test: `src/core/agent-runner/__tests__/runners.test.ts`

- [ ] **Step 1: Add the failing capability-matrix test**

In `src/core/agent-runner/__tests__/runners.test.ts`, replace the first line

```ts
// @tests: make-noldor-agent-agnostic
```

with

```ts
// @tests: make-noldor-agent-agnostic, portable-gate-entrypoint-for-non-claude-runners
```

and add this test inside the existing `describe('capability matrix', ...)` block, after the `it('encodes the spec table', ...)` test:

```ts
  it('declares promptDispatch for every runner (portable gate entry, spec Unit 1)', () => {
    expect(CAPABILITIES.claude.promptDispatch).toBe('slash-command');
    expect(CAPABILITIES.codex.promptDispatch).toBe('prose');
    expect(CAPABILITIES.opencode.promptDispatch).toBe('prose');
    // stub mirrors claude: the consumer-contract CI drain e2e replays canned
    // work against today's prompt shapes — keeping stub on the claude shape
    // leaves those fixtures byte-identical (spec D5).
    expect(CAPABILITIES.stub.promptDispatch).toBe('slash-command');
  });
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts
```

Expected output: 1 failed test — `expected undefined to be 'slash-command'` (the field does not exist yet).

- [ ] **Step 3: Add the field to `RunnerCapabilities`**

In `src/core/agent-runner/types.ts`, replace

```ts
/** Per-runner capability grades; consumed by role-resolution fit checks and doctor. */
export interface RunnerCapabilities {
  structuredOutput: 'schema' | 'events' | 'prose';
  sandbox: 'fine' | 'coarse' | 'none';
  supportsLocalModels: boolean;
  questionSuppression: 'flag' | 'non-interactive' | 'permission-config';
  rulesFile: 'CLAUDE.md' | 'AGENTS.md';
}
```

with

```ts
/** Per-runner capability grades; consumed by role-resolution fit checks and doctor. */
export interface RunnerCapabilities {
  structuredOutput: 'schema' | 'events' | 'prose';
  sandbox: 'fine' | 'coarse' | 'none';
  supportsLocalModels: boolean;
  questionSuppression: 'flag' | 'non-interactive' | 'permission-config';
  rulesFile: 'CLAUDE.md' | 'AGENTS.md';
  /** How framework entry prompts are dispatched: 'slash-command' expands a
   *  vendored skill/command; 'prose' must be self-contained instructions. */
  promptDispatch: 'slash-command' | 'prose';
}
```

- [ ] **Step 4: Set the value for all four runners**

In `src/core/agent-runner/capabilities.ts` add one line per runner (the `Record<RunnerName, RunnerCapabilities>` type makes a missing entry a compile error):

- claude block: add `promptDispatch: 'slash-command',` after `rulesFile: 'CLAUDE.md',`
- codex block: add `promptDispatch: 'prose',` after `rulesFile: 'AGENTS.md',`
- opencode block: add `promptDispatch: 'prose',` after `rulesFile: 'AGENTS.md',`
- stub block: add the following after `rulesFile: 'CLAUDE.md',`:

```ts
    // Mirrors claude so contract-CI drain fixtures stay byte-identical (spec D5).
    promptDispatch: 'slash-command',
```

- [ ] **Step 5: Run tests + typecheck to verify PASS**

```bash
pnpm vitest run src/core/agent-runner/__tests__/ && pnpm typecheck
```

Expected output: all agent-runner test files pass (runners, registry, types, doctor-runners, no-stray-spawns); `tsc --noEmit` exits silently.

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/core/agent-runner/types.ts src/core/agent-runner/capabilities.ts src/core/agent-runner/__tests__/runners.test.ts docs/features/portable-gate-entrypoint-for-non-claude-runners.md
git commit -m "feat(agents): add promptDispatch runner capability" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

Note: the FD path is staged because the pre-commit `sync test-links` hook (stage_fixed) auto-adds `runners.test.ts` to the FD's `links.tests`; including it keeps the commit self-contained either way.

---

## Task 2: Regression lock — capture today's gatePrompt bytes BEFORE any refactor

**Files:**

- Test: `src/autonomous/__tests__/drain-source.test.ts`

- [ ] **Step 1: Write the byte-lock tests (literals copied from today's `drain-source.ts`)**

In `src/autonomous/__tests__/drain-source.test.ts`, replace the first line

```ts
// @tests: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, plan-runner
```

with

```ts
// @tests: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, plan-runner, portable-gate-entrypoint-for-non-claude-runners
```

and append this describe block at the end of the file. The two literals below are today's exact `gatePrompt` outputs (`drain-source.ts:98` and `drain-source.ts:177-186`) — do NOT retype them by eye; if in doubt, re-derive from the current source before editing:

```ts
/**
 * Byte lock for the claude-default gate prompts (portable-gate-entrypoint spec,
 * acceptance criterion 3): with no `agents:` block the drain children must
 * receive strings byte-identical to pre-change main. Written GREEN against the
 * pre-refactor code on purpose — the extraction into gate-prompt.ts must not
 * churn a single byte of the battle-tested claude path.
 */
describe('gatePrompt byte lock (claude default — no agents config)', () => {
  const RESUME_LITERAL = [
    '/gate --resume designed --autonomous',
    '',
    'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
    'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
    'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
    'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
    '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
    'lane picker or PR approval.',
  ].join('\n');

  it('roadmapSource emits the exact drain literal', () => {
    const dir = tmpRepo(block('alpha', 'XS'));
    try {
      expect(roadmapSource(dir).gatePrompt('alpha')).toBe('/gate --drain alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plansSource emits the exact resume literal', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      expect(plansSource(dir).gatePrompt('designed')).toBe(RESUME_LITERAL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the lock to verify it PASSES against the current code**

```bash
pnpm vitest run src/autonomous/__tests__/drain-source.test.ts
```

Expected output: all tests pass, including the two new byte-lock tests. This is deliberately green-first — the lock certifies today's bytes so Tasks 5–6 cannot silently rewrite them. If either new test FAILS here, the literal in the test does not match the live source: fix the test literal (never the source) before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/autonomous/__tests__/drain-source.test.ts docs/features/portable-gate-entrypoint-for-non-claude-runners.md
git commit -m "test(autonomous): byte-lock pre-refactor gate prompts (claude default)" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

---

## Task 3: `docs/noldor/drain-mode.md` — runner-neutral drain contract page + template twin

**Files:**

- Create: `templates/docs/noldor/drain-mode.md`
- Create: `docs/noldor/drain-mode.md`

- [ ] **Step 1: Write the template copy first**

Create `templates/docs/noldor/drain-mode.md` with exactly this content (ports the gate skill's Drain-mode section, `.claude/skills/gate/SKILL.md:332-374`, into runner-neutral language; commands are the PR #119 portable CLIs):

```markdown
---
noldor-page: drain-mode
---

<!-- @feature: portable-gate-entrypoint-for-non-claude-runners -->

# Drain Mode

The runner-neutral contract for one headless gate child spawned by the
autonomous drain supervisor (`pnpm noldor autonomous run` / `noldor autonomous
watch`). The supervisor owns the loop, retries, skips, and the lock; each child
ships exactly one entry and exits. Claude children receive `/gate --drain
<slug>` and follow the gate skill's drain-mode section; prose-dispatch runners
(codex, opencode — see the [flag mapping](agent-runtimes.md)) receive a
self-contained directive that points here. This page is that directive's
canonical referent: it restates the drain contract without any slash-command
dependency, so the prompt stays a thin pointer.

## Entry binding

- Ship **exactly the slug named by the spawn directive** — never re-pick from
  the queue (parallel drain assigns each concurrent child a distinct slug).
  Fallbacks when no slug rides the prompt: the `NOLDOR_DRAIN_SLUG` env var if
  set, else the top entry from `pnpm noldor next-priority --suggestions --json`.
- Honor `NOLDOR_DRAIN_SKIP` (comma-separated slugs the supervisor already
  skipped): never pick a listed entry.
- The supervisor sets `NOLDOR_DRAIN=1` in the child environment; treat its
  presence as confirmation you are a drain child.
- **Never ask interactive questions.** Runners enforce this via their
  kill-switch — see the [agent-runtimes flag mapping](agent-runtimes.md)
  (`--disallowed-tools AskUserQuestion`, non-interactive exec,
  `permission.question: "deny"`). Anything that would block on a human must
  instead fail the run (exit non-zero).

## Branch discipline — `fast/<slug>` (roadmap entries)

- The branch name is deterministic: `fast/<slug>` — the supervisor maps
  slug → branch → PR to detect shipped work.
- **Force-recreate before starting:** remove a stale worktree for the branch
  first (`git worktree remove --force <dir>`, if present), then
  `git branch -D fast/<slug>` and `git push origin --delete fast/<slug>`
  (each only when it exists). Reaching this point means the supervisor found
  no open PR for the slug, so leftover `fast/<slug>` state is abandoned work,
  safe to discard. This per-slug removal is the only worktree a drain child
  deletes.
- Do the work on that branch and run every noldor command from inside its
  checkout/worktree.

## Roadmap retirement

- Implement the entry, then remove its roadmap block **on the branch**:
  `pnpm noldor roadmap remove-block <slug>`. Absence of the block on `main`
  after merge is the supervisor's success oracle.

## Autonomous end-of-flow

- Mark the session autonomous immediately after the session marker exists:
  `pnpm noldor noldor set-autonomous` — never ask autonomous-vs-interactive.
- Code-stage CR:
  `pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --profile fast-track --autonomous`
  (drop `--profile fast-track` on the resume path — that profile is for
  fast-track roadmap entries).
- Ship via `pnpm noldor pr-flow` (auto-merge; polls until the PR merges).
  Under parallel drain the supervisor sets `NOLDOR_DRAIN_OPEN_ONLY=1`:
  `pr-flow` then pushes + opens the PR and returns at PR-open — the
  supervisor's serialized merge coordinator does the merging.
- On CR-red or test/typecheck-red: run `pnpm noldor cr escalate --autonomous`
  (config `autonomous.onFailure` governs) and exit non-zero — the supervisor
  retries from clean or skips.
- Commit and push gates run unchanged: hooks inject the `Noldor-*` trailers
  from the session marker; drain mode never bypasses them.

## Resume path (designed FDs, `feat/<slug>`)

The plans-source drain resumes an in-progress FD that is already designed.
Differences from the roadmap path:

- Branch is `feat/<slug>` — resume it (create from `main` only when absent);
  no force-recreate of prior plan work.
- Preconditions: `docs/superpowers/specs/<date>-<slug>-design.md` AND
  `docs/superpowers/plans/<date>-<slug>.md` must exist. If either is missing,
  exit non-zero immediately — never improvise a design.
- Execute the plan task-by-task inline, then the same autonomous end-of-flow
  as above plus the FD seams: refresh the FD's Usage section and flip the
  phase before merge (`pnpm noldor features phase-flip-done <slug>`).
- Never pause for a lane picker or PR approval.

## Exit-code contract

- `0` — the entry shipped (PR merged, or opened under
  `NOLDOR_DRAIN_OPEN_ONLY=1`).
- non-zero — the iteration failed; leave state clean enough for the
  supervisor's retry-from-clean (its salvage rebuilds a stale `fast/<slug>`
  from fresh `main`).

Drain mode is stricter than plain autonomous mode: it requires the
headless-safe config set (`autonomous.onFailure: "abort"`,
`skipLanePicker: true`, `requireHumanPrApproval: false`) — the supervisor
refuses to start otherwise. The Claude-path rendering of this contract lives
in the gate skill's Drain-mode section; keep the two in sync.
```

- [ ] **Step 2: Run template-sync to verify it FAILS (consumer copy absent)**

```bash
pnpm noldor checks template-sync templates/docs/noldor/drain-mode.md
```

Expected output: exit 1 with `docs/noldor/drain-mode.md (missing): consumer copy absent — run 'noldor init --update'`.

- [ ] **Step 3: Create the live copy and verify checks PASS**

Copy the template byte-identically:

```bash
cp templates/docs/noldor/drain-mode.md docs/noldor/drain-mode.md
pnpm noldor checks template-sync docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md
pnpm noldor validate noldor
```

Expected output: `template-sync OK`, then `Validated 25 Noldor page(s) — all OK.` (count = previous 24 + this page).

- [ ] **Step 4: Commit (noldor scope required — the commit stages `docs/noldor/*.md`)**

```bash
git add docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md docs/features/portable-gate-entrypoint-for-non-claude-runners.md
git commit -m "docs(noldor:drain-mode): add runner-neutral drain contract page" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

Note: the pre-commit `sync doc-links` hook (stage_fixed) auto-adds `docs/noldor/drain-mode.md` to the FD's `links.docs` from the `<!-- @feature: ... -->` tag — that FD change lands in this commit; hence the FD path in `git add`.

---

## Task 4: agent-runtimes capability-table row + rollout sentence (live + twin)

**Files:**

- Modify: `docs/noldor/agent-runtimes.md`
- Modify: `templates/docs/noldor/agent-runtimes.md`

- [ ] **Step 1: Add the flag-mapping row**

In `docs/noldor/agent-runtimes.md`, replace

```markdown
| headless spawn | `claude --print "<prompt>"` | `codex exec` (prompt via stdin) | `opencode run "<prompt>"` |
```

with

```markdown
| headless spawn | `claude --print "<prompt>"` | `codex exec` (prompt via stdin) | `opencode run "<prompt>"` |
| drain entry prompt | slash-command: `/gate --drain <slug>` / `/gate --resume <slug>` | prose directive → [drain-mode.md](drain-mode.md) | prose directive → [drain-mode.md](drain-mode.md) |
```

- [ ] **Step 2: Fix the now-stale §Rollout sentence**

In the same file, replace

```markdown
win), CR lanes second, `implementer` last — and only per-runner once outcome
telemetry shows ship/retry/revert parity. v1 shims are thin command pointers
(fat CLI, thin skills); a non-Claude implementer cannot drive the full `/gate`
skill flow yet.
```

with

```markdown
win), CR lanes second, `implementer` last — and only per-runner once outcome
telemetry shows ship/retry/revert parity. v1 shims are thin command pointers
(fat CLI, thin skills); a non-Claude implementer drain child now receives a
self-contained prose entry ([drain-mode.md](drain-mode.md)) instead of the
`/gate` skill — the hard blocker is gone, the caution stands.
```

- [ ] **Step 3: Mirror to the template twin and verify checks PASS**

Apply the exact same two edits to `templates/docs/noldor/agent-runtimes.md` (or copy the file over — the two must be byte-identical), then:

```bash
cp docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
pnpm noldor checks template-sync docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
pnpm noldor validate noldor
```

Expected output: `template-sync OK`, then `Validated 25 Noldor page(s) — all OK.`

- [ ] **Step 4: Commit**

```bash
git add docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
git commit -m "docs(noldor:agent-runtimes): add drain-entry-prompt dispatch row" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

---

## Task 5: `gate-prompt.ts` builders (spec Unit 2, TDD)

**Files:**

- Create: `src/autonomous/gate-prompt.ts`
- Test: `src/autonomous/__tests__/gate-prompt.test.ts`

- [ ] **Step 1: Write the failing builder-matrix test**

Create `src/autonomous/__tests__/gate-prompt.test.ts` with exactly:

```ts
// @tests: portable-gate-entrypoint-for-non-claude-runners
import { describe, expect, it } from 'vitest';
import { buildDrainGatePrompt, buildResumeGatePrompt } from '../gate-prompt.js';

// Today's plansSource literal (drain-source.ts pre-extraction) — the
// slash-command branch must return it byte-identically.
const RESUME_SLASH_LITERAL = [
  '/gate --resume designed --autonomous',
  '',
  'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
  'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
  'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
  'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
  '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
  'lane picker or PR approval.',
].join('\n');

describe('buildDrainGatePrompt', () => {
  it("slash-command returns today's drain literal verbatim", () => {
    expect(buildDrainGatePrompt('alpha', 'slash-command')).toBe('/gate --drain alpha');
  });

  it('prose is self-contained: slug, fast/<slug>, drain-mode.md pointer, portable CLIs, no /gate token', () => {
    const p = buildDrainGatePrompt('alpha', 'prose');
    expect(p).toContain("'alpha'");
    expect(p).toContain('fast/alpha');
    expect(p).toContain('docs/noldor/drain-mode.md');
    expect(p).toContain('pnpm noldor roadmap remove-block alpha');
    expect(p).toContain('pnpm noldor noldor set-autonomous');
    expect(p).not.toContain('/gate');
  });
});

describe('buildResumeGatePrompt', () => {
  it("slash-command returns today's resume literal verbatim", () => {
    expect(buildResumeGatePrompt('designed', 'slash-command')).toBe(RESUME_SLASH_LITERAL);
  });

  it('prose is self-contained: slug, feat/<slug>, drain-mode.md, autonomous directives, no /gate token', () => {
    const p = buildResumeGatePrompt('designed', 'prose');
    expect(p).toContain("'designed'");
    expect(p).toContain('feat/designed');
    expect(p).toContain('docs/noldor/drain-mode.md');
    expect(p).toContain('pnpm noldor noldor set-autonomous');
    expect(p).toContain('NO interactive prompts');
    expect(p).not.toContain('/gate');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
pnpm vitest run src/autonomous/__tests__/gate-prompt.test.ts
```

Expected output: the suite errors — `Cannot find module '../gate-prompt.js'` (module does not exist yet).

- [ ] **Step 3: Implement the builders**

Create `src/autonomous/gate-prompt.ts` with exactly:

```ts
// @fd: portable-gate-entrypoint-for-non-claude-runners

/**
 * Runner-aware gate entry prompts for the autonomous drain (portable gate
 * entrypoint, spec Unit 2).
 *
 * 'slash-command' dispatch (claude, stub) returns the battle-tested strings
 * byte-identical to the pre-extraction `drain-source.ts` literals — Claude
 * Code expands them via the vendored gate skill. 'prose' dispatch (codex,
 * opencode) returns a self-contained directive: those runners have no
 * slash-command system, so the contract must ride the prompt itself (PR #33
 * rule: directives ride the prompt, never env) and points at the canonical
 * runner-neutral page `docs/noldor/drain-mode.md` so the prompt stays a thin
 * pointer rather than a second copy of the gate skill.
 */
export type PromptDispatch = 'slash-command' | 'prose';

/**
 * Drain entry (roadmap source): ship one fast-track entry on `fast/<slug>`.
 * Slash-command branch: an explicit drain entry that short-circuits the
 * interactive Step 0 — a headless model ignores an env-var-only signal, so
 * the assigned slug must ride the prompt itself.
 */
export function buildDrainGatePrompt(slug: string, dispatch: PromptDispatch): string {
  if (dispatch === 'slash-command') return `/gate --drain ${slug}`;
  return [
    'Autonomous Noldor drain run. Read docs/noldor/drain-mode.md and follow it exactly.',
    '',
    `Ship roadmap entry '${slug}' end-to-end on branch 'fast/${slug}' with ZERO interactive`,
    'questions. Force-recreate the branch from main, implement the entry, remove its roadmap',
    `block (\`pnpm noldor roadmap remove-block ${slug}\`), mark the session autonomous`,
    '(`pnpm noldor noldor set-autonomous`), run code-stage CR',
    `(\`pnpm noldor cr orchestrate --slug ${slug} --artifact . --kind code --profile fast-track --autonomous\`),`,
    'and ship via `pnpm noldor pr-flow`. On CR-red or test-red run',
    '`pnpm noldor cr escalate --autonomous` and exit non-zero.',
  ].join('\n');
}

/**
 * Resume entry (plans source): resume one designed in-progress FD on
 * `feat/<slug>`. Plan-drain is headless: the resumed gate MUST run
 * autonomously or it stalls at the autonomous-vs-interactive / lane-picker /
 * PR-approval seams a headless child can't answer. Per the PR #33 rule the
 * directive rides the prompt (never env): the `--autonomous` flag (slash) or
 * explicit prose tell the gate to set `session.autonomous` immediately and
 * ship end-to-end without pausing.
 */
export function buildResumeGatePrompt(slug: string, dispatch: PromptDispatch): string {
  if (dispatch === 'slash-command') {
    return [
      `/gate --resume ${slug} --autonomous`,
      '',
      'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
      'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
      'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
      'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
      '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
      'lane picker or PR approval.',
    ].join('\n');
  }
  return [
    'Autonomous Noldor plan-drain resume. Read docs/noldor/drain-mode.md (Resume path) and',
    'follow it exactly.',
    '',
    `Resume the designed in-progress feature '${slug}' end-to-end on branch 'feat/${slug}'`,
    'with NO interactive prompts. Its approved spec and plan are committed under',
    'docs/superpowers/ — read both and execute the plan inline; if either is missing, exit',
    'non-zero. Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right',
    'after the session marker is written — never ask autonomous-vs-interactive. Implement',
    'the plan, run code-stage CR',
    `(\`pnpm noldor cr orchestrate --slug ${slug} --artifact . --kind code --autonomous\`),`,
    'and ship via `pnpm noldor pr-flow`. On CR-red or test-red run',
    '`pnpm noldor cr escalate --autonomous` (config `autonomous.onFailure` governs).',
    'Never pause for a lane picker or PR approval.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it PASSES**

```bash
pnpm vitest run src/autonomous/__tests__/gate-prompt.test.ts && pnpm typecheck
```

Expected output: 4 tests pass; typecheck silent.

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/autonomous/gate-prompt.ts src/autonomous/__tests__/gate-prompt.test.ts docs/features/portable-gate-entrypoint-for-non-claude-runners.md
git commit -m "feat(autonomous): add runner-aware gate-prompt builders" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

---

## Task 6: Dispatch resolution at source construction + drop the `'/gate'` spawnGate default (spec Unit 3)

**Files:**

- Modify: `src/autonomous/drain-source.ts`
- Modify: `src/autonomous/drain-io.ts`
- Test: `src/autonomous/__tests__/drain-source.test.ts`

- [ ] **Step 1: Write the failing wiring tests**

Append to `src/autonomous/__tests__/drain-source.test.ts` (after the Task 2 byte-lock block):

```ts
/** Pin the implementer role to a runner via a fixture `.noldor/config.json`. */
function writeImplementerRunner(dir: string, runner: string): void {
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({ agents: { roles: { implementer: { runner } } } }),
    'utf8',
  );
}

describe('gatePrompt dispatch follows the implementer runner (spec Unit 3)', () => {
  it('codex implementer → prose drain directive (slug, fast/<slug>, drain-mode.md, no /gate)', () => {
    const dir = tmpRepo(block('alpha', 'XS'));
    try {
      writeImplementerRunner(dir, 'codex');
      const p = roadmapSource(dir).gatePrompt('alpha');
      expect(p).toContain("'alpha'");
      expect(p).toContain('fast/alpha');
      expect(p).toContain('docs/noldor/drain-mode.md');
      expect(p).not.toContain('/gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opencode implementer → prose resume directive (slug, feat/<slug>, drain-mode.md, no /gate)', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      writeImplementerRunner(dir, 'opencode');
      const p = plansSource(dir).gatePrompt('designed');
      expect(p).toContain("'designed'");
      expect(p).toContain('feat/designed');
      expect(p).toContain('docs/noldor/drain-mode.md');
      expect(p).not.toContain('/gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stub implementer keeps the claude (slash-command) shape — contract-CI fixtures unchanged (spec D5)', () => {
    const dir = tmpRepo(block('alpha', 'XS'));
    try {
      writeImplementerRunner(dir, 'stub');
      expect(roadmapSource(dir).gatePrompt('alpha')).toBe('/gate --drain alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test file to verify the new tests FAIL (and the byte lock still PASSES)**

```bash
pnpm vitest run src/autonomous/__tests__/drain-source.test.ts
```

Expected output: exactly 2 failures — the codex and opencode tests report `expected '/gate --drain alpha' … not to contain '/gate'` (resp. the resume string); the stub test and both byte-lock tests pass (current code always emits the slash literals).

- [ ] **Step 3: Wire dispatch into `drain-source.ts`**

Apply these edits to `src/autonomous/drain-source.ts`:

(a) After the existing imports (below the `import { isDrainEligible } ...` line) add:

```ts
import { CAPABILITIES } from '../core/agent-runner/capabilities.js';
import { loadAgentsConfig, resolveRunner } from '../core/agent-runner/registry.js';
import { buildDrainGatePrompt, buildResumeGatePrompt, type PromptDispatch } from './gate-prompt.js';
```

(b) Replace the `DrainSource` interface's gatePrompt comment line

```ts
  /** prompt handed to `claude --print` for this slug */
```

with

```ts
  /** gate entry prompt for this slug (shape follows the implementer runner's promptDispatch) */
```

(c) After the `escapeRe` function add:

```ts
/**
 * Resolve the gate-prompt dispatch ONCE at source construction (spec D2): the
 * implementer runner's `promptDispatch` capability picks slash-command vs
 * prose. The drain spawn path never pins `opts.runner` (`spawnGate` passes
 * only `role: 'implementer'`), so construction-time and spawn-time resolution
 * cannot diverge. A malformed `agents:` block throws loudly here — same
 * posture as the registry.
 */
function implementerDispatch(cwd: string): PromptDispatch {
  return CAPABILITIES[resolveRunner('implementer', loadAgentsConfig(cwd)).runner].promptDispatch;
}
```

(d) In the JSDoc above `roadmapSource`, replace the sentence fragment

```ts
 * `parseAll` is the full roadmap slug list (the success oracle); the gate prompt is
 * `/gate --drain <slug>` — an explicit drain entry that short-circuits the interactive Step 0
 * (a headless model ignores an env-var-only signal, so the assigned slug must ride the prompt
 * itself, mirroring how `plansSource` uses `--resume <slug>`); the branch is `fast/<slug>`.
```

with

```ts
 * `parseAll` is the full roadmap slug list (the success oracle); the gate prompt comes from
 * `buildDrainGatePrompt` with the dispatch resolved once at construction from the implementer
 * runner (claude/stub → `/gate --drain <slug>` verbatim, codex/opencode → self-contained prose
 * directive — see src/autonomous/gate-prompt.ts); the branch is `fast/<slug>`.
```

(e) In `roadmapSource`, replace

```ts
  const read = (): string => readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
```

with

```ts
  const read = (): string => readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
  const dispatch = implementerDispatch(cwd);
```

and replace its `gatePrompt` implementation

```ts
    gatePrompt(slug) {
      return `/gate --drain ${slug}`;
    },
```

with

```ts
    gatePrompt(slug) {
      return buildDrainGatePrompt(slug, dispatch);
    },
```

(f) In `plansSource`, replace

```ts
  const roots = loadDocRoots(cwd);
```

with

```ts
  const roots = loadDocRoots(cwd);
  const dispatch = implementerDispatch(cwd);
```

and replace its entire `gatePrompt` implementation (including the leading comment — the rationale now lives in `gate-prompt.ts`)

```ts
    gatePrompt(slug) {
      // Plan-drain is headless: the resumed gate MUST run autonomously or it
      // stalls at the autonomous-vs-interactive / lane-picker / PR-approval
      // seams a `claude --print` child can't answer. Per the PR #33 rule the
      // directive rides the prompt (never env): the `--autonomous` flag plus
      // explicit prose tell the gate to set `session.autonomous` immediately
      // and ship end-to-end without pausing.
      return [
        `/gate --resume ${slug} --autonomous`,
        '',
        'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
        'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
        'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
        'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
        '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
        'lane picker or PR approval.',
      ].join('\n');
    },
```

with

```ts
    gatePrompt(slug) {
      return buildResumeGatePrompt(slug, dispatch);
    },
```

- [ ] **Step 4: Drop the `'/gate'` default in `spawnGate`**

In `src/autonomous/drain-io.ts`, replace the JSDoc tail sentence

```ts
 * runner not on PATH) rejects `spawn-failed: …` so the loop aborts the whole
 * drain instead of churning retries across every entry. `prompt` defaults to
 * `/gate` (roadmap source); plans source passes `/gate --resume <slug>`.
 */
```

with

```ts
 * runner not on PATH) rejects `spawn-failed: …` so the loop aborts the whole
 * drain instead of churning retries across every entry. `prompt` is required —
 * the drain sources build it via src/autonomous/gate-prompt.ts, so no `/gate`
 * literal survives outside that builder.
 */
```

and replace the signature line

```ts
  prompt = '/gate',
```

with

```ts
  prompt: string,
```

(Both call sites — `queue-drain.ts:169` and `watch.ts:283` — always pass a prompt, so this is a compile-time tightening only.)

- [ ] **Step 5: Run tests + typecheck to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/ && pnpm typecheck
```

Expected output: the full autonomous suite passes — including the Task 2 byte lock (claude default unchanged), the pre-existing `gatePrompt is /gate --drain <slug>` and resume `toContain` tests, and the 3 new wiring tests; typecheck silent (confirms no caller relied on the dropped default).

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/autonomous/drain-source.ts src/autonomous/drain-io.ts src/autonomous/__tests__/drain-source.test.ts
git commit -m "feat(autonomous): dispatch gate prompts by implementer runner capability" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

---

## Task 7: Gate-skill cross-link + opencode command paragraph (spec Unit 5)

**Files:**

- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `templates/.claude/skills/gate/SKILL.md`
- Modify: `templates/.opencode/command/gate.md`

- [ ] **Step 1: Add the cross-link to the gate skill's Drain-mode section**

In `.claude/skills/gate/SKILL.md`, replace

```markdown
## Drain mode (`NOLDOR_DRAIN=1`)

The [Autonomous Queue-Drain Runner](../../../docs/features/autonomous-queue-drain-runner.md)
```

with

```markdown
## Drain mode (`NOLDOR_DRAIN=1`)

Runner-neutral twin: [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) restates
this drain contract for prose-dispatch runners (a codex/opencode implementer child receives a
self-contained prose directive pointing there instead of `/gate --drain <slug>`). Keep the two
renderings in sync.

The [Autonomous Queue-Drain Runner](../../../docs/features/autonomous-queue-drain-runner.md)
```

- [ ] **Step 2: Mirror the skill twin byte-identically**

```bash
cp .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
```

- [ ] **Step 3: Add the drain/resume paragraph to the opencode command template**

In `templates/.opencode/command/gate.md`, replace

```markdown
Commit messages need a `Noldor-FD: <slug>` trailer (lefthook injects it when a
session marker exists).
```

with

```markdown
Commit messages need a `Noldor-FD: <slug>` trailer (lefthook injects it when a
session marker exists).

Headless drain / resume: the autonomous drain supervisor does not invoke this
command — non-Claude runners receive a self-contained prose directive whose
canonical contract is `docs/noldor/drain-mode.md` (slug binding, `fast/<slug>`
branch discipline, roadmap retirement, autonomous end-of-flow, exit codes).
Driving a drain-style run by hand? Read that page and follow it exactly.
```

(Template-only on this repo: `agents.targets` defaults to `['claude']`, so there is no live `.opencode/` copy to sync and the template-sync check skips the subtree.)

- [ ] **Step 4: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md templates/.opencode/command/gate.md
```

Expected output: `template-sync OK`.

- [ ] **Step 5: Commit (shared-files guard: `.claude/skills/**` edits from a `.worktrees/` checkout need the override)**

```bash
git add .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md templates/.opencode/command/gate.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(gate): cross-link runner-neutral drain-mode page" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```

(When running from the main workspace the `NOLDOR_ALLOW_SHARED=1` prefix is harmless — the shared-files guard only fires inside `.worktrees/` checkouts.)

---

## Task 8: FD code links + full verification sweep

**Files:**

- Modify: `docs/features/portable-gate-entrypoint-for-non-claude-runners.md`

- [ ] **Step 1: Record the touched modules in the FD's `links.code`**

Open `docs/features/portable-gate-entrypoint-for-non-claude-runners.md` and READ its current frontmatter first — the pre-commit sync hooks from Tasks 1–6 have rewritten it (gray-matter re-serialization: `links.docs` / `links.tests` now populated, keys possibly reordered). Then edit the `links.code` array in place so it reads exactly (keep every other frontmatter field untouched):

```yaml
  code:
    - src/autonomous/drain-io.ts
    - src/autonomous/drain-source.ts
    - src/autonomous/gate-prompt.ts
    - src/core/agent-runner/capabilities.ts
    - src/core/agent-runner/types.ts
```

(Do NOT run `pnpm noldor sync code-links` without `--check` — the repo currently carries 53 pre-existing stale FDs and the write mode rewrites all of them; hand-edit only this FD. `links.tests` and `links.docs` were already auto-synced by the pre-commit hooks in Tasks 1–6.)

- [ ] **Step 2: Full verify + acceptance sweep**

```bash
pnpm fmt && pnpm verify
```

Expected output: lint, fmt:check, typecheck, and the full vitest suite all green (the existing drain suite must be untouched — any red here is a regression from Tasks 5–6, fix before committing).

Then re-confirm the spec's acceptance criteria in one shot:

```bash
pnpm vitest run src/autonomous/__tests__/gate-prompt.test.ts src/autonomous/__tests__/drain-source.test.ts src/core/agent-runner/__tests__/runners.test.ts
grep -n "prompt = '/gate'" src/autonomous/drain-io.ts || echo "OK: no /gate default"
pnpm noldor checks template-sync docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md .claude/skills/gate/SKILL.md
```

Expected output: 3 test files pass; `OK: no /gate default`; `template-sync OK`.

- [ ] **Step 3: Commit**

```bash
git add docs/features/portable-gate-entrypoint-for-non-claude-runners.md
git commit -m "chore(features): record gate-prompt modules in FD code links" -m "Noldor-FD: portable-gate-entrypoint-for-non-claude-runners"
```
