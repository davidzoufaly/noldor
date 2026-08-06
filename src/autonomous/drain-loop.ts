import type { DrainSource, DrainCandidate } from './drain-source.js';
import type { MergeOutcome } from './drain-io.js';
import type { InFlight, DrainStateSnapshot } from './drain-state.js';

export type DrainAction = 'spawn' | 'skip-out-of-scope' | 'done';

export interface DecideInput {
  candidate: DrainCandidate;
  shipped: number;
  maxFeatures: number;
  spawns: number;
  maxSpawns: number;
}

/**
 * Pure per-iteration decision. Retry-agnostic — {@link runDrain} owns retry
 * counting. `done` caps fire first (backstops), then the source's eligibility
 * verdict, else `spawn`. No source/path literals here — eligibility is decided
 * by the {@link DrainSource} and read off the candidate.
 */
export function decideNext(input: DecideInput): { action: DrainAction; slug: string } {
  const { candidate, shipped, maxFeatures, spawns, maxSpawns } = input;
  const slug = candidate.slug;
  if (shipped >= maxFeatures || spawns >= maxSpawns) return { action: 'done', slug };
  if (!candidate.eligible) return { action: 'skip-out-of-scope', slug };
  return { action: 'spawn', slug };
}

export interface DrainDeps {
  /** Injected source — owns next-item selection, the success oracle, prompt, and branch. */
  source: DrainSource;
  /** Spawn a headless gate run with the source's prompt; resolves with the child exit code.
   *  Rejects with 'iteration-timeout' on a per-entry timeout, or 'spawn-failed: …' on a systemic
   *  spawn error. Async so the build pool can keep K children in flight at once. `onSpawn` is
   *  called synchronously with the child's process-group id so the loop can record it for the
   *  next run's orphan-reap (spec Unit 2). `slug` is the candidate being built — stamped on the
   *  spawn's agent-event rows (K=1 has no `NOLDOR_DRAIN_SLUG`, so the loop passes it explicitly). */
  spawnGate: (
    env: Record<string, string>,
    timeoutMs: number,
    prompt: string,
    onSpawn?: (pgid: number) => void,
    slug?: string,
  ) => Promise<number>;
  /** Sync local main to origin + clean leftover worktrees/branches. May throw → abort (ff-only reject).
   *  At K>1 the coordinator also calls this after each merge to advance local main before the oracle. */
  syncMainCleanState: () => void;
  /** Serialized squash-merge of one open PR (K>1 only). Resolves with the merge outcome; rejects on a
   *  systemic gh failure (coordinator aborts fail-closed). Optional: only the K>1 path uses it, so the
   *  K=1 sequential callers (and tests) need not provide it. Asserted present before the coordinator runs. */
  mergePr?: (slug: string, branch: string) => Promise<MergeOutcome>;
  /** True when an open PR exists for the source's branch. May throw → abort (fail-closed). */
  openPrExistsFor: (slug: string, branch: string) => boolean;
  /** True when a MERGED PR exists for the source's branch. A fast-track ship (branch `fast/<slug>`)
   *  doesn't remove the roadmap entry, so the "absence-on-re-read = shipped" oracle misses it and the
   *  entry re-selects; without this the loop re-spawns an implementer to rebuild already-merged work
   *  (each spawn ~13min / ~170k tokens). Consulted ONLY post-spawn in settleShipVerdict (never at
   *  selection) so a stale historical merge on a reused branch can't silently drop new work. Optional:
   *  absent → old behavior. May throw → abort. */
  mergedPrExistsFor?: (slug: string, branch: string) => boolean;
  /** True when the branch carries commits not in `origin/main` — i.e. a prior child committed its
   *  work but never pushed/opened a PR (the "returned prose while a CR lane was still running"
   *  failure). Consulted ONLY for a slug already spawned this run, immediately before its NEXT spawn
   *  (`resolveFinishPrompt`): combined with a clean prior exit it distinguishes "built but
   *  undelivered" (deliver it) from "build failed" (rebuild). Turns a ~13min/~170k-token rebuild into
   *  a delivery-only re-spawn.
   *  ERRS TOWARD REBUILDING by contract — an implementation that can't tell should return false
   *  rather than throw, degrading to today's rebuild instead of aborting the drain.
   *  Optional: absent (or a source without `finishPrompt`) → old retry-from-scratch behavior. */
  branchHasUnshippedWork?: (slug: string, branch: string) => boolean;
  /** True when a CLOSED-but-unmerged PR exists for the branch — a human rejected that work, and it is
   *  one of the provably-wedging bases `salvageStaleBase` repairs by rebuilding from fresh main. Read
   *  at the same point as {@link branchHasUnshippedWork} to keep such a branch OUT of finish mode,
   *  which suppresses salvage and would otherwise re-deliver the rejected commits. May throw —
   *  the loop answers a throw by excluding the slug (rebuild), never by aborting the drain, since a
   *  probe that only disqualifies must not turn `gh` noise into a systemic failure. Optional: absent
   *  → no exclusion. */
  closedUnmergedPrExistsFor?: (slug: string, branch: string) => boolean;
  /** Optional pre-spawn clean-room: detect + repair a stale `fast/<slug>` base (leftover local/remote
   *  branch or closed-unmerged PR) before the gate child spawns. Throws → systemic abort (fail-closed,
   *  like the other git/gh deps). Absent → no salvage (existing behavior). */
  salvageStaleBase?: (slug: string, branch: string) => 'clean' | 'salvaged';
  /** Best-effort heartbeat write (never throws). Reports ALL in-flight slugs (building or
   *  awaiting-merge) + the slug currently merging — the K>1 generalization of the old `currentSlug`.
   *  Runners project the snapshot via `projectDrainState`. */
  writeState: (s: DrainStateSnapshot) => void;
  /** True when a stop has been requested (SIGINT / sentinel). */
  stopRequested: () => boolean;
}

export interface DrainOpts {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  cwd: string;
  /** Max features built concurrently. 1 (default) = today's sequential, inline-merge behavior. */
  concurrency: number;
  /** Per-worker first-spawn stagger (ms) so K simultaneous `git worktree add` don't collide on the
   *  shared `.git`. Production passes 750; tests pass 0. Only applies at concurrency > 1. */
  startupStaggerMs: number;
}

export interface DrainResult {
  shipped: number;
  skipped: string[];
  /** Per-slug skip reasons (e.g. ineligible). Present only when at least one reason was recorded. */
  skipReasons?: Record<string, string>;
  /** Dry-run only: eligible candidates that WOULD ship, in FIFO order. Present only in --dry-run with ≥1 eligible. */
  planned?: string[];
  exitCode: 0 | 1 | 130;
  /** Set only on an abort (exitCode 1) — the message of the dep that threw. */
  error?: string;
}

/**
 * The drain loop. Pure of IO except through injected {@link DrainDeps}. Success
 * === the target slug is absent from the source's freshly-synced `parseAll()`
 * universe (absence === shipped). Failure → retry up to `maxRetries`, then skip.
 * Termination on a null `nextItem` (no items remain), the `done` caps, or a stop
 * request (exit 130). Any thrown dep (source.nextItem / source.parseAll /
 * openPrExistsFor / syncMainCleanState) aborts the whole drain (exit 1) — never
 * loop blind.
 */
export async function runDrain(deps: DrainDeps, opts: DrainOpts): Promise<DrainResult> {
  const skip = new Set<string>();
  const retries = new Map<string, number>();
  const skipReasons: Record<string, string> = {};
  const planned: string[] = [];
  let shipped = 0;
  let spawns = 0;
  const result = (exitCode: 0 | 1 | 130, error?: string): DrainResult => ({
    shipped,
    skipped: [...skip],
    ...(Object.keys(skipReasons).length > 0 ? { skipReasons } : {}),
    ...(planned.length > 0 ? { planned } : {}),
    exitCode,
    ...(error !== undefined ? { error } : {}),
  });

  // `dispatched` holds a slug from the moment a worker dispatches it until it is FULLY settled
  // (shipped / skipped / retry-bumped). At K>1 that window includes awaiting-merge — the COORDINATOR
  // removes the slug after settling it (not the worker), so the slug stays (a) counted against
  // maxFeatures and (b) excluded from re-selection while its PR is open.
  const dispatched = new Set<string>();
  // Did this slug's last spawn THIS RUN exit cleanly? Absent = never spawned this run. Together with
  // a fresh branch probe at spawn time this is the whole input to the finish-vs-rebuild decision —
  // see `resolveFinishPrompt`. Deliberately NOT a carried "is finishable" set: membership that has
  // to be maintained at every ship / skip / merge / retry leaf eventually misses one and sends a
  // child to deliver work that is already merged, rejected, or gone.
  const lastExitClean = new Map<string, boolean>();
  const readyToMerge: Array<{ slug: string; branch: string }> = [];
  // Holder (not a bare `let`) so TS doesn't narrow the closure-mutated abort flag to `never` at the
  // outer read after `await Promise.all` — object properties aren't subject to that CFA collapse.
  const abortRef: { current: Error | null } = { current: null };
  let buildersDone = false;
  let wake: (() => void) | null = null; // resolves the coordinator's idle wait
  const signalCoordinator = (): void => {
    if (wake) {
      wake();
      wake = null;
    }
  };
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let merging: string | null = null; // slug the coordinator is merging right now (K>1)
  // pgids of the gate children currently in flight. Recorded via spawnGate's onSpawn and
  // surfaced in every heartbeat so the NEXT run can reap this run's orphans if it dies (SIGKILL
  // runs no handler). A child's pgid is removed once its spawnGate promise settles.
  const livePgids = new Set<number>();

  // Best-effort heartbeat: derive inFlight (building vs awaiting-merge) from the live sets.
  const emitState = (): void => {
    const pending = new Set(readyToMerge.map((r) => r.slug));
    const inFlight: InFlight[] = [...dispatched].map((slug) => ({
      slug,
      phase: pending.has(slug) || slug === merging ? 'awaiting-merge' : 'building',
    }));
    deps.writeState({
      phase: merging !== null ? 'awaiting-merge' : inFlight.length > 0 ? 'spawning' : 'idle',
      inFlight,
      merging,
      shipped,
      skip: [...skip],
      retries: Object.fromEntries(retries),
      agentPgids: [...livePgids],
    });
  };

  const recordRetryOrSkip = (slug: string): void => {
    const n = (retries.get(slug) ?? 0) + 1;
    retries.set(slug, n);
    if (n > opts.maxRetries) {
      skip.add(slug);
      skipReasons[slug] = 'retries-exhausted';
    }
  };

  /** A slug reached a terminal verdict (shipped / skipped): drop every per-slug retry state. */
  const settle = (slug: string): void => {
    retries.delete(slug);
    lastExitClean.delete(slug);
  };

  // K=1 → EXACTLY today's env (no slug assignment / open-only): the gate falls back to topPriority[0],
  // which the single worker selected anyway. Slug-assignment + open-only are K>1-only.
  const envFor = (slug: string, finishing: boolean): Record<string, string> => {
    const base: Record<string, string> = {
      NOLDOR_DRAIN: '1',
      NOLDOR_DRAIN_SKIP: [...skip].join(','),
      // Belt-and-suspenders only — the authoritative finish directive rides the prompt
      // (`source.finishPrompt`), since a headless model ignores an env-only signal.
      ...(finishing ? { NOLDOR_DRAIN_FINISH: '1' } : {}),
    };
    return opts.concurrency > 1
      ? { ...base, NOLDOR_DRAIN_SLUG: slug, NOLDOR_DRAIN_OPEN_ONLY: '1' }
      : base;
  };

  /**
   * The delivery-only prompt for this spawn, or `undefined` to build from scratch. Decided FRESH
   * immediately before each spawn rather than carried as state, so every answer reflects the branch
   * and its PRs as they are right now: a slug whose work was merged, rejected, or discarded since
   * the last attempt simply reads as not deliverable and rebuilds.
   *
   * Three conditions, all required:
   * - the source offers a delivery-only prompt at all (`plansSource` does not — its end-of-flow
   *   carries FD seams whose partial state a delivery-only child cannot infer);
   * - this slug's last spawn THIS RUN exited cleanly. A failed or timed-out child may have committed
   *   only part of the entry, and nothing on the branch distinguishes that from a finished build, so
   *   those rebuild;
   * - the branch still holds undelivered work AND carries no closed-unmerged PR (a human rejecting
   *   the branch is one of the wedged bases `salvageStaleBase` repairs by rebuilding, and finish mode
   *   suppresses salvage).
   *
   * Both probes only ever DISqualify, so a throw is answered by disqualifying: tool noise decides
   * "rebuild", it does not abort the drain from HERE. It may still abort a step later — a rebuild
   * runs `salvageStaleBase`, whose `detectStale` re-issues the same `gh pr list` and is fail-closed
   * by design (a wedged-base check that cannot run must not be guessed past). That split is
   * deliberate: the finish/rebuild choice has a safe default, the clean-room decision does not.
   * Reached only after the worker's pre-spawn open-PR guard, so a slug with a live PR never gets here.
   */
  const resolveFinishPrompt = (
    slug: string,
    branch: string,
  ): ((s: string) => string) | undefined => {
    if (lastExitClean.get(slug) !== true) return undefined;
    // `.bind` so a source whose `finishPrompt` uses `this` cannot break when invoked detached.
    const finishPrompt = deps.source.finishPrompt?.bind(deps.source);
    if (finishPrompt === undefined) return undefined;
    try {
      const deliverable =
        deps.branchHasUnshippedWork?.(slug, branch) === true &&
        deps.closedUnmergedPrExistsFor?.(slug, branch) !== true;
      return deliverable ? finishPrompt : undefined;
    } catch {
      return undefined;
    }
  };

  /** Returns true iff the slug was handed to the coordinator (worker must NOT drop it from
   *  `dispatched` — the coordinator owns its removal). K=1 settles inline and returns false.
   *  `code` is the gate child's exit code. At K=1 it's ignored (the oracle is authoritative, as
   *  today); at K>1 a non-zero exit means a post-open failure — don't merge that PR, skip it. */
  const settleShipVerdict = (slug: string, branch: string, code: number): boolean => {
    if (opts.concurrency === 1) {
      deps.syncMainCleanState(); // today's inline authority: advance local main, then read the oracle
      const stillPresent = deps.source.parseAll().includes(slug);
      if (!stillPresent) {
        shipped += 1;
        settle(slug);
        return false;
      }
      // Post-spawn only. We just dispatched THIS slug this run, so a merged PR
      // on its branch is the ship we (or a concurrent run) just landed — a
      // fast-track ship leaves the roadmap entry in place, so the absence oracle
      // above missed it. Count it shipped instead of re-spawning a rebuild.
      // This NARROWS but does not fully eliminate the "stale historical merge"
      // hazard: gating on having-spawned-this-iteration keeps an unrelated old
      // merge from blocking SELECTION, but if a branch name were reused (same
      // slug re-added after a prior ship) a stale merge could still be misread
      // here as this run's ship. That residual rests on the retire-on-ship +
      // stable-Q-NNNN-ID invariant that a shipped `<prefix>/<slug>` branch name
      // is never reused; if that ever breaks, scope this to a run-relative
      // `mergedAt` window.
      if (deps.mergedPrExistsFor?.(slug, branch)) {
        shipped += 1;
        settle(slug);
        skip.add(slug);
        skipReasons[slug] = 'already-merged (fast-track ship left the roadmap entry in place)';
        return false;
      }
      if (deps.openPrExistsFor(slug, branch)) {
        skip.add(slug); // PR landed in-flight; never re-spawn a duplicate
        skipReasons[slug] = 'pr-open-unmerged';
        return false;
      }
      // No PR and the entry is still queued → retry. Whether that retry rebuilds or merely delivers
      // is decided fresh at the next spawn by `resolveFinishPrompt`, never recorded here.
      recordRetryOrSkip(slug);
      return false;
    }
    // K>1: same post-spawn merged recognition as K=1 — a fast-track ship that left the roadmap
    // entry behind has a MERGED (not open) PR, so the open-only handoff below would miss it and fall
    // through to a retry re-spawn. Count it shipped; the worker settles it (coordinator never sees it).
    if (deps.mergedPrExistsFor?.(slug, branch)) {
      shipped += 1;
      settle(slug);
      skip.add(slug);
      skipReasons[slug] = 'already-merged (fast-track ship left the roadmap entry in place)';
      return false;
    }
    // K>1: hand off to the coordinator ONLY when the child exited cleanly AND opened a PR. A non-zero
    // exit with an open PR (post-open failure) is skipped — its PR is left open, matching K=1's
    // "don't ship a failed build" intent rather than letting the coordinator merge it blindly.
    // Only a clean exit can hand off, so only a clean exit needs this read — skip it on a failed
    // build rather than widen the systemic-abort surface (`openPrExistsFor` throws → whole-drain
    // abort) for an answer that cannot change the outcome. Nothing to disqualify here either: a
    // post-open failure leaves its PR as the delivery, and the next spawn's `resolveFinishPrompt`
    // re-derives the verdict from scratch rather than trusting a carried flag.
    if (code === 0 && deps.openPrExistsFor(slug, branch)) {
      readyToMerge.push({ slug, branch });
      signalCoordinator();
      emitState(); // slug transitions building → awaiting-merge
      return true;
    }
    recordRetryOrSkip(slug); // no PR / non-zero exit → build failed → retry/skip; worker drops it
    return false;
  };

  const worker = async (index: number): Promise<void> => {
    if (opts.concurrency > 1 && opts.startupStaggerMs > 0)
      await delay(index * opts.startupStaggerMs);
    for (;;) {
      if (abortRef.current || deps.stopRequested()) return;
      // ---- selection critical section (synchronous, no await) ----
      if (shipped + dispatched.size >= opts.maxFeatures) return; // cap counts in-flight + awaiting-merge
      const candidate = deps.source.nextItem(new Set([...skip, ...dispatched]));
      if (candidate === null) return;
      const d = decideNext({
        candidate,
        shipped,
        maxFeatures: opts.maxFeatures,
        spawns,
        maxSpawns: opts.maxSpawns,
      });
      if (d.action === 'done') return;
      if (d.action === 'skip-out-of-scope') {
        skip.add(candidate.slug);
        if (candidate.reason !== undefined) skipReasons[candidate.slug] = candidate.reason;
        continue;
      }
      const branch = deps.source.branchFor(candidate.slug);
      // NB: the merged-PR check is deliberately NOT applied here (pre-spawn). A
      // merged PR lives in GitHub history forever, so skipping selection on it
      // would let a stale historical merge on a reused branch name silently drop
      // genuinely new same-slug work — never even spawning it. The check runs only
      // in settleShipVerdict (post-spawn), where it is scoped to work we just
      // dispatched this run: it turns a retry re-spawn into a recognized ship
      // without ever gating selection on ancient history.
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // restart-safety: a prior run's PR is in-flight
        skipReasons[candidate.slug] = 'pr-open-unmerged';
        continue;
      }
      if (opts.dryRun) {
        planned.push(candidate.slug);
        skip.add(candidate.slug);
        continue;
      }
      spawns += 1;
      dispatched.add(candidate.slug);
      emitState();
      // ---- end critical section ----
      let handedToCoordinator = false;
      let childPgid: number | null = null;
      const finishPrompt = resolveFinishPrompt(candidate.slug, branch);
      try {
        // Salvage is a clean room: `repair` deletes the worktree + local + REMOTE branch. On a
        // finish that would destroy the very commits being delivered (a child that pushed without
        // opening a PR reads as `orphan-remote-branch`), so suppress it — the branch is known-good
        // work this run produced, not stale leftovers from a prior run.
        if (finishPrompt === undefined) deps.salvageStaleBase?.(candidate.slug, branch);
        const code = await deps.spawnGate(
          envFor(candidate.slug, finishPrompt !== undefined),
          opts.timeoutMs,
          finishPrompt !== undefined
            ? finishPrompt(candidate.slug)
            : deps.source.gatePrompt(candidate.slug),
          (pgid) => {
            childPgid = pgid;
            livePgids.add(pgid);
            emitState(); // heartbeat now carries the live pgid for the next run's reap
          },
          candidate.slug,
        );
        lastExitClean.set(candidate.slug, code === 0);
        handedToCoordinator = settleShipVerdict(candidate.slug, branch, code);
      } catch (e) {
        // A per-entry timeout is recoverable (retry/skip); any other spawn error is systemic → abort.
        // Recording the timeout as an UNCLEAN exit is what makes the retry a rebuild: a child killed
        // mid-flight may have committed only part of the entry (or only the roadmap-retirement
        // commit, which lands before implementation), and nothing on the branch distinguishes that
        // from a finished build. Telling the next child "do NOT re-implement the entry" over
        // half-done work would rest on child-side prose judgement — exactly the soft signal this
        // change exists to stop trusting.
        if (e instanceof Error && e.message === 'iteration-timeout') {
          lastExitClean.set(candidate.slug, false);
          recordRetryOrSkip(candidate.slug);
        } else abortRef.current = e instanceof Error ? e : new Error(String(e));
      } finally {
        if (childPgid !== null) {
          livePgids.delete(childPgid); // child settled — drop its pgid
          // Re-emit so the heartbeat never carries a settled child's pgid into the
          // idle tail (a long-lived watcher's SIGTERM group-kill would otherwise
          // fire at a stale — possibly recycled — pgid many minutes later).
          emitState();
        }
        if (!handedToCoordinator) dispatched.delete(candidate.slug);
      }
      if (abortRef.current) return;
    }
  };

  const coordinator = async (): Promise<void> => {
    for (;;) {
      if (abortRef.current) return;
      const next = readyToMerge.shift();
      if (next === undefined) {
        if (buildersDone) return;
        await new Promise<void>((r) => {
          wake = r;
        }); // woken by a worker push or by buildersDone + signal
        continue;
      }
      merging = next.slug;
      emitState();
      try {
        const outcome = await deps.mergePr!(next.slug, next.branch); // non-null: asserted at K>1 entry
        if (outcome !== 'merged') {
          skip.add(next.slug);
          skipReasons[next.slug] = `${outcome} — PR left open for human resolution`;
        } else {
          deps.syncMainCleanState(); // advance local main so parseAll() reflects the squash before the oracle
          const stillPresent = deps.source.parseAll().includes(next.slug);
          if (!stillPresent) {
            shipped += 1;
            settle(next.slug);
          } else {
            // Merged, yet the oracle still sees the entry (a fast-track ship leaves the roadmap block
            // in place when its removal did not land). Clear the clean-exit record BEFORE the
            // `dispatched.delete` below frees the slug: the coordinator runs concurrently with the
            // workers, so a live worker can re-select it in this same run, and every other
            // finish precondition would still hold — the handoff required `code === 0`, the merged PR
            // is no longer open so the pre-spawn guard passes, and `origin/main..fast/<slug>` stays
            // positive after a squash merge. Without this the next child is told "do NOT
            // re-implement, ship it" over already-merged commits, with salvage suppressed.
            lastExitClean.delete(next.slug);
            recordRetryOrSkip(next.slug);
          }
        }
      } catch (e) {
        abortRef.current = e instanceof Error ? e : new Error(String(e));
        return;
      } finally {
        merging = null;
        dispatched.delete(next.slug); // settled (any outcome) → free the cap slot + re-selection guard
        emitState();
      }
    }
  };

  try {
    if (opts.concurrency > 1 && deps.mergePr === undefined) {
      throw new Error('concurrency > 1 requires a mergePr dep');
    }
    deps.syncMainCleanState();
    const coordinatorPromise = opts.concurrency > 1 ? coordinator() : Promise.resolve();
    const workers = Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i));
    await Promise.all(workers);
    buildersDone = true;
    signalCoordinator(); // unblock a parked coordinator so it observes buildersDone and exits
    await coordinatorPromise;
    if (abortRef.current) return result(1, abortRef.current.message); // abort (1) wins
    if (deps.stopRequested()) return result(130); // stop (130) wins over the drained 0
    return result(0);
  } catch (err) {
    // source.nextItem / parseAll / openPrExistsFor / syncMain failure → abort, surfacing the cause.
    return result(1, err instanceof Error ? err.message : String(err));
  }
}
