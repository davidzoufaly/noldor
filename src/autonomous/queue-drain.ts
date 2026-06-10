import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync, type NoldorConfig } from '../cr/config.js';
import { getSuggestions, loadInProgressFds, loadMilestoneGate } from '../core/next-priority.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { parseRoadmap } from '../utils/parse-blocks.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState, type DrainState } from './drain-state.js';
import { syncMainCleanState, openPrExistsFor, spawnGate } from './drain-io.js';

export interface ParsedArgs {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
}

function intFlag(args: readonly string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
  return v;
}

/** Parse the queue-drain CLI flags. Throws on a non-positive integer flag. */
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
  };
}

/**
 * Assert the headless-safe config precondition set (spec D6). All three must
 * hold or the drain refuses to start — `prompt`/`spawn-deep-review` onFailure and
 * a lane-picker / PR-approval prompt would each hang a headless run.
 */
export function assertConfig(cfg: Partial<NoldorConfig>): void {
  const a = cfg.autonomous;
  if (!a) throw new Error('drain requires an `autonomous` block in .noldor/config.json');
  const bad: string[] = [];
  if (a.onFailure !== 'abort') bad.push('autonomous.onFailure must be "abort"');
  if (a.skipLanePicker !== true) bad.push('autonomous.skipLanePicker must be true');
  if (a.requireHumanPrApproval !== false)
    bad.push('autonomous.requireHumanPrApproval must be false');
  if (bad.length > 0)
    throw new Error(`drain config precondition unmet:\n  - ${bad.join('\n  - ')}`);
}

function main(): void {
  const args = process.argv.slice(2);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
    assertConfig(loadConfigSync() ?? {});
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const startedAt = new Date().toISOString();
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
  process.on('SIGINT', () => {
    stop = true;
  });

  const deps: DrainDeps = {
    nextPriority: (skip) =>
      getSuggestions(
        readFileSync(loadDocRoots(cwd).roadmap, 'utf8'),
        { inProgressFds: loadInProgressFds(cwd), milestoneGate: loadMilestoneGate(cwd) },
        skip,
      ),
    parseAll: () =>
      parseRoadmap(readFileSync(loadDocRoots(cwd).roadmap, 'utf8')).map((e) => e.slug),
    spawnGate: (env, timeoutMs) => spawnGate(cwd, env, timeoutMs),
    syncMainCleanState: () => syncMainCleanState(cwd),
    openPrExistsFor: (slug) => openPrExistsFor(cwd, slug),
    writeState: (s) => {
      const state: DrainState = {
        pid: process.pid,
        startedAt,
        phase: s.phase,
        currentSlug: s.currentSlug,
        shipped: s.shipped,
        skip: s.skip,
        retries: s.retries,
      };
      writeState(cwd, state);
    },
    stopRequested: () => stop || existsSync(join(cwd, '.noldor/drain-stop')),
  };

  let res: DrainResult;
  try {
    res = runDrain(deps, { ...parsed, cwd });
  } finally {
    releaseLock(cwd);
  }

  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(res)}\n`
      : `drain: shipped ${res.shipped}, skipped ${res.skipped.length} [${res.skipped.join(', ')}]\n`,
  );
  if (res.error !== undefined) process.stderr.write(`drain aborted: ${res.error}\n`);
  process.exit(res.exitCode);
}

// Match the entrypoint file exactly (queue-drain.ts/.js/.mjs) — NOT a test file
// such as queue-drain-cli.test.ts, which would otherwise run main() at import.
const invokedDirect = /[\\/]queue-drain\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
