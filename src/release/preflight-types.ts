// Row contract for the release preflight aggregate.
//
// Lives in its own module because every other preflight file needs these types:
// `preflight.ts` (orchestration) imports the probes and the fixes, so if the
// probes imported their types back from `preflight.ts` that would be a module
// cycle — forbidden by the `no-module-cycles` boundary rule.

export type PreflightStatus = 'ok' | 'blocking' | 'warn' | 'skipped';

/**
 * Closed set — one id per probe. A union rather than `string` so a typo in a
 * `fixes` list or a render test is a type error, not a silently-missing row.
 */
export type PreflightRowId =
  | 'session-marker'
  | 'release-state'
  | 'branch'
  | 'tree-clean'
  | 'origin-sync'
  | 'gh-auth'
  | 'graph-freshness'
  | 'garden-receipt'
  | 'sdd-report'
  | 'validate-features'
  | 'gate-compliance'
  | 'cr-gate'
  | 'npm-name';

/**
 * One gate's verdict.
 *
 * `blocking` aborts a release. `warn` never does — it records something the
 * operator should see but that is not a reason to refuse (an unreachable npm
 * registry, a leftover release-automation marker). `skipped` records a check
 * that did not apply — feature untracked, override env set, publish disabled —
 * and carries the reason in `detail`, because a silently absent row reads as a
 * pass.
 */
export interface PreflightRow {
  id: PreflightRowId;
  status: PreflightStatus;
  /** What was observed. Always populated, including on `ok`. */
  detail: string;
  /** Copy-pasteable operator remedy. Present on every `blocking` and `warn` row. */
  fix?: string;
}

export interface PreflightInput {
  cwd: string;
  /** Consumer `scanPaths` — scopes the graph and garden freshness comparisons. */
  scanPaths: string[];
  /** Injected clock, for the session-marker TTL comparison. */
  nowMs: number;
  /**
   * `'canonical'` regenerates `docs/sdd-report.md` in place (the real release,
   * whose commit folds volatile-only drift in); `'temp'` regenerates to a temp
   * file outside the repo (`--preflight`, which must leave the tree untouched).
   */
  sddReportOut: 'canonical' | 'temp';
  /** Rows to auto-remediate, in application order. Empty = report-only. */
  fixes: readonly PreflightRowId[];
  /** Test seam — defaults to `console.log`. */
  log?: (msg: string) => void;
}
