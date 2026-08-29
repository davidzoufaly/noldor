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
after the first. It never opens the baseline, and it cannot see whether the generator that produces
the baseline still works.

In charuy, `design:capture-ui` was broken for days. Two capture states drove through buttons that
`ai-first-ui-hide-low-level-tools-by-default` had moved behind a disclosure, so the run died on state
8 of 10. The generator writes temp-then-rename, so the committed baseline survived intact, describing
a toolbar that no longer existed. Every reader said healthy: freshness said `fresh`, and CI never ran
the capture at all. The break surfaced only when a later UI-bearing session tried to seed a design
from that baseline.

The false-fresh has one cause: **the artifact whose commit is read as proof is exactly the artifact a
failed capture leaves untouched.** A `.pen` that survives its generator's failure keeps vouching for
itself. The fix is to read a different artifact — one that a failed capture cannot advance.

The framework cannot close this by running the capture itself, because **noldor ships no capture**.
`design:capture-ui` is a consumer script (`charuy/scripts/design/capture-ui-baseline.ts`); the
framework side is the evaluator plus four read-only callers. So the fix is a contract between the two
repos.

## Goals

- A capture that fails leaves the surface unable to read `fresh` once the UI has moved on.
- The proof survives this repo's own integration workflow — `pr-flow` squash-merges every PR, so anything recorded as a branch sha is unreachable in the merged history.
- Adopting the new version introduces no new block **and removes no existing one**.
- No seam boots an application or a browser to compute a freshness verdict.

## Non-goals

- Shipping a capture implementation. Capture stays consumer-owned; the framework wraps and vouches for it.
- Content-diffing `.pen` baselines. `.pen` is encrypted and pencil MCP is its only reader.
- Detecting a capture that fails while the UI has *not* moved (see Risks — accepted limitation).
- Running the real capture in CI on any `uiPaths` diff. Louder, and still open as later work.
- Fixing charuy's `scripts/design/__tests__/validate.test.ts` hardcoded `/Applications/Pencil.app/…` path — another repo.

## Design

### Structural context

The change lands in a tightly-owned corner of the graph. `src/release/ui-design-freshness.ts` and
`src/core/ui-predicate.ts` share community **c77**, a four-file community whose other two members are
their own tests and whose only FD owner is `pendev-ui-design-phase` — interior, defining no god node,
so the evaluator is safe to extend without broad blast radius. Its cross-community edges are exactly
the callers whose blocking posture this spec must reason about: `check-ui-design-freshness.ts` and
`ui-sync-cli.ts` (both **c66**, the CLI-wrapper community beside `src/core/cli-entry.ts`),
`preflight-probes.ts` (**c17**), and `doctor.ts` (**c103**). That last edge is the one worth having
read the graph for: a grep of `src/` under a narrower glob misses `src/cli/commands/doctor.ts:117`,
and it is a fourth consumer of the same verdict.

The one high-degree node in range is `loadConsumerConfig()` in `src/core/consumer-config.ts`
(**c80**) — a god node at **rank #2, 40 edges** — so the schema addition is made once, as a
self-contained block. `src/core/doc-roots.ts` defines the rank-#1 god node `loadDocRoots()` (80
edges) but sits off this change's path.

### U1 — one receipt file per surface, and its commit is the proof

A successful capture writes `.noldor/ui-capture/<surface>.json`:

```json
{ "capturedAt": "2026-08-29T15:04:05.000Z", "baselineBlob": "<git object id of the .pen the capture produced>", "command": "pnpm build:samples && tsx scripts/design/capture-ui-baseline.ts" }
```

The **ordering** proof is `git log -1 -- .noldor/ui-capture/<surface>.json` — the commit that last
touched the file. `baselineBlob` adds a **binding** proof, and it is the one piece of content a
verdict reads: the evaluator compares it to `git rev-parse HEAD:docs/design/ui/baseline/<surface>.pen`,
and a mismatch is `stale`. It records git's own object id rather than a hash of the file's bytes,
because the comparison is against the blob git STORED: `core.autocrlf`, a `text=auto` attribute, a
clean filter or LFS would otherwise make a raw byte hash differ from the stored blob permanently,
minting a blocking `stale` that no re-capture could clear. Without it an operator could commit the freshly written receipt
while leaving the changed `.pen` out of the commit, and the surface would read `fresh` over a baseline
HEAD never received. The blob id also makes the file's uniqueness robust in a way `capturedAt` alone is
not — a clock that repeats or steps backwards cannot produce a colliding receipt when the baseline
differs. A capture that legitimately reproduces a byte-identical baseline writes an identical receipt
and therefore no commit; the verdict is unchanged by that, and it can never be a false `fresh`.

Two properties follow, and they are the whole reason for this shape:

- **A failed capture cannot advance it.** The file is written only on exit 0, so its commit history contains successful captures and nothing else — the property `.pen` lacks.
- **It survives squash-merge.** A recorded sha would not: `pr-flow` squash-merges, so a branch sha is unreachable in a fresh clone of `main`, `merge-base --is-ancestor` would error rather than answer, and the evaluator's indeterminate branch would return `skipped` **permanently** — a silently disabled check. A file's last-touching commit is recomputed in whatever history is present, exactly as today's `baselineCommit` is.

One file **per surface** rather than one map keyed by surface: `git log` is per-path, so a shared file
would let a capture of surface `a` advance surface `b`'s proof. Per-surface files also make a
partially successful multi-surface run correct by construction, with no read-merge-write and no
concurrent-write contract to get right.

`.noldor/` is selectively ignored, not wholesale — `config.json`, `id-counter.json` and
`retired-entry-ids.json` are tracked — so `.noldor/ui-capture/` is committable. It is deliberately
**not** modelled on `.noldor/garden-receipt`, which is gitignored and therefore machine-local; a
machine-local file has no commit to read.

### U2 — what the evaluator changes

`evaluateUiDesignFreshness` keeps its shape, its per-surface loop, and `classifyAncestry` untouched.
One input changes: `baselineCommit` is derived from the surface's receipt file rather than from its
`.pen`. The ancestry probes and the degrade-to-`skipped` posture on any git failure are unchanged.

`RANK` (`src/release/ui-design-freshness.ts:115`) is **not** unchanged, and its new entry is
safety-critical rather than cosmetic. It is a `Record<UiSurfaceFreshness['status'], number>` — total
over the status union, so widening the union forces an entry — and it is the sole input to `overall`,
a max-reduce (`:264`). The ordering becomes `stale` > `uninitialized` > `unverified` > `fresh` >
`skipped`. Ranking `unverified` at or above `stale` would let a repo with one `stale` surface and one
legacy-fresh `unverified` surface reduce to an overall `unverified`, hit the new non-blocking branch,
and stop blocking the release — precisely the regression U3 exists to prevent.
`UiFreshnessVerdict['overall']` widens with the same member, since AC8 turns on an `unverified`
overall.

Because both orderings now land on the same commit relation, the operator's working loop is
unconstrained: committing the UI first and capturing after gives `uiCommit` an ancestor of
`receiptCommit`; capturing with the UI still uncommitted and committing UI, baseline and receipt
together gives `uiCommit === receiptCommit`. Both are `fresh`. A capture that fails after the UI has
been committed leaves the receipt at its previous commit, so `receiptCommit` is an ancestor of
`uiCommit` — `stale`.

A new **`unverified`** status covers a surface with a baseline but no receipt in HEAD. It is distinct
from `uninitialized` in meaning and in remediation: `uninitialized` is *baseline file missing* and
routes to `design ui-sync`; `unverified` is *baseline present, never vouched for* and routes to
`design capture`. `src/release/ui-design-freshness.ts`'s single `REMEDIATION` constant splits into
those two strings.

**Four** readers branch on the status set explicitly, and all four must be extended in the same
change, or the new status is worse than useless — it would report clean:

- `src/release/preflight-probes.ts:348` branches `skipped` / `fresh` / `uninitialized` and then falls through **unconditionally** to `status: 'blocking'`, with `detail` built by filtering to `stale`. An unhandled `unverified` would reach that fall-through and block the release with an *empty* detail string. It gains an explicit `unverified` → `warn` branch.
- `src/cli/commands/doctor.ts:119` filters its warn lines to `stale || uninitialized`; the filter gains the status, since surfacing this debt early is that reader's entire job.
- `src/design/ui-sync-cli.ts` is the one Usage positions as the remediation reporter, and it ignores the status twice: `renderSurfaceReport` falls through to `'no action'`, and its staging loop filters `stale || uninitialized`, so `pending` stays 0 and the command exits 0 announcing nothing pending. Both sites gain the status.
- `exitCodeFor` (`src/checks/check-ui-design-freshness.ts:16`) gains it alongside `fresh` and `skipped`.

`REMEDIATION` (`:33`) has **three** call sites, not two — `uninitialized` (`:190`), `stale` (`:224`)
and the synthetic `(unmapped)` row (`:258`) — so it becomes a per-status lookup rather than one
constant: `uninitialized` → `design ui-sync` (bootstrap the baseline by hand); `unverified` and a
receipt-path `stale` → `design capture`; a **legacy-fallback** `stale` → `design ui-sync`, because
that surface has no receipt and typically no `uiCapture` block, so handing it `design capture` would
name a command it cannot run; `(unmapped)` → extend `uiSurfaces`, which neither command fixes.

### U3 — the legacy fallback, so adoption removes no existing block

A surface with a baseline and **no receipt** is every existing consumer on upgrade day. Reporting
those `unverified` unconditionally would be a safety regression, not a neutral migration: a consumer
whose baseline is genuinely older than its UI is `stale` today — blocking — and would silently become
non-blocking.

So with no receipt present the evaluator computes the **legacy** verdict from the `.pen`'s own commit,
exactly as today, and then reports:

- legacy `stale` ⇒ **`stale`** — the existing block is preserved unchanged.
- legacy `fresh` ⇒ **`unverified`** — fresh under the old rule, but never vouched for; visible, non-blocking, and prompting adoption.
- legacy `uninitialized` / `skipped` ⇒ unchanged.

The fallback is gated on the receipt path having **no history at all** (`git log -- <path>` empty),
not merely on its being absent from HEAD. Absent-but-with-history means the proof was withdrawn after
adoption, and routing that back through the legacy path would be an escape hatch: an adopted surface
sitting at a blocking `stale` could be un-blocked by deleting its receipt, since the legacy read of a
recently captured `.pen` may well be `fresh` and would then report the non-blocking `unverified`. A
receipt path with history and nothing at HEAD is therefore `stale`.

So the fallback is not a permanent second mode: once a surface has ever had a receipt, its `.pen`
commit is never consulted again.

### U4 — `noldor design capture` owns the exit-code branch

The framework wraps the capture rather than trusting the consumer to report on it.
`noldor design capture [--surface <s>]` reads the declared command, runs it, and writes the U1 receipt
**only when it exits 0**. The consumer repoints its own script at it
(`"design:capture-ui": "noldor design capture"`), so *receipt advanced* and *capture succeeded* are the
same branch in framework code. A bare `design capture-receipt` for the consumer's script to call on
success was rejected: a forgotten call, or one in a `finally`, restores the false-fresh with no
diagnostic.

**Config.** A new `consumer.uiCapture` record keyed by surface name, each entry
`{ command: string (min 1), timeoutMs: int 1..600_000, default 300_000 }`. Its cross-check
deliberately **differs** from `uiBoot`'s: that block's `superRefine` (`src/core/consumer-config.ts:276`)
rejects any key not declared in `uiSurfaces`, and charuy declares `uiPaths` only — a literal copy
would reject the one consumer this feature exists for. `uiCapture` accepts a key that is declared in
`uiSurfaces`, **or** the implicit `app` surface when `uiSurfaces` is absent; any other key is an
orphan and is rejected.

The command is not a `verifyCommands` entry of `kind: "cli"`, despite the shape being similar. Every
`verifyCommands` surface is booted by the smoke floor (`src/verify/smoke.ts:71`), so declaring the
capture there would make `noldor verify` run it — a slow, app-dependent side effect on an unrelated
command.

**Execution reuses `runCapture`** (`src/cr/lanes/render-compare.ts:82`) rather than reimplementing it:
`spawn('/bin/sh', ['-c', command], { cwd, detached: true })`, a `timeoutMs` timer that group-kills, a
`reapGroup` on **every** exit path (a capture whose command exits while a browser or daemonized helper
lives on would otherwise leak it), an `'exit'`-plus-stderr-drain resolution so a descendant holding the
pipe cannot turn a good capture into a timeout, and a `{ code, timedOut, stderrTail }` result. It is
already a capture runner for a consumer-declared command under its own timeout — the same problem —
so it is lifted into a shared module and called from both. `src/verify/boot.ts:61` is deliberately not
the model: it boots servers, its success condition is an HTTP 200, and it never surfaces an exit code,
which is the only thing this feature needs.

A timeout, a non-zero exit, and a spawn error are all **failed captures**: the receipt is left
untouched and the command exits non-zero. There is no dirty-tree refusal — the evaluator reads
committed state only, and both working orderings are `fresh` under U2.

**Surface resolution precedes path construction.** `--surface <s>` is resolved against the declared
`uiCapture` keys first; an undeclared name exits 2 with `no surface named '<s>'`, mirroring
`src/design/ui-sync-cli.ts:85`. Only a resolved key reaches the filesystem, and it does so through
`slugPath(repoRoot, ['.noldor', 'ui-capture'], surface, { suffix: '.json' })`
(`src/core/slug-paths.ts:64`) — the repo's existing containment choke point — so a key that somehow
carried separators or `..` is refused rather than escaping the receipt directory. Config keys already
match `SURFACE_NAME_RE` (`src/core/consumer-config.ts:110`), which admits none of those characters;
the choke point is the second lock, not the first.

**Missing declarations are failures, never quiet successes.** `design capture` with no
`consumer.uiCapture` block at all exits non-zero naming the missing key. An all-surfaces run reports
every UI surface that has no declared command and exits non-zero, so a repo that declares commands for
two of its three surfaces cannot come back green having captured two.

**Multi-surface.** With no `--surface`, every declared surface runs **sequentially**, and a failure
does not stop the run. Each success writes its own file as it happens, so a partial run leaves the
surfaces that worked vouched for and the rest untouched. The aggregate exit code is non-zero if any
surface failed.

### U5 — precedence

Evaluated in order; the first match wins.

| # | Condition | Status |
|---|---|---|
| 1 | no consumer config, or `uiPaths` empty | `skipped` (whole check) |
| 2 | shallow clone | `skipped` (whole check) |
| 3 | no commit touches the surface's globs | `skipped` |
| 4 | baseline not in HEAD **and** the receipt path has no history | `uninitialized` |
| 4b | baseline not in HEAD **but** the receipt path has history | `stale` — the baseline was withdrawn after adoption |
| 5 | receipt absent from HEAD **and** its path has no history | legacy fallback (U3) |
| 6 | receipt absent from HEAD **but** its path has history | `stale` — the proof was withdrawn |
| 7 | receipt unreadable or its content invalid | `skipped` |
| 8 | `baselineBlob` ≠ sha256 of the `.pen` at HEAD | `stale` — receipt committed without its baseline |
| 9 | receipt commit unresolvable, or either ancestry probe errors | `skipped` |
| 10 | otherwise | `classifyAncestry(uiCommit, receiptCommit)` |

Rows 1–4 and 9–10 are today's branches with one input renamed; 4b and 5–8 are new. Row 4b exists for the same reason as row 6: withdrawing *either* file must not soften a verdict, or an adopted surface sitting at a blocking `stale` could be un-blocked by deleting its `.pen`. Existence is read **at
HEAD** throughout, as `existsAtHead` already does — the working tree is never consulted, so an
uncommitted or untracked receipt does not change a verdict, and the row-8 digest is taken over the
`.pen` blob at HEAD rather than the file on disk. Row 7 sits above row 8 because the digest comparison
needs parsed content: an unreadable receipt cannot mint a red, only an indeterminate.

## Acceptance criteria

1. A capture exiting non-zero leaves the surface's receipt file untouched.
2. A capture exiting 0 writes the receipt with the produced baseline's sha256 in `baselineBlob`.
3. With a receipt present, a UI commit later than the receipt's commit reports `stale`.
4. With a receipt present, a receipt commit that is the UI commit or a descendant of it reports `fresh`.
5. Evaluated from a fresh clone of a branch squash-merged into `main`, a surface that was `fresh` before the merge is still `fresh` after it.
6. A receipt whose `baselineBlob` does not match the `.pen` at HEAD reports `stale`.
19. `design capture --vouch-only` writes a receipt for the baseline currently on disk without running the capture command, so a sanctioned hand write-back can be greened without overwriting it.
7. A surface with a baseline, no receipt, no receipt history, and a `.pen` commit older than its UI commit reports `stale` — the pre-upgrade blocking verdict is preserved.
8. A surface with a baseline, no receipt, no receipt history, and a `.pen` commit at or after its UI commit reports `unverified`.
9. A surface whose receipt is absent from HEAD but whose receipt path has history reports `stale`, never the legacy verdict.
10. Given one `stale` surface and one `unverified` surface, the overall verdict is `stale` and the release preflight result is blocking.
11. An `unverified` overall produces a non-blocking release-preflight result, and `design ui-sync` reports the surface as pending rather than exiting 0 with nothing to do.
12. A receipt with unreadable or invalid content reports `skipped`, never `stale` — the file-existence rows (4, 4b, 9) are decided before content is read and are unaffected.
13. `design capture --surface a` leaves surface `b`'s receipt file byte-identical.
14. A run over three surfaces where one fails writes the two successful receipts and exits non-zero.
15. A capture killed by `timeoutMs` leaves the receipt untouched and exits non-zero, and its process group is reaped.
16. `design capture --surface <undeclared>` exits 2 and constructs no path under `.noldor/ui-capture/`.
17. An all-surfaces run in a repo where some UI surface has no declared command exits non-zero and names that surface.
18. A `uiCapture` key naming the implicit `app` surface validates in a config declaring `uiPaths` and no `uiSurfaces`; an orphan key does not.

## Risks / trade-offs

- **Accepted limitation:** a capture that fails while the UI has *not* moved still reads `fresh`, because neither the UI commit nor the receipt commit has advanced. This is narrower than the incident, which was caused by a UI change (`ai-first-ui-hide-low-level-tools-by-default`) and is therefore caught. Closing it would require recording failed attempts as well as successes, which makes the receipt's commit history no longer mean "successful captures" and is left out deliberately.
- The red arrives at the next freshness read rather than at the breaking commit. Strictly earlier than today, which never reds; later than running the real capture in CI, which stays available as follow-up work.
- Once a consumer adopts, a UI change without a re-capture blocks the next release. That is the intended enforcement and not a new class of block — `stale` blocks today — but it is the first time a *failed* capture can reach it.
- The legacy fallback means two evaluation paths coexist per surface until it has a receipt. Bounded: the fallback is never consulted once a receipt exists, and row 5 of U5 is its only entry point.
- `.noldor/ui-capture/<surface>.json` is committed state and can be hand-edited. Forging it forges only the operator's own signal, and the `baselineBlob` check means a forged receipt still has to name the digest of the baseline actually sitting at HEAD.
- Adoption is one-way as far as the evaluator is concerned: once a surface has receipt history, withdrawing either file reads `stale` rather than falling back. `design capture --surface <s> --vouch-only` is the exit — it needs no declared command, so a consumer that later drops its `uiCapture` block can still vouch for the baseline it has instead of blocking every release.
- The schema addition touches the rank-#2 god node `loadConsumerConfig()`, which is why it lands once as a self-contained block rather than threaded into `uiBoot`.
- `baselineBlob` makes one content field verdict-bearing, against the cleaner "commit is the only proof" story. Accepted: without it, committing the receipt while omitting the `.pen` yields a `fresh` verdict over a baseline HEAD never received, and no ordering proof can catch that.
- The parent FD (`docs/features/pendev-ui-design-phase.md`) currently tells operators that `design ui-sync` repairs any freshness failure. That becomes false for `unverified` and receipt-path `stale`, so its Usage must change in the same PR — gate Step 4's scoped `--refresh --usage-only` is where that lands, and leaving it stale would make the user-facing contract contradict the implementation.

## User Story

As an operator shipping UI changes, I want the baseline-freshness verdict to rest on an artifact a
failed capture cannot advance, so that a broken capture driver stops the surface reading `fresh`
instead of surfacing days later when a design session seeds from a baseline describing UI that no
longer exists.

## Usage

Declare the capture command per surface in `.noldor/config.json`:

```json
{ "consumer": { "uiCapture": { "app": { "command": "pnpm build:samples && tsx scripts/design/capture-ui-baseline.ts", "timeoutMs": 300000 } } } }
```

Repoint the consumer's script at the wrapper, then:

```
pnpm noldor design capture                  # every declared surface, sequential; receipt on exit 0 only
pnpm noldor design capture --surface app    # one surface
git add docs/design/ui/baseline .noldor/ui-capture && git commit   # the receipt is the proof — commit it
pnpm noldor checks ui-design-freshness      # ancestry read, now against the receipt file's commit
```

Remediation by status: `stale` and `unverified` are repaired by `design capture` (only it advances the
receipt); `uninitialized` — no baseline at all — is still bootstrapped by `design ui-sync` in a
pencil-capable session.

## Open questions (resolved)

1. *What makes a broken capture visible — a success-receipt, a real capture run in CI on any `uiPaths` diff, or a dry-run of the drivers inside the freshness check?*
   -> **A success-receipt.** (D1) It removes the false-fresh at its input rather than adding a second detector beside it, and it boots nothing, so one implementation serves the local advisory check and the blocking release probe unchanged.

2. *What proves ordering — a sha stored in the receipt, or the receipt file's own commit?*
   -> **The file's own commit.** (D2) A stored sha does not survive the squash-merge this repo performs on every PR: it becomes unreachable in a fresh clone, the ancestry probe errors, and the surface degrades to `skipped` forever — a silently disabled check. A file's last-touching commit is recomputed in whatever history exists. Ordering is all the commit proves; content binding is D8's job.

3. *One receipt file keyed by surface, or one file per surface?*
   -> **One per surface.** (D3) `git log` is per-path, so a shared file would let one surface's capture advance another's proof; per-surface files also make partial multi-surface runs correct without a merge or concurrency contract.

4. *What happens to a consumer with a baseline and no receipt on upgrade day?*
   -> **Legacy fallback, never a downgrade.** (D4) Reporting `unverified` unconditionally would turn an existing blocking `stale` into a non-blocking status. The `.pen` commit is consulted only while no receipt exists: legacy `stale` stays `stale`, legacy `fresh` becomes `unverified`.

5. *Where is the capture command declared?*
   -> **A new `consumer.uiCapture` block.** (D5) `uiBoot` requires three render-compare fields and rejects keys absent from `uiSurfaces`, which charuy does not declare; `verifyCommands` entries are booted by the smoke floor (`src/verify/smoke.ts:71`), so a capture declared there would run on every `noldor verify`.

6. *Where does `unverified` sit in the `RANK` reduction?*
   -> **Below `uninitialized`, above `fresh`.** (D7) `RANK` is total over the status union and `overall` is a max-reduce, so the placement decides masking: at or above `stale`, an `unverified` surface would hide a `stale` one and un-block the release. `exitCodeFor` gains it beside `fresh` and `skipped`.

7. *How is the receipt bound to the baseline it vouches for?*
   -> **A `baselineBlob` field compared against the `.pen` at HEAD.** (D8) The commit proves ordering but not content, so an operator committing the receipt without the regenerated `.pen` would otherwise get `fresh` over a stale baseline. It also removes `capturedAt`'s dependence on a monotonic clock.

8. *Should `design capture` refuse to run on a dirty working tree?*
   -> **No.** (D6) Under the receipt-file scheme both orderings are `fresh` — capture-then-commit-together yields `uiCommit === receiptCommit` — so there is nothing to refuse. The evaluator reads committed state only.
