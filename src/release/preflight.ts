// Release preflight aggregate — evaluates every release STATE gate and reports
// all of them at once instead of aborting on the first.
//
// The ladder it replaces was a sequence of throwing guards in `./index.ts`, so
// an operator with four independent staleness problems discovered exactly one
// per full release re-run. Each gate is now a probe returning a
// {@link PreflightRow}; `pnpm release --preflight` renders every row, and the
// real release runs the SAME probe set as its first rung — one source of truth
// for the conditions, not two copies to drift apart.
//
// Consumer scripts (typecheck / test / build / docs:build) are deliberately NOT
// covered: running the suite twice doubles release wall-clock for no new signal,
// and a test red is already loud and locally reproducible. They stay in the
// pipeline after the aggregate, and the report names them as not run.
import { applyFix } from './preflight-fix.js';
import { ALL_ROW_IDS, makeProbeContext, runProbe } from './preflight-probes.js';
import type { PreflightInput, PreflightRow, PreflightRowId } from './preflight-types.js';

export type {
  PreflightInput,
  PreflightRow,
  PreflightRowId,
  PreflightStatus,
} from './preflight-types.js';

/**
 * Evaluate every gate and return one row per registered check.
 *
 * With `fixes` empty this is a single evaluation pass that mutates nothing.
 * With `fixes` non-empty it runs two passes:
 *
 * - **Pass 1 (fix)** — walks `fixes` in order, PER-ID AND SEQUENTIALLY:
 *   evaluate that one row, apply its remedy if it came back `blocking`, then
 *   move on. The sequencing is load-bearing, not stylistic — `origin-sync` is
 *   first in `SAFE_FIXES` because it is the only remedy that moves refs, and a
 *   `garden-receipt` that was fine before that fast-forward but stale after it
 *   is auto-restamped only because its evaluation happens after the merge.
 *   Evaluating everything up front and then applying would miss exactly that
 *   case. A duplicate id is harmless: the second visit re-evaluates and no-ops
 *   once the row is `ok`.
 * - **Pass 2 (report)** — re-evaluates EVERY row from scratch against the
 *   post-fix tree. Pass 2's rows are what gets returned.
 *
 * Re-probing only the fixed row would be wrong: a fast-forward can pull commits
 * that invalidate `graph-freshness`, `sdd-report`, `validate-features` and
 * `cr-gate`, and can bring new tags that change the previous-tag lookup, so a
 * row observed before the merge could be reported green when it no longer is.
 * Bounded at exactly two passes — there is no fix-then-re-probe loop.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightRow[]> {
  const log = input.log ?? ((m: string) => console.log(m));
  const base = {
    cwd: input.cwd,
    scanPaths: input.scanPaths,
    nowMs: input.nowMs,
    sddReportOut: input.sddReportOut,
  };

  if (input.fixes.length > 0) {
    // Pass 1. A fresh context per id: the memoized git lookups must not carry a
    // pre-merge tree state into the evaluation of a later id.
    for (const id of input.fixes) {
      const row = await runProbe(id, makeProbeContext(base));
      if (row.status !== 'blocking') continue;
      const applied = await applyFix(id, input.cwd, input.nowMs);
      if (applied !== null) log(`→ preflight --fix: ${applied}`);
    }
  }

  // Pass 2 — its own context, so every row is observed against the post-fix tree.
  const ctx = makeProbeContext(base);
  const rows: PreflightRow[] = [];
  for (const id of ALL_ROW_IDS) {
    rows.push(await runProbe(id, ctx));
  }
  return rows;
}

/** Ids of every blocking row, in report order. Empty array means green. */
export function blockingIds(rows: readonly PreflightRow[]): PreflightRowId[] {
  return rows.filter((r) => r.status === 'blocking').map((r) => r.id);
}
