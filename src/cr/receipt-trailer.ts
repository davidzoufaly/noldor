import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Rewrite the tip commit message so it carries exactly one `<key>: <value>`
 * trailer, replacing any receipt already there.
 *
 * Every CR round amends the tip and so changes `HEAD^{tree}`. Adding the
 * receipt with a bare `git interpret-trailers --trailer` appended, leaving a
 * commit that went through N rounds with N receipts, all but the last naming a
 * tree the commit no longer has. The pre-push hook compares against the tree,
 * so the stale lines are noise there; `release-cr-gate.ts` scans the whole
 * message for any receipt-shaped line, where a stale one reads as review
 * evidence. `--if-exists replace` does not fix it either: it deletes only the
 * closest same-key trailer, so an already-accumulated stack keeps the rest.
 *
 * No-op when the message already carries exactly one such trailer naming
 * `value` (idempotent re-runs) — a fresh receipt sitting next to stale ones is
 * still rewritten. Uses an OS temp dir for the msg file so worktrees (where
 * `.git` is a file, not a directory) are supported.
 *
 * `key` is a literal git trailer token (letters and hyphens, as in
 * `Noldor-Reviewed-Subagent`); it is matched case-insensitively, like git's own
 * trailer-token matching.
 */
export function replaceReceiptTrailer(opts: { cwd: string; key: string; value: string }): {
  amended: boolean;
} {
  const line = new RegExp(`^${opts.key}:[ \\t]*(\\S*)`, 'i');

  const msg = execFileSync('git', ['log', '-1', '--format=%B'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  });

  const kept: string[] = [];
  const existing: string[] = [];
  for (const l of msg.split('\n')) (line.test(l) ? existing : kept).push(l);
  if (existing.length === 1 && line.exec(existing[0])?.[1] === opts.value) {
    return { amended: false };
  }

  const msgFile = join(mkdtempSync(join(tmpdir(), 'noldor-receipt-')), 'COMMIT_RECEIPT_MSG');
  writeFileSync(msgFile, kept.join('\n'), 'utf8');
  execFileSync(
    'git',
    ['interpret-trailers', '--in-place', '--trailer', `${opts.key}: ${opts.value}`, msgFile],
    { cwd: opts.cwd },
  );
  execFileSync('git', ['commit', '--amend', '-F', msgFile], { cwd: opts.cwd });
  return { amended: true };
}
