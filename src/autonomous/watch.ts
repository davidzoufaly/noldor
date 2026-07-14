import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigSync } from '../core/config.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import { roadmapSource } from './drain-source.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { detachWatch, WATCH_LOG_REL } from './watch-detach.js';
import { writeState, projectDrainState } from './drain-state.js';
import { makePhaseTap } from './phase-events.js';
import {
  assertQueueSourceSyncedAt,
  syncMainCleanState,
  openPrExistsFor,
  mergedPrExistsFor,
  spawnGate,
  mergePr,
} from './drain-io.js';
import { assertConfig } from './queue-drain.js';
import {
  formatReconcile,
  groupKillState,
  makeReconcileDeps,
  reconcileDeadRun,
  reportIsEmpty,
} from './drain-reconcile.js';
import { makeSalvage } from './salvage.js';
import {
  applyCycleVerdict,
  loadPark,
  mapCycle,
  parkAwareSource,
  SUGGESTED_ACTIONS,
} from './escalations.js';
import {
  applyCycleToState,
  loadWatchState,
  saveWatchState,
  type WatchRails,
} from './watch-state.js';
import { notify } from './notify.js';

export interface WatchArgs {
  intervalMinutes: number;
  maxFeatures: number;
  maxRetries: number;
  timeoutMs: number;
  once: boolean;
  json: boolean;
  dryRun: boolean;
  detach: boolean;
}

function intFlag(args: readonly string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
  return v;
}

/** Parse watch flags. `configInterval` is the resolved `autonomous.watch.intervalMinutes`. */
export function parseWatchArgs(args: readonly string[], configInterval: number): WatchArgs {
  return {
    intervalMinutes: intFlag(args, '--interval', configInterval),
    maxFeatures: intFlag(args, '--max-features', 1),
    maxRetries: intFlag(args, '--max-retries', 2),
    timeoutMs: intFlag(args, '--iteration-timeout', 30 * 60 * 1000),
    once: args.includes('--once'),
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run'),
    detach: args.includes('--detach'),
  };
}

/**
 * Disambiguate a 130 cycle (spec Unit 1 step 4): pause, drain-stop, and SIGINT
 * all flow through the same stopRequested seam, so the watcher inspects its own
 * state afterwards. SIGINT wins (operator at the keyboard), then pause (hold /
 * exit-0), else a freshly written drain-stop (one-shot stop → exit 130).
 */
export function resolve130(s: {
  sigint: boolean;
  pauseExists: boolean;
}): 'sigint' | 'paused' | 'stopped' {
  if (s.sigint) return 'sigint';
  if (s.pauseExists) return 'paused';
  return 'stopped';
}

const PAUSE_REL = '.noldor/drain.pause';
const STOP_REL = '.noldor/drain-stop';

function dayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function interruptibleSleep(ms: number, interrupted: () => boolean): Promise<void> {
  const step = 1000;
  for (let waited = 0; waited < ms; waited += step) {
    if (interrupted()) return;
    await sleep(Math.min(step, ms - waited));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const cfg = loadConfigSync() ?? {};
  let parsed: WatchArgs;
  try {
    assertConfig(cfg);
    const watchCfg = cfg.autonomous?.watch;
    parsed = parseWatchArgs(args, watchCfg?.intervalMinutes ?? 30);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
  const rails: WatchRails = {
    maxFeaturesPerDay: cfg.autonomous?.watch?.maxFeaturesPerDay ?? 10,
    maxConsecutiveFailures: cfg.autonomous?.watch?.maxConsecutiveFailures ?? 3,
  };
  const notifyCommand = cfg.autonomous?.watch?.notifyCommand;

  // --detach: re-spawn ourselves as a session-independent daemon and exit. The
  // detached child re-enters here without --detach and acquires the lock below.
  // Kept BEFORE acquireLock so the launcher never holds the lock the child needs.
  if (parsed.detach) {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const r = detachWatch(cwd, moduleDir, args);
    if (!r.ok) {
      process.stderr.write(`watch --detach: ${r.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `watch: detached (pid ${String(r.pid)}) — logs → ${r.logPath}\n` +
        `  stop: kill $(cat ${r.pidPath})   (or: touch .noldor/drain-stop)\n`,
    );
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const lock = acquireLock(cwd, startedAt);
  if (!lock.ok) {
    process.stderr.write(`watch: ${lock.reason}\n`);
    process.exit(1);
  }

  // Startup-only stale-sentinel clear (spec Unit 1 step 2): a sentinel written DURING
  // this run — including between cycles — is live operator intent, never cleared.
  try {
    unlinkSync(join(cwd, STOP_REL));
  } catch {
    /* not present — fine */
  }

  let sigint = false;
  // SIGINT stays graceful: flag a between-cycles stop and let in-flight children finish.
  // SIGTERM is a hard stop — `kill $(cat .noldor/watch.pid)` must tear the detached
  // bypassPermissions agent grandchildren down with the watcher instead of orphaning
  // them (mirrors queue-drain). SIGKILL runs no handler; the next cycle/run's
  // `reapOrphanAgents` is the backstop for that.
  process.on('SIGINT', () => {
    sigint = true;
  });
  process.on('SIGTERM', () => {
    groupKillState(cwd);
    releaseLock(cwd, { startedAt });
    process.exit(130);
  });
  const pauseExists = (): boolean => existsSync(join(cwd, PAUSE_REL));

  const out = (line: string): void => {
    if (!parsed.json) process.stdout.write(`${line}\n`);
  };
  const emitJson = (obj: unknown): void => {
    if (parsed.json) process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  let exitCode = 0;
  try {
    for (;;) {
      if (sigint) {
        exitCode = 130;
        break;
      }
      if (pauseExists()) {
        out('watch: paused (.noldor/drain.pause present)');
        emitJson({ cycle: 'paused' });
        if (parsed.once) break;
        await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint || !pauseExists());
        continue;
      }
      let state = loadWatchState(cwd, dayKeyOf(new Date()));
      if (state.shippedToday >= rails.maxFeaturesPerDay) {
        out(
          `watch: daily cap reached (${String(state.shippedToday)}/${String(rails.maxFeaturesPerDay)})`,
        );
        emitJson({ cycle: 'capped', shippedToday: state.shippedToday });
        if (parsed.once) break;
        await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint);
        continue;
      }

      // Cycle-start reconciliation (mirrors queue-drain's startup pass): reap orphan
      // agents from a dead prior cycle/run, sync + divergence pre-flight, heal open
      // PRs, prune shipped worktrees. A clean cycle is an all-empty no-op. Failure
      // handling is two-tier: a local-ahead divergence is a persistent operator
      // condition — trip immediately (pause + escalation + notify + exit 1). Any
      // other reconcile throw (gh/network hiccup) rides the consecutiveFailures
      // rail like a failed cycle, so one transient error can't kill the daemon.
      const baseSource = roadmapSource(cwd);
      try {
        const reconcileDeps = makeReconcileDeps(
          cwd,
          baseSource,
          () => syncMainCleanState(cwd),
          () => assertQueueSourceSyncedAt(cwd),
        );
        const report = await reconcileDeadRun(reconcileDeps, baseSource, parsed.dryRun);
        if (!reportIsEmpty(report)) out(formatReconcile(report));
      } catch (e) {
        const now = new Date().toISOString();
        const evidence = e instanceof Error ? e.message : String(e);
        if (parsed.dryRun) {
          // Mirror queue-drain's dry-run failure: report + exit, no state writes.
          out(`watch: reconcile failed (dry-run) — ${evidence}`);
          emitJson({ cycle: 'reconcile-failed', evidence });
          exitCode = 1;
          break;
        }
        const divergence = evidence.includes('local main is ahead of origin/main');
        const failures = state.consecutiveFailures + 1;
        const trip = divergence || failures >= rails.maxConsecutiveFailures;
        applyCycleVerdict(
          cwd,
          baseSource.id,
          {
            escalations: [
              {
                ts: now,
                slug: '-',
                source: baseSource.id,
                reason: 'reconcile-failed',
                evidence,
                stateSnapshot: { shipped: 0, skipped: [] },
                suggestedAction: SUGGESTED_ACTIONS['reconcile-failed'],
              },
            ],
            toPark: [],
            toUnpark: [],
            nextPendingPr: state.pendingPr,
          },
          now,
        );
        notify(notifyCommand, 'reconcile-failed', { evidence }, cwd);
        if (trip) {
          try {
            writeFileSync(join(cwd, PAUSE_REL), `reconcile-failed ${now}\n`, 'utf8');
          } catch {
            /* best-effort */
          }
          out(`watch: reconcile failed — ${evidence}; .noldor/drain.pause written`);
          emitJson({ cycle: 'reconcile-failed', evidence, tripped: true });
          exitCode = 1;
          break;
        }
        state = { ...state, consecutiveFailures: failures, lastCycleAt: now };
        saveWatchState(cwd, state);
        out(
          `watch: reconcile failed — ${evidence}; failures ${String(failures)}/${String(rails.maxConsecutiveFailures)}, retrying next cycle`,
        );
        emitJson({ cycle: 'reconcile-failed', evidence, consecutiveFailures: failures });
        if (parsed.once) break;
        await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint || pauseExists());
        continue;
      }

      const source = parkAwareSource(baseSource, () => loadPark(cwd));
      // Per-CYCLE run id (spec D7): each cycle is one runDrain with its own
      // outcome totals. The ambient env copy feeds salvage + nested spawns.
      const runId = `${new Date().toISOString()}.${String(process.pid)}`;
      process.env.NOLDOR_RUN_ID = runId;
      // Attached (foreground) watch tees child output into the shared watch log for
      // the dashboard's live drain pane; the detached daemon's stdio is already
      // redirected into that file, so its children must not tee (double lines).
      const logSink =
        process.env.NOLDOR_WATCH_DETACHED === '1' ? undefined : join(cwd, WATCH_LOG_REL);
      const deps: DrainDeps = {
        source,
        spawnGate: (env, timeoutMs, prompt, onSpawn, slug) =>
          spawnGate(
            cwd,
            { ...env, NOLDOR_RUN_ID: runId },
            timeoutMs,
            prompt,
            onSpawn,
            slug,
            logSink,
          ),
        syncMainCleanState: () => syncMainCleanState(cwd),
        mergePr: (slug, branch) => mergePr(cwd, slug, branch),
        openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
        mergedPrExistsFor: (slug, branch) => mergedPrExistsFor(cwd, slug, branch),
        salvageStaleBase: makeSalvage(cwd, 'watch'),
        writeState: makePhaseTap(cwd, runId, (s) =>
          writeState(cwd, projectDrainState(process.pid, startedAt, s)),
        ),
        stopRequested: () => sigint || existsSync(join(cwd, STOP_REL)) || pauseExists(),
      };

      const res: DrainResult = await runDrain(deps, {
        maxFeatures: parsed.maxFeatures,
        maxRetries: parsed.maxRetries,
        maxSpawns: parsed.maxFeatures * (parsed.maxRetries + 1),
        timeoutMs: parsed.timeoutMs,
        dryRun: parsed.dryRun,
        cwd,
        concurrency: 1,
        startupStaggerMs: 750,
      });

      const now = new Date().toISOString();
      const verdict = mapCycle({
        result: res,
        mode: 'watch',
        source: source.id,
        parked: loadPark(cwd),
        pendingPr: state.pendingPr,
        ...(state.lastRunAbortError !== undefined
          ? { prevRunAbortError: state.lastRunAbortError }
          : {}),
        queueUniverse: source.parseAll(),
        now,
        runId,
      });
      applyCycleVerdict(cwd, source.id, verdict, now);
      for (const rowItem of verdict.escalations) notify(notifyCommand, 'escalation', rowItem, cwd);

      const applied = applyCycleToState(state, res, verdict.escalations.length, rails, now);
      // lastRunAbortError is per-cycle memory: set it on an aborted cycle, CLEAR it
      // otherwise — spreading the old value forward would dedupe a future identical
      // abort against a long-gone streak.
      state = { ...applied.state, pendingPr: verdict.nextPendingPr };
      if (verdict.nextRunAbortError !== undefined) {
        state.lastRunAbortError = verdict.nextRunAbortError;
      } else {
        delete state.lastRunAbortError;
      }
      saveWatchState(cwd, state);

      const summary = {
        cycle: 'done',
        shipped: res.shipped,
        skipped: res.skipped.length,
        parked: verdict.toPark.length,
        unparked: verdict.toUnpark.length,
        exitCode: res.exitCode,
        consecutiveFailures: state.consecutiveFailures,
        capped: applied.capped, // cap engages loudly the moment it's hit (FD: "never silent")
      };
      notify(notifyCommand, 'cycle-summary', summary, cwd);
      out(
        `watch cycle: shipped ${String(res.shipped)}, parked ${String(verdict.toPark.length)}, failures ${String(state.consecutiveFailures)}/${String(rails.maxConsecutiveFailures)}${applied.capped ? ' — DAILY CAP REACHED' : ''}`,
      );
      emitJson(summary);

      if (res.exitCode === 130) {
        const why = resolve130({ sigint, pauseExists: pauseExists() });
        if (why === 'sigint' || why === 'stopped') {
          exitCode = 130;
          break;
        }
        // paused: daemon holds (pause check at top of loop), --once exits 0 below.
      }

      if (applied.tripped) {
        // Loud trip (spec Unit 5): pause file so even cron --once respects it, escalation row, notify, exit 1.
        try {
          writeFileSync(join(cwd, PAUSE_REL), `tripped ${now}\n`, 'utf8');
        } catch {
          /* best-effort */
        }
        applyCycleVerdict(
          cwd,
          source.id,
          {
            escalations: [
              {
                ts: now,
                slug: '-',
                source: source.id,
                reason: 'watcher-tripped',
                evidence: `consecutiveFailures=${String(state.consecutiveFailures)}`,
                stateSnapshot: { shipped: res.shipped, skipped: [...res.skipped] },
                suggestedAction:
                  'inspect recent escalations, clear the root cause, then `rm .noldor/drain.pause`',
              },
            ],
            toPark: [],
            toUnpark: [],
            nextPendingPr: state.pendingPr,
          },
          now,
        );
        notify(
          notifyCommand,
          'watcher-tripped',
          { consecutiveFailures: state.consecutiveFailures },
          cwd,
        );
        out(
          'watch: TRIPPED — .noldor/drain.pause written; see watcher-tripped row in .noldor/escalations.jsonl',
        );
        exitCode = 1;
        break;
      }

      if (parsed.once) break;
      await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint || pauseExists());
    }
  } finally {
    releaseLock(cwd, { startedAt });
  }
  process.exit(exitCode);
}

// Match the entrypoint exactly (watch.ts/.js/.mjs) — NOT watch-args.test.ts.
const invokedDirect = /[\\/]watch\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().catch((e: unknown) => {
    process.stderr.write(`watch crashed: ${e instanceof Error ? e.message : String(e)}\n`);
    // Module-scope: main()'s `startedAt` is out of reach here, so release pid-only.
    // Safe by construction — if main() threw before acquireLock, the on-disk lock
    // belongs to a foreign supervisor (different pid) and owner-checked releaseLock
    // no-ops rather than freeing a lock this process never held.
    releaseLock(process.cwd());
    process.exit(1);
  });
}
