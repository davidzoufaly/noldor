import { invariants as defaultInvariants, runInvariants } from '../invariants/index.js';

import type { Invariant, InvariantResult } from '../invariants/types.js';

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
 * @returns Aggregate result including exit code (1 if any violation, 0 otherwise).
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
  const failed = results.filter((r) => r.violations.length > 0);
  const totalMs = Date.now() - start;
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    failed,
    results,
    totalMs,
  };
}

/**
 * Format invariant results for CLI output.
 *
 * @param result - The aggregate result to format.
 * @returns Text destined for stdout/stderr.
 */
export function formatResults(result: RunAllResult): FormattedRunAllResult {
  const timingLines = result.results.map((r) => `  ${r.invariant}: ${r.durationMs}ms`);
  const timingBlock = timingLines.length > 0 ? `\nTimings:\n${timingLines.join('\n')}` : '';

  if (result.failed.length === 0) {
    return {
      stderr: '',
      stdout: `✓ ${result.results.length} invariants passed (${result.totalMs}ms wall)${timingBlock}\n`,
    };
  }

  const lines: string[] = [];
  for (const r of result.failed) {
    const count = r.violations.length;
    lines.push(`\n✗ ${r.invariant} (${count} violation${count > 1 ? 's' : ''}):`);
    for (const v of r.violations) {
      const loc = v.file ? `${v.file}${v.line ? `:${v.line}` : ''} — ` : '';
      lines.push(`  ${loc}${v.message}`);
    }
  }
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
