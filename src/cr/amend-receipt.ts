import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Amend the tip commit with `Noldor-Reviewed-Subagent: <tree>` after a clean
 * code-stage subagent CR. Mirrors `scripts/cr/codex.ts`'s codex-trailer amend.
 * The pre-push hook accepts this trailer in lieu of legacy `Noldor-Reviewed`.
 *
 * No-op when the trailer is already present (idempotent re-runs). Uses an
 * OS temp dir for the msg file so worktrees (where `.git` is a file, not a
 * directory) are supported.
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
  if (new RegExp(`^Noldor-Reviewed-Subagent:[ \\t]*${tree}\\b`, 'm').test(msg)) {
    return { amended: false, tree };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'noldor-receipt-'));
  const msgFile = join(tmpDir, 'COMMIT_RECEIPT_MSG');
  writeFileSync(msgFile, msg, 'utf8');
  execFileSync(
    'git',
    ['interpret-trailers', '--in-place', '--trailer', `Noldor-Reviewed-Subagent: ${tree}`, msgFile],
    { cwd: opts.cwd },
  );
  execFileSync('git', ['commit', '--amend', '-F', msgFile], { cwd: opts.cwd });
  return { amended: true, tree };
}
