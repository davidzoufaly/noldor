import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { loadConfig, type CrGateExemption } from '../../core/config.js';
import { readRolloutMarker } from '../../core/rollout-marker.js';

/**
 * The committed decisions a consumer can record about the gate-compliance
 * audit: a floor below which commits are not judged, and per-SHA
 * acknowledgments for the ones above it that still cannot be fixed.
 */
export interface GateComplianceScope {
  /** `release.gateComplianceSince` — a commit-SHA prefix, or null when unset. */
  readonly since: string | null;
  /** `release.gateComplianceExemptCommits` — empty when unset. */
  readonly exemptions: readonly CrGateExemption[];
}

/** No floor, nothing exempt — the pre-config behaviour. */
export const EMPTY_GATE_COMPLIANCE_SCOPE: GateComplianceScope = { since: null, exemptions: [] };

/**
 * Read the `release.gateCompliance*` knobs from `<cwd>/.noldor/config.json`.
 *
 * Fail-open, mirroring `loadOverrideAuditOptions`: a missing or malformed
 * config yields {@link EMPTY_GATE_COMPLIANCE_SCOPE} so a config typo reports
 * every finding rather than crashing `/noldor-garden` or the release probe.
 *
 * @param cwd - Repository root.
 * @returns The configured floor and exemptions.
 */
export async function loadGateComplianceScope(cwd: string): Promise<GateComplianceScope> {
  try {
    const config = await loadConfig(join(cwd, '.noldor', 'config.json'));
    return {
      since: config?.release?.gateComplianceSince ?? null,
      exemptions: config?.release?.gateComplianceExemptCommits ?? [],
    };
  } catch {
    return EMPTY_GATE_COMPLIANCE_SCOPE;
  }
}

/** True when `rev` names a commit that exists in this repo. */
function resolvesToCommit(cwd: string, rev: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    cwd,
    stdio: 'ignore',
  });
  return r.status === 0;
}

/**
 * The `git log` revision arguments a gate-compliance detector should scan.
 *
 * `release.gateComplianceSince` wins over `.noldor/rollout-marker` when set —
 * the marker is stamped once at `noldor init` and answers "when did this repo
 * adopt Noldor", while the floor answers "when did it adopt *this rule*", which
 * is always the later of the two for a rule the consumer took on afterwards.
 *
 * A floor that does not resolve to a commit is DISCARDED, with a warning, and
 * the marker range stands. The schema only shape-checks the SHA, so a
 * one-character typo yields a hex-shaped rev that git rejects — and every
 * caller wraps its `git log` in a `catch { return []; }`, which would turn that
 * typo into a permanently green gate. Silently disabling the audit is a worse
 * failure than re-reporting the noise the floor was meant to remove: the noise
 * is visible, and `RELEASE_SKIP_GATE_COMPLIANCE` at least logs itself.
 *
 * @param cwd - Repository root.
 * @param since - The configured floor, or null to fall back to the marker.
 * @returns Revision args for `git log` — `<floor>..HEAD`, or `HEAD` when neither is set.
 */
export function gateComplianceRange(cwd: string, since: string | null): string[] {
  let floor = since;
  if (floor !== null && !resolvesToCommit(cwd, floor)) {
    process.stderr.write(
      `gate-compliance: release.gateComplianceSince '${floor}' does not resolve to a commit — ` +
        `ignoring the floor and auditing the full range.\n`,
    );
    floor = null;
  }
  floor ??= readRolloutMarker(cwd);
  return floor ? [`${floor}..HEAD`] : ['HEAD'];
}

/**
 * True when `sha` is acknowledged by a configured exemption.
 *
 * Prefix match, as `checkCrGate` does it: the config records a short prefix and
 * the scan holds the full SHA. Nothing is reported for an exempt commit — the
 * committed config diff is the audit trail, and re-reporting an acknowledged
 * finding is the noise the exemption was recorded to remove.
 *
 * @param sha - Full commit SHA from the scan.
 * @param exemptions - Configured acknowledgments.
 * @returns Whether the commit should be skipped.
 */
export function isGateComplianceExempt(
  sha: string,
  exemptions: readonly CrGateExemption[],
): boolean {
  return exemptions.some((e) => sha.startsWith(e.sha));
}
