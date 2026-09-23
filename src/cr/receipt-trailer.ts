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
 * `also` names trailer families kept in step with the receipt (Q-0261's
 * `Noldor-CR-Settled:`, Q-0262's `Noldor-CR-Refuted:`): every existing line of
 * each listed key is replaced by that key's `values`, in order, even when the
 * receipt value is unchanged, and the amend is still a no-op when all of them
 * already match. A key left out of `also` keeps its lines untouched.
 */
export function replaceReceiptTrailer(opts: {
  cwd: string;
  key: string;
  value: string;
  also?: readonly { key: string; values: readonly string[] }[];
}): {
  amended: boolean;
} {
  const line = new RegExp(`^${RegExp.escape(opts.key)}:[ \\t]*(\\S*)`, 'i');
  const families = (opts.also ?? []).map((a) => ({
    ...a,
    line: new RegExp(`^${RegExp.escape(a.key)}:[ \\t]*(.*)$`, 'i'),
    existing: [] as string[],
  }));

  const msg = execFileSync('git', ['log', '-1', '--format=%B'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  });

  const kept: string[] = [];
  const existing: string[] = [];
  for (const l of msg.split('\n')) {
    if (line.test(l)) {
      existing.push(l);
      continue;
    }
    const hit = families.map((f) => ({ f, m: f.line.exec(l) })).find((x) => x.m !== null);
    if (hit?.m) hit.f.existing.push(hit.m[1].trim());
    else kept.push(l);
  }
  const receiptCurrent = existing.length === 1 && line.exec(existing[0])?.[1] === opts.value;
  const alsoCurrent = families.every(
    (f) => f.existing.length === f.values.length && f.existing.every((v, i) => v === f.values[i]),
  );
  if (receiptCurrent && alsoCurrent) {
    return { amended: false };
  }

  const msgFile = join(mkdtempSync(join(tmpdir(), 'noldor-receipt-')), 'COMMIT_RECEIPT_MSG');
  writeFileSync(msgFile, kept.join('\n'), 'utf8');
  const trailers = [
    ...families.flatMap((f) => f.values.map((v) => `${f.key}: ${v}`)),
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
