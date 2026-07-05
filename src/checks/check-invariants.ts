import { invariants as defaultInvariants, runInvariants } from '../invariants/index.js';

import type { Invariant, InvariantResult, InvariantViolation } from '../invariants/types.js';

/** A violation blocks the run unless it is explicitly `warn` severity. */
function isBlocking(v: InvariantViolation): boolean {
  return (v.severity ?? 'error') === 'error';
}

/** A violation is a non-blocking warning. */
function isWarning(v: InvariantViolation): boolean {
  return v.severity === 'warn';
}

/**
 * Aggregate result of running all invariants.
 */
export interface RunAllResult {
  readonly exitCode: 0 | 1;
  readonly results: readonly InvariantResult[];
  readonly failed: readonly InvariantResult[];
  readonly totalMs: number;
}

/** Rendered CLI output split by stream. */
export interface FormattedRunAllResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run every invariant in parallel and aggregate results.
 *
 * @param invs - Invariants to run. Defaults to the registry export.
 * @returns Aggregate result including exit code (1 if any blocking violation,
 *   0 otherwise — `warn`-severity violations surface but do not fail the run).
 *
 * @example
 * ```typescript
 * const result = await runAll();
 * if (result.exitCode !== 0) process.exit(1);
 * ```
 */
export async function runAll(
  invs: readonly Invariant[] = defaultInvariants,
): Promise<RunAllResult> {
  const start = Date.now();
  const results = await runInvariants(invs);
  const failed = results.filter((r) => r.violations.some(isBlocking));
  const totalMs = Date.now() - start;
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    failed,
    results,
    totalMs,
  };
}

/** Render one violation as an indented `<loc> — <message>` line. */
function formatViolationLine(v: InvariantViolation): string {
  const loc = v.file ? `${v.file}${v.line ? `:${v.line}` : ''} — ` : '';
  return `  ${loc}${v.message}`;
}

/** Build the ⚠ warning block for every non-blocking violation across results. */
function warningBlock(results: readonly InvariantResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    const warns = r.violations.filter(isWarning);
    if (warns.length === 0) {
      continue;
    }
    lines.push(`\n⚠ ${r.invariant} (${warns.length} warning${warns.length > 1 ? 's' : ''}):`);
    for (const v of warns) {
      lines.push(formatViolationLine(v));
    }
  }
  return lines;
}

/**
 * Format invariant results for CLI output.
 *
 * @param result - The aggregate result to format.
 * @returns Text destined for stdout/stderr. Warnings (non-blocking) surface on
 *   stderr but never suppress the ✓ pass line or flip the exit code.
 */
export function formatResults(result: RunAllResult): FormattedRunAllResult {
  const timingLines = result.results.map((r) => `  ${r.invariant}: ${r.durationMs}ms`);
  const timingBlock = timingLines.length > 0 ? `\nTimings:\n${timingLines.join('\n')}` : '';
  const warnLines = warningBlock(result.results);

  if (result.failed.length === 0) {
    return {
      stderr: warnLines.length > 0 ? `${warnLines.join('\n')}\n` : '',
      stdout: `✓ ${result.results.length} invariants passed (${result.totalMs}ms wall)${timingBlock}\n`,
    };
  }

  const lines: string[] = [];
  for (const r of result.failed) {
    const errs = r.violations.filter(isBlocking);
    lines.push(`\n✗ ${r.invariant} (${errs.length} violation${errs.length > 1 ? 's' : ''}):`);
    for (const v of errs) {
      lines.push(formatViolationLine(v));
    }
  }
  lines.push(...warnLines);
  lines.push(`${timingBlock}\nTotal: ${result.totalMs}ms wall`);
  return {
    stderr: `${lines.join('\n')}\n`,
    stdout: '',
  };
}

/**
 * Print the results of a `runAll` call to stdout/stderr.
 *
 * @param result - The aggregate result to print.
 */
function printResults(result: RunAllResult): void {
  const formatted = formatResults(result);
  if (formatted.stdout) {
    process.stdout.write(formatted.stdout);
  }
  if (formatted.stderr) {
    process.stderr.write(formatted.stderr);
  }
}

const invokedDirect = process.argv[1] && process.argv[1].endsWith('check-invariants.ts');
if (invokedDirect) {
  void runAll().then((r) => {
    printResults(r);
    process.exit(r.exitCode);
  });
}
