import { execFileSync } from 'node:child_process';

const BLOCK_LIST: ReadonlyArray<string | RegExp> = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  '.claude/engineering-rules.md',
  'pnpm-lock.yaml',
  'package.json',
  /^\.claude\/skills\/[^/]+/,
  /^\.claude\/commands\/[^/]+/,
];

/** Evaluation result. */
export interface EvalResult {
  readonly blocked: readonly string[];
  readonly reason: 'ok' | 'override' | 'main' | 'block';
}

/**
 * Decide whether to block the commit.
 *
 * @param staged - File paths from `git diff --cached --name-only`.
 * @param repoRoot - Output of `git rev-parse --show-toplevel`.
 * @param env - Environment dictionary (typically `process.env`).
 * @returns An {@link EvalResult} describing whether the commit is blocked and why.
 */
export function evaluate(
  staged: readonly string[],
  repoRoot: string,
  env: Record<string, string | undefined>,
): EvalResult {
  if (!repoRoot.includes('/.worktrees/')) return { blocked: [], reason: 'main' };
  if (env.NOLDOR_ALLOW_SHARED === '1') return { blocked: [], reason: 'override' };

  const blocked = staged.filter((path) =>
    BLOCK_LIST.some((entry) => (typeof entry === 'string' ? entry === path : entry.test(path))),
  );
  return blocked.length > 0 ? { blocked, reason: 'block' } : { blocked: [], reason: 'ok' };
}

/**
 * Driver: collect git inputs, evaluate, exit 0 or 1 with a clear message.
 *
 * @returns Exit code — `0` means the commit may proceed, `1` means it is blocked.
 */
export function main(): number {
  let repoRoot = '';
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  } catch {
    return 0; // not in a git repo — let other hooks fail loudly
  }
  const stagedRaw = execFileSync('git', ['diff', '--cached', '--name-only'], {
    encoding: 'utf-8',
  });
  const staged = stagedRaw.split('\n').filter(Boolean);
  const result = evaluate(staged, repoRoot, process.env);

  if (result.reason === 'block') {
    process.stderr.write(
      `Shared root file(s) edited from feature worktree:\n  ${result.blocked.join('\n  ')}\n` +
        `Move these edits to the main worktree, or set NOLDOR_ALLOW_SHARED=1 to override.\n`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
