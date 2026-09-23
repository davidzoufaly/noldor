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
 *
 * `also` names trailers kept in step with the receipt (Q-0261's
 * `Noldor-CR-Settled:`): every existing `also.key` line is replaced by
 * `also.values`, in order, even when the receipt value is unchanged, and the
 * amend is still a no-op when both already match. Without `also`, such lines are
 * left alone.
 */
export function replaceReceiptTrailer(opts: {
  cwd: string;
  key: string;
  value: string;
  also?: { key: string; values: readonly string[] };
}): {
  amended: boolean;
} {
  const line = new RegExp(`^${RegExp.escape(opts.key)}:[ \\t]*(\\S*)`, 'i');
  const alsoLine =
    opts.also === undefined
      ? null
      : new RegExp(`^${RegExp.escape(opts.also.key)}:[ \\t]*(.*)$`, 'i');

  const msg = execFileSync('git', ['log', '-1', '--format=%B'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  });

  const kept: string[] = [];
  const existing: string[] = [];
  const existingAlso: string[] = [];
  for (const l of msg.split('\n')) {
    const also = alsoLine?.exec(l);
    if (line.test(l)) existing.push(l);
    else if (also) existingAlso.push(also[1].trim());
    else kept.push(l);
  }
  const receiptCurrent = existing.length === 1 && line.exec(existing[0])?.[1] === opts.value;
  const alsoCurrent =
    opts.also === undefined ||
    (existingAlso.length === opts.also.values.length &&
      existingAlso.every((v, i) => v === opts.also?.values[i]));
  if (receiptCurrent && alsoCurrent) {
    return { amended: false };
  }

  const msgFile = join(mkdtempSync(join(tmpdir(), 'noldor-receipt-')), 'COMMIT_RECEIPT_MSG');
  writeFileSync(msgFile, kept.join('\n'), 'utf8');
  const trailers = [
    ...(opts.also?.values ?? []).map((v) => `${opts.also?.key}: ${v}`),
    `${opts.key}: ${opts.value}`,
  ].flatMap((t) => ['--trailer', t]);
  // `--if-exists add`: two rulings may share a trailer text, and git's default drops a
  // trailer identical to its neighbour. Every line the key owned was stripped above.
  execFileSync(
    'git',
    ['interpret-trailers', '--in-place', '--if-exists', 'add', ...trailers, msgFile],
    { cwd: opts.cwd },
  );
  execFileSync('git', ['commit', '--amend', '-F', msgFile], { cwd: opts.cwd });
  return { amended: true };
}
