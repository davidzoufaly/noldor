/**
 * `noldor clones report [--json] [--min-tokens N] [--min-lines N]
 *  [--gap-tokens N] [--include-tests]`
 * `noldor clones check` (same flags, plus `--against <ref>`) — exit 1 when a
 * clone group overlaps the lines this change wrote, or when
 * `clones.thresholdPct` (`.noldor/config.json`) is exceeded. The two verdicts
 * are independent; either one can turn the check red.
 *
 * Corpus = `scanRoots(cwd)` roots walked via `walkCodeFiles` (the shared
 * repo-paths policy). Flags override config, config overrides defaults.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultRunGit } from '../core/branch-added.js';
import type { RunGit } from '../core/branch-added.js';
import { runIfDirect } from '../core/cli-entry.js';
import { loadConfig } from '../core/config.js';
import { scanRoots, walkCodeFiles } from '../core/repo-paths.js';
import { DEFAULT_CLONE_OPTIONS, detectClones } from './detect.js';
import type { CloneOptions, CloneReport } from './detect.js';
import { flaggedGroups, resolveChangedRanges } from './diff-scope.js';

export interface ClonesArgs {
  sub: 'report' | 'check';
  json: boolean;
  includeTests: boolean;
  minTokens?: number;
  minLines?: number;
  gapTokens?: number;
  against?: string;
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
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} needs a positive integer`);
    return n;
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--json') args.json = true;
    else if (flag === '--include-tests') args.includeTests = true;
    else if (flag === '--min-tokens') args.minTokens = numeric(flag, rest[++i]);
    else if (flag === '--min-lines') args.minLines = numeric(flag, rest[++i]);
    else if (flag === '--gap-tokens') args.gapTokens = numeric(flag, rest[++i]);
    else if (flag === '--against') {
      const ref = rest[++i];
      if (ref === undefined || ref.length === 0) throw new UsageError('--against needs a ref');
      args.against = ref;
    } else throw new UsageError(`unknown flag: ${flag}`);
  }
  return args;
}

/**
 * True when `ref` resolves to a commit in this clone.
 *
 * The caller named this base, so it has to be usable; whether an unusable one is
 * a typo, a shallow clone, or a narrowed refspec is not decidable here and does
 * not change the remedy. `--end-of-options` so a ref starting with `-` reaches
 * git as a ref rather than an option.
 */
export function validateAgainstRef(ref: string, run: RunGit): boolean {
  return run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).status === 0;
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

const renderSpans = (groups: readonly CloneReport['groups'][number][]): string =>
  groups
    .map((g) => {
      const spans = g.instances.map((i) => `${i.file}:${i.startLine}-${i.endLine}`);
      return `  ${spans.join(' and ')} (${g.tokens} tokens)`;
    })
    .join('\n');

function renderSummary(report: CloneReport): string {
  const lines = [
    `clones: ${report.groups.length} group(s), ${report.duplicationPct.toFixed(2)}% duplicated tokens across ${report.filesScanned} file(s)`,
  ];
  const shown = renderSpans(report.groups.slice(0, 10));
  if (shown.length > 0) lines.push(shown);
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

  // Validate an explicit `--against` BEFORE the `diffScope` gate and before any
  // detection work: a ref the caller named must be usable even in a repo that
  // has diff-scoping switched off, or the flag is silently ignored. Exit 3 (not
  // 1) keeps "could not look" distinct from "found duplication".
  if (args.sub === 'check' && args.against !== undefined) {
    if (!validateAgainstRef(args.against, defaultRunGit(cwd))) {
      process.stderr.write(
        `clones check: --against '${args.against}' does not resolve to a commit\n` +
          `  check the ref name; in CI fetch with depth 0 and an unrestricted refspec\n`,
      );
      return 3;
    }
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

  // Two independent verdicts; either can turn the check red, and both always
  // report so the output says which gate spoke.
  const diffScopeRed = checkDiffScope(report, config?.clones?.diffScope, args.against, cwd);
  const thresholdRed = checkThreshold(report, config?.clones?.thresholdPct);
  return diffScopeRed || thresholdRed ? 1 : 0;
}

/**
 * Diff-scoped verdict: red when a clone group overlaps a line this change wrote.
 *
 * Needs no tuning, which is the whole point — an unset `thresholdPct` is
 * permanently green, whereas this asks a question with a size-independent
 * answer. Skipped (green, with the reason on stderr) when the consumer opted out
 * or when git cannot resolve a base; "unknown" is never printed as "clean".
 */
function checkDiffScope(
  report: CloneReport,
  diffScope: boolean | undefined,
  against: string | undefined,
  cwd: string,
): boolean {
  if (diffScope === false) {
    process.stdout.write('clones check: diff-scoping disabled (clones.diffScope) - skipped\n');
    return false;
  }
  const changed = resolveChangedRanges({ cwd, against });
  if (changed === null) {
    process.stderr.write(
      'clones check: no base to diff against (no upstream, no remote head, or no merge base) - skipped\n',
    );
    return false;
  }
  const flagged = flaggedGroups(report, changed);
  if (flagged.length === 0) {
    process.stdout.write('clones check: no clone group touches this change - green\n');
    return false;
  }
  // Uncapped, unlike `renderSummary`: a diff-scoped list is bounded by what the
  // author just wrote, and truncating it would hide a blocker the push must fix.
  process.stderr.write(
    `clones check: ${flagged.length} group(s) duplicated in this change\n${renderSpans(flagged)}\n`,
  );
  return true;
}

/** Whole-corpus verdict, unchanged: unset threshold is always green. */
function checkThreshold(report: CloneReport, threshold: number | undefined): boolean {
  if (threshold === undefined) {
    process.stdout.write('clones check: no clones.thresholdPct configured - green\n');
    return false;
  }
  if (report.duplicationPct <= threshold) {
    process.stdout.write(
      `clones check: ${report.duplicationPct.toFixed(2)}% <= ${threshold}% - green\n`,
    );
    return false;
  }
  process.stderr.write(
    `clones check: ${report.duplicationPct.toFixed(2)}% exceeds threshold ${threshold}%\n${renderSummary(report)}\n`,
  );
  return true;
}

runIfDirect('clones-cli', 'clones', runClones);
