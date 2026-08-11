import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Matches one `Noldor-Reviewed-Subagent: <tree>` line; capture 1 is the tree. */
const RECEIPT_LINE = /^Noldor-Reviewed-Subagent:[ \t]*(\S*)/i;

/**
 * Amend the tip commit with `Noldor-Reviewed-Subagent: <tree>` after a clean
 * code-stage subagent CR. Mirrors `scripts/cr/codex.ts`'s codex-trailer amend.
 * The pre-push hook accepts this trailer in lieu of legacy `Noldor-Reviewed`.
 *
 * The receipt is REPLACED, not appended: any existing receipt line is stripped
 * before the fresh one is added, so a commit that went through N CR rounds ends
 * up with exactly one receipt naming the current tree. Appending left every
 * prior round's receipt behind (each amend changes `HEAD^{tree}`), which is
 * noise at best and — for the whole-message scan in `release-cr-gate.ts` — a
 * stale pass at worst. `git interpret-trailers --if-exists replace` is not
 * enough here: it only drops the closest same-key trailer, so a commit that
 * already accumulated several would keep the rest.
 *
 * No-op when the message already carries exactly one receipt and it names the
 * current tree (idempotent re-runs). Uses an OS temp dir for the msg file so
 * worktrees (where `.git` is a file, not a directory) are supported.
 */
export function amendSubagentReceipt(opts: { cwd: string }): { amended: boolean; tree: string } {
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  }).trim();

  const msg = execFileSync('git', ['log', '-1', '--format=%B'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  });
  const lines = msg.split('\n');
  const existing = lines.filter((l) => RECEIPT_LINE.test(l));
  if (existing.length === 1 && RECEIPT_LINE.exec(existing[0])?.[1] === tree) {
    return { amended: false, tree };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'noldor-receipt-'));
  const msgFile = join(tmpDir, 'COMMIT_RECEIPT_MSG');
  writeFileSync(msgFile, lines.filter((l) => !RECEIPT_LINE.test(l)).join('\n'), 'utf8');
  execFileSync(
    'git',
    ['interpret-trailers', '--in-place', '--trailer', `Noldor-Reviewed-Subagent: ${tree}`, msgFile],
    { cwd: opts.cwd },
  );
  execFileSync('git', ['commit', '--amend', '-F', msgFile], { cwd: opts.cwd });
  return { amended: true, tree };
}
