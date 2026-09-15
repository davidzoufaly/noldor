import { execFileSync } from 'node:child_process';

/**
 * `rev^{tree}`, or `null` when git cannot answer — no repo, no such commit, no
 * git on PATH. The subprocess is the boundary this converts at (expected
 * failures do not throw past it); the caller disambiguates the two meanings by
 * resolving `HEAD` first.
 *
 * TREES, not commits, is what the CR pipeline binds to throughout: the review
 * receipt, the arbitration record's `boundTree`, and the sink-staleness check
 * all compare `HEAD^{tree}`, so a receipt amend or a `cr bootstrap` message
 * rewrite — both tree-preserving — leaves every one of them valid.
 *
 * Its own module rather than a private helper in either caller: the diff-scoped
 * clone gate flagged the second copy (`cr/aggregate.ts` against
 * `cr/arbitration-cli.ts`, 59 tokens), and importing the function out of
 * `aggregate.ts` would have pulled that module's whole transitive closure into a
 * CLI that needs six lines of it.
 */
export function treeOf(cwd: string, rev: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', `${rev}^{tree}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
