# Codex Lane Headless Dispatch — Design

**Slug:** specs-cr-gate-multi-reviewer-codex-headless-dispatch
**FD:** docs/features/specs-cr-gate-multi-reviewer.md
**Date:** 2026-08-11
**Tier:** specs-only
**Deps:** none beyond the parent FD's (`codex-cr-plan-review-mode`, `fix-multiterminal-dev-flow-bug`)
**Roadmap entry:** Q-0089 `codex-lane-headless-dispatch-breakage` (retired into this attach session)

## Problem

The `codex` CR lane does not complete headlessly against `codex-cli 0.133.0`. The roadmap entry
named three symptoms; measuring the live CLI confirms two of them and reframes the third, which
also relocates the fix.

**Measured, `codex-cli 0.133.0`, prompt on stdin, `--output-schema` set:**

| stream | bytes | content |
| --- | --- | --- |
| stdout | 12 | `{"ok":true}` — clean, parseable |
| stderr | 326,525 | `Reading prompt from stdin...` then `ERROR codex_models_manager::cache: failed to load models cache: unknown variant 'max'`, which dumps the entire models JSON body |

Exit code 0. So the prompt **already rides stdin correctly** — `src/cr/run-codex.ts:43-47` spawns
via `buildCodexArgv`, which emits no prompt positional, and `codex exec --help` documents that an
absent `[PROMPT]` means "instructions are read from stdin". The entry's prescribed fix
("stdin dispatch") is already in place; implementing it again would be a no-op.

The actual defect is in the spawn wrapper. `defaultSpawn` at `src/cr/codex.ts:241-257` creates the
child with `nodeSpawn(cmd, args)` — which pipes all three streams — and then reads only `stdout`.
`c.stderr` is never consumed, so once the kernel pipe buffer fills, codex blocks on `write(2)`
forever and never reaches `close`.

**Measured deadlock threshold** (`defaultSpawn`'s exact shape, child writing N bytes to stderr):

| stderr bytes | outcome |
| --- | --- |
| 32,000 | resolves, 32 ms |
| 65,000 | resolves, 27 ms |
| 200,000 | never resolves |
| 327,000 | never resolves |

codex emits 326,525 bytes, so every real dispatch deadlocks. The outer `execFile` in
`src/cr/lanes/codex.ts:82` eventually kills the `pnpm` child at its hard-coded `120_000` ms and the
lane writes a synthetic `codex lane errored: ...` blocker — which is what the entry observed as
"hang or dump a 478KB models-cache error".

Three further findings, all confirmed by reading the live code:

1. **`--base-sha` (entry symptom (a)).** A `--base-sha` the worktree cannot resolve makes
   `sh(cwd, ['diff', ...])` at `src/cr/codex.ts:111` throw. `runPlanReview`'s catch turns it into a
   `severity: 'high'` synthetic finding, so the lane reports `ok: false` and orchestrate exits 1.
   Confirmed as described.
2. **Unattributable failure (entry symptom (c)).** `src/cr/run-codex.ts:53` maps any non-zero exit
   to `synthBlocker('codex exited with exit code N')`. Because `defaultSpawn` never captures
   stderr, the child's own explanation — an expired ChatGPT session included — is discarded before
   it can reach the sink. Nothing about the message distinguishes expired auth from a crash.
3. **Timeout residue, not in the entry.** `src/cr/lanes/codex.ts:82` hard-codes
   `timeout: 120_000`, ignoring the `LaneInput.dispatchTimeoutMs` that
   `src/cr/orchestrate.ts:299` already resolves from `crReview.dispatchTimeoutMs`
   (`DEFAULT_DISPATCH_TIMEOUT_MS` = 900,000). `src/cr/lanes/subagent.ts:102` and
   `src/cr/lanes/verify.ts:161` both honour it; codex was missed. Even with the deadlock fixed, a
   real review exceeding two minutes would still false-red.

**Why the existing tests are green.** All eight tests in `src/cr/__tests__/run-codex.test.ts`
inject a fake `Spawn`. `defaultSpawn` — the only place the defect lives — is a module-private const
that no test executes. This is precisely the drift Q-0005 predicted mocked lane tests could not
catch, so the fix is only complete if the regression test runs a **real** child process.

## Goals

- The codex lane completes headlessly against a CLI that writes hundreds of KB to stderr.
- A codex failure carries its own explanation into the sink, with an explicit `codex login` hint
  when the stderr looks auth-shaped.
- A codex failure records which CLI version produced it, so the next drift is attributable.
- `crReview.dispatchTimeoutMs` governs the codex lane exactly as it governs `reviewer` / `verifier`.
- The regression test for the deadlock runs a real child process.

## Non-goals

- **No `--output-last-message` plumbing.** The entry's scope mentioned it, but stdout measured
  clean at 12 bytes; a temp-file round trip buys nothing today. Drift-hardening comes instead from
  reusing the tolerant JSON slicer that `src/cr/lanes/codex.ts:32` already implements (U3). See (D5).
- **No hard version gate.** The probe records the version; it never refuses to run. A gate on an
  unverified version floor would block working CLIs.
- **No retry / backoff at the codex dispatch seam.** Same reasoning `src/core/config.ts:80-86`
  records for the reviewer lane: a deterministic failure re-fails under the same cap and doubles
  wasted wall clock. The cap is the lever.
- **Not fixing the models-cache error itself** — that is an upstream `codex-cli` bug
  (`unknown variant 'max'` in its own reasoning-effort enum). Noldor's job is to survive it.
- **Not adding codex to `crLanes.code`.** That is Q-0091, which declares `blocked-by: Q-0089` and
  becomes eligible once this ships.
- **Not repairing the three pre-existing stale `links.code` FDs** that `sync code-links --check`
  reports (`portable-gate-entrypoint-for-non-claude-runners`, `scan-roots-repo-paths-provider`,
  `stable-entry-ids-for-roadmap-backlog`). Pre-existing, unrelated, red on `main` already.

## Design

### U1 — `src/cr/codex-spawn.ts` (new): the drained spawn

Move `defaultSpawn` out of `src/cr/codex.ts` into its own module as an exported `spawnCodex`, so a
test can reach it without going through `runCli` (which every existing test bypasses by injecting
`spawn`). Two changes to the body: consume `c.stderr`, and return it.

`Spawn` moves here too, alongside its canonical implementation — see (D10). `run-codex.ts` keeps
re-exporting the type (`export type { Spawn } from './codex-spawn.js'`) so the existing
`import { runCodex, type Spawn } from '../run-codex.js'` in `run-codex.test.ts` needs no edit.

```ts
export type Spawn = (args: {
  cmd: string;
  args: string[];
  stdin: string;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface SpawnCodexOpts {
  /** Wall-clock cap. Omitted → no inner cap; the caller's cap governs. */
  timeoutMs?: number;
}

export function spawnCodex(
  args: { cmd: string; args: string[]; stdin: string },
  opts?: SpawnCodexOpts,
): Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

Behaviour, preserving every existing property of `defaultSpawn`:

- `c.stdout.on('data')` and `c.stderr.on('data')` both accumulate. Draining stderr is the fix.
- `settled` latch retained — `close`, `error`, and the timeout race, first one wins.
- `error` → `{ stdout: '', stderr: <accumulated>, exitCode: 127 }` (127 preserved from today).
- `c.stdin.on('error', () => {})` retained: a child that exits before reading stdin must not raise
  `EPIPE`.
- On `timeoutMs` expiry: **group-kill**, then resolve `{ exitCode: -1 }` with whatever stderr
  accumulated, so the caller can still attribute the failure. `-1` matches the convention
  `src/core/agent-runner/registry.ts:232` establishes (`code ?? -1`);
  `src/cr/lanes/subagent-dispatch.ts` only surfaces it, it does not mint it.

  A direct `child.kill('SIGKILL')` is **not** sufficient: `codex exec` runs a sandbox and spawns
  children of its own, so killing only the direct child orphans them — the exact hazard (D6) exists
  to prevent, and the exact hazard `registry.ts:150-153` documents ("Without it, a runner SIGKILL
  orphans the grandchild"). Reuse that seam's pattern rather than inventing a second one: spawn with
  `detached: true` so the child is its own process-group leader (`pgid === child.pid`), and kill the
  group, falling back to a direct kill when the group is already gone or not permitted.

  ```ts
  // mirrors registry.ts:200-211 — keep the two implementations recognisably identical
  const killTree = (): void => {
    const pid = c.pid;
    if (pid !== undefined) {
      try {
        process.kill(-pid, 'SIGKILL');
        return;
      } catch {
        /* group gone / not permitted — fall through to direct kill */
      }
    }
    c.kill('SIGKILL');
  };
  ```

  **Never `c.unref()`** — that would let the parent exit while codex still runs, which is the orphan
  we are closing, not a cleanup. Group kill is POSIX-only (darwin / Linux), matching that seam's
  stated platform support; the fallback covers the rest.
- **Reap on parent interrupt too, or `detached: true` is a regression.** A detached child leaves the
  terminal's foreground process group, so a `Ctrl-C` — SIGINT delivered to that *group* — no longer
  reaches codex. The `timeoutMs` timer is no help: it lives in the parent SIGINT just killed, so
  nothing reaps codex at all. Measured on darwin, parent made a group leader and the group sent
  SIGINT:

  | spawn mode | parent | child |
  | --- | --- | --- |
  | same group (today's `defaultSpawn`) | dies | **dies with parent** |
  | `detached: true`, no handler | dies | **survives — orphan** |

  So the interactive path would get *worse* than today, not merely inherit `registry.ts`'s posture.
  Register `SIGINT` / `SIGTERM` handlers alongside the spawn that call `killTree` before exiting, and
  remove them when the promise settles so a long-lived process (the lane runs several dispatches in
  one process) does not accumulate listeners:

  ```ts
  const onSignal = (): void => {
    killTree();
    process.exit(130); // 128 + SIGINT
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  ```

  Ctrl-C then group-kills through `onSignal`; a timeout group-kills through the timer; a normal exit
  needs neither. This is the one place the design deliberately diverges from `registry.ts`, which
  takes the orphan-on-interrupt trade; the divergence is justified because that seam's callers are
  themselves headless, while `pnpm noldor cr codex …` is a documented interactive command.
- **Clear the timer and drop the signal handlers on settle.** `settle()` calls
  `clearTimeout(timer)` and `process.off` for both signals. Mirrors the
  `if (timer) clearTimeout(timer)` that `src/core/agent-runner/registry.ts:225` and `:230` do on
  their two listeners — `close` and `error` only, **not** inside the timeout callback, where
  clearing a timer from within its own firing is a no-op. Without the clear, a pending `setTimeout`
  holds the event loop open for up to the full cap, which surfaces as a vitest hanging-handle
  warning or a worker that will not exit.

Accumulate into a `string[]` and `join('')` rather than `+=` — 326 KB of `+=` on every chunk is
quadratic, and this path is now guaranteed to see that volume.

### U2 — `src/cr/codex-failure.ts` (new): failure attribution

Pure functions plus one injectable probe, so all of it is unit-testable with no real process.

```ts
/** Loose on purpose — see (D8). */
export const AUTH_HINT_RE =
  /codex login|not logged[- ]?in|unauthorized|\b401\b|no valid credentials|auth(?:entication)? (?:failed|expired|required)/i;

export function formatStderrTail(stderr: string, maxChars?: number): string;
export function describeCodexFailure(input: {
  exitCode: number;
  stderr: string;
  version: string;
}): string;
// Spawn imported from './codex-spawn.js' — U2 must not import it from run-codex.ts,
// which imports these helpers back (D10).
export function probeCodexVersion(spawn: Spawn): Promise<string>;
```

- `formatStderrTail` — returns `''` for empty stderr; otherwise
  `stderr (last <shown> of <total> bytes):\n<tail>` with `maxChars` defaulting to 4,000. The header
  always states the true total, so truncation is never silent.
- `describeCodexFailure` — composes `<version>: exited with exit code <n>`, appends
  ` — auth looks expired; run: codex login` when `AUTH_HINT_RE` matches **anywhere in the full
  stderr** (not just the tail — the actionable line can sit at byte 400 of 326,525), then a blank
  line and `formatStderrTail(stderr)`.
- `probeCodexVersion` — runs `codex --version` through the injected `Spawn`, returns the trimmed
  first line, and returns `'unknown'` on throw / non-zero / empty. It must never throw: an
  attribution helper that fails cannot be allowed to mask the failure it is attributing.

### U3 — `src/cr/extract-json.ts` (new): one tolerant JSON slicer

`src/cr/lanes/codex.ts:32` already carries `extractLaneJson` — slice from the first `{` to the last
`}` so surrounding noise cannot break `JSON.parse`. `src/cr/run-codex.ts:56` does a bare
`JSON.parse(stdout)` and has no such tolerance. Move the helper to `src/cr/extract-json.ts` as
`extractJsonObject(text: string): unknown` and consume it from both call sites. This is the
drift-hardening that replaces `--output-last-message`, and it removes a duplicated concern rather
than adding a second one.

The thrown message **does change**: the live one at `src/cr/lanes/codex.ts:36` is prefixed
`codex lane: `, which a shared helper must drop (it now serves two callers). Verified safe — a
repo-wide grep for `no JSON object` matches only that source line, so no test asserts on it.

### U4 — `src/cr/run-codex.ts`: capture, attribute, parse tolerantly

- `Spawn`'s resolved type gains `stderr: string`, **required** — see (D4).
- Keep `stderr` from the spawn result and pass it to `describeCodexFailure` on the
  `exitCode !== 0` branch (`run-codex.ts:53`), replacing today's bare
  `codex exited with exit code ${exitCode}`. `probeCodexVersion` runs **only** on this branch (D3),
  so a green run spawns nothing extra.
- Route the `JSON.parse` at line 56 through `extractJsonObject`. The two existing malformed-output
  tests keep passing: `'!!! not json'` has no `{`, so the extractor throws and the same
  `malformed CR record` blocker is synthesized.
- The `catch` around the spawn keeps returning `codex spawn failed: <message>` unchanged.

### U5 — `src/cr/codex.ts`: consume `spawnCodex`

Delete the local `defaultSpawn` (its body moved to U1) and use `spawnCodex` as the fallback at both
`input.spawn ?? defaultSpawn` sites (`runCli` lines 44 and 68), so a direct
`pnpm noldor cr codex --plan …` run is capped too and a codex that outlives the outer `execFile` cap
in U7 is killed here rather than orphaned when `pnpm` is signalled. See (D6).

Resolve the cap exactly the way `src/cr/orchestrate.ts:252` does — there is **no** `loadNoldorConfig`;
the real exports are the async `loadConfig(path)` and the sync `loadConfigSync(path)`
(`src/core/config.ts:224`), and both take a **config-file path**, not a cwd:

```ts
// runCli is already async, so mirror orchestrate.ts:252 rather than the sync variant.
const cfg = await loadConfig(join(cwd, '.noldor', 'config.json')).catch(() => null);
const timeoutMs = resolveDispatchTimeoutMs(cfg);
```

`resolveDispatchTimeoutMs` (`src/core/config.ts:267`) already accepts `null` and falls back to
`DEFAULT_DISPATCH_TIMEOUT_MS`, so an unreadable or absent config degrades to the 900 s default
instead of throwing.

### U6 — `src/core/agent-runner/runners/codex.ts`: explicit stdin positional

`buildCodexArgv` appends `'-'` as the final positional. Per `codex exec --help` the prompt is read
from stdin when `[PROMPT]` is absent *or* is `-`, so this is behaviour-preserving and makes the
contract that `CODEX_PROMPT_VIA = 'stdin'` already declares explicit at the argv level — no
future reader has to know that "absent" means "stdin". Shared surface: `registry.ts:73` also builds
argv from it, so the registry's argv assertions move in lockstep.

### U7 — `src/cr/lanes/codex.ts`: honour the configured cap

Replace `{ timeout: 120_000 }` at line 82 with
`{ timeout: input.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS }`, matching
`src/cr/lanes/subagent.ts:102` and `src/cr/lanes/verify.ts:161`. Also swap the local
`extractLaneJson` for the shared `extractJsonObject` from U3.

### U8 — parent FD link hygiene

`docs/features/specs-cr-gate-multi-reviewer.md` `links.code` lists `src/cr/prompt-stdin.ts`, which
does not exist. `pnpm noldor sync code-links --check` reports this FD as
`skipped (no tags, existing links kept)`, so the tool will never repair it — the field is
hand-maintained here. Remove the dangling entry by hand and add `src/cr/codex-spawn.ts`,
`src/cr/codex-failure.ts`, and `src/cr/extract-json.ts`. See (D7).

### Data flow

```
orchestrate.ts:299  resolveDispatchTimeoutMs(cfg) ──► LaneInput.dispatchTimeoutMs
                                                          │
lanes/codex.ts  execFile('pnpm', […], { timeout: ↑ })  ◄──┘         [U7]
                                                          │
                                        stdout ─► extractJsonObject  [U3]
                                                          │
codex.ts runCli ─► run-codex.ts runCodex                             [U4/U5]
                       │
                       ├─ spawnCodex({cmd,args,stdin}, {timeoutMs}) [U1]
                       │       stdout ─► extractJsonObject ─► CrRecord
                       │       stderr ─┐
                       │               │  (exit ≠ 0 only)
                       └─ describeCodexFailure({exitCode, stderr,   [U2]
                              version: await probeCodexVersion()})
                                       └─► synthBlocker ─► sink JSON
```

### Error handling

Every failure mode resolves to a written sink, never a throw — the lane contract at
`src/cr/codex.ts:96-101` states findings travel via stdout and a non-zero exit means infrastructure
failure, and that stays true.

| failure | today | after |
| --- | --- | --- |
| large stderr | deadlock → outer 120 s kill → `codex lane errored` | drained; review completes |
| expired auth | `codex exited with exit code 1` | `codex-cli 0.133.0: exited with exit code 1 — auth looks expired; run: codex login` + stderr tail |
| other non-zero exit | `codex exited with exit code N` | same + version + stderr tail |
| noisy stdout | `malformed CR record` | tolerant slice recovers the object |
| unresolvable `--base-sha` | synthetic high blocker (correct) | unchanged |
| slow but healthy review | false red at 120 s | runs to `crReview.dispatchTimeoutMs` (900 s default) |
| `probeCodexVersion` itself fails | n/a | `unknown`, never throws |

### Testing

Two new test files, both tagged `// @tests: specs-cr-gate-multi-reviewer` per the src-layout
tag requirement.

**`src/cr/__tests__/codex-spawn.test.ts` (new — real child processes).** This file is the point of
the change; a fake `Spawn` cannot reproduce a pipe deadlock.

- A real child writing 327,000 bytes to stderr resolves with `exitCode: 0` and
  `stderr.length > 300_000`, inside a per-test timeout well under the hang. **Fails today** (never
  resolves) — this is the regression test.
- Control at 65,000 bytes resolves too, documenting that the old code passed below the pipe buffer
  and so looked fine in casual use.
- stdin reaches the child (child echoes it to stdout).
- Nonexistent binary → `exitCode: 127`, no throw.
- `timeoutMs` shorter than a sleeping child → child killed, `exitCode: -1`, stderr preserved.
- **Group kill reaches the grandchild.** The child spawns a grandchild that would outlive it (a
  long `sleep` whose pid the child prints to stdout), then blocks. After `timeoutMs` fires,
  **poll** `process.kill(grandchildPid, 0)` for up to ~2 s until it throws `ESRCH`, rather than
  asserting once: immediately after the group `SIGKILL` the grandchild can still be a zombie awaiting
  re-parenting and reaping by init, and `kill(pid, 0)` does **not** throw for a zombie — a single
  assertion would flake. This is the test that distinguishes the group kill from a direct
  `child.kill`, which leaves the grandchild running so the poll times out and fails. Skip on
  non-POSIX platforms, matching the seam's stated support.
- **No timer is left armed after a normal settle.** Assert it directly — a leaked `setTimeout` never
  delays resolution (the promise settles on `close` regardless), so "it resolved quickly" proves
  nothing. Use `vi.useFakeTimers()` and assert `vi.getTimerCount() === 0` once the promise settles,
  or spy on `clearTimeout` and assert it was called with the timer id. Under fake timers keep the
  child's own lifetime real (or drive it explicitly) so the spawn still completes.
- **Signal handlers are removed on settle.** After a normal run,
  `process.listenerCount('SIGINT')` and `'SIGTERM'` are back to their pre-call values — otherwise a
  process making several dispatches leaks a listener per call and eventually trips Node's
  max-listeners warning.

**`src/cr/__tests__/codex-failure.test.ts` (new — pure).** `AUTH_HINT_RE` matches representative
auth stderr and does **not** match the models-cache noise; auth line at the head of 326 KB still
produces the hint (proving the scan reads the whole string, not the tail); `formatStderrTail`
reports the true total and caps the tail; `''` in → `''` out; `describeCodexFailure` contains the
version; `probeCodexVersion` returns `unknown` on a throwing / non-zero / empty spawn.

**Existing files.** `run-codex.test.ts` — add `stderr` to the eight stubs (compiler-driven), plus
new cases for the auth hint, the tail on non-auth failure, the version in the message, noisy-stdout
recovery, and argv ending in `-`. `lanes/codex.test.ts` (9 tests, currently no timeout coverage) —
assert the execFile timeout equals `input.dispatchTimeoutMs`, and `DEFAULT_DISPATCH_TIMEOUT_MS`
(900,000, explicitly not 120,000) when absent. Registry tests move with U6's argv change.

**Manual verification.** A real `pnpm noldor cr codex --spec <this spec>` run must exit 0 and write
a parseable sink — the whole entry exists because mocked lanes missed real CLI drift, so the
implementation is not done until the real CLI has been driven once end to end.

## Acceptance criteria

1. `spawnCodex` resolves `exitCode: 0` with `stderr.length > 300_000` for a real child writing
   327,000 bytes to stderr; the equivalent test against today's `defaultSpawn` shape never resolves.
2. `spawnCodex` delivers `stdin` to the child, returns `127` for a missing binary, and — given
   `timeoutMs` — kills an over-running child and returns `-1` with stderr preserved.
3. On expiry `spawnCodex` kills the whole process group, not just the direct child: a grandchild
   spawned by the child is gone afterwards, established by polling `process.kill(pid, 0)` until it
   throws `ESRCH` (a single immediate assertion can see a zombie and pass wrongly). The child is
   spawned `detached: true` and is never `unref`'d.
4. After a normal settle no timer remains armed — asserted via `vi.getTimerCount() === 0` under fake
   timers, or a `clearTimeout` spy — and `process.listenerCount('SIGINT')` / `'SIGTERM'` are back to
   their pre-call values. Neither claim may rest on the run "resolving quickly": a leaked timer does
   not delay resolution.
5. A `SIGINT` delivered to the parent while a dispatch is in flight kills the codex process group
   rather than orphaning it — the interactive case must be no worse than today's non-detached spawn,
   where the child dies with its parent's process group.
6. `Spawn`'s resolved type requires `stderr: string`; `pnpm typecheck` fails on a stub that omits it.
7. `buildCodexArgv(...)` ends with `'-'`, and `registry.ts`'s argv assertions agree.
8. `runCodex` on a non-zero exit whose stderr matches `AUTH_HINT_RE` yields exactly one blocker
   whose `message` contains `codex login`.
9. `runCodex` on a non-zero exit with 326,525 bytes of non-auth stderr yields a blocker containing
   `of 326525 bytes` and at most ~4,000 characters of stderr body.
10. That blocker's `message` contains the probed version; a failing probe yields `unknown` and no throw.
11. `runCodex` recovers `{…}` from stdout carrying leading and trailing noise, and still returns the
   parsed record on clean JSON (the three existing malformed-output tests keep passing unchanged).
12. `src/cr/lanes/codex.ts` passes `input.dispatchTimeoutMs` to `execFile`, defaulting to
   `DEFAULT_DISPATCH_TIMEOUT_MS`; a test asserts `900_000` and no `120_000` literal remains in the file.
13. `docs/features/specs-cr-gate-multi-reviewer.md` `links.code` no longer lists
    `src/cr/prompt-stdin.ts` and lists the three new modules.
14. `pnpm typecheck` and the full `pnpm test` pass, and the total test count is strictly greater
    than the pre-change count (a suite that never loaded the new files also reports green).
15. One real `pnpm noldor cr codex --spec <path>` invocation against the installed CLI exits 0 and
    writes a parseable sink.

## Risks / trade-offs

- **U6 touches a shared surface.** `buildCodexArgv` feeds both the CR lane and the agent-runner
  registry, so `-` reaches every codex consumer. Safe because `CODEX_PROMPT_VIA = 'stdin'` already
  declares that contract for all of them, and `-` is the documented explicit spelling of the
  default; mitigated by asserting argv in both the CR and registry tests.
- **The auth pattern is unverified against a genuinely expired session.** The probe machine is
  logged in and expiry cannot be forced on demand. Mitigated by a loose alternation plus the
  unconditional stderr tail: a pattern miss degrades to "exit code + version + tail", which is
  still strictly better than today's bare exit code — never worse.
- **Required `stderr` churns roughly 18 test stubs** across `run-codex.test.ts` and `codex.test.ts`.
  Accepted deliberately: the defect being fixed *is* a field nobody read, and an optional field
  reproduces that hazard at the type level (D4).
- **A 4,000-character tail can still truncate away the real cause** when the cause is neither
  auth-shaped nor last. Accepted: the byte count makes the truncation visible, and the operator can
  re-run the CLI directly.
- **`detached: true` takes codex out of the terminal's foreground process group**, so Ctrl-C no
  longer reaches it implicitly — and the `timeoutMs` timer cannot cover for that, because SIGINT
  kills the parent the timer lives in. Measured: a same-group child dies with its parent, a detached
  one survives. Closed by the `SIGINT` / `SIGTERM` handlers in U1 rather than accepted; the residual
  exposure is narrowed to a signal those handlers cannot intercept (`SIGKILL` on the parent, or a
  hard machine loss), where codex runs to self-completion. Group kill is POSIX-only; the direct-kill
  fallback covers other platforms with the pre-existing behaviour.
- **The signal handlers are process-global while the spawn is per-call.** Two concurrent
  `spawnCodex` calls in one process each register their own pair, so a Ctrl-C kills both trees — which
  is the desired outcome — but the `process.exit(130)` means the first handler to run ends the
  process, so a caller mid-write could lose an unflushed sink. Accepted: the alternative (ref-counted
  handlers with a coordinated shutdown) is more machinery than the interactive path warrants, and the
  lane's own sink write is atomic (`src/cr/atomic-write.ts`).
- **Real-process tests are slower and more environment-sensitive** than mocked ones (~1 s, and they
  spawn `node`). Accepted — a mocked test provably cannot catch this class, which is the entry's
  entire premise. Scoped to one new file.
- **Raising the codex cap from 120 s to 900 s makes a genuinely hung dispatch cost 15 minutes**
  instead of 2. Bounded by the drain's 30-minute per-iteration cap, exactly as
  `src/core/config.ts:80-86` reasons for the reviewer lane, and U1's inner `timeoutMs` prevents an
  orphaned codex from outliving it.

## User Story

As an agent running the gate's CR lanes, I want the codex lane to complete headlessly and to
explain itself when it fails, so that a second-model review round is usable unattended instead of
deadlocking until the dispatch timeout and reporting an unattributable exit code.

## Usage

**UI** — none; the codex lane is CLI-driven.

**Keyboard shortcut** — none.

**Agent/Programmatic API** — no new commands and no new flags. Existing surfaces change behaviour:

- `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <spec|plan|code> --lanes codex`
  — the lane now completes instead of deadlocking, and is capped by `crReview.dispatchTimeoutMs`
  (default 900,000 ms) rather than a hard-coded 120,000 ms.
- `pnpm noldor cr codex --plan|--spec <path> [--slug <slug>] [--base-sha <sha>]` — unchanged flags.
  A failure now prints and sinks the CLI version, an explicit `run: codex login` hint when the
  stderr looks auth-shaped, and a bounded stderr tail with its true byte count.
- Sink shape at `.noldor/cr/<slug>-<kind>-codex.json` is unchanged: the added detail rides the
  existing blocker `message`, so `cr aggregate`, `cr autofix`, and `finding-class` need no change.
- Opting codex into the code stage stays a `crLanes.code` config choice (`["reviewer", "codex"]`);
  making it mandatory on large changes remains Q-0091.

## Open questions (resolved)

1. *When does the `codex --version` probe run?* → **Lazily, on the failure path only.** (D3) Folding
   it into the blocker message costs nothing on a green run, needs no `findings-schema` change, and
   puts the version exactly where someone debugging drift will look. A green run needs no version.
2. *Should `Spawn`'s resolved `stderr` be required or optional?* → **Required.** (D4) An optional
   field lets a future stub omit stderr and leave the auth-hint path vacuously green — the same
   "field nobody read" shape as the bug being fixed. ~18 mechanical stub edits, compiler-driven.
3. *Keep `--output-last-message` from the entry's scope?* → **No — drop it; reuse the tolerant JSON
   slicer instead (U3).** (D5) stdout measured clean at 12 bytes, so the temp-file round trip guards
   nothing today, while `extractJsonObject` hardens the same drift in three lines and removes an
   existing duplication. Cheap to add later if stdout ever does get polluted.
4. *Should `spawnCodex` carry its own `timeoutMs`, or rely on the outer `execFile` cap?* → **Carry
   it, wired from config in U5, and make the expiry a group kill.** (D6) `execFile`'s timeout signals
   only its direct child (`pnpm`), so a hung codex would orphan and keep burning ChatGPT quota
   unattended in drain mode. The CR round then caught that a *direct* `child.kill` reintroduces the
   same hazard one level down, since `codex exec` spawns its own children — hence `detached: true`
   plus `process.kill(-pgid)` with a direct-kill fallback, reusing `registry.ts:200-211` verbatim
   rather than minting a second pattern.
   Cuttable without touching U1 if the operator reads it as creep.
5. *Fix the dangling `links.code` entry by hand, or with `sync code-links`?* → **By hand.** (D7)
   `--check` reports this FD as `skipped (no tags, existing links kept)`, so the tool will never
   touch it; the field is hand-maintained. `--force` would clear all 21 entries, not just the dead one.
6. *Where does `AUTH_HINT_RE` live?* → **`src/cr/codex-failure.ts`, exported.** (D8) Exported so a
   test can assert both directions (matches auth stderr, does not match models-cache noise) without
   reaching through `runCodex`; colocated with the formatter that consumes it.
7. *Does removing the Q-0089 roadmap block strand Q-0091's `blocked-by: Q-0089`?* → **No.** (D9)
   Per the plans-source dependency semantics, an absent entry reads as shipped, so Q-0091 becomes
   eligible exactly when this merges. No roadmap edit needed.
8. *Where does the `Spawn` type live, given U2 needs it and `run-codex.ts` imports U2 back?* →
   **`src/cr/codex-spawn.ts`, re-exported from `run-codex.ts`.** (D10) Homing it beside its canonical
   implementation avoids a type-only import cycle (harmless at runtime, but needless), and the
   re-export keeps `import { runCodex, type Spawn } from '../run-codex.js'` working in the existing
   tests with no edit.
