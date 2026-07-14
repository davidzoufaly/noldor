# opencode `--format json` Events + `--auto` Fix Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Parse opencode `run --format json` NDJSON into assistant prose (text only) at the registry return boundary (for piped, non-tee, non-inherit spawns only), and fix the removed `--dangerously-skip-permissions` flag → `--auto` on opencode 1.17. Part 1 of 3; ships independently.
**Architecture:** New pure parser `opencode-events.ts`; `buildOpencodeArgv` gains a conditional `jsonEvents` flag; the registry computes `jsonEvents` once and reuses it to (a) opt the argv into `--format json` and (b) replace accumulated stdout with parsed prose in the close handler. Capability grade stays `'events'`; the `schemaPath` gate is untouched.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod (unaffected), vitest.

---

## File Structure

- `src/core/agent-runner/opencode-events.ts` — new; pure NDJSON→text parser (text only), fail-open.
- `src/core/agent-runner/__tests__/opencode-events.test.ts` — new; parser unit tests over a captured fixture.
- `src/core/agent-runner/__tests__/fixtures/opencode-events.ndjson` — new; real captured opencode 1.17 `--format json` output (3 events).
- `src/core/agent-runner/runners/opencode.ts` — modify; `--dangerously-skip-permissions`→`--auto`, add conditional `--format json` via `jsonEvents` opt.
- `src/core/agent-runner/__tests__/runners.test.ts` — modify; assert default argv + `jsonEvents` argv.
- `src/core/agent-runner/registry.ts` — modify; compute `opencodeJsonEvents`, thread to argv, parse stdout at the return boundary.
- `docs/noldor/agent-runtimes.md` + `templates/docs/noldor/agent-runtimes.md` — modify; structured-output cell + auto-permissions cell + version-floor note (doc twin, byte-identical).

---

## Task 1: opencode NDJSON events parser (TDD)

**Files:**
- Create: `src/core/agent-runner/__tests__/fixtures/opencode-events.ndjson`
- Create: `src/core/agent-runner/__tests__/opencode-events.test.ts`
- Create: `src/core/agent-runner/opencode-events.ts`

- [ ] **Step 1: Write the fixture** — real captured opencode 1.17.20 `run --format json` output (a multi-line reply, proving one complete `type:text` part per step with a distinct `part.id`). Create `src/core/agent-runner/__tests__/fixtures/opencode-events.ndjson` with exactly these 3 lines:

```
{"type":"step_start","timestamp":1784042493403,"sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","part":{"id":"prt_f613815d5001rcUifECKvoXkrP","messageID":"msg_f6138047b001rGdRQKLlhUSBtv","sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","snapshot":"9c8ab37b17a412bb5a752da21ff051af8cd6bb13","type":"step-start"}}
{"type":"text","timestamp":1784042493812,"sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","part":{"id":"prt_f613816f1001bZwkywXZ1fakDi","messageID":"msg_f6138047b001rGdRQKLlhUSBtv","sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","type":"text","text":"alpha\nbravo\ncharlie","time":{"start":1784042493681,"end":1784042493807}}}
{"type":"step_finish","timestamp":1784042493849,"sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","part":{"id":"prt_f613817960017pgGJBeKYeFJ6i","reason":"stop","snapshot":"9c8ab37b17a412bb5a752da21ff051af8cd6bb13","messageID":"msg_f6138047b001rGdRQKLlhUSBtv","sessionID":"ses_09ec7fc10ffekAtgUWHv9M6Y0T","type":"step-finish","tokens":{"total":19615,"input":17913,"output":9,"reasoning":29,"cache":{"write":0,"read":1664}},"cost":0}}
```

- [ ] **Step 2: Write the failing test.** Create `src/core/agent-runner/__tests__/opencode-events.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOpencodeEvents } from '../opencode-events.js';

const FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'opencode-events.ndjson'),
  'utf8',
);

describe('parseOpencodeEvents', () => {
  it('returns the complete text of a single (multiline) type:text part', () => {
    expect(parseOpencodeEvents(FIXTURE)).toBe('alpha\nbravo\ncharlie');
  });

  it('concatenates distinct-id text parts in first-seen order (multi-step run)', () => {
    const s =
      '{"type":"text","part":{"id":"a","type":"text","text":"Hel"}}\n' +
      '{"type":"text","part":{"id":"b","type":"text","text":"lo"}}\n';
    expect(parseOpencodeEvents(s)).toBe('Hello');
  });

  it('keeps the LAST value for a repeated part.id (defends against cumulative re-emit)', () => {
    const s =
      '{"type":"text","part":{"id":"a","type":"text","text":"Hel"}}\n' +
      '{"type":"text","part":{"id":"a","type":"text","text":"Hello world"}}\n';
    expect(parseOpencodeEvents(s)).toBe('Hello world');
  });

  it('is fail-open: skips malformed/blank lines and non-text events, never throws', () => {
    const s =
      '\nnot json\n{"type":"step_start","part":{"id":"s"}}\n' +
      '{"type":"text","part":{"id":"x","text":"X"}}\n{bad\n';
    expect(parseOpencodeEvents(s)).toBe('X');
  });

  it('returns empty for no text events / empty input', () => {
    expect(
      parseOpencodeEvents('{"type":"step_finish","part":{"id":"f","tokens":{"input":9,"output":1}}}'),
    ).toBe('');
    expect(parseOpencodeEvents('')).toBe('');
  });
});
```

- [ ] **Step 3: Run the test, verify FAIL.**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/runner-parity-followups
pnpm vitest run src/core/agent-runner/__tests__/opencode-events.test.ts
```

Expected output: fails to resolve `../opencode-events.js` (module not found) — the parser does not exist yet.

- [ ] **Step 4: Implement the parser.** Create `src/core/agent-runner/opencode-events.ts`:

```ts
/**
 * Parse an opencode `run --format json` NDJSON event stream (one JSON object
 * per line) into the assistant text. Verified against opencode 1.17.20
 * `run --format json` (2026-07-14): batch mode emits one COMPLETE `type:"text"`
 * part per step, each with a distinct `part.id` (no delta streaming — a
 * multi-line reply arrived as a single event). We key by `part.id` and keep the
 * LAST value per id, then concatenate in first-seen order: correct for the
 * observed distinct-id case, and defensive against any future cumulative
 * same-id re-emission (the final snapshot wins — no duplicated prose). Fail-open:
 * malformed/blank lines are skipped, never thrown. Text only — token telemetry
 * stays with the on-disk usage adapter (`usage/opencode.ts`); no duplicate sum.
 */
export function parseOpencodeEvents(stdout: string): string {
  const byPartId = new Map<string, string>();
  let anon = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue; // tolerate non-JSON noise (stray logs, partial lines)
    }
    if (typeof ev !== 'object' || ev === null) continue;
    const e = ev as { type?: unknown; part?: unknown };
    if (e.type !== 'text') continue;
    const part = e.part as { id?: unknown; text?: unknown } | undefined;
    if (!part || typeof part.text !== 'string') continue;
    const id = typeof part.id === 'string' ? part.id : `__anon_${anon++}`;
    byPartId.set(id, part.text); // last value per id wins; Map preserves first-seen order
  }
  return [...byPartId.values()].join('');
}
```

- [ ] **Step 5: Run the test, verify PASS.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/opencode-events.test.ts
```

Expected output: all 6 tests pass.

- [ ] **Step 6: Commit.**

```bash
git add src/core/agent-runner/opencode-events.ts src/core/agent-runner/__tests__/opencode-events.test.ts src/core/agent-runner/__tests__/fixtures/opencode-events.ndjson
git commit -m "feat(agent-runner): add opencode --format json NDJSON events parser" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 2: `buildOpencodeArgv` — `--auto` fix + conditional `--format json`

**Files:**
- Modify: `src/core/agent-runner/runners/opencode.ts`
- Test: `src/core/agent-runner/__tests__/runners.test.ts`

- [ ] **Step 1: Update the opencode argv tests to the new contract.** In `src/core/agent-runner/__tests__/runners.test.ts`, replace the `describe('opencode argv', …)` block (currently lines ~68-79) with:

```ts
describe('opencode argv', () => {
  it('builds run argv with --auto (1.17 replaces --dangerously-skip-permissions)', () => {
    expect(buildOpencodeArgv('p', {})).toEqual(['run', 'p', '--auto']);
    expect(OPENCODE_BIN).toBe('opencode');
  });
  it('appends --format json only when jsonEvents is set', () => {
    expect(buildOpencodeArgv('p', { jsonEvents: true })).toEqual(['run', 'p', '--auto', '--format', 'json']);
    expect(buildOpencodeArgv('p', { jsonEvents: false })).toEqual(['run', 'p', '--auto']);
  });
  it('appends provider/model', () => {
    expect(buildOpencodeArgv('p', { model: 'ollama/llama3.2' }).slice(-2)).toEqual([
      '--model',
      'ollama/llama3.2',
    ]);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts -t opencode
```

Expected output: fails — current `buildOpencodeArgv` emits `--dangerously-skip-permissions` and rejects the `jsonEvents` option (type error / wrong array).

- [ ] **Step 3: Reverify the live flag before coding.** Confirm the installed opencode still uses `--auto` and lacks `--dangerously-skip-permissions`:

```bash
opencode run --help 2>&1 | grep -E '\-\-auto|dangerously'
```

Expected output: a line for `--auto` (`auto-approve permissions that are not explicitly denied`); NO `--dangerously-skip-permissions` line. (If that assumption breaks, stop and re-derive the flag.)

- [ ] **Step 4: Rewrite the argv builder.** Replace the whole body of `src/core/agent-runner/runners/opencode.ts` with:

```ts
export const OPENCODE_BIN = 'opencode';

/** Prompt rides argv (`opencode run <prompt>`). */
export const OPENCODE_PROMPT_VIA = 'argv' as const;

/**
 * `--auto` auto-approves permissions that are not explicitly denied, still
 * honoring explicit `deny` rules in opencode.json (verified against
 * `opencode run --help`, opencode 1.17.20, 2026-07-14). Replaces the removed
 * 0.6-era `--dangerously-skip-permissions`. `--format json` is opt-in via
 * `jsonEvents`: the registry sets it only for spawns whose stdout it will parse
 * (piped, non-tee, non-inherit), so human/log-facing spawns keep opencode's
 * default formatted output.
 */
export function buildOpencodeArgv(
  prompt: string,
  opts: { model?: string; jsonEvents?: boolean },
): string[] {
  const argv = ['run', prompt, '--auto'];
  if (opts.jsonEvents) argv.push('--format', 'json');
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
```

- [ ] **Step 5: Run the test, verify PASS.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts -t opencode
```

Expected output: all 3 opencode-argv tests pass.

- [ ] **Step 6: Commit.**

```bash
git add src/core/agent-runner/runners/opencode.ts src/core/agent-runner/__tests__/runners.test.ts
git commit -m "fix(agent-runner): opencode --dangerously-skip-permissions -> --auto (1.17) + conditional --format json" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 3: registry — compute `jsonEvents`, thread to argv, parse stdout at the boundary

**Files:**
- Modify: `src/core/agent-runner/registry.ts`
- Test: `src/core/agent-runner/__tests__/registry.test.ts` (stale opencode argv assertion)

- [ ] **Step 1: Import the parser.** In `src/core/agent-runner/registry.ts`, add after the existing `import { OPENCODE_BIN, buildOpencodeArgv } from './runners/opencode.js';` line:

```ts
import { parseOpencodeEvents } from './opencode-events.js';
```

- [ ] **Step 2: Add the parse-intent helper.** Directly above `function planSpawn(` (currently line 51), add:

```ts
/**
 * True when this opencode spawn's stdout will be accumulated + read
 * programmatically — i.e. NOT tee/logSink (chunks forwarded for display) and
 * NOT stdio:'inherit' (streamed to the terminal). Only these spawns opt into
 * `--format json` and get NDJSON→prose parsing at the return boundary; every
 * other opencode spawn keeps default formatted output (no display regression).
 */
function opencodeWantsJson(resolved: ResolvedRunner, opts: SpawnAgentOpts): boolean {
  return resolved.runner === 'opencode' && opts.logSink === undefined && opts.stdio !== 'inherit';
}
```

- [ ] **Step 3: Thread `jsonEvents` into the opencode argv.** In `planSpawn`, replace the `case 'opencode':` block (currently lines 69-74) with:

```ts
    case 'opencode':
      return {
        bin: OPENCODE_BIN,
        argv: buildOpencodeArgv(prompt, {
          model: resolved.model,
          jsonEvents: opencodeWantsJson(resolved, opts),
        }),
        promptVia: 'argv',
      };
```

- [ ] **Step 4: Parse stdout at the return boundary — clean exits only.** In the `child.on('close', …)` handler, replace the final `resolve({ exitCode, stdout, timedOut });` (currently line 233) with the guarded version below. Parse ONLY on `exitCode === 0`: a failed/timed-out opencode run may emit no `type:text` part (error events instead), and parsing that to `''` would swallow the raw NDJSON diagnostics callers/logs rely on. On non-zero exit or timeout, return the raw stdout untouched (stderr is inherited separately).

```ts
      const outText =
        exitCode === 0 && opencodeWantsJson(resolved, opts) ? parseOpencodeEvents(stdout) : stdout;
      resolve({ exitCode, stdout: outText, timedOut });
```

- [ ] **Step 5: Fix the stale opencode argv assertion in `registry.test.ts`.** The test `opencode role with model builds --model argv` (currently lines 190-205) hard-asserts the old argv. That spawn (`role:'polish'`, no `logSink`, no `stdio:'inherit'`) → `opencodeWantsJson` is TRUE → the real argv now includes `--auto --format json`. Replace the `expect(f.calls[0]!.argv).toEqual([...])` block (currently lines 197-203) with:

```ts
    expect(f.calls[0]!.argv).toEqual([
      'run',
      'p',
      '--auto',
      '--format',
      'json',
      '--model',
      'ollama/x',
    ]);
```

- [ ] **Step 6: Typecheck.**

```bash
pnpm typecheck
```

Expected output: no errors (exit 0). (`opencodeWantsJson` is used in both `planSpawn` and the close handler; `parseOpencodeEvents` is imported.)

- [ ] **Step 7: Run the agent-runner suite, verify PASS.**

```bash
pnpm vitest run src/core/agent-runner
```

Expected output: all agent-runner tests pass (registry, runners, opencode-events, capabilities, usage adapters). No test asserts the old `--dangerously-skip-permissions` argv anymore (the `runners.test.ts` opencode block from Task 2 + `registry.test.ts:190-205` from Step 5 both now assert `--auto --format json`).

- [ ] **Step 8: Commit.**

```bash
git add src/core/agent-runner/registry.ts src/core/agent-runner/__tests__/registry.test.ts
git commit -m "feat(agent-runner): parse opencode NDJSON to prose at the registry return boundary" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 4: doc twin — `agent-runtimes.md` structured-output + permissions + floor

**Files:**
- Modify: `docs/noldor/agent-runtimes.md`
- Modify: `templates/docs/noldor/agent-runtimes.md`

- [ ] **Step 1: Edit the live doc.** In `docs/noldor/agent-runtimes.md`:
  1. Flag-mapping table — change the opencode `auto-permissions` cell from `` `--dangerously-skip-permissions` (respects explicit `deny`) `` to `` `--auto` (respects explicit `deny`) ``.
  2. Flag-mapping table — change the opencode `structured output` cell from `` `--format json` (reserved; treated as prose v1) `` to `` `--format json` → NDJSON events, parsed by `opencode-events.ts` ``.
  3. **`versionFloors` example JSON (line ~42)** — bump `"opencode": "0.6.0"` to `"opencode": "1.17.0"`. This is load-bearing: the framework now emits `--auto` (a 1.17 flag absent in 0.6); leaving the copied example at `0.6.0` would let a consumer on opencode 0.6 pass `doctor` (`doctor-runners.ts:72`) yet break at runtime. The floor must match the flag surface the code assumes.
  4. Below the table, update the version note to state opencode flags + floor are verified against 1.17.

- [ ] **Step 2: Sync the template twin byte-for-byte.**

```bash
cp docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
```

- [ ] **Step 3: Verify the twins are byte-identical.**

```bash
diff docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md && echo IDENTICAL
```

Expected output: `IDENTICAL` (no diff). (The `agent-runtimes.md` intro "first-class peers" rewrite is Part 2 Task — it lands with the shim-count change so the stated numbers and the guard land together.)

- [ ] **Step 4: Run the full verify to confirm Part 1 is green end to end.**

```bash
pnpm verify
```

Expected output: typecheck + tests + lint all pass (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
git commit -m "docs(agent-runtimes): opencode --format json is real (NDJSON), --auto permissions, 1.17 floor" -m "Noldor-FD: make-noldor-agent-agnostic"
```
