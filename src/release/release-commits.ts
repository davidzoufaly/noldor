import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * One git commit reduced to the fields the release pipeline needs.
 */
export interface Commit {
  sha: string;
  subject: string;
  body: string;
  prNumber?: number;
}

/** Semver bump level derived from commit history. */
export type BumpLevel = 'major' | 'minor' | 'patch';

/** Conventional-commit category bucket. */
export type Category = 'feature' | 'fix' | 'other';

const CONVENTIONAL_RE =
  /^(feat|fix|refactor|chore|docs|perf|test|style|ci|build)(\([^)]+\))?(!)?:\s/;
const BREAKING_RE = /^(feat|fix|refactor|chore|docs|perf|test|style|ci|build)(\([^)]+\))?!:\s/;

/**
 * Classify a single commit into feature / fix / other based on its subject.
 * Non-conventional commits fall into "other". Bang-prefix (`type!:`) does NOT
 * change the category — it only affects the bump-level computation.
 *
 * @param c - Commit to classify
 * @returns The category bucket
 */
export function classifyCommit(c: Commit): Category {
  const match = c.subject.match(CONVENTIONAL_RE);
  if (!match) {
    return 'other';
  }
  const type = match[1];
  if (type === 'feat') {
    return 'feature';
  }
  if (type === 'fix') {
    return 'fix';
  }
  return 'other';
}

function isBreaking(c: Commit): boolean {
  if (BREAKING_RE.test(c.subject)) {
    return true;
  }
  return /^BREAKING CHANGE:/m.test(c.body);
}

/**
 * Derive the semver bump level from a list of commits.
 *
 * - Any breaking marker (bang prefix or BREAKING CHANGE footer) → `major`
 * - Otherwise any feat → `minor`
 * - Otherwise → `patch`
 * - Empty list → `null` (caller decides to abort)
 *
 * @param commits - Commits to inspect
 * @returns The derived bump level, or null when no commits
 */
export function deriveBumpLevel(commits: Commit[]): BumpLevel | null {
  if (commits.length === 0) {
    return null;
  }
  if (commits.some(isBreaking)) {
    return 'major';
  }
  if (commits.some((c) => classifyCommit(c) === 'feature')) {
    return 'minor';
  }
  return 'patch';
}

/**
 * Commits split into feature / fix / other buckets for downstream rendering.
 */
export interface ClassifiedCommits {
  features: Commit[];
  fixes: Commit[];
  other: Commit[];
}

/**
 * Group commits into features / fixes / other buckets, preserving input order.
 *
 * @param commits - Commits to bucket
 * @returns Grouped buckets keyed by category
 */
export function classifyCommits(commits: Commit[]): ClassifiedCommits {
  const features: Commit[] = [];
  const fixes: Commit[] = [];
  const other: Commit[] = [];
  for (const c of commits) {
    const cat = classifyCommit(c);
    if (cat === 'feature') {
      features.push(c);
    } else if (cat === 'fix') {
      fixes.push(c);
    } else {
      other.push(c);
    }
  }
  return { features, fixes, other };
}

const PR_IN_SUBJECT_RE = /\(#(\d+)\)\s*$/;
const PR_TRAILER_RE = /^PR-#:\s*(\d+)\s*$/m;

async function refExists(ref: string): Promise<boolean> {
  try {
    await execFileP('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read commits from git between two refs (`fromRef..toRef`, exclusive lower
 * bound, inclusive upper bound). PR number is harvested from `(#42)` at the
 * end of the subject or a `PR-#:` trailer in the body.
 *
 * @param fromRef - Lower bound (exclusive); typically the previous release tag
 * @param toRef - Upper bound (inclusive); typically `HEAD`
 * @returns Commits in git-log order (newest first)
 */
export async function readCommitsSince(fromRef: string, toRef: string): Promise<Commit[]> {
  const range = (await refExists(fromRef)) ? `${fromRef}..${toRef}` : toRef;
  const { stdout } = await execFileP('git', [
    'log',
    '--no-merges',
    '--format=%H%x00%s%x00%b%x00',
    range,
  ]);

  if (!stdout.trim()) {
    return [];
  }

  const records = stdout
    .split('\x00\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  return records.map<Commit>((record) => {
    const [sha = '', subject = '', body = ''] = record.split('\x00').map((s) => s.trim());
    const subjectPrMatch = subject.match(PR_IN_SUBJECT_RE);
    const bodyPrMatch = body.match(PR_TRAILER_RE);
    const prNumber = subjectPrMatch
      ? Number(subjectPrMatch[1])
      : bodyPrMatch
        ? Number(bodyPrMatch[1])
        : undefined;
    return { body, prNumber, sha, subject };
  });
}
