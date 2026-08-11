import { execFileSync } from 'node:child_process';
import { replaceReceiptTrailer } from './receipt-trailer.js';

/**
 * Amend the tip commit with `Noldor-Reviewed-Subagent: <tree>` after a clean
 * code-stage subagent CR. Twin of the `Noldor-Reviewed-Codex` amend in
 * `src/cr/codex.ts`; both go through {@link replaceReceiptTrailer}, so the
 * receipt is replaced rather than appended and each commit ends up with exactly
 * one. The pre-push hook accepts this trailer in lieu of legacy
 * `Noldor-Reviewed`.
 */
export function amendSubagentReceipt(opts: { cwd: string }): { amended: boolean; tree: string } {
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: opts.cwd,
    encoding: 'utf8',
  }).trim();

  const { amended } = replaceReceiptTrailer({
    cwd: opts.cwd,
    key: 'Noldor-Reviewed-Subagent',
    value: tree,
  });
  return { amended, tree };
}
