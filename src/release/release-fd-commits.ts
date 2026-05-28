// scripts/release/release-fd-commits.ts
// @tests: feature-md-links-overhaul

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** One commit attributed to a feature, parsed from `git log`. */
export interface FeatureCommit {
  /** 12-char prefix of the commit sha. */
  sha: string;
  /** Conventional Commits type, with `!` preserved on breaking changes. */
  type: string;
  /** Commit subject minus `<type>(<scope>):` prefix. */
  subject: string;
  /** Author date as `YYYY-MM-DD`. */
  date: string;
}

const SUBJECT_RE =
  /^(?<type>\w+)(?<bangBefore>!)?(?:\([^)]*\))?(?<bangAfter>!)?:\s*(?<subject>.+)$/;

/**
 * Parse one `--format=%H%x09%s%x09%ad` line into a {@link FeatureCommit}.
 * Returns null when the line doesn't match a Conventional Commit subject.
 */
export function parseCommitLine(line: string): FeatureCommit | null {
  const parts = line.split('\t');
  if (parts.length !== 3) {
    return null;
  }
  const [sha, commitSubject, date] = parts;
  if (!sha || !commitSubject || !date) return null;

  const m = SUBJECT_RE.exec(commitSubject);
  if (!m?.groups) return null;

  const breaking = Boolean(m.groups.bangBefore || m.groups.bangAfter);
  return {
    sha: sha.slice(0, 12),
    type: `${m.groups.type}${breaking ? '!' : ''}`,
    subject: m.groups.subject.trim(),
    date,
  };
}

interface GitLogShasOptions {
  grep: string;
  fromRef: string;
  toRef: string;
  cwd: string;
  extendedRegexp?: boolean;
}

/**
 * Helper to run `git log` with a grep filter and return an array of unique SHAs.
 */
async function gitLogShas(options: GitLogShasOptions): Promise<string[]> {
  const { grep, fromRef, toRef, cwd, extendedRegexp } = options;
  const range = await rangeForRefs(fromRef, toRef, cwd);
  const args = [
    'log',
    '--no-merges',
    ...(extendedRegexp ? ['--extended-regexp'] : []),
    `--grep=${grep}`,
    '--format=%H',
  ];
  if (range) {
    args.push(range);
  }
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Walk `git log` between `fromRef` and `toRef` returning commits whose scope
 * matches `<package>:<slug>` OR whose Noldor-FD trailer matches the slug.
 * Commits are deduplicated by SHA.
 *
 * Pass `fromRef = ''` for "repo start" — emits `git log <toRef>` (all commits
 * reachable from `toRef`). Use this for the first version bucket where there
 * is no prior tag to bound against.
 *
 * Equal non-empty `fromRef` and `toRef` are rejected to prevent a footgun:
 * `git log ref..ref` is empty, but the no-range fallback would silently log
 * all of HEAD into the bucket. Pass distinct refs or `''` instead.
 */
export async function commitsForFeature(
  slug: string,
  fromRef: string,
  toRef: string,
  cwd: string = process.cwd(),
): Promise<FeatureCommit[]> {
  if (toRef === '') {
    throw new Error("commitsForFeature: toRef must be non-empty (use 'HEAD' or a tag).");
  }
  if (fromRef === toRef) {
    throw new Error(
      `commitsForFeature: equal refs ('${fromRef}') would silently log all of HEAD. ` +
        `Pass distinct refs or '' for repo-start.`,
    );
  }
  // Scope-grep: commit subject matches `feat(pkg:slug):`
  const scopeGrep = `^[a-z]+!?\\([^)]*:${escapeForRegex(slug)}\\)!?:`;
  const scopeShas = await gitLogShas({
    grep: scopeGrep,
    fromRef,
    toRef,
    cwd,
    extendedRegexp: true,
  });

  // Trailer-grep: commit body contains `Noldor-FD: slug` as a trailer
  const trailerGrep = `^Noldor-FD: ${escapeForRegex(slug)}$`;
  const trailerShas = await gitLogShas({
    grep: trailerGrep,
    fromRef,
    toRef,
    cwd,
    extendedRegexp: true,
  });

  // Union and deduplicate by SHA
  const union = new Set([...scopeShas, ...trailerShas]);

  // Load each unique commit and parse
  const commits: FeatureCommit[] = [];
  for (const sha of Array.from(union)) {
    const commit = await loadCommit(sha, cwd);
    if (commit) {
      commits.push(commit);
    }
  }
  return commits;
}

/**
 * Load and parse a single commit by SHA.
 */
async function loadCommit(sha: string, cwd: string): Promise<FeatureCommit | null> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', '-1', '--format=%s%x09%ad', '--date=short', sha],
      { cwd },
    );
    const [subject, date] = stdout.trim().split('\t');
    // Extract type and scope from subject to reconstruct the commit line for parsing
    const subjectLine = `${sha}\t${subject}\t${date}`;
    return parseCommitLine(subjectLine);
  } catch {
    return null;
  }
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function rangeForRefs(fromRef: string, toRef: string, cwd: string): Promise<string | null> {
  if (fromRef === toRef) {
    return null;
  }
  try {
    await execFileP('git', ['rev-parse', '--verify', fromRef], { cwd });
    return `${fromRef}..${toRef}`;
  } catch {
    return toRef;
  }
}
