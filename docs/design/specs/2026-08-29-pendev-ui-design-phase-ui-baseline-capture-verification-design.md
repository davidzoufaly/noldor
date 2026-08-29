# UI Baseline Capture Verification — Design

**Slug:** ui-baseline-capture-verification
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-29
**Tier:** specs-only
**Deps:** none

## Problem

`checks ui-design-freshness` reports on commit ancestry alone. `evaluateUiDesignFreshness`
(`src/release/ui-design-freshness.ts:128`) asks git two questions per surface — what commit last
touched the surface's `uiPaths` globs, and what commit last touched
`docs/design/ui/baseline/<surface>.pen` — and calls the surface `fresh` when the second is at or
after the first. It never opens the baseline, and it has no way to know whether the generator that
produces the baseline still works.

In charuy, `design:capture-ui` was broken for days. Two capture states drove through buttons a prior
UI change had moved behind a disclosure, so the run died on state 8 of 10. The generator writes
temp-then-rename, so the committed baseline survived intact, describing a toolbar that no longer
existed. Every reader said healthy: freshness said `fresh`, because the *last successful* capture's
commit still satisfied ancestry, and CI never ran the capture at all. The break surfaced only when a
later UI-bearing session tried to seed a design from that baseline.

The framework cannot close this by calling the capture itself, because **noldor ships no capture**.
`design:capture-ui` is a consumer script (`charuy/scripts/design/capture-ui-baseline.ts`); the
framework side is the evaluator, `design ui-sync`, and four read-only callers. The fix therefore has
to be a contract between the two repos, not a direct call.

## Goals

- A capture that fails stops the surface from reading `fresh`, instead of silently inheriting the last good run's verdict.
- The framework learns the consumer's capture command through declared config, in the idiom already used by `consumer.verifyCommands` and `consumer.uiBoot`.
- Adopting the new framework version introduces no new blocking verdict for a consumer that has not yet wired anything up.
- No seam boots an application or a browser to compute a freshness verdict.

## Non-goals

- Shipping a capture implementation. Capture stays consumer-owned; the framework only wraps and vouches for it.
- Content-diffing `.pen` baselines. `.pen` is encrypted and pencil MCP is its only reader, so a byte-compare is unavailable to a headless check.
- Running the real capture in CI on every `uiPaths` diff. That is the loudest option and remains open as later work; it is not this slice.
- Fixing charuy's `scripts/design/__tests__/validate.test.ts` hardcoded `/Applications/Pencil.app/…` path — another repo, dropped at promote.

## Design

### Structural context

The change lands in a tightly-owned corner of the graph. `src/release/ui-design-freshness.ts` and
`src/core/ui-predicate.ts` share community **c77**, a four-file community whose other two members
are their own tests and whose only FD owner is `pendev-ui-design-phase` — interior, defining no god
node, so the evaluator is safe to extend without broad blast radius. Its cross-community edges are
exactly the callers whose blocking posture this spec must reason about:
`check-ui-design-freshness.ts` and `ui-sync-cli.ts` (both **c66**, the CLI-wrapper community beside
`src/core/cli-entry.ts`), `preflight-probes.ts` (**c17**), and `doctor.ts` (**c103**). That last edge
is the one worth having read the graph for: a plain grep of `src/` under a narrower glob misses
`src/cli/commands/doctor.ts:117`, and it is a fourth consumer of the same verdict.

The one high-degree node in range is `loadConsumerConfig()` in `src/core/consumer-config.ts`
(**c80**) — a god node at **rank #2, 40 edges** — so every schema addition here is felt repo-wide and
should be made once, not twice. `src/core/doc-roots.ts` defines the rank-#1 god node `loadDocRoots()`
(80 edges) but sits off this change's path.

### U1 — the capture receipt

A new `.noldor/ui-capture-receipt.json` records, per surface, what the last **successful** capture ran
against:

```json
{ "surfaces": { "app": { "commit": "<sha>", "capturedAt": "<iso8601>" } } }
```

`commit` is `git rev-parse HEAD` at the moment the capture exited 0. The file is committed alongside
the baseline it vouches for, and it advances on success only — that single property is what removes
the false-fresh. The shape is modelled on `src/garden/garden-receipt.ts` (**c17**), which exists for
the same reason: an evaluator that cannot otherwise see whether its generator ran.

The write is a **read-merge-write**: `design capture --surface app` in a multi-surface repo re-reads
the existing `surfaces` map and replaces only its own key, so a single-surface run cannot drop the
other surfaces' entries (which would silently demote them to `unverified`). It lands through
`atomicWriteFileSync` — temp-then-rename — so an interrupted write cannot leave a truncated receipt.

The **reader is not** a literal mirror of `readGardenReceipt`, which is
`GardenReceiptSchema.parse(JSON.parse(…))` (`src/garden/garden-receipt.ts:29`) and therefore throws
on malformed content. AC6 requires degrading to `skipped`, so the receipt reader is `safeParse`
inside a `try`/`catch`, returning `null` on any unreadable or invalid file and letting the evaluator
take its existing indeterminate branch.

### U2 — freshness reads the receipt, not the baseline file's commit

Today `evaluateUiDesignFreshness` derives `baselineCommit` from
`git log -1 -- docs/design/ui/baseline/<surface>.pen`. That is the defect at its root: a failed
temp-then-rename capture leaves the baseline file untouched, so its commit — and therefore the whole
verdict — keeps reflecting the last good run indefinitely. The receipt replaces that one input.
`baselineCommit` becomes the receipt's per-surface `commit`, and `classifyAncestry` is untouched: UI
commit an ancestor of the receipt commit ⇒ `fresh`; receipt commit an ancestor of the UI commit ⇒
`stale`; unrelated ⇒ `skipped`.

A surface with a baseline at HEAD but no receipt entry gets a new status, `unverified`, distinct from
`uninitialized`. The two mean different things and route to different commands: `uninitialized` is
*baseline file missing* and sends the operator to `design ui-sync`, while `unverified` is *baseline
present, never vouched for* and sends them to `design capture`. `unverified` is non-blocking
everywhere, so a consumer that upgrades without wiring anything up sees a visible prompt rather than
a new failure — but that is not free, because two readers branch on the status set explicitly and
both must be extended in the same change:

- `src/release/preflight-probes.ts:348` branches `skipped` / `fresh` / `uninitialized` and then falls
  through **unconditionally** to `status: 'blocking'`, with `detail` built by filtering surfaces to
  `stale`. A new `unverified` overall would therefore reach that fall-through and block the release
  with an *empty* detail string — the exact opposite of Goal 3, and what every consumer would hit on
  upgrade. The probe gains an explicit `unverified` → `warn` branch, naming the surfaces and the
  `design capture` remediation.
- `src/cli/commands/doctor.ts:119` filters its warn lines to `stale || uninitialized`, so
  `unverified` would be invisible in the reader whose whole job is surfacing this debt early. The
  filter gains the status.

`exitCodeFor` (`src/checks/check-ui-design-freshness.ts:16`) gains it alongside `fresh` and
`skipped`. Every existing degradation rule survives verbatim — an unreadable, unparseable or
unresolvable receipt is `skipped` with detail, never a red — because `preflight-probes.ts:348` treats
`stale` as blocking and `classifyAncestry`'s standing invariant is that no blocking verdict may be
minted from an operational failure.

### U3 — who writes the receipt

The framework wraps the capture rather than trusting the consumer to report on it. A new
`noldor design capture [--surface <s>]` subcommand reads the consumer's declared capture command,
spawns it with the declared timeout, and writes the U1 receipt **only when it exits 0**. The consumer
repoints its own script at it (`"design:capture-ui": "noldor design capture"`), so *receipt advanced*
and *capture succeeded* are the same branch in framework code and cannot drift apart. The rejected
alternative — a bare `design capture-receipt --surface <s>` for the consumer's script to call on
success — reproduces the original defect one level up: a forgotten call, or one placed in a
`finally`, silently restores the false-fresh with no diagnostic.

The command is declared in a new `consumer.uiCapture` record keyed by surface name,
`{ command, timeoutMs }`. Its validation deliberately **differs** from `uiBoot`'s: that block's
`superRefine` (`src/core/consumer-config.ts:276`) rejects any key not declared in `uiSurfaces`, and
charuy declares `uiPaths` only — so the implicit `app` surface exists at evaluation time but not in
config, and a literal copy of that rule would reject the one consumer this feature exists for. The
`uiCapture` cross-check therefore accepts a key that is either declared in `uiSurfaces` **or** is the
implicit `app` surface used when `uiSurfaces` is absent, and rejects any other key as an orphan. It does not hang off `uiBoot`
because `UiBootRecipeSchema` makes `verifyCommand`, `route` and `screenshotCommand` all required, so
that placement would make authoring a full render-compare recipe the price of capture verification —
and charuy, the only consumer with `uiPaths` today, declares no `uiBoot` at all. Capture produces the
baseline; render-compare consumes screenshots. Separate concerns, separate blocks.

**Execution contract.** The command is spawned as `/bin/sh -c <command>` with `detached: true` from
the repo root, reusing the process-group idiom already established at `src/verify/boot.ts:61` — the
declared commands are shell strings containing `&&`, and a `pnpm …` capture spawns a whole tree that
a bare child-pid kill would orphan. On `timeoutMs` the group is signalled, and **a timeout counts as
a failed capture**: the receipt is left unchanged, exactly as a non-zero exit would. A spawn error
(command not found) is likewise a failed capture, not a crash.

**Multi-surface.** `design capture` with no `--surface` runs every declared surface **sequentially**
and does not stop at the first failure. Each success is persisted as it happens, through the
read-merge-write above, so a partially successful run leaves the surfaces that worked vouched for and
the ones that failed untouched. The aggregate exit code is non-zero when any surface failed.

### U4 — no live capture at any seam

Explicitly out of scope for every reader of the verdict. The check boots nothing and runs nothing
app-dependent: it reads one JSON file and asks git the same two ancestry questions it asks today.
That is what lets identical logic serve the advisory gate-Step-4 seam, `doctor`, `ui-sync`, and the
blocking release probe without any of them becoming slow or requiring a display. The capture itself
runs only when an operator invokes `design capture` deliberately.

## Acceptance criteria

1. A capture command exiting non-zero leaves the receipt unchanged.
2. A capture command exiting 0 writes the surface's receipt entry with the HEAD sha at capture time.
3. A surface whose UI commit postdates its receipt commit reports `stale`.
4. A surface whose receipt commit is at or after its UI commit reports `fresh`.
5. A surface with a baseline at HEAD and no receipt entry reports `unverified`, and `unverified` does not block the release preflight probe.
6. An unreadable, unparseable, or unresolvable-sha receipt reports `skipped`, never `stale`.
7. A repo with no `consumer.uiCapture` declared can still run every existing freshness reader without a new failure.
8. `design capture` on a surface with no declared command exits non-zero with a message naming the missing config key, and writes no receipt.
9. `design capture --surface a` in a repo whose receipt also holds surface `b` leaves `b`'s entry byte-identical.
10. A capture killed by `timeoutMs` leaves the receipt unchanged and exits non-zero.
11. A run over three surfaces where one fails persists the two that succeeded and exits non-zero.
12. An `unverified` overall verdict resolves to a non-blocking release-preflight result, asserted against the probe rather than against `exitCodeFor` alone.
13. A `uiCapture` key naming the implicit `app` surface validates in a config that declares `uiPaths` and no `uiSurfaces`.

## Risks / trade-offs

- The receipt cannot distinguish *capture ran and failed* from *capture never ran since the UI change*. Both read `stale` and both are remediated by re-running the capture, so the conflation is accepted — but `stale` no longer implies a broken driver.
- The red arrives at the next freshness read rather than at the breaking commit. Strictly earlier than today, which never reds at all; strictly later than running the real capture in CI, which stays available as a follow-up.
- A consumer that adopts `design capture`, gets a `fresh` receipt, then lands a UI change without re-capturing will see `stale` block their next release. That is the intended enforcement and not a new class of block — `stale` blocks today too — but it is the first time a *failed* capture can reach that state.
- `.noldor/ui-capture-receipt.json` is committed state that can be hand-edited. Mitigated by the `skipped` degradation on anything unreadable, and by the fact that forging it only forges the operator's own signal.
- Adding `consumer.uiCapture` touches the rank-#2 god node `loadConsumerConfig()`, which is why it is added once as a self-contained block rather than threaded into `uiBoot`.

## User Story

As an operator shipping UI changes, I want the baseline-freshness verdict to depend on the capture
having actually succeeded, so that a broken capture driver stops the surface reading `fresh` instead
of surfacing days later when a design session seeds from a baseline describing UI that no longer
exists.

## Usage

Declare the capture command per surface in `.noldor/config.json`:

```json
{ "consumer": { "uiCapture": { "app": { "command": "pnpm build:samples && tsx scripts/design/capture-ui-baseline.ts", "timeoutMs": 300000 } } } }
```

Repoint the consumer's own script at the wrapper, then use it as before:

```
pnpm noldor design capture                  # run every declared surface's capture; receipt on exit 0 only
pnpm noldor design capture --surface app    # one surface
pnpm noldor checks ui-design-freshness      # ancestry read, now against the receipt
pnpm noldor design ui-sync                  # unchanged remediation entry point
```

## Open questions (resolved)

1. *What makes a broken capture visible — a success-receipt, a real capture run in CI on any `uiPaths` diff, or a dry-run of the drivers inside the freshness check?*
   -> **Success-receipt.** (D1) It removes the false-fresh at its root rather than adding a second detector beside it, and it needs no application boot at any seam, so the same logic serves the local advisory check and the blocking release probe unchanged.

2. *Who writes the receipt — the consumer's capture script, or a framework wrapper around a declared command?*
   -> **A framework wrapper.** (D2) The defect being fixed is a signal that silently did not happen; leaving the write to the consumer reproduces that class exactly, whereas owning the exit-code branch in framework code makes "receipt advanced" and "capture succeeded" the same test.

3. *Does the capture command belong on the existing `uiBoot` recipe or in a new block?*
   -> **A new `consumer.uiCapture` block.** (D3) `uiBoot` requires three render-compare fields, so reusing it would make a render-compare recipe a prerequisite for capture verification, which no current consumer wants.

4. *What status does a baseline with no receipt entry get?*
   -> **A new non-blocking `unverified`.** (D4) It carries a different meaning and a different remediation from `uninitialized`; reusing that status would tell an operator their baseline is missing while it sits in HEAD, and send them to the wrong command.

5. *Where does `unverified` sit in the `RANK` reduction, and does it affect `exitCodeFor`?*
   -> **Between `uninitialized` and `fresh`, and it exits 0.** (D5) Ranking it above `fresh` keeps one unverified surface visible in a repo where others are fresh; ranking it below `uninitialized` keeps a genuinely missing baseline the louder of the two. `exitCodeFor` gains it alongside `fresh` and `skipped`.

6. *Should `design capture` refuse to run on a dirty working tree, where HEAD does not describe what was captured?*
   -> **No — record HEAD and proceed.** (D6) The evaluator already reads committed state only, by explicit design, so a receipt that vouches for HEAD is consistent with every other input it takes; refusing would block the ordinary edit-then-capture loop for a discrepancy the next commit resolves.
