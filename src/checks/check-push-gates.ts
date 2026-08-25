// CLI: `noldor checks push-gates` — author-side replay of the REAL pre-push
// hook chain, run by /noldor-gate Step 4 before the code-stage review.
//
// The preflight exists because a push refused AFTER the reviewer went green
// costs a fix commit, which changes the tree, which invalidates the
// `Noldor-Reviewed-Subagent` receipt, which costs a whole re-earn dispatch of
// zero review value. It only pays if what it runs is what the push runs.
//
// Enumerating the jobs — the way the gate prose used to (`checks
// template-sync`, `clones check`, a printf-ed `hooks pre-push`) — cannot hold
// that property: a job added to `lefthook/noldor.yml` is silently never
// preflighted, a flag drifts, and lefthook's own skip/exit semantics are not
// reproduced by calling the same binaries by hand. So this delegates: lefthook
// executes its own `pre-push` job list, over the ref line git itself would
// send. Preflight and hook are then the same executor by construction, and the
// only deliberate difference is {@link EXCLUDED_JOBS}.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defaultRunGit, type RunGit } from '../core/branch-added.js';
import { runIfDirect } from '../core/cli-entry.js';
import { lefthookBlockDoc } from './check-lefthook-wiring.js';

/**
 * Jobs the replay skips, by lefthook job name.
 *
 * The review receipt is earned by the code-stage review that runs AFTER this
 * preflight, so before it the job can only be red — including it would make the
 * preflight permanently fail and teach operators to ignore it. Every other
 * pre-push job is a real author-side question.
 */
export const EXCLUDED_JOBS: readonly string[] = ['noldor-enforce-review-receipt'];

/**
 * What git sends for a ref that does not exist on the remote yet. The ADR gate
 * reads it as "no published base" and falls back to the merge base with
 * `origin/main` (see `validate-pushed-adrs.ts` `resolveBase`), which is exactly
 * what the first push of a feature branch will do.
 */
export const ZERO_SHA = '0'.repeat(40);

/**
 * A single-value git query: the trimmed stdout when the command succeeded, `''`
 * when it did not, plus stderr so the caller can quote why. Absent output and a
 * failed command are the same answer here — every caller treats "git could not
 * tell me" as "no value".
 */
function gitValue(run: RunGit, args: readonly string[]): { value: string; stderr: string } {
  const out = run([...args]);
  return { value: out.status === 0 ? out.stdout.trim() : '', stderr: out.stderr.trim() };
}

export type RefLineResult =
  | { readonly ok: true; readonly line: string; readonly branch: string; readonly newRef: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * The pre-push stdin line the next `git push <remote> <branch>` will emit:
 * `<local ref> SP <local sha> SP <remote ref> SP <remote sha>`.
 *
 * The remote sha comes from the remote-tracking ref, or {@link ZERO_SHA} when
 * there is none — the two cases a push distinguishes, and the reason the
 * synthesized line cannot be hardcoded to `origin/main`: on a re-push the real
 * range is `origin/<branch>..HEAD`, and a wider stand-in would make the
 * preflight answer a question the push never asks.
 *
 * A detached HEAD is a refusal, not a guess: there is no branch name to push,
 * so any line invented here would describe a push that cannot happen.
 *
 * // noldor:cut tracking ref, not `ls-remote` — the real push resolves the
 * // remote side over the wire. Swap in `ls-remote --heads` here if a stale
 * // tracking ref is ever observed to change a verdict; today the staleness
 * // only widens the scanned range, which fails safe.
 */
export function buildRefLine(run: RunGit, remote: string): RefLineResult {
  const branch = gitValue(run, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch.value.length === 0) {
    return { ok: false, reason: 'HEAD is detached, so there is no branch to push' };
  }
  const head = gitValue(run, ['rev-parse', 'HEAD']);
  if (head.value.length === 0) {
    return { ok: false, reason: `cannot resolve HEAD (${head.stderr || 'git failed'})` };
  }
  const tracking = gitValue(run, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/${remote}/${branch.value}`,
  ]);
  const remoteSha = tracking.value.length > 0 ? tracking.value : ZERO_SHA;
  const ref = `refs/heads/${branch.value}`;
  return {
    ok: true,
    line: `${ref} ${head.value} ${ref} ${remoteSha}`,
    branch: branch.value,
    newRef: tracking.value.length === 0,
  };
}

export interface PrePushJob {
  readonly name: string;
  readonly run: string;
}

/**
 * The framework block's `pre-push` jobs, minus {@link EXCLUDED_JOBS} — read
 * from the consumer's own `lefthook/noldor.yml` so the by-hand fallback this
 * check prints when lefthook is missing names the jobs that actually exist
 * rather than a second enumeration that can drift.
 */
export function prePushJobs(cwd: string): PrePushJob[] {
  const doc = lefthookBlockDoc(cwd);
  const hook = doc?.['pre-push'];
  const jobs = (hook as { jobs?: unknown } | null | undefined)?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((entry): PrePushJob[] => {
    const { name, run } = (entry ?? {}) as { name?: unknown; run?: unknown };
    if (typeof name !== 'string' || typeof run !== 'string') return [];
    return EXCLUDED_JOBS.includes(name) ? [] : [{ name, run }];
  });
}

export interface SpawnOutcome {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
}

/** Test seam over `spawnSync`: the one external boundary this check crosses. */
export type SpawnLike = (
  bin: string,
  args: readonly string[],
  opts: { cwd: string; input: string; env: NodeJS.ProcessEnv },
) => SpawnOutcome;

const defaultSpawn: SpawnLike = (bin, args, opts) =>
  spawnSync(bin, [...args], {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env,
    // Inherit both output streams: the operator must read lefthook's own job
    // output, which is the whole point of replaying rather than summarizing.
    stdio: ['pipe', 'inherit', 'inherit'],
  });

type ReplayOutcome =
  | { readonly kind: 'green' | 'red' }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** `LEFTHOOK_EXCLUDE` with our jobs unioned in, preserving an operator's own. */
export function exclusionList(existing: string | undefined): string {
  const own = (existing ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  return [...new Set([...own, ...EXCLUDED_JOBS])].join(',');
}

/**
 * Hand the hook to lefthook. `--no-auto-install` so a preflight never rewrites
 * `.git/hooks`; no `--force`, because a job lefthook would SKIP at push time
 * must also be skipped here — fidelity is the contract, not coverage.
 */
function replay(opts: {
  cwd: string;
  remote: string;
  refLine: string;
  spawn: SpawnLike;
}): ReplayOutcome {
  const local = join(opts.cwd, 'node_modules/.bin/lefthook');
  const candidates = existsSync(local) ? [local, 'lefthook'] : ['lefthook'];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LEFTHOOK_EXCLUDE: exclusionList(process.env.LEFTHOOK_EXCLUDE),
  };
  let reason = 'lefthook is not installed (looked in node_modules/.bin and on PATH)';
  for (const bin of candidates) {
    const res = opts.spawn(bin, ['run', 'pre-push', opts.remote, '--no-auto-install'], {
      cwd: opts.cwd,
      input: `${opts.refLine}\n`,
      env,
    });
    if (res.error !== undefined) {
      // Almost always ENOENT on the PATH candidate; keep the message and try the
      // next binary rather than reporting a red the gates never returned.
      reason = `${bin}: ${res.error.message}`;
      continue;
    }
    if (res.status === null) {
      return {
        kind: 'unavailable',
        reason: `lefthook was terminated by signal ${res.signal ?? 'unknown'} — the gates did not finish`,
      };
    }
    return { kind: res.status === 0 ? 'green' : 'red' };
  }
  return { kind: 'unavailable', reason };
}

export interface PushGatesOptions {
  readonly cwd?: string;
  readonly remote?: string;
  /** Test seams. */
  readonly runGit?: RunGit;
  readonly spawn?: SpawnLike;
}

/**
 * Exit 0 = every pre-push job the real push will run is green on this tree.
 * Exit 1 = one of them refused; fix it now, while no review receipt exists to
 * invalidate. Exit 3 = the replay could not run at all — never reported as
 * green, since "I did not look" is not a pass.
 */
export function runPushGates(options: PushGatesOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const remote = options.remote ?? 'origin';
  const refLine = buildRefLine(options.runGit ?? defaultRunGit(cwd), remote);
  if (!refLine.ok) {
    process.stderr.write(`push-gates: cannot verify — ${refLine.reason}\n`);
    return 3;
  }
  const shape = refLine.newRef
    ? `${remote} has no ${refLine.branch} yet, so the remote sha is zeros — same as the first real push`
    : `remote side is ${remote}/${refLine.branch}`;
  process.stdout.write(
    `push-gates: replaying the pre-push hook over '${refLine.line}' (${shape})\n` +
      `push-gates: skipping ${EXCLUDED_JOBS.join(', ')} — that receipt is earned by the code-stage review, which runs after this\n`,
  );

  const outcome = replay({
    cwd,
    remote,
    refLine: refLine.line,
    spawn: options.spawn ?? defaultSpawn,
  });
  if (outcome.kind === 'unavailable') {
    const jobs = prePushJobs(cwd);
    const byHand =
      jobs.length > 0
        ? `run these by hand instead:\n${jobs.map((j) => `  ${j.name}: ${j.run}`).join('\n')}\n`
        : 'and lefthook/noldor.yml lists no pre-push jobs to name as a fallback\n';
    process.stderr.write(`push-gates: cannot verify — ${outcome.reason}\n  ${byHand}`);
    return 3;
  }
  if (outcome.kind === 'red') {
    process.stderr.write(
      'push-gates: RED — the push will be refused. Fix it now: a fix landed after the ' +
        'code-stage review invalidates the receipt and costs a re-earn dispatch.\n',
    );
    return 1;
  }
  process.stdout.write('push-gates: green — the pre-push chain accepts this tree\n');
  return 0;
}

runIfDirect('check-push-gates', 'checks push-gates', async () => runPushGates());
