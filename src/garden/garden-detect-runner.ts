import { spawnSync as nodeSpawnSync } from 'node:child_process';

import { noldorCliCommand } from '../core/noldor-cli.js';

/**
 * A single finding flagged by `garden detect`. The `kind` discriminates
 * which detector produced it (e.g. `stale-plan`, `sdd-gap`,
 * `contradiction`); remaining fields are pass-through from the source
 * detector and not interpreted here.
 */
export interface GardenDetectFinding {
  kind: string;
  [k: string]: unknown;
}

export interface GardenDetectRunResult {
  exitCode: number;
  findings: GardenDetectFinding[];
}

export interface GardenDetectRunOptions {
  cwd: string;
  /** Test seam — defaults to node's spawnSync. */
  spawnSync?: typeof nodeSpawnSync;
}

/**
 * Categories of `GardenFindings` (see `scripts/garden/garden-detect.ts`)
 * that count toward auto-restamp gating.
 *
 * Includes `overrideAudit` indirectly via the explicit severity check in
 * {@link runGardenDetectViaCli} (a `WARN` severity surfaces as a finding
 * even though the array-shaped categories are empty).
 */
const FINDING_CATEGORIES = [
  'stalePlans',
  'staleSpecs',
  'unusedBacklog',
  'contradictions',
  'sourceDrift',
  'sddGaps',
  'invariantViolations',
  'codexCrOverrideAudit',
  'tierMismatch',
  'allowlistDrift',
  'trailerScopeMismatch',
  'planWithoutFd',
  'fdWithoutPlan',
  'milestoneShippedIncomplete',
  'bootstrapOverrideAudit',
  'circularBlockedBy',
] as const;

interface ParsedGardenJson {
  overrideAudit?: { severity?: string };
  [category: string]: unknown;
}

/**
 * Extract the JSON object emitted by `noldor garden detect --json` from
 * stdout. The CLI may print banner/log lines before the JSON:
 *
 *     > noldor garden detect --json
 *     > tsx src/garden/garden-detect.ts "--json"
 *     {...JSON...}
 *
 * Scan stdout from the end and return the LAST line that starts with `{`.
 * Mirrors the same pattern used by `loadSddGaps` in
 * `src/garden/garden-detect.ts` for `noldor garden sdd-report --json`.
 */
function extractJsonLine(stdout: string): string | null {
  return (
    stdout
      .split('\n')
      .toReversed()
      .find((line) => line.trim().startsWith('{')) ?? null
  );
}

/**
 * Run `pnpm garden:detect --json` as a subprocess. Flattens the
 * categorical `GardenFindings` output into a single `findings` array,
 * each entry tagged with `kind: <category>`. Used by the release
 * script's auto-restamp gate (`src/release/index.ts`) to decide
 * whether to stamp the garden receipt at release start.
 *
 * `overrideAudit.severity === 'WARN'` (or `'CRITICAL'`) surfaces as a
 * synthetic finding `{ kind: 'overrideAudit', severity: '...' }` so
 * auto-restamp gates on the same notion of "clean" that the operator-
 * facing `/noldor-garden` skill uses — operator-acknowledged-but-unresolved
 * overrides should not silently stamp a release-ready receipt.
 *
 * Failure modes (non-zero exitCode + empty findings):
 * - subprocess error (ENOENT, status != 0)
 * - malformed JSON stdout (no `{`-prefixed line found, or `JSON.parse`
 *   throws); caller can't distinguish from "no findings", so we coerce
 *   exitCode != 0 to avoid silent auto-stamp.
 *
 * Both are safe — the caller treats any non-zero exitCode as "don't
 * auto-stamp", which falls through to the existing `ensureGardenFresh()`
 * gate to surface the receipt-stale error with its canonical message.
 */
export async function runGardenDetectViaCli(
  opts: GardenDetectRunOptions,
): Promise<GardenDetectRunResult> {
  const spawn = opts.spawnSync ?? nodeSpawnSync;
  const [cmd, cmdArgs] = noldorCliCommand(['garden', 'detect', '--json']);
  const r = spawn(cmd, cmdArgs, {
    cwd: opts.cwd,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    return { exitCode: r.status ?? -1, findings: [] };
  }
  const jsonLine = extractJsonLine((r.stdout as string) ?? '');
  if (!jsonLine) {
    return { exitCode: 1, findings: [] };
  }
  let parsed: ParsedGardenJson;
  try {
    parsed = JSON.parse(jsonLine) as ParsedGardenJson;
  } catch {
    return { exitCode: 1, findings: [] };
  }
  const findings: GardenDetectFinding[] = [];
  for (const category of FINDING_CATEGORIES) {
    const arr = parsed[category];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        findings.push({ kind: category, ...(entry as Record<string, unknown>) });
      }
    }
  }
  const overrideSeverity = parsed.overrideAudit?.severity;
  if (overrideSeverity === 'WARN' || overrideSeverity === 'CRITICAL') {
    findings.push({ kind: 'overrideAudit', severity: overrideSeverity });
  }
  return { exitCode: 0, findings };
}
