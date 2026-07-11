# Noldor-Native Wait Primitive — Design

**Slug:** noldor-native-wait-primitive
**FD:** docs/features/noldor-native-wait-primitive.md
**Date:** 2026-07-11
**Tier:** specs-only
**Deps:** none

## Problem

The autonomous controller (and any headless caller) sometimes needs to block until a producer job reaches a terminal state — a drain cycle going idle, a code-review lane finishing. Today the only tool for this is the host harness's `Monitor`, which (a) can itself be blocked, and (b) is not portable across runners (Claude Code, Codex, etc.). `grep -rn 'Monitor' src/` confirms the framework never uses it — every existing wait is a bespoke self-`setTimeout` loop (`watch.ts` `interruptibleSleep`, `drain-loop.ts` `delay`, `pr-flow.ts` `pollAutoMerge`, `verify/health.ts` `waitForHttp200`, `cr/aggregate-cli.ts` `--wait-ms`).

The producers already write machine-readable state files (`.noldor/drain-state.json`, `.noldor/cr/<slug>-<kind>-<lane>.json`). The "write one side / read the other" channel exists; the gap is a **portable, runner-agnostic `wait`/poll** the controller calls instead of `Monitor`. This must reuse the existing state files — it must not invent a new progress format or mutate the producer side.

## Goals

- A `noldor wait <state-file> --until <cond>` CLI that polls a JSON state file on a fixed interval until a predicate matches, then exits `0`.
- A `--fail-if <cond>` predicate that exits `1` fast when a job reaches a known-bad terminal state (e.g. a CR sink with `finishedAt` set *and* blockers present), rather than burning the full timeout.
- A bounded `--timeout-ms` (default 10 min) so the primitive can never hang the way a blocked `Monitor` does; timeout exits `2`.
- `--emit <dotpath>` to capture a scalar/JSON value from the terminal snapshot on stdout, so the caller can consume a result.
- Human-readable progress on stderr (stdout stays pipe-clean), silenceable with `--quiet`.
- Blind to producer schemas: a generic dotpath predicate over any JSON file — zero coupling to drain-state or CR-sink shapes, no producer-side change.
- A pure, clock-injected core testable with fake timers; `pnpm verify` stays green.

## Non-goals

- **No producer-side changes.** Do not add a `status`/`done`/`heartbeatAt` field to `.noldor/drain-state.json`. Its terminal signal stays `phase == idle`; its liveness stays out-of-band (`.noldor/drain.lock` + `kill -0`). See risk R1.
- **No lock/liveness awareness baked into `wait`.** It is a generic file poller. A drain that crashes *while busy* freezes its state at `phase: spawning|awaiting-merge`, so `--until 'phase==idle'` correctly never matches and the caller learns via timeout (exit `2`).
- **No `pollAutoMerge` refactor.** `wait.ts`'s core is *modeled on* `src/core/pr-flow.ts:212` but written fresh; `pollAutoMerge` is `gh`-specific and release-critical — not worth coupling for an M feature.
- **No config block.** Interval/timeout are flags, matching the house lean (`--wait-ms`, `--iteration-timeout`, the `config.ts` "timeout is a flag not a rail" comment). No `wait:` key in `noldorConfigSchema`.
- **No backoff / jitter.** Fixed interval, like every existing poll loop.
- **No predicate combinators.** Single `<dotpath> <op> <value>` or `<dotpath>?`. No `and`/`or`, no `<`/`>`/`in[]`. Extensible later if a real need appears (YAGNI).

## Design

All new code lands in `src/core/` (see D9 — a producer-agnostic primitive sits beside `pr-flow.ts`'s `pollAutoMerge`, not in drain-specific `src/autonomous/`; FD `links.code` updated to match).

### Unit 1 — `src/core/wait.ts` (pure core)

- **`getPath(obj: unknown, dotpath: string): unknown`** — `dotpath.split('.').reduce((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj)`. Numeric segments index arrays (`blockers.0`). Null-safe. Greenfield — no jsonpath dependency exists (confirmed against `package.json`).
- **`parsePredicate(src: string): Predicate`** — grammar:
  - `<dotpath>?` → `{ kind: 'exists', path }` (trailing `?`, detected first).
  - `<dotpath> == <literal>` / `<dotpath> != <literal>` → `{ kind: 'eq' | 'neq', path, literal }`. Take the **leftmost operator occurrence**: compute the index of the first `==` and the first `!=`, pick whichever is smaller (that operator's kind wins; if only one is present, use it). Everything before is the dotpath; everything after is the literal; trim both. **Only the dotpath is charset-checked — the literal is unconstrained.** So `a!=b==c` deterministically parses as `neq(path 'a', literal 'b==c')` (leftmost operator is `!=` at index 1), *not* an error; and `a!==b` parses as `neq(path 'a', literal '=b')`. Exit `3` happens only when the dotpath portion fails the charset guard (e.g. `a b==c` → path `a b` has a space) or no operator/`?` is found at all.
  - Anything else → throw a typed `PredicateParseError` (CLI maps to exit `3`).
  - **Dotpath validation (all branches):** the extracted dotpath must match `/^[A-Za-z0-9_.-]+$/` — segment chars, `.` separators, **and `-`** because real state-file keys are kebab-case (`drain-state.json` `retries` is `Record<slug, number>` and `skip` holds slugs, `src/autonomous/drain-state.ts:22-23`; CR sinks are slug-keyed too). Any `=`, `!`, whitespace, `?`, or other character in the resolved dotpath throws `PredicateParseError`. This catches malformed input the branch order would otherwise swallow — e.g. `phase==idle?` (trailing-`?` detected first) yields an `exists` predicate with path `phase==idle`; the `=` in that path makes it exit `3` instead of a predicate that silently never matches (burning the full timeout).
  - **Literals may not end in `?`.** An `eq`/`neq` literal ending in `?` (e.g. `msg==done?`) hits the exists branch first, producing dotpath `msg==done`, which the charset guard rejects → exit `3`. This is a grammar limitation, not a parser bug — documented so implementers don't try to "fix" it.
- **`evalPredicate(pred: Predicate, snapshot: unknown): boolean`** — resolves `v = getPath(snapshot, pred.path)`. `exists` ⇒ `v != null`. `eq`/`neq` **short-circuit on an absent path**: if `v == null` (path missing or null), *both* `eq` and `neq` return `false` — no match, keep waiting — so a partially-written state file, or a wrong file passed, can never produce a false terminal. Only once the path resolves to a non-null value do we compare `String(v) === pred.literal` (covers string/number/bool scalars); `neq` is that comparison negated. Consequence: `phase!=spawning` and `phase==undefined` never match an *absent* `phase` (both require `phase` present first) — literal `undefined`/`null` comparisons against a missing path are unsupported by construction, not by a `String()`-coercion accident. Comparing a path that resolves to a **non-scalar** (object/array) is defined but not the intended use — `String({})` is `'[object Object]'`, `String(['a','b'])` is `'a,b'` — so `eq`/`neq` are meant for scalar leaves; to test for the presence of a subtree use `exists` (`some.nested?`), not `eq`.
- **`waitUntil(opts): Promise<WaitOutcome>`** — the poll loop, mirroring `pollAutoMerge`'s injected-clock shape:
  ```ts
  interface WaitDeps {
    read: () => unknown | null;          // caller reads+parses the file; null on missing/unparseable
    until: Predicate;
    failIf?: Predicate;
    intervalMs: number;
    timeoutMs: number;                   // 0 = no timeout
    now?: () => number;                  // injected clock (default Date.now)
    sleep?: (ms: number) => Promise<void>;
    onPoll?: (snapshot: unknown | null, elapsedMs: number) => void;
  }
  type WaitOutcome =
    | { outcome: 'matched'; snapshot: unknown }
    | { outcome: 'failed'; snapshot: unknown }
    | { outcome: 'timeout'; lastSnapshot: unknown | null; everReadable: boolean };
  ```
  Each iteration: `read()`, call `onPoll`, evaluate **`failIf` first** (bad terminal dominates) then `until`; on match return. Else, if timed out return `timeout`; else `sleep(intervalMs)` and repeat. `read()` returning `null` (startup race / bad JSON) yields no predicate match — the loop keeps polling. Tracks `everReadable` for the timeout message. **Timeout guard special-cases `timeoutMs === 0` as *no timeout* (poll forever):** the loop must check `timeoutMs > 0 && now() - start >= timeoutMs`, *not* copy `pollAutoMerge`'s `while (now() - start < timeoutMs)` condition verbatim — that form never enters the loop when `timeoutMs` is `0`.

### Unit 2 — `src/core/wait-cli.ts` (thin CLI wrapper)

- Guards direct invocation with the repo idiom: `/[\\/]wait-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '')`.
- For-loop arg parse (à la `src/cr/cli-args.ts:25`): positional `<state-file>` = first non-flag arg; valued flags `--until`, `--fail-if`, `--emit`, `--interval-ms`, `--timeout-ms`; boolean `--quiet`; throw-on-unknown. A valued flag with no following token (`argv[++i] === undefined`, i.e. flag is last in argv) ⇒ exit `3`. Missing `<state-file>` or `--until` ⇒ usage error, exit `3`.
- **Numeric flag validation (closes R3's bounded-timeout mitigation).** `--interval-ms` / `--timeout-ms` are parsed with `Number(...)` and validated: must be a finite number; `--timeout-ms` must be `>= 0` (with `0` = no timeout per D-earlier); `--interval-ms` must be `> 0`. Any non-finite / out-of-range value (`--timeout-ms garbage` → `NaN`, `--interval-ms 0`/negative) ⇒ exit `3`. Without this, `NaN` timeout silently disables the timeout guard (`timeoutMs > 0` is `false` → waits forever) and `NaN` interval makes `setTimeout(fn, NaN)` fire immediately → a hot-spin read loop. Validation happens in `wait-cli.ts` before `waitUntil` is called, so the pure core only ever sees valid numbers.
- `read` closure: `readFileSync` → `JSON.parse` wrapped in one try/catch returning `null` on any failure (missing file, unreadable, bad JSON) — best-effort, mirroring `drain-state.ts` `readState`. No `existsSync` pre-check: it only adds a TOCTOU window; the catch already covers a missing file (`ENOENT`). A file whose content parses to `null` or a non-object (`false`, a bare number) is likewise treated as "no usable snapshot yet" — `getPath` over it resolves nothing, so no predicate matches and the loop keeps polling. Benign for the two known producers (always objects); called out because the tool is billed as generic.
- Calls `waitUntil`. On return:
  - `--emit`: fires only on a terminal outcome that carries a result — `matched` and `failed` (both hold `snapshot`). On `timeout`, `--emit` prints **nothing** (only `lastSnapshot` exists, which is not a terminal result the caller asked to wait *for*). The `--emit` dotpath is charset-validated like the predicate dotpaths (`/^[A-Za-z0-9_.-]+$/`) — a malformed emit path exits `3`; a well-formed but absent path is not an error (see the null rule below — the caller can't distinguish a typo'd-but-well-formed path from a legitimately absent one, so exit code stays the source of truth). For matched/failed: resolve `v = getPath(snapshot, emitPath)`; the print rule is **`v == null` (missing path *or* JSON `null`) ⇒ print nothing; a scalar ⇒ raw `String(v)`; an object/array ⇒ `JSON.stringify(v)`** (so an empty array prints `[]` and an empty string prints an empty line — only `null`/absent is silent).
  - Progress (unless `--quiet`): via `onPoll` to **stderr** — a line on the first poll, whenever the `--until` dotpath's value **changes** (change detected by comparing the *stringified* value — `JSON.stringify(getPath(snapshot, untilPath))` — against the last, so an object/array value doesn't spam a line every poll on reference inequality), and a final terminal line (`matched`/`failed`/`timeout` + elapsed).
  - `process.exit`: `matched` → 0, `failed` → 1, `timeout` → 2, parse/usage error → 3.
- Defaults: `--interval-ms 2000` (matches `aggregate-cli.ts`), `--timeout-ms 600000` (10 min, matches `pr-flow.ts` `DEFAULT_TIMEOUT_MS`); `--timeout-ms 0` = wait forever (documented escape hatch).

### Unit 3 — CLI registration

Add a leaf entry to `MANIFEST` in `src/cli/manifest.ts` (mirroring `next-priority`/`pr-flow`):
```ts
'wait': { desc: 'Poll a state file until a predicate matches', subs: { '': { src: 'core/wait-cli.ts', desc: 'Wait until <state-file> satisfies --until' } } },
```
`src/cli/help.ts` derives help from the manifest automatically — no separate registration.

## Acceptance criteria

- `noldor wait <f> --until 'phase==idle'` exits `0` once the file's `phase` equals `idle`; polls (does not one-shot) until then.
- `--until 'finishedAt?'` exits `0` when the dotpath resolves to a non-null value; stays waiting while the path is absent.
- `--fail-if 'blockers.0?'` exits `1` when `blockers[0]` exists, even if `--until` would also match the same snapshot (fail-if precedence).
- `--timeout-ms` elapsed with no match exits `2`; `--timeout-ms 0` never times out.
- A state file that does not exist when `wait` starts, then appears mid-poll, is handled: no crash, exits per the predicate once the file is readable.
- `eq`/`neq` against an **absent** dotpath never match: `--until 'phase!=spawning'` and `--until 'phase==undefined'` on a JSON lacking `phase` keep waiting (no false terminal) rather than firing on `String(undefined)` coercion.
- `--emit <dotpath>` prints the terminal value to stdout on `matched`/`failed` (scalar raw, object/array as JSON); on `timeout` it prints nothing; nothing else pollutes stdout; progress is on stderr and `--quiet` silences it.
- A malformed `--until` exits `3` with a usage message — covers `phase=idle` (single `=`), `foo bar baz` (spaces in dotpath), and `phase==idle?` (`=` inside a would-be `exists` dotpath).
- `--fail-if 'retries.my-feature==3'` (kebab-case dotpath segment) parses successfully — the charset guard admits `-` — rather than exiting `3`.
- Non-numeric or out-of-range `--timeout-ms` / `--interval-ms` (`--timeout-ms garbage`, `--interval-ms 0`, a valued flag with no token) exit `3` — they never reach `waitUntil` as `NaN` (which would disable the timeout or hot-spin the poll).
- Pure `src/core/wait.ts` functions have unit tests in `src/core/__tests__/wait.test.ts`; `waitUntil` is tested with a fake `read` + `vi.useFakeTimers()` for matched/failed/timeout/precedence/startup-race. The CLI is tested in `src/core/__tests__/wait.cli.test.ts` (tmpdir-exec). `noldor wait --help` lists the command. `pnpm verify` is green.

## Risks / trade-offs

- **R1 — drain-state has no self-contained terminal marker.** `.noldor/drain-state.json` carries no `done`/`status` field and no per-beat freshness timestamp (`startedAt` is stamped once); liveness is out-of-band via `.noldor/drain.lock` + `kill -0` (`status-cli.ts:26` `stateIsLive`). So `wait` over drain-state alone cannot distinguish "finished (idle)" from "crashed after reaching idle". *Trade-off:* we keep `wait` generic and accept this — a crash *while busy* freezes a non-idle `phase` so `--until 'phase==idle'` times out honestly (exit `2`); the residual ambiguity (crash *at* idle ≈ finished) is benign. A caller needing hard liveness composes `wait` with `noldor status`. Rejected alternative: baking lock-awareness in (couples the generic tool to drain internals) or adding a producer terminal field (violates the no-producer-change goal).
- **R2 — string-coercion equality.** `String(value) === literal` means `phase==idle`, `shipped==3`, `fullReview==true` all work, but there is no typed/numeric comparison (`>=`, `<`). Acceptable for terminal-state polling (states are enums/booleans/existence, not thresholds); documented as a non-goal and extensible.
- **R3 — no timeout by default would reintroduce the "blocked Monitor" failure.** Mitigated by a bounded 10-min default; `--timeout-ms 0` is opt-in only.
- **R4 — busy-file read each poll.** `wait` re-reads + re-parses the file every interval. Files are small (<a few KB) and the interval is seconds; negligible. No mtime-gating needed.

## User Story

As an autonomous controller (or any headless agent) on any runner, I want to block on a producer's state file until it reaches a terminal state — with fast-fail and a bounded timeout — so that I can sequence work without depending on the host harness's `Monitor` tool, which can be blocked and is not portable across runners.

## Usage

```bash
# Wait for a drain cycle to go idle (10-min default timeout), quiet:
noldor wait .noldor/drain-state.json --until 'phase==idle' --quiet

# Wait for a CR lane sink to finish; fail fast if it landed blockers:
noldor wait .noldor/cr/my-feature-spec-subagent.json \
  --until 'finishedAt?' --fail-if 'blockers.0?' --emit summary
# stdout: the lane's `summary` string on terminal
# exit:   0 finished-clean · 1 finished-with-blockers · 2 timeout

# Tighter cadence, capture a nested value:
noldor wait .noldor/drain-state.json --until 'phase==idle' \
  --interval-ms 1000 --timeout-ms 120000 --emit shipped
```

Exit codes: `0` `--until` matched · `1` `--fail-if` matched · `2` timeout · `3` usage/parse error. Progress prints to stderr (unless `--quiet`); `--emit` prints one value to stdout.

Note: `--emit` prints nothing both when the emit-path is absent *and* when its value is empty, so a caller cannot distinguish "matched but no such field" from a legitimately empty value on stdout alone — the exit code (0/1) is the source of truth for the outcome; `--emit` is a convenience for the common non-empty case.

## Open questions (resolved)

1. *Should `--until` understand Noldor's state-file shapes, or be a blind generic JSON poller?* -> **Generic dotpath predicate over any JSON.** (D1) Matches the "portable primitive" framing, zero producer coupling, reusable beyond the two current files; the caller owns the mapping (drain = `phase==idle`, cr = `finishedAt?`). Ratified by the operator at the gate.
2. *Does `wait` need a fast-fail predicate, or is success-or-timeout enough?* -> **Add `--fail-if` with distinct exit codes (0/1/2).** (D2) A finished job isn't a succeeded job (CR `finishedAt` + blockers; drain idle-with-skips); fail-fast saves the controller the full-timeout latency on definitive failures. Reuses the same predicate parser — cheap.
3. *When both `--until` and `--fail-if` match the same snapshot, which wins?* -> **`--fail-if` wins (evaluated first).** (D3) A bad terminal state should dominate a generic "is it done" check — a CR sink is both `finishedAt?` and `blockers.0?` exactly in the case the caller most wants flagged as failure.
4. *Interval/timeout as flags or config?* -> **Flags, no config block.** (D4) Matches the house lean (`--wait-ms`, `--iteration-timeout`, the declined poll-backoff-config direction). Defaults mirror the codebase: `2000ms` interval (`aggregate-cli.ts`), `600000ms` timeout (`pr-flow.ts`); `--timeout-ms 0` = infinite.
5. *How does `--emit` behave — stream every poll or once on terminal?* -> **Once, on the terminal snapshot, to stdout.** (D5) It captures a result for the caller; per-poll streaming belongs to stderr progress. Keeps stdout single-value and pipe-clean.
6. *Reuse `pollAutoMerge` or write fresh?* -> **Write a fresh generic `waitUntil` modeled on it.** (D6) `pollAutoMerge` is `gh`-specific and release-critical; extracting a shared poller is scope creep for an M feature. Lift the *pattern* (injected clock, fixed interval, typed outcome, throttled progress), not the code.
7. *How to handle a state file that doesn't exist yet when `wait` starts?* -> **Treat missing/unparseable as `null`; keep polling until timeout.** (D7) Producers may not have written the file when the controller launches `wait`; failing immediately would lose a benign startup race. The timeout message reports whether the file ever became readable.
8. *What do `eq`/`neq` do when the dotpath is absent?* -> **Both no-match (keep waiting); the comparison only runs once the path resolves to a non-null value.** (D8) Surfaced by the spec CR: naive `String(value) === literal` makes `neq` (and `==undefined`) fire on a partially-written or wrong file — `String(undefined) = 'undefined' ≠ 'spawning'` → a false terminal, premature exit 0. Requiring path-resolution first closes the hole and is consistent with D7's startup-race intent (an absent path = keep polling, not "condition met"). Paired with a dotpath charset guard (`/^[A-Za-z0-9_.-]+$/` — includes `-` for kebab-case keys like `retries.<slug>`) so `phase==idle?` and other malformed inputs exit `3` instead of parsing into a never-matching `exists` predicate.
9. *Where does the code live — `src/autonomous/` (per the roadmap `Touches:` hint) or `src/core/`?* -> **`src/core/wait.ts` + `src/core/wait-cli.ts`; FD `links.code` updated.** (D9) The roadmap put it in `src/autonomous/` on the premise "watch shares the poll loop." D6 consciously rejects that coupling (write a fresh primitive, don't refactor watch), which voids the premise. A producer-agnostic JSON poller is a core primitive — its natural neighbours are `pr-flow.ts`'s `pollAutoMerge`, `session.ts`, and `config.ts` in `src/core/`, not the drain-specific `src/autonomous/`. Surfaced by the spec CR as an altitude nit; taken as a deliberate placement decision.
