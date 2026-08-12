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
 * Auto-restamp remedy: runs `garden:detect` inline; if clean, stamps the garden
 * receipt at the current HEAD SHA. Eliminates the 3× manual `/noldor-garden`
 * re-stamp loop that plagued v0.5.0 — each follow-up PR merge invalidated the
 * SHA-anchored receipt, forcing operators to re-run garden then re-stamp before
 * the release's garden gate would let them through.
 *
 * Now reached through the preflight aggregate's `garden-receipt` fix rather than
 * called directly by the pipeline: `pnpm release` passes `fixes:
 * ['garden-receipt']`, which is exactly the auto-restamp it always performed,
 * and `pnpm release --preflight --fix` opts into the same remedy. Reusing this
 * function keeps one definition of "safe to stamp".
 *
 * Failure modes — in every one the receipt is left alone, `false` is returned,
 * and the aggregate's `garden-receipt` row reports the canonical stale-receipt
 * reason:
 * - detect surfaces findings → skip stamp.
 * - detect subprocess error → skip stamp.
 * - stamp itself throws (disk full, perms) → log + continue.
 *
 * @returns `true` only when the receipt was actually written. Callers must use
 *   this rather than matching on log text: every failure line here contains the
 *   substring "auto-stamped" ("receipt NOT auto-stamped"), so a `includes()`
 *   check reads every failure as a success.
 */
export async function autoStampOnCleanDetect(opts: AutoStampOptions): Promise<boolean> {
  const runDetect = opts.runDetect ?? runGardenDetectViaCli;
  const stamp = opts.stamp ?? defaultStamp;
  const log = opts.log ?? console.log;

  const detect = await runDetect({ cwd: opts.cwd });
  if (detect.exitCode === 0 && detect.findings.length === 0) {
    try {
      stamp({ cwd: opts.cwd });
      log('Garden receipt auto-stamped at release start (detect clean).');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Garden auto-stamp failed: ${msg}. The garden-receipt row will surface it.`);
      return false;
    }
  }
  if (detect.exitCode !== 0) {
    log(
      `garden:detect exited ${detect.exitCode}; receipt NOT auto-stamped. ` +
        `The garden-receipt row will surface it.`,
    );
    return false;
  }
  log(`garden:detect surfaced ${detect.findings.length} finding(s); receipt NOT auto-stamped.`);
  return false;
}
