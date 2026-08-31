/**
 * `noldor indirection <report|check|baseline> [--json]`
 *
 * Exit contract, per subcommand — 3 stays distinct from 1 for the reason
 * `clones-cli.ts` gives: a pre-push consumer acts on the difference between
 * "found something" and "could not look".
 *
 *              report   check   baseline
 *   clean        0        0        0
 *   red          0        1        0   (records, prints direction)
 *   no baseline  0        0        0
 *   stale        0        0        0   (overwrites)
 *   unreadable   0        3        0   (overwrites)
 *   no parser    3        3        3
 *   unresolved   0        3        3
 */
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { scanRoots } from '../core/repo-paths.js';
import {
  BASELINE_FILE,
  buildBaseline,
  compareToBaseline,
  readBaseline,
  writeBaseline,
} from './baseline.js';
import type { BaselineOptions } from './baseline.js';
import { INDIRECTION_CLOSURE_THRESHOLD, measureIndirection } from './detect.js';
import type { IndirectionResult } from './detect.js';

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
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }

  // `scanRoots` already returns roots relative to the repo root, which is what
  // `measureIndirection` wants — joining `cwd` onto them makes cruise resolve
  // `<baseDir>/<abs>` and fail with ENOENT.
  const result = await measureIndirection({ roots: scanRoots(cwd), cwd });

  if (result.kind === 'no-parser' || result.kind === 'unmeasurable') {
    // Rendered, not hand-formatted, so renderReport's failure branches are
    // reachable from a caller rather than dead code.
    process.stderr.write(`${renderReport(result)}\n`);
    return 3;
  }

  if (args.sub === 'report') {
    process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${renderReport(result)}\n`);
    return 0;
  }

  // An empty corpus has nothing to ratchet and nothing to record.
  if (result.kind === 'empty') {
    process.stdout.write('indirection: no source files under the scan roots\n');
    return 0;
  }

  // An incomplete graph must never be recorded as truth, nor compared as if it
  // were complete.
  if (result.unresolvedInScope.length > 0) {
    process.stderr.write(
      `indirection ${args.sub}: ${result.unresolvedInScope.length} unresolved in-scope ` +
        `import(s) — the measured graph is incomplete\n` +
        result.unresolvedInScope.map((u) => `  ${u}\n`).join(''),
    );
    return 3;
  }

  const options: BaselineOptions = {
    threshold: INDIRECTION_CLOSURE_THRESHOLD,
    scanRoots: scanRoots(cwd),
    includeTests: false,
  };
  const path = join(cwd, BASELINE_FILE);
  const prior = readBaseline(path);

  if (args.sub === 'baseline') {
    // Writes unconditionally: re-recording is the only repair for an unreadable
    // or stale file, so refusing here would deadlock. The sibling behaves the
    // same way — clones-cli reads the prior only for the drift line.
    const baseline = buildBaseline(result, options, new Date().toISOString());
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
    process.stdout.write(
      `indirection check: no baseline recorded (excess sum ${result.excessSum}) - ` +
        `record one with 'noldor indirection baseline'\n`,
    );
    return 0;
  }
  if (prior.kind === 'unreadable') {
    process.stderr.write(
      `indirection check: baseline at ${BASELINE_FILE} is unreadable - ${prior.message}\n` +
        `  re-record with 'noldor indirection baseline'\n`,
    );
    return 3;
  }

  const verdict = compareToBaseline(result, prior.baseline, options);
  const stream = verdict.kind === 'red' ? process.stderr : process.stdout;
  stream.write(`indirection check: ${verdict.message}\n`);
  return verdict.kind === 'red' ? 1 : 0;
}

runIfDirect('indirection-cli', 'indirection', runIndirection);
