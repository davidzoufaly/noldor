import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Real implementations of the {@link DrainDeps} IO adapters. These shell out to
 * `git` / `gh` / `claude`, so they carry no branching logic worth unit-testing —
 * the loop logic is tested against mocks in `run-drain.test.ts`, and these are
 * exercised by the manual integration run (FD Usage → Verification).
 */

/**
 * Checkout main, fetch, ff-only sync, prune leftover worktrees + `fast/*`
 * branches, drop stale escalation context. Throws on an ff-only rejection
 * (caller aborts the drain — local main diverged, spec Error handling).
 */
export function syncMainCleanState(cwd: string): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  git(['checkout', 'main']);
  git(['fetch', 'origin', 'main']);
  git(['merge', '--ff-only', 'origin/main']); // throws on divergence → abort
  git(['worktree', 'prune']);
  // Best-effort: remove leftover .worktrees/* + their fast/* branches; rm stale escalation context.
  spawnSync(
    'bash',
    [
      '-lc',
      'for d in .worktrees/*; do [ -d "$d" ] && git worktree remove --force "$d" 2>/dev/null || true; done; ' +
        'for b in $(git branch --list "fast/*" --format "%(refname:short)"); do git branch -D "$b" 2>/dev/null || true; done; ' +
        'rm -f .noldor/cr/*-escalation-context.md 2>/dev/null || true',
    ],
    { cwd, stdio: 'pipe' },
  );
}

/**
 * True when an OPEN PR exists for the deterministic drain branch `fast/<slug>`.
 * Throws on a `gh` failure — the caller treats that as a fail-closed abort (spec):
 * treating an error as "no PR" would re-spawn a duplicate.
 */
export function openPrExistsFor(cwd: string, slug: string): boolean {
  const out = execFileSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--head', `fast/${slug}`, '--json', 'number'],
    { cwd, encoding: 'utf8' },
  );
  return (JSON.parse(out) as unknown[]).length > 0;
}

/**
 * Spawn a headless gate run. Returns the child exit code; throws
 * `iteration-timeout` when the child exceeds `timeoutMs` (caller kills + treats
 * as failure). `--disallowed-tools AskUserQuestion` is the code-level prompt
 * kill-switch (a forgotten prose branch fails fast instead of hanging);
 * `--permission-mode bypassPermissions` lets git/gh/pnpm/Edit run unattended.
 * Flags confirmed against `claude --help` during the spike (Task 11).
 */
export function spawnGate(cwd: string, env: Record<string, string>, timeoutMs: number): number {
  const res = spawnSync(
    'claude',
    [
      '--print',
      '/gate',
      '--disallowed-tools',
      'AskUserQuestion',
      '--permission-mode',
      'bypassPermissions',
    ],
    {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    },
  );
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    throw new Error('iteration-timeout');
  }
  return res.status ?? 1;
}
