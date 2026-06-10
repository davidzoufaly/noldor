import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Real implementations of the {@link DrainDeps} IO adapters. These shell out to
 * `git` / `gh` / `claude`, so they carry no branching logic worth unit-testing —
 * the loop logic is tested against mocks in `run-drain.test.ts`, and these are
 * exercised by the manual integration run (FD Usage → Verification).
 */

/**
 * Checkout main, fetch, ff-only sync, prune stale worktree admin entries, drop
 * stale escalation context. Throws on an ff-only rejection (caller aborts the
 * drain — local main diverged, spec Error handling).
 *
 * IMPORTANT: this does **not** blanket-remove `.worktrees/*` or delete `fast/*`
 * branches — that would destroy unrelated human feature worktrees and ordinary
 * interactive fast-track branches the lock does not protect. `git worktree prune`
 * only drops admin entries for worktree dirs that are *already gone*; it never
 * deletes a live worktree. Per-slug cleanup of the drain's own `fast/<slug>`
 * branch + worktree is the gate Step 2 force-recreate's job (drain-mode), scoped
 * to the exact slug being shipped.
 */
export function syncMainCleanState(cwd: string): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  git(['checkout', 'main']);
  git(['fetch', 'origin', 'main']);
  git(['merge', '--ff-only', 'origin/main']); // throws on divergence → abort
  git(['worktree', 'prune']); // admin-only: drops entries for already-deleted dirs; never deletes a live worktree
  // Drop stale escalation context so a failed iteration's context can't bleed into the next.
  spawnSync('bash', ['-c', 'rm -f .noldor/cr/*-escalation-context.md 2>/dev/null || true'], {
    cwd,
    stdio: 'pipe',
  });
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
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') throw new Error('iteration-timeout'); // per-entry failure → retry/skip
    // Any other spawn error (e.g. ENOENT — `claude` not on PATH) is systemic, not a per-entry
    // failure: throw a non-timeout error so the loop aborts the whole drain instead of churning
    // retries across every entry.
    throw new Error(`spawn-failed: ${res.error.message}`);
  }
  return res.status ?? 1;
}
