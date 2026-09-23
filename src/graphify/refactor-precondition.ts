/**
 * Precondition for the `/noldor-release-sweep` refactor pass: is the graph shape
 * any different from the one the last release shipped with?
 *
 * The refactor pass reads god nodes and community cohesion off `GRAPH_REPORT.md`.
 * When neither moved since the last tagged report, the pass re-reads the same
 * deliberate single-source-of-truth utilities and proposes nothing — seven
 * releases running before this check existed. So the sweep asks here first.
 *
 * Compared: the god-node NAME set (edge counts grow with the corpus every
 * release, so they are not a signal) and the lowest community cohesion.
 * Only a cohesion DROP counts — a rise is the codebase getting tidier, which
 * is nothing to refactor.
 *
 * Exit 0 = run the refactor pass, 10 = skip it, 2 = cannot read the current
 * report. The sweep treats every exit other than 10 as "run", so a broken
 * check falls back to the old always-run behaviour.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { readValueFlags, runIfDirect } from '../core/cli-entry.js';

/** The two numbers-and-names the refactor pass keys on. */
export interface ReportShape {
  readonly godNodes: readonly string[];
  readonly minCohesion: number;
}

export type Decision = { run: boolean; reason: string };

const REPORT = 'graphify-out/GRAPH_REPORT.md';

/**
 * Read god nodes and the lowest cohesion out of a `GRAPH_REPORT.md`. `null`
 * when either section is missing — a report graphify never finished, or a
 * format this parser does not know.
 */
export function parseReportShape(md: string): ReportShape | null {
  const section = /^## God Nodes[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1] ?? '';
  const godNodes = [...section.matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((m) => m[1]!);
  const cohesions = [...md.matchAll(/^Cohesion:\s*([\d.]+)\s*$/gm)].map((m) => Number(m[1]));
  if (godNodes.length === 0 || cohesions.length === 0) return null;
  return { godNodes, minCohesion: Math.min(...cohesions) };
}

/** Compare the current report against the last release's. */
export function decideRefactor(current: ReportShape, baseline: ReportShape | null): Decision {
  if (baseline === null) {
    return { run: true, reason: 'no readable baseline report at the last tag' };
  }
  const before = new Set(baseline.godNodes);
  const after = new Set(current.godNodes);
  const added = current.godNodes.filter((n) => !before.has(n));
  const removed = baseline.godNodes.filter((n) => !after.has(n));
  if (added.length > 0 || removed.length > 0) {
    const parts = [
      added.length > 0 ? `+${added.join(', +')}` : '',
      removed.length > 0 ? `-${removed.join(', -')}` : '',
    ].filter(Boolean);
    return { run: true, reason: `god-node set changed: ${parts.join('; ')}` };
  }
  // Cohesion is printed to two decimals and community detection is not quite
  // stable run to run, so a 0.01 wobble is noise. Compared in hundredths:
  // `0.06 - 0.04` is 0.01999… in floating point.
  const dropHundredths = Math.round((baseline.minCohesion - current.minCohesion) * 100);
  if (dropHundredths >= 2) {
    return {
      run: true,
      reason: `lowest cohesion fell ${baseline.minCohesion} → ${current.minCohesion}`,
    };
  }
  return {
    run: false,
    reason: `god-node set and lowest cohesion (${current.minCohesion}) unchanged since the last tag`,
  };
}

/** `git <args>` stdout, or `null` when git refuses (no tag, path absent at that ref) or hangs. */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    // An absent tag or path is an expected answer here, not a failure: the
    // caller turns `null` into "no baseline", which runs the refactor pass.
    return null;
  }
}

export async function main(argv: string[]): Promise<number> {
  const label = 'refactor-precondition';
  const flags = readValueFlags(argv, ['--report', '--since'], label);
  if (!flags.ok) {
    process.stderr.write(`${flags.error}\n`);
    return 2;
  }
  const reportPath = flags.values.get('--report') ?? REPORT;
  let currentMd: string;
  try {
    currentMd = readFileSync(reportPath, 'utf8');
  } catch (err) {
    process.stderr.write(`${label}: cannot read ${reportPath}: ${(err as Error).message}\n`);
    return 2;
  }
  const current = parseReportShape(currentMd);
  if (current === null) {
    process.stderr.write(`${label}: ${reportPath} has no God Nodes or Cohesion lines\n`);
    return 2;
  }
  const since = flags.values.get('--since') ?? git(['describe', '--tags', '--abbrev=0'])?.trim();
  const baselineMd = since ? git(['show', `${since}:${reportPath}`]) : null;
  const decision = decideRefactor(
    current,
    baselineMd === null ? null : parseReportShape(baselineMd),
  );
  process.stdout.write(`verdict: ${decision.run ? 'run' : 'skip'}\n`);
  process.stdout.write(`baseline: ${since ?? '(no tag)'}\n`);
  process.stdout.write(`${decision.reason}\n`);
  return decision.run ? 0 : 10;
}

runIfDirect('refactor-precondition', 'refactor-precondition', main);
