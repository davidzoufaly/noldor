import { execFileSync } from 'node:child_process';

import { isMicroChoreAllowed } from '../../core/allowlist.js';
import { readRolloutMarker } from '../../core/rollout-marker.js';
import { parseTrailers } from '../../core/trailers.js';

export interface AllowlistDriftFinding {
  readonly sha: string;
  readonly subject: string;
  readonly offendingFiles: readonly string[];
  readonly reason: 'non-allowlisted-files';
  readonly action: 'investigate';
}

/**
 * Walk all commits that carry `Noldor-Path: micro-chore` and verify
 * that the touched files are covered by the micro-chore allowlist. Flags
 * any commit where non-allowlisted files escaped the hook.
 *
 * @param opts.cwd - Repository root.
 * @returns One AllowlistDriftFinding per flagged commit.
 */
export async function detectAllowlistDrift(opts: {
  cwd: string;
}): Promise<AllowlistDriftFinding[]> {
  const { cwd } = opts;
  const marker = readRolloutMarker(cwd);
  const range = marker ? [`${marker}..HEAD`] : ['HEAD'];

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
      const offendingFiles = files.filter((f) => !isMicroChoreAllowed([f]));
      findings.push({
        sha,
        subject,
        offendingFiles,
        reason: 'non-allowlisted-files',
        action: 'investigate',
      });
    }
  }

  return findings;
}
