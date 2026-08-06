/**
 * `noldor fmt [--check] [oxfmt-args...] [files...]` — run oxfmt with the
 * all-ignored no-op guard.
 *
 * Forwards every argv to the repo/consumer-local oxfmt and applies
 * {@link decideFmtGuard}: a "no target files" failure becomes exit 0 (nothing
 * to format), while real format failures propagate unchanged. Replaces the
 * inline bash guard in `lefthook/noldor.yml`, so every fmt invocation — the
 * pre-commit hook, `pnpm fmt`, the release flow — shares one guard.
 *
 * oxfmt is resolved from the *invocation* cwd's `node_modules/.bin` (it is a
 * devDependency of the framework, not a runtime dep — a consumer runs its own),
 * falling back to `oxfmt` on `PATH`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  decideFmtGuard,
  LEFTHOOK_UNSTAGED_PATCH,
  PARTIAL_STAGING_WARNING,
  shouldWarnPartialStaging,
  type FmtRunResult,
} from './fmt-guard.js';

/** Resolve the cwd-local oxfmt binary, falling back to `oxfmt` on PATH. */
export function resolveOxfmt(cwd: string): string {
  const local = join(cwd, 'node_modules', '.bin', 'oxfmt');
  return existsSync(local) ? local : 'oxfmt';
}

/** Runs oxfmt with `argv` and returns its raw result. Injectable for tests. */
export type FmtRunner = (argv: string[]) => FmtRunResult;

const defaultRunner: FmtRunner = (argv) => {
  const r = spawnSync(resolveOxfmt(process.cwd()), argv, { encoding: 'utf8' });
  if (r.error) {
    // Spawn failure (e.g. ENOENT: oxfmt not installed). Surface as a hard
    // failure — never a swallow — so a missing formatter can't pass silently.
    return {
      status: r.status ?? 1,
      stdout: r.stdout ?? '',
      stderr: `${r.stderr ?? ''}oxfmt: ${r.error.message}\n`,
    };
  }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/**
 * True when lefthook's saved unstaged patch exists — i.e. this run is happening
 * inside a hook job over partially staged files.
 *
 * Resolved with `git rev-parse --git-common-dir`, NOT `--git-dir`: lefthook
 * writes the patch to the *common* dir, so in a worktree (`--git-dir` →
 * `.git/worktrees/<name>`) a `--git-dir` lookup never finds it — and worktrees
 * are exactly where the fast-track / drain paths run, so the advisory would be
 * dead in the workflow that needs it most.
 *
 * Any git failure (not a repo, git missing) reads as "no patch": this is an
 * advisory, never a gate.
 */
export function lefthookPatchPresent(cwd: string = process.cwd()): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return false;
  const gitDir = r.stdout.trim();
  return existsSync(join(isAbsolute(gitDir) ? gitDir : join(cwd, gitDir), LEFTHOOK_UNSTAGED_PATCH));
}

export function main(
  argv: string[],
  runner: FmtRunner = defaultRunner,
  patchPresent: () => boolean = lefthookPatchPresent,
): number {
  const decision = decideFmtGuard(runner(argv));
  if (decision.stdout) process.stdout.write(decision.stdout);
  if (decision.stderr) process.stderr.write(decision.stderr);
  // Advisory only — never changes the exit code. A swallowed no-target run
  // formatted nothing, so it cannot have shifted the patch's anchor lines.
  if (
    !decision.swallowed &&
    shouldWarnPartialStaging({ patchPresent: patchPresent(), check: argv.includes('--check') })
  ) {
    process.stderr.write(PARTIAL_STAGING_WARNING);
  }
  return decision.code;
}

const invokedDirect = /[\\/]fmt-guard-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  process.exit(main(process.argv.slice(2)));
}
