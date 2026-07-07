import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync, type NoldorConfig } from '../core/config.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import {
  roadmapSource,
  plansSource,
  specsSource,
  type SourceId,
  type DrainSource,
} from './drain-source.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState, projectDrainState } from './drain-state.js';
import { makePhaseTap } from './phase-events.js';
import {
  syncMainCleanState,
  openPrExistsFor,
  mergedPrExistsFor,
  spawnGate,
  mergePr,
  assertQueueSourceSyncedAt,
} from './drain-io.js';
import {
  reconcileDeadRun,
  makeReconcileDeps,
  reportIsEmpty,
  formatReconcile,
  groupKillState,
  type ReconcileReport,
} from './drain-reconcile.js';
import { makeSalvage } from './salvage.js';
import { applyCycleVerdict, loadPark, mapCycle, parkAwareSource } from './escalations.js';

export interface ParsedArgs {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  source: SourceId;
  concurrency: number;
}

function intFlag(args: readonly string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
  return v;
}

/** Parse `--source roadmap|plans|specs` (default roadmap). Throws on an unknown source. */
function parseSource(args: readonly string[]): SourceId {
  const i = args.indexOf('--source');
  if (i === -1) return 'roadmap';
  const v = args[i + 1];
  if (v !== 'roadmap' && v !== 'plans' && v !== 'specs') {
    throw new Error('--source must be one of: roadmap, plans, specs');
  }
  return v;
}

/** Parse the drain CLI flags. Throws on a non-positive integer flag or bad --source. */
export function parseArgs(args: readonly string[]): ParsedArgs {
  const maxFeatures = intFlag(args, '--max-features', 20);
  const maxRetries = intFlag(args, '--max-retries', 2);
  return {
    maxFeatures,
    maxRetries,
    maxSpawns: intFlag(args, '--max-spawns', maxFeatures * (maxRetries + 1)),
    timeoutMs: intFlag(args, '--iteration-timeout', 30 * 60 * 1000),
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    source: parseSource(args),
    concurrency: intFlag(args, '--concurrency', 1),
  };
}

/**
 * Assert the headless-safe config precondition set (spec D6). All three must
 * hold or the drain refuses to start — `prompt`/`spawn-deep-review` onFailure and
 * a lane-picker / PR-approval prompt would each hang a headless run.
 */
export function assertConfig(cfg: Partial<NoldorConfig>): void {
  const a = cfg.autonomous;
  if (!a)
    throw new Error(
      'drain requires an `autonomous` block in .noldor/config.json. Fresh scaffolds ' +
        '(noldor v0.5.1+) include it; older ones must add the headless-safe block:\n' +
        '  "autonomous": { "skipLanePicker": true, "onFailure": "abort", "requireHumanPrApproval": false }',
    );
  const bad: string[] = [];
  if (a.onFailure !== 'abort') bad.push('autonomous.onFailure must be "abort"');
  if (a.skipLanePicker !== true) bad.push('autonomous.skipLanePicker must be true');
  if (a.requireHumanPrApproval !== false)
    bad.push('autonomous.requireHumanPrApproval must be false');
  if (bad.length > 0)
    throw new Error(`drain config precondition unmet:\n  - ${bad.join('\n  - ')}`);
}

/** Build the matching {@link DrainSource}. `specs` throws (phase 2) → caller exits 1. */
function buildSource(id: SourceId, cwd: string): DrainSource {
  if (id === 'roadmap') return roadmapSource(cwd);
  if (id === 'plans') return plansSource(cwd);
  return specsSource(cwd); // throws — phase 2
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  let parsed: ParsedArgs;
  let source: DrainSource;
  try {
    parsed = parseArgs(args);
    assertConfig(loadConfigSync() ?? {});
    source = buildSource(parsed.source, cwd); // --source specs throws here → exit 1
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  // Run correlation id (spec Unit 1): sortable, collision-free, human-legible.
  // Exported into our own env so direct appendAgentEvent writers in this
  // process (salvage) and the registry's ambient fallback resolve the same id.
  const runId = `${startedAt}.${String(process.pid)}`;
  process.env.NOLDOR_RUN_ID = runId;
  const lock = acquireLock(cwd, startedAt);
  if (!lock.ok) {
    process.stderr.write(`drain: ${lock.reason}\n`);
    process.exit(1);
  }

  // Clear a stale stop sentinel from a prior run so this run isn't immediately
  // short-circuited to exit 130 (the sentinel is a one-shot between-iterations stop).
  try {
    unlinkSync(join(cwd, '.noldor/drain-stop'));
  } catch {
    /* not present — fine */
  }

  let stop = false;
  // SIGINT stays graceful: flag a between-iterations stop and let in-flight children finish
  // (group-killing here would abort a build mid-merge). SIGTERM is a hard stop — tear the
  // agent grandchildren down with the runner so `kill <pid>` doesn't orphan them. SIGKILL
  // runs no handler; the next run's startup `reapOrphanAgents` is the backstop for that.
  process.on('SIGINT', () => {
    stop = true;
  });
  process.on('SIGTERM', () => {
    groupKillState(cwd);
    releaseLock(cwd);
    process.exit(130);
  });

  // Startup reconciliation of a prior dead run (reap orphans → sync + divergence pre-flight →
  // heal open PRs → prune shipped worktrees). A clean startup is an all-empty no-op. A
  // local-ahead-of-origin divergence throws here → exit 1 before any gate child wastes work.
  const reconcileDeps = makeReconcileDeps(
    cwd,
    source,
    () => syncMainCleanState(cwd),
    () => assertQueueSourceSyncedAt(cwd),
  );
  let reconcileReport: ReconcileReport | null = null;
  try {
    reconcileReport = await reconcileDeadRun(reconcileDeps, source, parsed.dryRun);
    if (!reportIsEmpty(reconcileReport))
      process.stdout.write(`${formatReconcile(reconcileReport)}\n`);
  } catch (e) {
    releaseLock(cwd);
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  const drainSource = parkAwareSource(source, () => loadPark(cwd));
  const deps: DrainDeps = {
    source: drainSource,
    spawnGate: (env, timeoutMs, prompt, onSpawn, slug) =>
      spawnGate(cwd, { ...env, NOLDOR_RUN_ID: runId }, timeoutMs, prompt, onSpawn, slug),
    syncMainCleanState: () => syncMainCleanState(cwd),
    mergePr: (slug, branch) => mergePr(cwd, slug, branch),
    openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
    mergedPrExistsFor: (slug, branch) => mergedPrExistsFor(cwd, slug, branch),
    salvageStaleBase: makeSalvage(cwd, 'run'),
    writeState: makePhaseTap(cwd, runId, (s) =>
      writeState(cwd, projectDrainState(process.pid, startedAt, s)),
    ),
    stopRequested: () => stop || existsSync(join(cwd, '.noldor/drain-stop')),
  };

  let res: DrainResult;
  try {
    res = await runDrain(deps, { ...parsed, cwd, startupStaggerMs: 750 });
  } finally {
    releaseLock(cwd);
  }

  // Run-side escalation symmetry (spec Unit 3 / D3): terminal failures land in the same
  // inbox as watch cycles. mode 'run' never parks pr-open-unmerged and never notifies —
  // an operator-fired one-shot reports to its own terminal.
  const runNow = new Date().toISOString();
  const verdict = mapCycle({
    result: res,
    mode: 'run',
    source: parsed.source,
    parked: loadPark(cwd),
    pendingPr: [],
    queueUniverse: drainSource.parseAll(),
    now: runNow,
    runId,
  });
  applyCycleVerdict(cwd, parsed.source, verdict, runNow);

  process.stdout.write(
    parsed.json
      ? `${JSON.stringify({ ...res, reconcile: reconcileReport })}\n`
      : `drain: shipped ${res.shipped}, skipped ${res.skipped.length} [${res.skipped.join(', ')}]\n`,
  );
  if (!parsed.json && res.planned !== undefined) {
    process.stdout.write(`  would ship (FIFO plan-age): ${res.planned.join(', ')}\n`);
  }
  if (!parsed.json && res.skipReasons !== undefined) {
    for (const [slug, reason] of Object.entries(res.skipReasons)) {
      process.stdout.write(`  skip ${slug}: ${reason}\n`);
    }
  }
  if (res.error !== undefined) process.stderr.write(`drain aborted: ${res.error}\n`);
  process.exit(res.exitCode);
}

// Match the entrypoint file exactly (queue-drain.ts/.js/.mjs) — NOT a test file
// such as queue-drain-cli.test.ts, which would otherwise run main() at import.
const invokedDirect = /[\\/]queue-drain\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().catch((e: unknown) => {
    process.stderr.write(`drain crashed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
