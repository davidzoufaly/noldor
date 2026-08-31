/**
 * `noldor indirection <report|check|baseline> [--json]`
 *
 * Exit contract, per subcommand — 3 stays distinct from 1 for the reason
 * `clones-cli.ts` gives: a pre-push consumer acts on the difference between
 * "found something" and "could not look".
 *
 *               report   check   baseline
 *   clean         0        0        0
 *   red           0        1        0   (records, prints direction)
 *   no baseline   0        0        0
 *   stale         0        0        0   (overwrites)
 *   unreadable    0        3        0   (overwrites)
 *   empty corpus  0        0        0   (records a zero baseline)
 *   no parser     3        3        3
 *   unresolved    0        3        3
 *
 * `--json` is honoured on every outcome of all three subcommands, so automation
 * never has to parse the prose form.
 */
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { scanRoots } from '../core/repo-paths.js';
import {
  BASELINE_FILE,
  buildBaseline,
  buildEmptyBaseline,
  compareToBaseline,
  readBaseline,
  writeBaseline,
} from './baseline.js';
import type { BaselineOptions } from './baseline.js';
import { INDIRECTION_CLOSURE_THRESHOLD, measureIndirection } from './detect.js';
import type { IndirectionResult, MeasuredIndirection } from './detect.js';

export interface IndirectionArgs {
  sub: 'report' | 'check' | 'baseline';
  json: boolean;
}

class UsageError extends Error {}

export function parseIndirectionArgs(argv: string[]): IndirectionArgs {
  const [sub, ...rest] = argv;
  if (sub !== 'report' && sub !== 'check' && sub !== 'baseline') {
    throw new UsageError('usage: noldor indirection <report|check|baseline> [--json]');
  }
  const args: IndirectionArgs = { sub, json: false };
  for (const flag of rest) {
    if (flag === '--json') args.json = true;
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  return args;
}

export function renderReport(result: IndirectionResult): string {
  switch (result.kind) {
    case 'empty':
      return 'indirection: no source files under the scan roots';
    case 'no-parser':
    case 'unmeasurable':
      return `indirection: ${result.message}`;
    case 'measured': {
      const p = result.percentiles;
      const lines = [
        `indirection excess sum: ${result.excessSum} (threshold ${result.threshold}, ` +
          `${result.flagged.length} flagged of ${result.modules.length} modules)`,
        `  closure p50=${p.p50} p75=${p.p75} p90=${p.p90} p99=${p.p99} max=${p.max}`,
      ];
      for (const m of result.flagged) {
        lines.push(`  ${m.source}  closure=${m.closure} excess=${m.excess}`);
      }
      if (result.unresolvedInScope.length > 0) {
        lines.push(
          `  WARNING: ${result.unresolvedInScope.length} unresolved in-scope import(s) — ` +
            `the excess sum above is understated`,
        );
        for (const u of result.unresolvedInScope) lines.push(`  unresolved: ${u}`);
      }
      return lines.join('\n');
    }
  }
}

export async function runIndirection(argv: string[], cwd: string = process.cwd()): Promise<number> {
  let args: IndirectionArgs;
  try {
    args = parseIndirectionArgs(argv);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // `--json` may itself be the flag that parsed, so honour it when present in
    // the raw argv rather than reaching for args, which does not exist yet.
    process.stderr.write(
      argv.includes('--json')
        ? `${JSON.stringify({ verdict: 'could-not-look', reason: 'usage', message })}\n`
        : `${message}\n`,
    );
    return 3;
  }

  // `scanRoots` already returns roots relative to the repo root, which is what
  // `measureIndirection` wants — joining `cwd` onto them makes cruise resolve
  // `<baseDir>/<abs>` and fail with ENOENT.
  const result = await measureIndirection({ roots: scanRoots(cwd), cwd });

  if (result.kind === 'no-parser' || result.kind === 'unmeasurable') {
    // Rendered, not hand-formatted, so renderReport's failure branches are
    // reachable from a caller rather than dead code.
    process.stderr.write(
      args.json
        ? `${JSON.stringify({ verdict: 'could-not-look', reason: result.kind, message: result.message })}\n`
        : `${renderReport(result)}\n`,
    );
    return 3;
  }

  if (args.sub === 'report') {
    // An `empty` result carries no excessSum or percentiles of its own, but the
    // documented JSON shape does — filling them here keeps one payload contract
    // across both kinds instead of making every caller special-case emptiness.
    const payload =
      result.kind === 'empty'
        ? { ...result, excessSum: 0, modules: [], flagged: [], percentiles: null }
        : result;
    process.stdout.write(args.json ? `${JSON.stringify(payload)}\n` : `${renderReport(result)}\n`);
    return 0;
  }

  const options: BaselineOptions = {
    threshold: INDIRECTION_CLOSURE_THRESHOLD,
    scanRoots: scanRoots(cwd),
    includeTests: false,
  };
  const path = join(cwd, BASELINE_FILE);

  // An empty corpus is measured, not skipped: it has an excess sum of zero, and
  // a zero is a perfectly good thing to ratchet against. Treating it as a
  // special early exit is what let an unreadable baseline pass as green and hid
  // a fall to zero — so it flows through the same read/compare path below,
  // standing in as a measured result with no modules.
  const measured: MeasuredIndirection =
    result.kind === 'empty'
      ? {
          kind: 'measured',
          threshold: result.threshold,
          excessSum: 0,
          modules: [],
          flagged: [],
          percentiles: { p50: 0, p75: 0, p90: 0, p99: 0, max: 0 },
          unresolvedInScope: [],
        }
      : result;
  const corpusEmpty = result.kind === 'empty';

  // An incomplete graph must never be recorded as truth, nor compared as if it
  // were complete.
  if (measured.unresolvedInScope.length > 0) {
    process.stderr.write(
      args.json
        ? `${JSON.stringify({ verdict: 'could-not-look', reason: 'unresolved-imports', unresolvedInScope: measured.unresolvedInScope })}\n`
        : `indirection ${args.sub}: ${measured.unresolvedInScope.length} unresolved in-scope ` +
            `import(s) — the measured graph is incomplete\n` +
            measured.unresolvedInScope.map((u) => `  ${u}\n`).join(''),
    );
    return 3;
  }

  const prior = readBaseline(path);

  if (args.sub === 'baseline') {
    // Writes unconditionally: re-recording is the only repair for an unreadable
    // or stale file, so refusing here would deadlock. The sibling behaves the
    // same way — clones-cli reads the prior only for the drift line.
    const at = new Date().toISOString();
    const baseline = corpusEmpty
      ? buildEmptyBaseline(options, at)
      : buildBaseline(measured, options, at);
    writeBaseline(path, baseline);
    const drift =
      prior.kind === 'ok' && prior.baseline.excessSum !== baseline.excessSum
        ? ` (${baseline.excessSum > prior.baseline.excessSum ? 'RAISED' : 'lowered'} from ${prior.baseline.excessSum})`
        : '';
    process.stdout.write(
      args.json
        ? `${JSON.stringify(baseline)}\n`
        : `indirection baseline: recorded excess sum ${baseline.excessSum}${drift} ` +
            `across ${baseline.modulesScanned} module(s) -> ${BASELINE_FILE}\n`,
    );
    return 0;
  }

  if (prior.kind === 'absent') {
    const message =
      `no baseline recorded (excess sum ${measured.excessSum}) - ` +
      `record one with 'noldor indirection baseline'`;
    process.stdout.write(
      args.json
        ? `${JSON.stringify({ verdict: 'green', reason: 'no-baseline', excessSum: measured.excessSum, message })}\n`
        : `indirection check: ${message}\n`,
    );
    return 0;
  }
  if (prior.kind === 'unreadable') {
    const message = `baseline at ${BASELINE_FILE} is unreadable - ${prior.message}`;
    process.stderr.write(
      args.json
        ? `${JSON.stringify({ verdict: 'could-not-look', reason: 'unreadable-baseline', message })}\n`
        : `indirection check: ${message}\n  re-record with 'noldor indirection baseline'\n`,
    );
    return 3;
  }

  const verdict = compareToBaseline(measured, prior.baseline, options);
  const stream = verdict.kind === 'red' ? process.stderr : process.stdout;
  stream.write(
    args.json
      ? `${JSON.stringify({ verdict: verdict.kind, excessSum: measured.excessSum, baseline: prior.baseline.excessSum, message: verdict.message })}\n`
      : `indirection check: ${verdict.message}\n`,
  );
  return verdict.kind === 'red' ? 1 : 0;
}

runIfDirect('indirection-cli', 'indirection', runIndirection);
