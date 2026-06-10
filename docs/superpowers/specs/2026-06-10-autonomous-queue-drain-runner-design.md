# Autonomous Queue-Drain Runner — design

**Slug:** `autonomous-queue-drain-runner`
**FD:** [docs/features/autonomous-queue-drain-runner.md](../../features/autonomous-queue-drain-runner.md)
**Date:** 2026-06-10
**Tier:** full
**Deps:** `autonomous-plan-to-pr-merge`

> This spec was hardened by a 4-lens adversarial review (loop-correctness, always-clear/headless,
> scope/fast-track, failure-modes/testability). Findings that were *verified against the code* are
> folded in below; the "Design decisions from review" section records the load-bearing ones.

## Problem

The **always-clear** policy ends every `/gate` session at Step 5 and tells the operator to `/clear`
+ re-run `/gate` for the next feature — a fresh context per feature prevents stale-context drift.
But it forces a human between every feature. Claude cannot `/clear` itself, so a single long-running
session cannot drain a multi-entry roadmap without weakening always-clear.

Goal: drain the roadmap queue feature-after-feature with **no human between features**, **without
weakening always-clear**.

## Key insight

Always-clear is preserved by running each feature in a **fresh `claude --print` process**. An
external supervisor process is the `/clear`: it spawns one headless gate run per feature, waits, then
spawns the next from a clean context. The supervisor is plain TypeScript holding only loop state
(skip-set, retry counts, shipped count) — it is **not** an LLM and accumulates no feature context.

## What already exists (and what is genuinely new)

The gate **already consumes roadmap entries on a fast-track-from-roadmap-pick** — this is the single
biggest simplification from review. Verified in [gate SKILL.md](../../../.claude/skills/gate/SKILL.md):

- **Step 0** (line ~37): an XS/S `suggestedPath` routes to `fast-track` with **no `/promote`**; the
  pick carries `entry.slug` forward and the fast-track scaffold records it in the session marker.
- **Step 2 → "Roadmap-entry retirement"** (lines 64–78): when the marker carries `slug`, the gate
  runs `removeBlock(raw, slug)` from [write-blocks.ts](../../../src/utils/write-blocks.ts) (export at
  line 180), guarded by `parseRoadmap(...).some(...)` for re-run safety, and commits
  `docs(roadmap): retire <slug> — shipped via fast-track (no FD)` **on the feature branch**. The
  deletion lands on `main` only when the PR merges — retirement is atomic with the shipped change.

So the drain does **not** need a new `removeRoadmapEntry` helper (an earlier draft invented one;
`/promote` removes blocks as LLM prose, not via a reusable helper — there was nothing to reuse). The
mechanism is already wired on exactly the path the drain uses.

**Genuinely new work:**
1. An external **supervisor** (`src/autonomous/queue-drain.ts`) + CLI manifest entry.
2. **`next-priority --skip <csv>`** so the supervisor can exclude entries it has shipped/skipped.
3. **Gate drain-mode branches** (prose) that suppress every AskUserQuestion seam under `NOLDOR_DRAIN=1`.
4. `.gitignore` entries for the drain's state + lock files.

## Scope (MVP)

**Fast-track-sized entries only** — XS/S route to `fast-track` per
[size-routing.ts](../../../src/core/size-routing.ts) (`sizeSkipsSpec` short-circuits on size before
`hasParent`, so **all** XS/S → `fast-track`, parented or not). M/L/XL entries route to
`specs-only-*` / `full-*` and are **skipped, not attempted** — their brainstorming + writing-plans
stages need human steer (out of MVP).

**Parented XS/S are in scope** (decision below): the interactive gate already ships them as no-FD
fast-tracks; the drain introduces no new behavior, it only removes the human from a sanctioned path.

**`Touches:` / multi-scope blocks are out of scope** (decision below): the drain skips any roadmap
entry whose block carries a `Touches:` line or more than one top-level scope bullet, because the
gate's `removeBlock` retirement does a *blind* removal with no residue disposition (unlike `/promote`
Steps 6.4/6.5, hardened after incident 650d8d3). Unattended, blind narrow-slicing would silently
erase un-scoped residue from `main`. Such entries wait for an interactive gate session.

**Failure policy:** retry an entry up to `--max-retries` times (fresh context each retry), then skip
it and continue. A broken entry cannot stall the drain; a flaky one gets a few clean-context attempts.

## Design decisions from review

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **No new removal helper.** Drain reuses the gate's existing "Roadmap-entry retirement" (`removeBlock`). | The capability already ships on the fast-track-from-roadmap path; a new helper would duplicate it. |
| D2 | **Success oracle = target slug ABSENT from the roadmap**, not "no longer top". | A reorder / higher-priority insertion changes the top without shipping the target → "no longer top" is a false success that silently drops a real entry. Absence is uniquely caused by `removeBlock` + merge. |
| D3 | **Supervisor reads `next-priority --suggestions --json --skip`**; never the bare form. | Only `--suggestions` (`getSuggestions` → `withRouting`) stamps `suggestedPath`; the bare `--json` returns a plain entry with no `topPriority`/`suggestedPath`. |
| D4 | **Termination = `topPriority.length === 0`** (after skip-filtering), independent of exit code. | `--suggestions` exits 2 only when `inProgress` *and* `topPriority` are both empty; one stuck in-progress FD would otherwise keep exit 0 forever. The drain ignores `inProgress` entirely. |
| D5 | **Supervisor syncs local `main` to `origin/main` before the post-spawn read.** | The retirement lands on `main` only at PR-merge, which is async on GitHub's side; a child can exit before the local main reflects the merge → false-failure re-spawn of an already-shipped entry. |
| D6 | **Headless config precondition set.** Drain refuses to start unless **all** hold: `autonomous.onFailure === 'abort'`, `autonomous.skipLanePicker === true`, `autonomous.requireHumanPrApproval === false`. | `onFailure: 'prompt'` (the config default) drops a cr-red/test-red into an interactive `@inquirer` select with no TTY → hang; `'spawn-deep-review'` is an iTerm2/`osascript` GUI spawn → non-functional headless. `skipLanePicker`/`requireHumanPrApproval` would each re-introduce a prompt seam. `assertConfig` checks this exact set and aborts (exit 1) naming any unmet key. |
| D7 | **Prompt suppression is backstopped at the harness, not trusted to prose.** Supervisor spawns `claude` with AskUserQuestion disallowed + a per-iteration timeout. | `NOLDOR_DRAIN` is read by LLM prose across many gate steps; a single forgotten branch would hang. A code-level deny turns a forgotten branch into a fast, visible failure. |
| D8 | **Supervisor lives at `src/autonomous/queue-drain.ts` + a manifest entry.** | The CLI dispatcher resolves all manifest `src:` paths under `src/` ([cli/index.ts](../../../src/cli/index.ts)); a `scripts/`-rooted command is unreachable via `pnpm noldor`. |
| D9 | **Skip parented-but-`Touches`/multi-scope; ship plain parented XS/S.** | Q2 decision — see Scope. |

## Architecture

### 1. Supervisor — `src/autonomous/queue-drain.ts` (new)

CLI: `pnpm noldor autonomous queue-drain [flags]` (new `autonomous` namespace +
`queue-drain` sub in [manifest.ts](../../../src/cli/manifest.ts), `src: 'autonomous/queue-drain.ts'`).

**Flags** (validated; bad input → exit 1 with a usage message):
- `--max-features N` (default 20) — bounds **ships** (`shipped` counts only entries *this run* drove
  to merge; an entry skipped pre-spawn because a prior run's PR is in-flight is not counted, even if
  that PR merges during this run — it simply leaves the queue via D2).
- `--max-spawns N` (default `maxFeatures * (maxRetries + 1)`) — hard backstop on **spawns**
  (a queue of flaky entries spawns far more than it ships).
- `--max-retries N` (default 2) — retries per entry before skip.
- `--iteration-timeout MS` (default 30 min) — wall-clock per spawned gate run.
- `--dry-run` — run the decision loop + print planned spawn/skip/ship decisions, spawning **no**
  `claude` and merging nothing.
- `--json` — emit machine-readable summary.

(No `--force`: a lock whose holder pid is dead is auto-reclaimed at startup, and stealing a lock
held by a *live* drain is never safe — so an override flag would have nothing valid to do.)

**Own exit-code contract** (mirrors the repo's `next-priority` convention — 0 actionable-done,
1 error):
- **0** — ran to completion: queue drained, all-remaining-skipped, or `--max-features` reached cleanly.
- **1** — aborted on error: `next-priority` parse/exec failure, `openPrExistsFor` `gh` failure
  (fail-closed), lock contention with a live drain, duplicate-slug roadmap, config precondition unmet,
  or a fatal git-sync failure.
- **130** — stopped via kill switch: Ctrl-C (process-group SIGINT kills the child too) or the
  `.noldor/drain-stop` sentinel checked between iterations (see Error handling).

**Loop** (the loop is a thin IO shell; all branching lives in the pure `decideNext`):

```
acquireLock()                      // .noldor/drain.lock {pid, startedAt}; reclaim if holder pid dead; exit 1 if held by live pid
assertConfig()                     // the full precondition set (D6): onFailure==='abort' && skipLanePicker===true && requireHumanPrApproval===false
assertNoDuplicateSlugs(roadmap)    // colliding -2/-3 slugs → abort (can't target a block safely)
syncMainCleanState()               // checkout main; fetch origin/main; merge --ff-only (reject → abort, do NOT force); prune worktrees/branches; rm stale cr/*-escalation-context.md
skip=∅, retries=Map, shipped=0, spawns=0
loop {
  if stopRequested(): exit 130 with summary
  const sugg = nextPriority({ suggestions:true, skip })       // parse JSON
  if sugg.topPriority.length === 0: break                     // D4 — done (ignore inProgress)
  const entry = sugg.topPriority[0]
  const decision = decideNext({ entry, shipped, maxFeatures, spawns, maxSpawns })
  switch decision.action {
    'skip-out-of-scope':  skip.add(entry.slug); continue        // non-fast-track, parented+Touches, or multi-scope
    'done':               break                                 // maxFeatures or maxSpawns reached
    'spawn': {
      if openPrExistsFor(entry.slug): { skip.add(entry.slug); continue }  // restart-safety — a PR from an interrupted prior run is in-flight; never duplicate
      spawns++; writeState({phase:'spawning', slug:entry.slug, pid, startedAt})
      const code = spawnGate({ env:{NOLDOR_DRAIN:'1', NOLDOR_DRAIN_SKIP:csv(skip)}, timeoutMs })  // blocks until merged or killed
      syncMainCleanState()                                      // D5 — make the read authoritative
      const after = nextPriority({ suggestions:true, skip })
      if shipped_(entry.slug, after): { shipped++; retries.delete(entry.slug); continue }  // D2 — slug absent
      if openPrExistsFor(entry.slug): { skip.add(entry.slug); continue }  // D5b — PR in-flight; never re-spawn a duplicate
      const n=(retries.get(entry.slug)??0)+1; retries.set(entry.slug,n)
      if n>maxRetries: skip.add(entry.slug)                     // give up on this entry
    }
  }
}
releaseLock(); printSummary({shipped, skipped:[...skip], retries})
```

**`decideNext(...)` — the pure, testable core.** Signature carries every input the decision needs
(review flagged the thin `(prev,next,retries,max)` form as under-powered):

```
decideNext({ entry, shipped, maxFeatures, spawns, maxSpawns })
  → { action: 'spawn' | 'skip-out-of-scope' | 'done', slug }
```
- `shipped >= maxFeatures || spawns >= maxSpawns` → `done`.
- `entry.suggestedPath !== 'fast-track'` → `skip-out-of-scope` (M/L/XL).
- `entry` block has a `Touches:` line or >1 scope bullet → `skip-out-of-scope` (D9 residue guard).
- else → `spawn`.

`decideNext` is intentionally **retry-agnostic** — retry is just "spawn again next iteration because
the still-present entry is still top and not yet skipped". Retry *bookkeeping* (increment, and add to
`skip` once `> maxRetries`) lives in the post-spawn loop body, not in `decideNext`; once an entry is
added to `skip`, `--skip` filtering removes it from `topPriority` so it never re-surfaces.

Eligibility scanning (`isDrainEligible(block)`) is a pure helper over the parsed roadmap block —
unit-tested independently. The supervisor owns the scope decision **pre-spawn**; the gate's Step 0
drain-branch out-of-scope exit is only a defensive backstop (the supervisor should never spawn an
out-of-scope entry).

**`shipped_(slug, after)`** ≡ `after.topPriority` (and the full roadmap parse) contains no entry with
that slug — D2. Because `removeBlock` only removes on merge-to-main and the supervisor synced main
first (D5), absence is an authoritative "shipped" signal robust to reordering.

**`openPrExistsFor(slug)`** ≡ `gh pr list --state open --head fast/<slug>` returns a PR. This relies on
the drain-mode gate naming the feature branch **deterministically** `fast/<slug>` (see §3 Step 2) so
the slug→branch→PR mapping is exact (ordinary fast-track uses `fast/<short-desc>`, which is not
slug-derivable). Checked **pre-spawn** (restart-safety against an interrupted prior run) and
**post-spawn** (D5b in-flight guard).

**Injected dependencies (for purity under test):** `nextPriority`, `spawnGate`, `syncMainCleanState`,
`openPrExistsFor`, `writeState`, `acquireLock`/`releaseLock`, `stopRequested`, `clock`/`timeout`. The
loop touches no real FS/git/process directly — tests drive every branch with mocks.

**Observability + crash recovery.** `.noldor/drain-state.json` (gitignored) is rewritten each
iteration with `{ pid, startedAt, phase, currentSlug, shipped, skip[], retries{} }`. It is **not** a
cross-run cache — a fresh run starts with empty skip/retries (a previously-skipped entry is
reconsidered; it may have been flaky/since-fixed). On startup the supervisor reclaims a stale lock
whose pid is dead and prunes leftover `.worktrees/*` from an interrupted prior run.

**Concurrency.** `.noldor/drain.lock` (pid + startedAt) is exclusive, acquired via an atomic
`O_EXCL` create. Reclaim-if-dead is TOCTOU-safe by renaming the stale lock **aside** (`drain.lock` →
a unique reclaim name; the loser's rename fails `ENOENT`), then `O_EXCL`-creating a fresh lock — *not*
by renaming a freshly-written tmp lock *onto* `drain.lock` (last-writer-wins, which both racers would
pass). So two supervisors starting simultaneously cannot both proceed. A second drain or a human
`/gate` running concurrently would collide on the single-slot `.noldor/session.json` and race on
`docs/roadmap.md`. The drain refuses to start if the lock is held by a live pid. Serial-only — one
feature at a time.

The lock guards concurrent **local** drains/gates, not a **remote** push landing on `main` between
the supervisor's pre-spawn read and the child's Step 0 read. If a remote push reorders the roadmap so
the child ships a *different* fast-track entry than the supervisor targeted, the slug-absence oracle
(D2) self-corrects: the shipped entry is absent from `main` (so it never re-attempts), the targeted
entry is still present (so it retries and ships next iteration). The only cost is a transient
`shipped`-counter undercount, never duplicate work or lost work.

### 2. `next-priority --skip <csv>` (modify [next-priority.ts](../../../src/core/next-priority.ts))

`getSuggestions` gains a skip-set: roadmap entries whose slug ∈ skip are excluded; the next
non-skipped entries fill `topPriority`. `--skip` only ever filters **roadmap entries**, never
`inProgress` FDs (which the drain ignores entirely — D4). The supervisor calls
`next-priority --suggestions --json --skip <csv>` and decides termination on
`topPriority.length === 0`, not on the exit code. Exit-code behavior is unchanged for existing callers.

### 3. Gate drain-mode branches (modify [gate SKILL.md](../../../.claude/skills/gate/SKILL.md))

When `NOLDOR_DRAIN=1`, the gate runs with **zero AskUserQuestion calls** (backstopped by D7's
harness-level deny + D-timeout):

- **Step 0:** no bucket prompt. Auto-pick `topPriority[0]` honoring `NOLDOR_DRAIN_SKIP`. (The
  supervisor only spawns for in-scope entries, so the top is expected to be a fast-track XS/S.) If
  `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — should not happen).
- **Steps 1 / 1.5:** no path-pick / confirm. Force `fast-track`, carrying `entry.slug`. In drain mode
  the feature branch is named **`fast/<slug>`** (deterministic, vs ordinary fast-track's
  `fast/<short-desc>`) so the supervisor's `openPrExistsFor(slug)` can map slug → branch → PR exactly.
  Because the name is deterministic, a prior interrupted run can leave a stale `fast/<slug>` branch
  (killed *before* a PR opened, or with a closed-unmerged PR) — which would otherwise collide on
  create/push. Reaching branch-create means the pre-spawn `openPrExistsFor` found **no open PR**, so
  any existing `fast/<slug>` is abandoned work safe to discard: drain-mode Step 2 **force-recreates**
  it — `git branch -D fast/<slug>` (local) + `git push origin --delete fast/<slug>` (remote, if it
  exists) — before `git worktree add … -b fast/<slug>`. Ordering matters: the supervisor's
  `syncMainCleanState` (which prunes leftover `.worktrees/*` + their branches) runs **before** the
  child spawns, so by branch-create time no leftover worktree still has `fast/<slug>` checked out and
  the `git branch -D` cannot fail on a checked-out branch.
- **Step 2:** the **existing** fast-track + Roadmap-entry-retirement sequence (unchanged) — worktree,
  implement from the entry description, `removeBlock` retirement commit on the branch. `cd` into the
  worktree; the session marker, `set-autonomous`, and `pr-flow` all operate from the worktree
  (existing gate cwd discipline; called out because a split-brain marker silently breaks autonomous
  activation — see the "Worktree edit-path trap" memory).
- **Step 4:** autonomous end-of-flow — `set-autonomous`, code-stage CR via `crLanes.code`, `pr-flow`
  auto-merge, no prompts. `pr-flow` **polls until the PR is actually merged** (existing gate Step 4
  behavior) and then fast-forwards local `main`, so a clean child exit implies the entry is retired on
  `main`. If the child instead exits with the merge still pending (timeout/edge), the supervisor's
  `openPrExistsFor(slug)` check (D5b) catches the in-flight PR and skips rather than re-spawning a
  duplicate. **No-FD seams are skipped** (phase-flip, `draft-feature-md --refresh` —
  fast-track carries no FD). The code-stage `cr orchestrate --slug` receives the roadmap slug for
  sink naming only; there is no `docs/features/<slug>.md` for a fast-track, matching existing gate
  fast-track behavior. Escalation runs `cr escalate --autonomous`; with `onFailure: abort` (D6) a red
  cleanly fails the iteration (non-zero) → the supervisor retries-from-clean or skips.
- **Step 5:** exit clean — no human `/clear`+`/gate` handoff prose. The supervisor is the loop.

### 4. `.gitignore` additions

Add `.noldor/drain-state.json`, `.noldor/drain.lock`, `.noldor/drain-stop`. (Today `.noldor/` is
ignored entry-by-entry, not wholesale — without these, the drain's state/lock could be swept into a
feature PR by branch staging.)

## Data flow

```
queue-drain.ts ─ acquireLock + assertConfig + assertNoDupSlugs + syncMain
      ▼
  nextPriority --suggestions --json --skip → topPriority (empty → done)
      │ decideNext: out-of-scope (M/L/XL | Touches | multi-scope) ──→ skip, continue
      │ in-scope (fast-track XS/S)
      ▼
  spawn  NOLDOR_DRAIN=1 NOLDOR_DRAIN_SKIP=…  claude --print "/gate"   (AskUserQuestion denied; timeout)
      │   └─ Step 0 (top, skip-aware) → Step 2 (implement + removeBlock retirement on branch)
      │      → Step 4 (autonomous PR auto-merge) → Step 5 (clean exit)
      ▼
  syncMain (fetch origin/main + ff)  →  nextPriority --suggestions --json --skip
      │ target slug ABSENT from roadmap ──yes──→ shipped++, continue          (D2 + D5)
      │                                  ──no───→ retries++ → (≤max: retry | >max: skip)
```

## Error handling

- `next-priority` non-zero / unparseable JSON → **abort** (exit 1; never loop blind).
- `openPrExistsFor` `gh` call non-zero / offline → **abort** (exit 1, fail-closed). Treating a `gh`
  failure as "no PR" would re-spawn a duplicate — the opposite of safe.
- Duplicate/colliding roadmap slugs (`-2` suffixing) → **abort** (exit 1; can't target a block safely).
- Lock held by a live pid → **abort** (exit 1). A lock whose holder pid is dead is auto-reclaimed at
  startup (no flag needed).
- `claude` child exits non-zero → iteration failure (retry/skip).
- `claude` child exceeds `--iteration-timeout` → kill the process tree, prune its worktree, treat as
  iteration failure.
- **Kill switch.** `.noldor/drain-stop` sentinel (checked between iterations) → finish cleanly, exit
  130. Ctrl-C from the controlling terminal sends SIGINT to the whole foreground process group, so the
  inherited-stdio `claude` child dies together with the supervisor (no orphaned local child) and the
  next loop check exits 130. A child that ignores the group signal is bounded by `--iteration-timeout`
  (the `spawnSync` timeout + `SIGKILL`). A cross-shell `kill -INT <supervisor-pid>` that targets only
  the supervisor cannot interrupt the blocking `spawnSync` and is **not** a supported stop path in MVP
  (async spawn with explicit child-tree forwarding is a post-MVP refinement) — use Ctrl-C or the
  sentinel. Note: if `pr-flow` already enabled GitHub's server-side auto-merge before the kill, killing
  the local child does not cancel that merge — the entry may still land on `main`; D5b's
  `openPrExistsFor` check on the next run absorbs this so it is never re-spawned.
- Config precondition unmet (any of the D6 set: `onFailure !== 'abort'`, `skipLanePicker !== true`,
  `requireHumanPrApproval !== false`) → abort before the first spawn (exit 1), naming each unmet key.
- `git merge --ff-only origin/main` rejects (local main diverged) during sync → abort the drain with
  the divergence surfaced (do not force; mirrors the gate's own ff-only discipline).
- Merged-on-origin-but-not-locally → resolved by D5's pre-read sync; the slug-absence check then reads
  true and the entry counts as shipped (no false-failure re-spawn).
- Stale `drain-state.json` / failed state write → best-effort; a state-write failure logs and
  continues (never crashes the loop). A failed **roadmap** edit inside the gate is fatal to that
  iteration (handled as a child failure).
- Inter-iteration cleanup (`syncMainCleanState`) runs before every spawn and after every failure:
  clean tree on synced `main`, no orphaned `fast/*` branches or `.worktrees/*`, no stale
  `cr/*-escalation-context.md`.

## Testing

- **Unit — `decideNext`:** spawn / skip-out-of-scope / done across permutations of (suggestedPath,
  Touches/multi-scope, shipped vs maxFeatures, spawns vs maxSpawns). `decideNext` is retry-agnostic —
  retry behavior is covered by the loop test, not here.
- **Unit — `isDrainEligible(block)`:** plain single-scope block → eligible; `Touches:`-bearing →
  ineligible; multi-bullet body → ineligible.
- **Unit — `next-priority --skip`:** excludes a slug, surfaces the next; all-skipped → empty
  `topPriority`; `--skip` never filters `inProgress`.
- **Unit — loop with injected deps:** (a) 2-entry queue, entry 1 ships / entry 2 fails twice then
  skips → assert summary + spawn count; (b) `nextPriority` throws → abort exit 1; (c) child timeout →
  fail-then-retry; (d) merged-but-locally-unsynced → sync makes slug absent → counts shipped, no
  re-spawn; (e) `--dry-run` → zero `spawnGate` calls; (f) stop-signal at iteration top → exit 130;
  (g) duplicate-slug roadmap → abort; (h) lock held by live pid → abort; (i) child exits with slug
  still present but `openPrExistsFor` true → skip, no re-spawn (D5b); (j) `openPrExistsFor` true
  **pre-spawn** (restart after an interrupted run) → skip without spawning; (k) `openPrExistsFor`
  `gh` call fails → abort exit 1 (fail-closed, no spawn).
- **Reused (not re-tested):** `removeBlock` is already covered by
  [write-blocks tests](../../../src/utils/__tests__/write-blocks.test.ts).
- **Pre-implementation spike (documented in the FD Usage section):** confirm `claude --print "/gate"`
  (i) resolves the `/gate` skill in print mode, (ii) accepts the flag that denies AskUserQuestion,
  (iii) passes permission flags so `git`/`gh`/`pnpm`/Edit run without prompts. The drain is not
  buildable end-to-end until this is verified; the plan front-loads it.
- **Integration (manual, documented):** one real `NOLDOR_DRAIN=1` drain over a seeded single-entry
  roadmap, end-to-end through PR merge; assert the gate skill actually executed (not just a clean
  child exit) and the entry was retired from `main`.

## Out of scope (YAGNI)

- Parallel drain (serial only).
- `specs-only-*` / `full-*` autonomy (no autonomous brainstorming / writing-plans).
- `Touches:` / multi-scope entry draining (skipped — needs residue disposition a human must do).
- Cross-run persistent skip memory (each run reconsiders previously-skipped entries).
- Config-driven trigger (env flag only; no `autonomous.drain` config block).
- A headless deep-review failure path (the standalone lane is GUI-only; drain forces `onFailure: abort`).
- Dashboard / web surface for drain state.

## Open questions (resolved)

1. *How does a headless gate suppress every prompt?* → `NOLDOR_DRAIN=1` drain-mode prose branches,
   **backstopped** by spawning `claude` with AskUserQuestion denied + a per-iteration timeout (prose
   alone is best-effort, not deterministic — D7).
2. *How is the queue entry consumed so the loop advances?* → the gate's **existing** Roadmap-entry
   retirement (`removeBlock` on the feature branch, merged to `main`); no new helper (D1).
3. *Per-feature failure policy?* → retry up to `--max-retries`, then skip-and-continue; headless
   `onFailure` forced to `abort` (D6).
4. *Success signal?* → target slug **absent** from the post-sync `main` roadmap (D2 + D5).
