import { execFileSync } from 'node:child_process';

import { writeGardenReceipt } from '../garden/garden-receipt.js';
import { runGardenDetectViaCli } from '../garden/garden-detect-runner.js';

interface AutoStampOptions {
  cwd: string;
  /** Test seam — defaults to {@link runGardenDetectViaCli}. */
  runDetect?: typeof runGardenDetectViaCli;
  /** Test seam — defaults to {@link defaultStamp}. */
  stamp?: (opts: { cwd: string }) => void;
  /** Test seam — defaults to console.log. */
  log?: (msg: string) => void;
}

function defaultStamp({ cwd }: { cwd: string }): void {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  writeGardenReceipt({ headSha, timestamp: Math.floor(Date.now() / 1000) }, cwd);
}

/**
 * Release-start auto-restamp gate: runs `garden:detect` inline; if clean,
 * stamps the garden receipt at the current HEAD SHA. Eliminates the 3×
 * manual `/noldor-garden` re-stamp loop that plagued v0.5.0 — each follow-up PR
 * merge invalidated the SHA-anchored receipt, forcing operators to re-run
 * garden then re-stamp before the release script's {@link ensureGardenFresh}
 * gate would let them through.
 *
 * Failure modes:
 * - detect surfaces findings → skip stamp; downstream `ensureGardenFresh`
 *   surfaces the canonical stale-receipt error.
 * - detect subprocess error → skip stamp; same downstream fallback.
 * - stamp itself throws (disk full, perms) → log + continue; the release
 *   will fail loudly at `ensureGardenFresh` with a clear error message.
 */
export async function autoStampOnCleanDetect(opts: AutoStampOptions): Promise<void> {
  const runDetect = opts.runDetect ?? runGardenDetectViaCli;
  const stamp = opts.stamp ?? defaultStamp;
  const log = opts.log ?? console.log;

  const detect = await runDetect({ cwd: opts.cwd });
  if (detect.exitCode === 0 && detect.findings.length === 0) {
    try {
      stamp({ cwd: opts.cwd });
      log('Garden receipt auto-stamped at release start (detect clean).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Garden auto-stamp failed: ${msg}. Falling through to ensureGardenFresh gate.`);
    }
    return;
  }
  if (detect.exitCode !== 0) {
    log(
      `garden:detect exited ${detect.exitCode}; receipt NOT auto-stamped. ` +
        `Falling through to ensureGardenFresh gate.`,
    );
    return;
  }
  log(`garden:detect surfaced ${detect.findings.length} finding(s); receipt NOT auto-stamped.`);
}
