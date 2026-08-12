import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Run a git command, forwarding stderr (fetch progress etc.) like index.ts's `run`. */
async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout, stderr } = await execFileP('git', args, { cwd });
  if (stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}

/** One observation of the three tree conditions the release cares about. */
export interface TreeState {
  /** Current branch name (`rev-parse --abbrev-ref HEAD`). */
  branch: string;
  /** Non-empty `status --porcelain` lines; empty array means clean. */
  dirty: string[];
  /** Commits local main is behind `origin/main` (0 when level or ahead). */
  behind: number;
  /** Commits local main is ahead of `origin/main` (0 when level or behind). */
  ahead: number;
  /**
   * True when `origin/main` could not be resolved at all (no remote, fetch
   * failed). Distinct from `ahead === 0 && behind === 0`: that means "verified
   * level", this means "could not verify" — and the two must never collapse,
   * or an unreachable remote would read as in-sync.
   */
  remoteMissing: boolean;
}

/**
 * One `git` round-trip over the three release-relevant tree conditions,
 * reported rather than thrown. `ensureCleanTreeOnMain` wraps this for callers
 * that want the old abort-on-first-problem behaviour; the preflight aggregate
 * consumes it directly so branch / dirtiness / sync each become their own
 * report row instead of collapsing into whichever throw fired first.
 *
 * Fetches `origin main` before comparing, exactly as the throwing form did —
 * a sync verdict against a stale remote ref would be worthless. When
 * `origin/main` cannot be resolved at all the counts come back 0 but
 * `remoteMissing` is set, and callers treat that as a hard failure rather than a
 * benign skip: "could not verify" must never read as "in sync".
 *
 * `cwd` is injectable so probes evaluate the repo they were handed rather than
 * whatever `process.cwd()` happens to be.
 */
export async function inspectTreeState(cwd: string = process.cwd()): Promise<TreeState> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const status = await git(['status', '--porcelain'], cwd);
  const dirty = status.length > 0 ? status.split('\n').filter((l) => l.trim().length > 0) : [];
  try {
    await git(['fetch', 'origin', 'main'], cwd);
    // `rev-list --left-right --count A...B` prints "<ahead>\t<behind>" — one
    // command for both directions, so a diverged history is distinguishable from
    // a simply-behind one (only the latter is safe to fast-forward).
    const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], cwd);
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    return {
      branch,
      dirty,
      ahead: Number(aheadRaw ?? 0),
      behind: Number(behindRaw ?? 0),
      remoteMissing: false,
    };
  } catch {
    return { branch, dirty, ahead: 0, behind: 0, remoteMissing: true };
  }
}

/**
 * Guard shared by the release pipeline entry and the registry-publish resume
 * path: refuse to proceed unless HEAD is `main`, the working tree is clean,
 * and local main matches `origin/main`. Extracted from `release/index.ts` so
 * `release-publish.ts` no longer imports the pipeline entry module back —
 * that import was one of the repo's two intra-module file cycles, which the
 * `no-module-cycles` boundary rule now forbids.
 *
 * Retained for `release-publish.ts`'s `--local` emergency path, which wants a
 * single throw rather than a report. The normal release pipeline goes through
 * the preflight aggregate instead.
 */
export async function ensureCleanTreeOnMain(): Promise<void> {
  const state = await inspectTreeState();
  if (state.branch !== 'main') {
    throw new Error(`Release must be run from main branch (currently on ${state.branch}).`);
  }
  if (state.dirty.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash first.');
  }
  if (state.remoteMissing) {
    throw new Error('Could not resolve origin/main — check the origin remote and network.');
  }
  if (state.ahead > 0 || state.behind > 0) {
    throw new Error('Local main is not up to date with origin/main.');
  }
}
