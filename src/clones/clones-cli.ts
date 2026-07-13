/**
 * `noldor clones report [--json] [--min-tokens N] [--min-lines N]
 *  [--gap-tokens N] [--include-tests]`
 * `noldor clones check` (same flags) — exit 1 when `clones.thresholdPct`
 * (`.noldor/config.json`) is exceeded; unset threshold = always green.
 *
 * Corpus = `scanRoots(cwd)` roots walked via `walkCodeFiles` (the shared
 * repo-paths policy). Flags override config, config overrides defaults.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from '../core/config.js';
import { scanRoots, walkCodeFiles } from '../core/repo-paths.js';
import { DEFAULT_CLONE_OPTIONS, detectClones } from './detect.js';
import type { CloneOptions, CloneReport } from './detect.js';

export interface ClonesArgs {
  sub: 'report' | 'check';
  json: boolean;
  includeTests: boolean;
  minTokens?: number;
  minLines?: number;
  gapTokens?: number;
}

class UsageError extends Error {}

export function parseClonesArgs(argv: string[]): ClonesArgs {
  const [sub, ...rest] = argv;
  if (sub !== 'report' && sub !== 'check') {
    throw new UsageError('usage: noldor clones <report|check> [flags]');
  }
  const args: ClonesArgs = { sub, json: false, includeTests: false };
  const numeric = (flag: string, value: string | undefined): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} needs a positive number`);
    return n;
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--json') args.json = true;
    else if (flag === '--include-tests') args.includeTests = true;
    else if (flag === '--min-tokens') args.minTokens = numeric(flag, rest[++i]);
    else if (flag === '--min-lines') args.minLines = numeric(flag, rest[++i]);
    else if (flag === '--gap-tokens') args.gapTokens = numeric(flag, rest[++i]);
    else throw new UsageError(`unknown flag: ${flag}`);
  }
  return args;
}

/** Build the corpus map for `cwd` (repo-relative keys, deterministic order). */
export function loadCorpus(cwd: string, includeTests: boolean): Map<string, string> {
  const files = new Map<string, string>();
  for (const root of scanRoots(cwd)) {
    for (const abs of walkCodeFiles(join(cwd, root), { includeTests })) {
      try {
        files.set(abs.slice(cwd.length + 1), readFileSync(abs, 'utf8'));
      } catch {
        // unreadable file — skipped, consistent with detector conventions
      }
    }
  }
  return files;
}

function renderSummary(report: CloneReport): string {
  const lines = [
    `clones: ${report.groups.length} group(s), ${report.duplicationPct.toFixed(2)}% duplicated tokens across ${report.filesScanned} file(s)`,
  ];
  for (const g of report.groups.slice(0, 10)) {
    const [a, b] = g.instances;
    lines.push(
      `  ${a!.file}:${a!.startLine}-${a!.endLine} and ${b!.file}:${b!.startLine}-${b!.endLine} (${g.tokens} tokens)`,
    );
  }
  return lines.join('\n');
}

export async function runClones(argv: string[], cwd: string = process.cwd()): Promise<number> {
  let args: ClonesArgs;
  try {
    args = parseClonesArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }

  const config = await loadConfig(join(cwd, '.noldor/config.json')).catch(() => null);
  const opts: CloneOptions = {
    minTokens: args.minTokens ?? config?.clones?.minTokens ?? DEFAULT_CLONE_OPTIONS.minTokens,
    minLines: args.minLines ?? config?.clones?.minLines ?? DEFAULT_CLONE_OPTIONS.minLines,
    gapTokens: args.gapTokens ?? config?.clones?.gapTokens ?? DEFAULT_CLONE_OPTIONS.gapTokens,
  };
  const report = detectClones(loadCorpus(cwd, args.includeTests), opts);

  if (args.sub === 'report') {
    process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${renderSummary(report)}\n`);
    return 0;
  }

  const threshold = config?.clones?.thresholdPct;
  if (threshold === undefined) {
    process.stdout.write('clones check: no clones.thresholdPct configured - green\n');
    return 0;
  }
  if (report.duplicationPct <= threshold) {
    process.stdout.write(
      `clones check: ${report.duplicationPct.toFixed(2)}% <= ${threshold}% - green\n`,
    );
    return 0;
  }
  process.stderr.write(
    `clones check: ${report.duplicationPct.toFixed(2)}% exceeds threshold ${threshold}%\n${renderSummary(report)}\n`,
  );
  return 1;
}

const invokedDirect = /[\\/]clones-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  runClones(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      process.stderr.write(`clones: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(1);
    });
}
