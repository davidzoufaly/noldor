/**
 * `noldor indirection report [--json]`
 *
 * Exit contract: 0 when the corpus was measured (or is legitimately empty), 3
 * when it could not be measured — no usable parser, or source files on disk
 * that produced no graph. `report` never fails on a verdict, only on being
 * unable to look, which keeps it usable as a diagnostic in exactly the states
 * where the gate added in part 2 is red.
 *
 * `check` and `baseline` land in part 2; the parser rejects them here rather
 * than accepting and ignoring them.
 */
import { runIfDirect } from '../core/cli-entry.js';
import { scanRoots } from '../core/repo-paths.js';
import { measureIndirection } from './detect.js';
import type { IndirectionResult } from './detect.js';

export interface IndirectionArgs {
  sub: 'report';
  json: boolean;
}

class UsageError extends Error {}

export function parseIndirectionArgs(argv: string[]): IndirectionArgs {
  const [sub, ...rest] = argv;
  if (sub !== 'report') {
    throw new UsageError('usage: noldor indirection report [--json]');
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

  process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${renderReport(result)}\n`);
  return 0;
}

runIfDirect('indirection-cli', 'indirection', runIndirection);
