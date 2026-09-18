import { execFileSync } from 'node:child_process';

import { isMicroChoreAllowed, microChoreOffenders } from '../../core/allowlist.js';
import {
  CONSUMER_CONFIG_PATH,
  retroactiveWaiversInCommit,
} from '../../core/config-waiver-guard.js';
import { parseTrailers } from '../../core/trailers.js';
import {
  gateComplianceRange,
  isGateComplianceExempt,
  loadGateComplianceScope,
} from './gate-compliance-scope.js';

export interface AllowlistDriftFinding {
  readonly sha: string;
  readonly subject: string;
  readonly offendingFiles: readonly string[];
  readonly reason: 'non-allowlisted-files' | 'retroactive-waiver';
  readonly action: 'investigate';
}

/**
 * Walk all commits that carry `Noldor-Path: micro-chore` and verify
 * that the touched files are covered by the micro-chore allowlist. Flags
 * any commit where non-allowlisted files escaped the hook.
 *
 * Commits below `release.gateComplianceSince` are outside the scan, and
 * commits acknowledged by `release.gateComplianceExemptCommits` are skipped.
 *
 * @param opts.cwd - Repository root.
 * @returns One AllowlistDriftFinding per flagged commit.
 */
export async function detectAllowlistDrift(opts: {
  cwd: string;
}): Promise<AllowlistDriftFinding[]> {
  const { cwd } = opts;
  const scope = await loadGateComplianceScope(cwd);
  const range = gateComplianceRange(cwd, scope.since);

  // Gather current-branch commits with Noldor-Path: micro-chore trailer.
  let raw: string;
  try {
    raw = execFileSync('git', ['log', '--pretty=%H%x00%s%x00%B%x1e', ...range], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }

  const findings: AllowlistDriftFinding[] = [];

  for (const block of raw.split('\x1e')) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Format: sha\x00subject\x00body
    const firstNull = trimmed.indexOf('\x00');
    if (firstNull === -1) continue;
    const secondNull = trimmed.indexOf('\x00', firstNull + 1);
    if (secondNull === -1) continue;

    const sha = trimmed.slice(0, firstNull).trim();
    if (isGateComplianceExempt(sha, scope.exemptions)) continue;
    const subject = trimmed.slice(firstNull + 1, secondNull).trim();
    const body = trimmed.slice(secondNull + 1);

    let trailers: Record<string, string>;
    try {
      trailers = parseTrailers(body);
    } catch {
      continue;
    }

    if (trailers['Noldor-Path'] !== 'micro-chore') continue;

    // Get the list of files changed in this commit
    let fileList: string;
    try {
      fileList = execFileSync('git', ['show', '--name-only', '--format=', sha], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      continue;
    }

    const files = fileList
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0) continue;

    if (!isMicroChoreAllowed(files)) {
      const offendingFiles = microChoreOffenders(files);
      findings.push({
        sha,
        subject,
        offendingFiles,
        reason: 'non-allowlisted-files',
        action: 'investigate',
      });
      continue;
    }

    // Glob-clean, but the consumer config's admission to this lane is
    // conditional: it may ride a no-review commit only while it leaves the
    // retroactive waiver keys alone. Both hooks enforcing that are
    // `--no-verify`-bypassable, so this is where a bypass surfaces — and
    // without it, putting the file on the glob list would have *reduced*
    // coverage, since every micro-chore commit touching it used to be flagged
    // by the branch above.
    if (files.includes(CONSUMER_CONFIG_PATH)) {
      const moved = retroactiveWaiversInCommit(cwd, sha);
      if (moved.length > 0) {
        findings.push({
          sha,
          subject,
          offendingFiles: [CONSUMER_CONFIG_PATH],
          reason: 'retroactive-waiver',
          action: 'investigate',
        });
      }
    }
  }

  return findings;
}
