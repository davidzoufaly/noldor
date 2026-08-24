import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync, type NoldorConfig } from '../core/config.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import {
  roadmapSource,
  plansSource,
  specsSource,
  selectionNotAtRef,
  formatNotAtRef,
  type SourceId,
  type DrainSource,
  type SelectionFilter,
} from './drain-source.js';
import { sizeSchema } from '../triage/score.js';
import { sizeToPath } from '../core/size-routing.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState, projectDrainState } from './drain-state.js';
import { makePhaseTap } from './phase-events.js';
import {
  syncMainCleanState,
  openPrExistsFor,
  mergedPrExistsFor,
  branchHasUnshippedWorkAt,
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
import { makeClosedUnmergedPrProbe, makeSalvage } from './salvage.js';
import { applyCycleVerdict, loadPark, mapCycle, parkAwareSource } from './escalations.js';
import { WATCH_LOG_REL } from './watch-detach.js';

export interface ParsedArgs {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  source: SourceId;
  concurrency: number;
  /** `--size` / `--only` narrowing; absent when the run is unnarrowed. */
  selection?: SelectionFilter;
}

/**
 * Sizes a roadmap block may declare — `--size` is validated against these. Derived from
 * the triage schema's own enum rather than restated, so a size added there cannot become
 * a size this flag silently rejects.
 */
const SIZES: readonly string[] = sizeSchema.options;

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

/**
 * Parse a comma-separated list flag (`--size XS,S`, `--only a,b`). Absent → `undefined`
 * (no constraint on that axis); present but empty throws rather than silently admitting
 * everything, since `--only` with a typo'd empty value would otherwise drain the queue.
 */
function listFlag(args: readonly string[], name: string): Set<string> | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const items = (args[i + 1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) throw new Error(`${name} must be a comma-separated non-empty list`);
  return new Set(items);
}

/**
 * Build the `--size` / `--only` narrowing, or `undefined` when the run is unnarrowed.
 * Throws when a size is not one of {@link SIZES} — a typo'd size would otherwise select
 * nothing and read as an empty queue. Roadmap-only: an in-progress FD is selected by
 * committed-design presence, so narrowing by size on `--source plans` would silently
 * no-op; fail loud instead.
 */
function parseSelection(args: readonly string[], source: SourceId): SelectionFilter | undefined {
  const raw = listFlag(args, '--size');
  const only = listFlag(args, '--only');
  if (raw === undefined && only === undefined) return undefined;
  if (source !== 'roadmap') {
    throw new Error('--size / --only apply to --source roadmap only');
  }
  const sizes = raw === undefined ? undefined : new Set([...raw].map((s) => s.toUpperCase()));
  const bad = sizes === undefined ? [] : [...sizes].filter((s) => !SIZES.includes(s));
  if (bad.length > 0) {
    throw new Error(`--size must be one of ${SIZES.join(', ')} (got ${bad.join(', ')})`);
  }
  // A size the roadmap source can never ship is a guaranteed-empty run: `roadmapSource`
  // admits fast-track entries only, so `--size M` would drain nothing and exit 0, which
  // reads as a drained queue. Fast-track membership comes from `sizeToPath` — the size→path
  // policy's own answer — rather than a restated {XS, S} literal.
  if (sizes !== undefined && ![...sizes].some((s) => sizeToPath(s, false) === 'fast-track')) {
    throw new Error(
      `--size ${[...sizes].join(', ')} can never ship on --source roadmap, which drains ` +
        `fast-track entries only — include a fast-track size`,
    );
  }
  return {
    ...(sizes !== undefined ? { sizes } : {}),
    ...(only !== undefined ? { only } : {}),
  };
}

/** Parse the drain CLI flags. Throws on a non-positive integer flag, bad --source, or bad --size. */
export function parseArgs(args: readonly string[]): ParsedArgs {
  const maxFeatures = intFlag(args, '--max-features', 20);
  const maxRetries = intFlag(args, '--max-retries', 2);
  const source = parseSource(args);
  const selection = parseSelection(args, source);
  return {
    maxFeatures,
    maxRetries,
    maxSpawns: intFlag(args, '--max-spawns', maxFeatures * (maxRetries + 1)),
    timeoutMs: intFlag(args, '--iteration-timeout', 30 * 60 * 1000),
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    source,
    concurrency: intFlag(args, '--concurrency', 1),
    ...(selection !== undefined ? { selection } : {}),
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

/**
 * Throw when `--only` names a slug the run would not attempt. A slug that resolves to
 * nothing narrows the run to nothing and exits 0 having shipped nothing, which reads as a
 * drained queue — the false green this guard exists to prevent. Two ways to resolve to
 * nothing, so two checks:
 *
 * - **Not in the queue at all** (a typo). Compared against the unfiltered universe
 *   (`parseAll`), so an entry that is merely *ineligible* still resolves and reports its
 *   own reason through the skip log.
 * - **Parked.** `parseAll` still lists a parked slug (it is the success oracle: absence
 *   === shipped, and a parked entry has not shipped), so the universe check passes it
 *   while `nextItem` — reading the same park — never yields it. Resolving `--only` against
 *   {@link DrainSource.parkedSlugs}, the set the loop itself excludes, is what keeps
 *   validation and iteration from disagreeing. Pass a park-aware source or this half
 *   cannot fire: a source that omits `parkedSlugs` cannot answer, and admits.
 *
 * A parked slug is a hard error rather than a warning, and it fires even when other
 * `--only` slugs are drainable — same posture as the typo above. The operator named this
 * entry explicitly; the park has an explicit remedy (`unpark`), so silently dropping it
 * would be the one outcome with no signal attached.
 */
export function assertOnlyResolves(
  selection: SelectionFilter | undefined,
  source: DrainSource,
): void {
  const only = selection?.only;
  if (only === undefined) return;
  const universe = new Set(source.parseAll());
  const unknown = [...only].filter((s) => !universe.has(s));
  if (unknown.length > 0) {
    throw new Error(
      `--only names ${unknown.length} slug(s) not in the queue: ${unknown.join(', ')}`,
    );
  }
  const parked = source.parkedSlugs?.() ?? new Map<string, string>();
  const blocked = [...only].filter((s) => parked.has(s));
  if (blocked.length > 0) {
    const named = blocked.map((s) => `${s} (${parked.get(s) ?? 'unknown'})`).join(', ');
    throw new Error(
      `--only names ${blocked.length} parked slug(s): ${named}\n` +
        `a parked entry is never selected, so the run would ship nothing and exit 0 — ` +
        `unpark it first: noldor autonomous unpark ${blocked[0] ?? '<slug>'}`,
    );
  }
}

/** Build the matching {@link DrainSource}. `specs` throws (phase 2) → caller exits 1. */
function buildSource(id: SourceId, cwd: string, selection?: SelectionFilter): DrainSource {
  // `parseSelection` already rejected a narrowing on any non-roadmap source, so the other
  // two branches cannot silently drop one.
  if (id === 'roadmap') return roadmapSource(cwd, selection);
  if (id === 'plans') return plansSource(cwd);
  return specsSource(cwd); // throws — phase 2
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  let parsed: ParsedArgs;
  let source: DrainSource;
  let drainSource: DrainSource;
  try {
    parsed = parseArgs(args);
    assertConfig(loadConfigSync() ?? {});
    source = buildSource(parsed.source, cwd, parsed.selection); // --source specs throws here → exit 1
    // The park-aware view is what the loop consumes, so it is also what `--only` is
    // validated against — built here rather than after the reconcile below so validation
    // and iteration read one source. The wrapper is lazy (it calls `loadPark` per query),
    // so constructing it early costs nothing; a corrupt park file throws from the assert
    // and lands on the same exit-1 path as any other startup rejection.
    drainSource = parkAwareSource(source, () => loadPark(cwd));
    // `--size` is validated against an enum for the same reason `--only` needs the queue:
    // a value that matches nothing reads as an empty queue, and "drained cleanly, shipped
    // 0" is indistinguishable from success. Slugs can only be checked once a source exists.
    assertOnlyResolves(parsed.selection, drainSource);
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
    releaseLock(cwd, { startedAt });
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
    releaseLock(cwd, { startedAt });
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  // Uncommitted-triage guard: children branch from `origin/main`, so a block that exists
  // only in this working tree is invisible to them while the eligibility read above (the
  // local tree) selected it happily — the child then finds nothing to implement and burns a
  // whole agent run. `assertQueueSourceSynced` (in the reconcile above) counts commits, so
  // it catches an unpushed triage COMMIT but not an uncommitted edit; this closes that half.
  // Park-aware source, so a parked entry cannot trip it. Under --dry-run the finding is a
  // warning: nothing spawns, and aborting the preview would hide the very plan being previewed.
  const notOnOrigin = selectionNotAtRef(drainSource, 'origin/main', parsed.maxFeatures);
  if (notOnOrigin.length > 0) {
    const detail = formatNotAtRef(notOnOrigin, 'origin/main');
    if (parsed.dryRun) {
      // Warn, don't abort: nothing spawns under --dry-run, and aborting the preview would
      // hide the very plan being previewed. Under --json the warning goes to stderr — prose
      // ahead of the payload on stdout would break a `JSON.parse` of the run's output.
      const stream = parsed.json ? process.stderr : process.stdout;
      stream.write(`${detail}\n`);
    } else {
      releaseLock(cwd, { startedAt });
      process.stderr.write(`${detail}\n`);
      process.exit(1);
    }
  }
  // Attached runs tee child output into the shared watch log so the dashboard's
  // live drain pane works in every mode. The detached watch daemon already has
  // whole-process stdio redirected into the same file (watch-detach.ts) and
  // marks its children via NOLDOR_WATCH_DETACHED — skip the tee there or every
  // line would land twice.
  const logSink = process.env.NOLDOR_WATCH_DETACHED === '1' ? undefined : join(cwd, WATCH_LOG_REL);
  const deps: DrainDeps = {
    source: drainSource,
    spawnGate: (env, timeoutMs, prompt, onSpawn, slug) =>
      spawnGate(cwd, { ...env, NOLDOR_RUN_ID: runId }, timeoutMs, prompt, onSpawn, slug, logSink),
    syncMainCleanState: () => syncMainCleanState(cwd),
    mergePr: (slug, branch) => mergePr(cwd, slug, branch),
    openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
    mergedPrExistsFor: (slug, branch) => mergedPrExistsFor(cwd, slug, branch),
    branchHasUnshippedWork: (slug, branch) => branchHasUnshippedWorkAt(cwd, slug, branch),
    closedUnmergedPrExistsFor: makeClosedUnmergedPrProbe(cwd),
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
    releaseLock(cwd, { startedAt });
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
