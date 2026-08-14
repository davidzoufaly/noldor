# Review-Run Lifecycle Module — Design

**Slug:** review-run-lifecycle-module
**FD:** docs/features/review-run-lifecycle-module.md
**Date:** 2026-08-14
**Tier:** specs-only
**Deps:** specs-cr-gate-multi-reviewer

## Problem

The codex CR lane owns neither the process it starts nor the capability probe it trusts.

`src/cr/lanes/codex.ts:79` runs `execFile('pnpm', ['--silent', 'noldor', 'cr', 'codex', …])`.
`execFile`'s `timeout` signals only its direct child, so when the cap fires it kills `pnpm`
and leaves three processes alive:

```
orchestrate (node)
└─ execFile('pnpm', …)              ← timeout + SIGTERM land HERE, and only here
   └─ pnpm
      └─ node bin/noldor.mjs cr codex
         └─ spawnCodex → codex      ← survives, runs to completion, burns quota
```

Unattended, in drain mode, that is a review the framework paid for and then discarded.

Two further defects ride the same seam:

- `codexSupportsBaseSha()` (`src/cr/lanes/codex.ts:39-48`) greps
  `pnpm --silent noldor cr codex --help` for `--base-sha`. The dispatcher intercepts `--help`
  first (`src/cli/help.ts:25-31` prints a one-line usage plus the manifest description and
  returns), so the detailed usage string in `src/cr/codex.ts:34-35` is unreachable and the probe
  can never return true. Every codex artifact review is silently full-scope, and
  `orchestrate.ts:363` caches that `false` once per batch. The capability was never missing:
  `src/cr/codex.ts:121-131` parses and applies `--base-sha` (`git diff <base>..HEAD`). The lane
  and the CLI ship in one package at one version, so there is no version skew to probe for.
- `spawnCodex` (`src/cr/codex-spawn.ts:44-45`) accumulates stdout and stderr into unbounded
  strings. Codex's measured worst case is ~326 KB, so nothing has failed yet, but the process
  that would bound it is the one that stopped being able to.

Underneath all three: `src/cr/run-codex.ts:45-49` hand-assembles
`{ cmd: CODEX_BIN, args: buildCodexArgv({ needsWrite: false, schemaPath }), stdin }` — which is
precisely what `src/core/agent-runner/registry.ts:72-80` already builds for its `codex` case.
The registry also already spawns `detached: true` (`registry.ts:153`) and group-kills on timeout
(`registry.ts:200-217`), and `SpawnAgentOpts.runner`'s docblock (`types.ts:54-55`) names this
exact caller: *"Pin a runner, bypassing role resolution (e.g. the codex CR lane is codex by
name)."* The lane reimplements, three processes away, what the shared runner was built to do.

## Goals

- One process owner for the codex review: timeout, signal and process-group cleanup all land on
  the process that actually runs codex.
- Delete the capability probe rather than repair it.
- Bound the diagnostic stream the lifecycle owner accumulates, without changing behaviour for any
  case ever measured.
- Leave exactly one spawn implementation and one process-kill implementation in the tree.

## Non-goals

- **A pre-dispatch run manifest.** The original 2026-08-12 audit block proposed recording expected
  lanes, kind, artifact and base before dispatch and aggregating against it. Q-0100 (PR #309)
  shipped the expected-lanes record (`src/cr/expected-lanes.ts`, read at `aggregate.ts:132`), which
  already delivers the leverage that framing was for — missing lanes become explicit red. Widening
  it to carry kind/artifact/base has no consumer this spec creates. (D4)
- **Fixing the shared CLI `--help` interception (Q-0115).** The probe is deleted, not repaired, so
  nothing here depends on `--help` becoming truthful. Q-0115 stands on its own merits.
- **Changing what codex reviews, or the prompt it receives.** Prompt and result semantics are
  carried across unchanged.
- **Reworking the `reviewer` or `verifier` lanes.** They already dispatch through `spawnAgent`.

## Design

### Unit 1 — `reviewWithCodex`: extract the review body from the CLI

`src/cr/codex.ts:108-151` `runReview` already does everything the lane needs: reads rules and the
feature MD, builds a `ReviewCtx` (code → `buildContext` over git; spec/plan → the artifact or its
`--base-sha` diff), calls `runCodex({ ctx, spawn })`, and maps the returned `CrRecord` to findings
via `toFindings`. Its only lane-specific act is the trailing `process.stdout.write(JSON.stringify(out))`.
Its own docblock already records the duplication: code context is built *"exactly the way the gate
lane does."*

Extract the body into an exported

```ts
reviewWithCodex(review: ArtifactReview, cwd: string, spawn: Spawn):
  Promise<{ summary: string; findings: OutFinding[] }>
```

in a module both callers can import. `runReview` becomes the thin CLI wrapper that awaits it and
writes the JSON; the lane awaits it and maps to `LaneFindings` directly. The existing
findings-travel-via-stdout-never-exit-code contract stays a property of the CLI wrapper, which is
the only place an exit code is observable.

Behaviour is unchanged for the CLI. The `try/catch` that turns a bad `--base-sha` or unreadable
artifact into a synthetic blocker moves with the body, so both callers inherit it.

### Unit 2 — `spawnAgent` grows opt-in stderr capture

`AgentResult` (`types.ts:94-98`) is `{ exitCode, stdout, timedOut }`. `run-codex.ts:51` needs
`stderr`, because `describeCodexFailure` (`codex-failure.ts:51-59`) scans it for an auth hint and
renders a bounded tail into the sink. `types.ts:60-64` documents stderr as *always* inherited for
live progress — a deliberate choice, so this is an addition, not a correction:

```ts
// SpawnAgentOpts
stderr?: 'inherit' | 'capture';   // default 'inherit' — unchanged for every existing caller

// AgentResult
stderr: string;                   // '' under 'inherit' and under tee (logSink)
```

Under `'capture'` the child's stderr is piped and accumulated; under `'inherit'` (the default) and
under tee the field is `''`, mirroring the existing `stdout: '' under stdio: 'inherit'` contract.
`errMode` at `registry.ts:146` gains the `'capture'` case alongside its current tee branch.

Two semantics move over from `spawnCodex` as part of this unit:

- **UTF-8 decoding.** `registry.ts:220-222` accumulates with a per-chunk `chunk.toString('utf8')`.
  A multi-byte character straddling a chunk boundary decodes to U+FFFD on both sides —
  realistic here, where reviewed source quotes em dashes and codex writes hundreds of KB.
  `codex-spawn.ts:53-58` already fixed this with `setEncoding('utf8')`, which keeps the stream's
  `StringDecoder` state across boundaries. Apply the same fix to the registry's **accumulating**
  paths only. The tee path must keep writing raw `Buffer` chunks to the sink and the parent's
  stdio, so it is deliberately left alone.
- **Signal-death annotation.** `registry.ts` already maps `close(code)` through `code ?? -1`, so a
  signal death is already a non-zero failure (it never had `spawnCodex`'s original `code ?? 0`
  bug). What it lacks is the explanation. Under `'capture'`, append
  `[spawnAgent] child terminated by signal <signal>` to the captured stderr when `code === null`,
  so the sink says *why* rather than only *that*.

`child.on('error')` needs no change: the registry rejects with `spawn-failed: <message>`, and
`run-codex.ts:53-55` already catches and converts that into a synthetic blocker carrying the
message — the same attribution `spawnCodex` produced by resolving with exit 127.

### Unit 3 — bounded capture buffer

A pure helper, `src/core/agent-runner/bounded-capture.ts`:

```ts
createBoundedCapture(opts?: { headChars?: number; tailChars?: number; limitChars?: number }): {
  push(chunk: string): void;
  value(): string;
  totalBytes(): number;   // TRUE pre-elision size, accumulated as Buffer.byteLength per chunk
}
```

**Chars for slicing, bytes for reporting — deliberately, and they are different numbers.** `push`
receives already-utf8-decoded strings (the `setEncoding` of Unit 2), so every slice this helper
takes is in JS string units, and so is `formatStderrTail`'s existing `stderr.slice(-maxChars)`.
Naming the knobs `*Chars` keeps them honest about what they cut. `formatStderrTail` reports
`of M bytes`, which must stay a real byte count, so the helper accumulates that separately via
`Buffer.byteLength(chunk, 'utf8')` and exposes it as `totalBytes()`. A string return cannot carry
that number — recovering it by re-parsing the elision marker would be a parser over our own prose —
so it is a second method, and `describeCodexFailure` is passed the total alongside the text.

Below `limitChars` (default ~512K chars, comfortably above the measured 326 KB) `value()` returns
the input verbatim — identical to today for every case ever observed. Above it, the buffer keeps a
head slice and a tail slice and elides the middle:

```
[ head ][ \n[… elided N bytes …]\n ][ tail ]
     ↑                                   ↑
AUTH_HINT_RE scan            formatStderrTail
```

Both slices are load-bearing and neither is arbitrary. `codex-failure.ts:44-49` states outright that
the auth scan runs over the **whole** stderr because *"the actionable line can sit at byte 400 of
326,525"* — so a tail-only cap would regress the auth hint by design. `formatStderrTail`
(`codex-failure.ts:37-42`) reads only the last 4000 chars. Head and tail are exactly the two
consumers that exist.

`formatStderrTail` renders `stderr (last N chars of M bytes)`. `M` must stay the **true** pre-elision
byte count, or a bounded capture would quietly under-report how much the child emitted — so
`formatStderrTail` gains an optional total parameter fed from `totalBytes()`, falling back to
`Buffer.byteLength(stderr)` when omitted (preserving today's behaviour for every existing caller).

An auth-shaped line that lands in the **elided middle** — past `headChars`, before the tail window —
is lost, and with it the `codex login` hint. Accepted: it can only happen above the limit, i.e. in a
run already larger than anything measured, and the alternative is scanning the whole stream as it
arrives, which is machinery for a case that has not occurred. The head slice is sized so the
observed auth line (byte ~400 of 326,525) sits far inside it.

**stdout stays uncapped.** Its content is a JSON `CrRecord` parsed by `extractJsonObject`; truncating
it converts a large response into a guaranteed parse failure, which is strictly worse than a large
allocation. The asymmetry is the point: the bounded stream is the diagnostic one.

This unit is what the `noldor:cut` at `codex-spawn.ts:41-43` deferred. That marker's stated blocker
was that *"every bound worth having (which stream, what to drop, how to say so in the sink) needs a
real runaway to design against."* No runaway has been measured — and the design question is
answerable anyway, because the consumers pin every part of it. The valve engages only above the
measured ceiling, so the cut's substance (do not redesign behaviour on speculation) is honoured
while the unbounded-heap hazard goes away. (D3)

### Unit 4 — a registry-backed `Spawn`; delete `codex-spawn.ts`

`Spawn` (`codex-spawn.ts:13-17`) is `({ cmd, args, stdin }) => Promise<{ stdout, stderr, exitCode }>`.
It shrinks to `(stdin) => Promise<{ stdout, stderr, exitCode, timedOut }>` — see 4b and 4c for why
`cmd`/`args` leave and `timedOut` arrives — and is backed by `spawnAgent`:

```ts
spawnAgent(stdin, {
  role: 'reviewer',
  runner: 'codex',          // pinned — types.ts:54-55 names this caller
  schemaPath,               // registry's codex case already threads it to buildCodexArgv
  needsWrite: false,        // read-only sandbox, unchanged
  stderr: 'capture',
  foreground,               // see 4a — false for the lane, true for the interactive CLI
  timeoutMs,                // from crReview.dispatchTimeoutMs; omitted when foreground
  site: 'cr.codex-lane',
})
```

The registry's `planSpawn` codex case (`registry.ts:72-80`) already produces
`buildCodexArgv({ needsWrite, schemaPath, model })` with `promptVia: 'stdin'`, so `run-codex.ts`
stops assembling argv by hand and passes the prompt instead. `src/cr/codex-spawn.ts` is deleted;
`run-codex.ts` re-exports `Spawn` today for back-compat, so the type moves to wherever the adapter
lives and the re-export follows it.

#### 4a — `detached` becomes conditional, because Ctrl-C and group-kill want opposite things

`codex-spawn.ts:30-36` declined `detached` for a specific reason: it removes the child from the
terminal's foreground process group, so **Ctrl-C stops reaching it**. Staying in the parent's group
means the platform reaps codex for free when an operator interrupts a hand-run review. The registry
is `detached: true` unconditionally — which is correct for every caller it has today, because they
are all unattended, but it never solved the Ctrl-C half. Routing an interactive spawn through it
as-is would take a hand-run `pnpm noldor cr codex`, make Ctrl-C stop reaching codex, and leave the
child running to completion after its parent dies. That is the same orphan-quota-burn this spec
exists to remove, relocated to the interactive path.

The two needs are complementary rather than conflicting, because they belong to different callers:

| caller | supervision | wants |
| --- | --- | --- |
| codex CR lane (unattended) | a wall-clock cap | `detached: true` + `timeoutMs` + group-kill |
| `cr codex` CLI (a human at a terminal) | Ctrl-C | `detached: false`, no cap — the terminal reaps |

So `SpawnAgentOpts` gains `foreground?: boolean` (default `false`, preserving today's behaviour for
every existing caller). Under `foreground: true` the child is spawned **non-detached**, no timer is
armed, and `killTree` is never installed — the operator's SIGINT reaches the whole foreground group,
which is exactly the property `codex-spawn.ts` was protecting. `timeoutMs` together with
`foreground: true` is a caller error: the cap could not be enforced by a group-kill, so it must be
rejected at the boundary rather than silently ignored.

Unit 5 is what makes this clean rather than a heuristic. Today `cr codex` is invoked *both* by a
human and by the lane, so no static answer to "is this interactive?" exists. After Unit 5 the lane
calls `reviewWithCodex` directly and never shells out, so the CLI entry point is unambiguously the
interactive one and can pass `foreground: true` as a constant. No TTY sniffing, no env var.

#### 4b — the version probe is not an agent spawn

`probeCodexVersion` (`codex-failure.ts:73-83`) currently borrows `Spawn` to run
`{ cmd, args: ['--version'], stdin: '' }`, and `run-codex.ts:63` calls it on every non-zero exit. A
registry-backed `Spawn` cannot honour that: `planSpawn` builds the review argv itself, so an adapter
that accepted `args` would have to ignore them — turning a `--version` call into a **full codex
review with an empty prompt**, spending quota on precisely the failure path this spec is hardening.

The category error is older than this spec: asking a binary for its version is a prerequisite probe,
not an agent dispatch. The repo already has the right seam — `PrereqProbe`
(`prerequisites.ts:38`) with `makeDefaultProbe(cwd)` (`prerequisites.ts:96`), which runs
`execFileSync(bin, ['--version'])` under a 5s cap with `stdio: ['ignore','pipe','ignore']`, falls
back to `node_modules/.bin/<bin>`, normalises the output through `versionFrom`, and returns `null`
instead of throwing. That matches `probeCodexVersion`'s stated contract ("never throws and never
propagates a non-zero exit") more closely than the `Spawn` it borrows today.

`probeCodexVersion` therefore takes a `PrereqProbe` instead of a `Spawn`, and `Spawn` loses `cmd`
and `args` entirely — the last reason it carried them.

That also retires `RunCodexInput.cmd`. Its docblock warns that probing a hard-coded `codex` would
misattribute a failure "precisely where attribution is the point" — true while a caller could
override the binary. Once the registry owns binary selection (`CODEX_BIN` via `planSpawn`), no
caller can, so the hazard the override guarded against cannot occur and the field goes. Tests that
used `cmd` to point at a fake binary use the registry's existing `spawnImpl` seam
(`registry.ts:100,130,147`) instead, which is where every other runner's tests already inject.

#### 4c — timeout attribution survives the seam

`AgentResult.timedOut` has no slot in `Spawn`'s result, so without care a `dispatchTimeoutMs` expiry
would reach the sink as `exited with exit code -1` plus 4a's signal note `terminated by signal
SIGKILL` — indistinguishable from an OOM kill or an operator `kill`, and a regression against
today's `ETIMEDOUT`-shaped message.

`Spawn`'s result gains `timedOut: boolean`, carried straight through from `AgentResult`.
`describeCodexFailure` takes it too and leads with `timed out after <dispatchTimeoutMs>ms` when set,
falling back to today's `exited with exit code <n>` otherwise. The version and stderr-tail
attribution are unchanged in both cases.

#### 4d — what D6 is and is not being overridden on

D6 of the earlier `codex-headless-dispatch` spec declined an inner timeout because a cap needs a
kill, a kill needs `detached`, and `detached` breaks Ctrl-C. Only the first two links are answered
by reuse: the registry's group-kill already exists and is already tested, so no second kill
implementation is written (the FD's deletion test asks for fewer, and there is currently exactly
one). The third link — `detached` breaking Ctrl-C — is a real cost the registry never paid, and 4a
pays it explicitly rather than by assertion.

Timeout ownership after this unit sits on the process that runs codex, one level down from where it
sits today, with a group-kill behind it on the unattended path and an operator's SIGINT on the
interactive one.

### Unit 5 — the codex lane goes in-process

`src/cr/lanes/codex.ts` loses `execFile`, the local `exec()` promise wrapper, `extractLaneJson`, the
`--silent` pnpm-banner workaround, and the `args` array. It calls `reviewWithCodex` (Unit 1) with the
registry-backed spawn (Unit 4) in its **unattended** configuration — `foreground` unset, `timeoutMs`
from `crReview.dispatchTimeoutMs`, so the cap is enforced by the group-kill — and maps the result
into `LaneFindings` with the same
`severity === 'high'` blocker/suggestion split it does today. `writeJsonAtomic` to
`.noldor/cr/<slug>-<kind>-codex.json` and the `LaneResult` shape are unchanged, so orchestrate and
aggregate see no difference.

The `kind` → mode mapping at `lanes/codex.ts:58` becomes a direct `ReviewCtx` construction rather
than a CLI flag; it maps all three kinds today (Q-0099, PR #308) and keeps doing so.

The existing `catch` that turns a lane failure into a synthetic high-severity blocker stays — it is
what keeps an infrastructure failure visible as red rather than as a missing sink.

### Unit 6 — delete the probe

Remove `codexSupportsBaseSha` (`lanes/codex.ts:39-48`), the `CodexOpts.supportsBaseSha` field, the
`codexBaseShaSupport` pre-cache at `orchestrate.ts:363`, and the `supportsBaseSha` argument threaded
into `runCodex` at `orchestrate.ts:378`. `input.baseSha` is passed whenever it is set and
`fullReview` is not — the same condition the lane already applies — and in that case it now lands in
the sink's `baseSha` field instead of being dropped by a probe that always said no. That restores
delta review for codex artifact passes, which has never actually run since the probe was introduced.

The `console.warn` fallback line at `lanes/codex.ts:68-70` goes with it. Its test doubles
(`delta.test.ts:12`, `orchestrate.test.ts:13`, `orchestrate.integration.test.ts:43`, all mocking the
probe to `true`) are deleted; those suites were asserting against a value production never produced.

## Acceptance criteria

- `grep -r codexSupportsBaseSha src/` returns no matches.
- `src/cr/codex-spawn.ts` does not exist and `grep -rn "spawnCodex" src/` returns no matches.
- `grep -n "execFile" src/cr/lanes/codex.ts` returns no matches. (Scoped to the lane on purpose:
  `src/cr/` keeps legitimate `execFile`/`execFileSync` git shell-outs in `receipt-trailer.ts`,
  `amend-receipt.ts`, `autofix-cli.ts`, `codex.ts`, `deep-review-spawn.ts` and `lanes/verify.ts`,
  none of which this spec touches.)
- A codex lane run at `--kind spec` with a `baseSha` set and `fullReview` unset writes a sink whose
  `baseSha` field equals the passed sha. (Today this field is never written.)
- `spawnAgent` with `stderr: 'capture'` returns the child's stderr in `AgentResult.stderr`; with
  `stderr` omitted it returns `''` and the child's stderr is inherited — asserted by a test per mode.
- A `spawnAgent` timeout group-kills the process group and resolves `timedOut: true`, exercised
  through the existing `spawnImpl` seam (`registry.ts:100,130,147`) rather than a new out-of-process
  harness — `registry.test.ts:137-175` already covers the shape.
- `createBoundedCapture` returns its input verbatim for a total below `limitChars`; above it,
  `value()` contains the first `headChars`, the last `tailChars` and an elision marker, and
  `totalBytes()` returns the true pre-elision byte count (not the elided string's length).
  Unit-tested in isolation, no child process.
- A stderr stream whose multi-byte character straddles a chunk boundary decodes without U+FFFD under
  both `capture` and the registry's stdout accumulation — a regression test for the `setEncoding`
  fix, driven through `spawnImpl`.
- An auth-shaped line at the head of a stderr stream that exceeds `limitChars` still produces the
  `— auth looks expired; run: codex login` hint from `describeCodexFailure`; the same line placed in
  the elided middle does not, and a test pins that as accepted rather than accidental.
- `spawnAgent` with `foreground: true` spawns **non-detached** (`detached` absent or `false` on the
  `spawnImpl` call) and arms no timer; with `foreground` omitted it stays `detached: true` with the
  timer, so no existing caller changes. Asserted per mode through `spawnImpl`, which already records
  the options object (`registry.test.ts:170` asserts `calls[0].detached`).
- `spawnAgent({ foreground: true, timeoutMs: n })` rejects rather than silently dropping the cap.
- `src/cr/codex.ts`'s CLI path passes `foreground: true`; the codex lane does not. Pinned by a test
  per caller, because this is the property that keeps Ctrl-C working on a hand-run review.
- `grep -rn "cmd" src/cr/run-codex.ts` shows no `RunCodexInput.cmd` field, and `probeCodexVersion`'s
  signature takes a `PrereqProbe`, not a `Spawn`.
- `probeCodexVersion` never spawns a review: a test asserts the probe seam is invoked with
  `['--version']` and that no agent spawn occurs on the failure path.
- A lane run whose child exceeds `dispatchTimeoutMs` produces a sink blocker message beginning
  `timed out after <n>ms`, distinct from the message produced by a signal kill at the same exit code.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass; the CR-lane suites pass with the probe mocks
  removed rather than retargeted.

## Risks / trade-offs

- **Shared-component blast radius.** Unit 2 touches `spawnAgent`, which every runner and every
  dispatch site uses. Mitigated by the change being additive with an unchanged default (`'inherit'`,
  `stderr: ''`) — no existing caller changes behaviour. The `setEncoding` fix is the one exception:
  it changes stdout decoding for all runners, in the direction of correctness, and only for chunk
  boundaries that are currently corrupted.
- **The CLI and the lane stop being the same execution path in the same way.** Today the lane
  literally runs the CLI, so drift between them is impossible. Afterwards both call
  `reviewWithCodex`, so drift is possible only in the thin wrappers on either side. Accepted: the
  shared function is the substance, and the CLI wrapper's remaining job (write JSON, exit 0) is small
  enough to read at a glance.
- **`role: 'reviewer'` with a pinned runner is slightly odd.** The role is carried for agent-events
  attribution while `runner: 'codex'` overrides resolution, so a consumer that remapped the reviewer
  role to another runner does not accidentally redirect the codex lane. This is the documented
  purpose of the pin, but the pairing deserves a comment at the call site or it reads as a mistake.
- **Deleting the probe restores a code path that has never run in production.** Codex artifact
  reviews will start receiving `--base-sha`-scoped diffs for the first time. The CLI side of it is
  exercised (`codex.ts:121-131`) and the bad-sha case is already caught into a synthetic blocker, but
  the first real delta review is genuinely new behaviour, not a restoration.
- **512 KB is a judgement call.** It is chosen as ~1.5× the single measured worst case. Too low
  risks eliding content someone later wants; too high defers the hazard. It is a constant in one
  helper, so re-tuning is cheap.
- **`foreground` is a second spawn mode in a shared component.** 4a adds a branch to `spawnAgent`
  that only one caller uses today, and a mode nothing else exercises is a mode that rots. Mitigated
  by pinning both sides with tests and by rejecting the incoherent combination (`foreground` +
  `timeoutMs`) at the boundary rather than letting it degrade quietly. The alternative — accepting a
  Ctrl-C regression on the interactive CLI — trades a rot risk for a live defect, which is worse.
- **The interactive CLI runs uncapped.** Under `foreground: true` no wall-clock cap is armed, so a
  hand-run review against a wedged codex hangs until the operator interrupts it. Accepted: that is
  today's behaviour for the CLI, and the operator is present by construction. An uncapped foreground
  process is not the failure mode this spec is about — an *un-interruptible* one is.
- **Retiring `RunCodexInput.cmd` removes a test seam some suite may lean on.** Callers move to the
  registry's `spawnImpl` injection, which is where the other runners' tests already sit, but the
  migration is mechanical work this spec is asserting rather than measuring.

## User Story

As an agent running an unattended CR pass, I want the codex review lane to own the process it
starts, so that a timeout actually stops the review instead of orphaning it to run to completion and
burn quota against a result nobody will read.

## Usage

No new CLI surface. The behaviour changes at existing seams:

```bash
# Artifact review — now genuinely delta-scoped; the sink records baseSha for the first time.
pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind spec --lanes codex --base-sha <sha>

# The standalone CLI remains independently invocable, and stays interruptible:
# it spawns foreground (4a), so Ctrl-C still reaches codex. It is no longer the
# transport the orchestrate lane uses.
pnpm noldor cr codex --spec <path> --slug <slug> --base-sha <sha>
```

A lane timeout (`crReview.dispatchTimeoutMs`) now terminates codex itself rather than the `pnpm`
wrapper above it, and says so: the blocker message leads with `timed out after <n>ms` rather than a
bare exit code (4c). On failure the sink's blocker message still carries the codex version, an auth
remediation hint when the stderr looks auth-shaped, and a bounded stderr tail — unchanged in shape
from today, but now reachable on the timeout path too.

The interactive CLI takes no `dispatchTimeoutMs`: it runs uncapped under the operator's Ctrl-C,
which is the supervision it actually has. Passing a cap to a foreground spawn is rejected as a
caller error rather than silently ignored (4a).

## Open questions (resolved)

1. *Does the lane collapse to an in-process `runCodex()` call, or keep the CLI subprocess boundary
   and only swap `execFile` for a group-killing spawn?*
   -> **Collapse to in-process.** (D1) The subprocess boundary is what creates the ownership problem;
   swapping the spawn would make the kill reach the group while leaving four processes and the
   capability probe intact. In-process deletes the probe as a side effect, because a function
   argument has no capability question.

2. *`spawnAgent` does not drain stderr into its result, but `run-codex.ts` needs it for
   `describeCodexFailure`. Widen `AgentResult`, or keep `spawnCodex`?*
   -> **Widen `AgentResult`, delete `spawnCodex`.** (D2) `types.ts:54-55` already names the codex CR
   lane as the intended caller of the runner pin, and `schemaPath`/`needsWrite` are already the two
   arguments `run-codex.ts` assembles by hand. Adding an opt-in capture mode is smaller than keeping
   a second spawn implementation alive, and the FD's deletion test asks for one kill path, not two.

3. *`registry.ts:220-222` has the per-chunk `toString('utf8')` corruption that `codex-spawn.ts`
   already fixed. Fix it in the shared component, or leave it?*
   -> **Fix it in the registry, accumulating paths only.** (D2) It is a latent correctness bug for
   every runner, the fix is three lines, and leaving it would mean deleting the file that documents
   it. The tee path keeps raw Buffers because it forwards to a sink and to the parent's stdio.

4. *Does the `noldor:cut` on unbounded accumulation get honoured, or does the lifecycle owner landing
   count as the upgrade path the marker names?*
   -> **Bound it, with a valve that engages only above the measured ceiling.** (D3) The marker's
   blocker was that the bound's design needed a real runaway to reason about; the two consumers
   (`AUTH_HINT_RE` over the head, `formatStderrTail` over the tail) determine the shape without one.
   Setting the limit above every measured case keeps behaviour byte-identical in practice, so this
   respects the cut rather than overriding it.

5. *Does the expected-lanes record widen into a full pre-dispatch run manifest?*
   -> **No — explicit non-goal.** (D4) Q-0100 already shipped the part with a consumer. The rest of
   the 2026-08-12 framing has none, and adding it would grow a spec that is already six units.

6. *Where does the shared review body live, so both the CLI and the lane call it?*
   -> **Extract `runReview`'s body as `reviewWithCodex(review, cwd, spawn)`.** (D5) It already
   contains the whole context-assembly + `runCodex` + `toFindings` chain; only the trailing
   `process.stdout.write` is CLI-specific. Its docblock already observes that code context is built
   "exactly the way the gate lane does", which is the duplication this removes.

7. *Routing the interactive CLI through a `detached: true` registry breaks Ctrl-C — forward SIGINT,
   add a non-detached mode, or accept the regression?*
   -> **Add a non-detached mode: `SpawnAgentOpts.foreground`, default `false`.** (D6) SIGINT
   forwarding is the "signal reaper" the original D6 named as a cost, and it would install a
   process-wide handler to solve a problem only one caller has. The regression is not acceptable:
   it is the same orphan-quota-burn this spec exists to delete, moved onto the interactive path.
   Conditional detach is small because the two callers want opposite, non-overlapping things — a cap
   enforced by group-kill when nobody is watching, an operator's SIGINT when someone is. Unit 5 is
   what makes the caller statically knowable, so no TTY sniffing is needed.

8. *`probeCodexVersion` needs arbitrary `cmd`/`args`, which a registry-backed `Spawn` cannot give.
   Keep a raw spawn, add a registry seam, or drop version attribution?*
   -> **Neither — move it to the existing `PrereqProbe` seam.** (D7) Asking a binary for
   `--version` was never an agent dispatch; `makeDefaultProbe` (`prerequisites.ts:96`) already does
   exactly this job with a 5s cap, a `node_modules/.bin` fallback, and a `null`-not-throw contract
   that matches `probeCodexVersion`'s own docblock better than `Spawn` does. Dropping attribution
   was rejected outright — it is the whole point of the entry that introduced it. This also lets
   `Spawn` shed `cmd`/`args`, and retires `RunCodexInput.cmd`: once the registry owns binary
   selection, the misattribution its docblock warns about is unreachable.

9. *`AgentResult.timedOut` has no slot in `Spawn`'s result, so a timeout becomes indistinguishable
   from a signal kill. How is it carried?*
   -> **Widen `Spawn`'s result with `timedOut` and lead the failure message with it.** (D8) The
   alternative — inferring timeout from `exitCode === -1` plus a `SIGKILL` note — is exactly the
   ambiguity the finding describes, since an OOM kill produces the same pair. `describeCodexFailure`
   takes the flag and emits `timed out after <n>ms`, keeping version and stderr-tail attribution
   unchanged on both branches.
