import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import semver from 'semver';

import type { BumpLevel } from './release-commits.js';
import { defaultRunCommand, type RunCommand } from './run-command.js';

// `getRepoUrl` keeps the direct spawn deliberately: it runs once from the
// release pipeline entry, never from a probe context, so routing it through the
// seam would add a parameter no caller passes. `findPreviousTag` below is the
// one every preflight pass reaches, and that is the one the seam covers.
const execFileP = promisify(execFile);

/**
 * Apply a semver bump to a version string.
 *
 * @param current - The current semver version (e.g. `0.1.0`)
 * @param level - Bump direction
 * @returns The bumped version string
 * @throws If `current` is not valid semver
 */
export function applyBump(current: string, level: BumpLevel): string {
  const next = semver.inc(current, level);
  if (next === null) {
    throw new Error(`Cannot bump invalid semver: ${current}`);
  }
  return next;
}

/**
 * Resolve the repository's GitHub URL from the `origin` remote.
 *
 * Normalises both HTTPS (`https://github.com/owner/repo.git`) and SSH
 * (`git@github.com:owner/repo.git`) forms to the canonical
 * `https://github.com/owner/repo` (no trailing `.git`).
 *
 * @returns The canonical GitHub repo URL
 * @throws If the origin remote is missing or unrecognised
 */
export async function getRepoUrl(): Promise<string> {
  const { stdout } = await execFileP('git', ['remote', 'get-url', 'origin']);
  let url = stdout.trim();
  if (url.startsWith('git@github.com:')) {
    url = `https://github.com/${url.slice('git@github.com:'.length)}`;
  }
  if (url.endsWith('.git')) {
    url = url.slice(0, -4);
  }
  if (!url.startsWith('https://github.com/')) {
    throw new Error(`Unrecognised origin remote URL: ${stdout.trim()}`);
  }
  return url;
}

/**
 * Find the most recent `v*` tag reachable from HEAD. Returns `v0.0.0` when no
 * matching tags exist so the first release can compute from a clean baseline.
 *
 * "No matching tag" and "the command failed" have always collapsed into the
 * same `v0.0.0`, and that stays true through the seam: `git describe` exits
 * non-zero for an untagged repo, so the two are indistinguishable at this
 * layer by construction, not by oversight.
 *
 * @param cwd - Directory in which to run `git describe`. Defaults to
 *   `process.cwd()`. Pass an explicit path when running against a scratch repo
 *   (e.g. in tests).
 * @param run - Spawn seam. Defaults to the real spawn; the preflight context
 *   passes its own so a probe pass adds no subprocess to a unit suite.
 * @returns The previous tag (with leading `v`)
 */
export async function findPreviousTag(
  cwd: string = process.cwd(),
  run: RunCommand = defaultRunCommand,
): Promise<string> {
  const { code, stdout } = await run(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'],
    { cwd },
  );
  return code === 0 ? stdout.trim() : 'v0.0.0';
}
