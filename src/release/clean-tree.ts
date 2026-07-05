import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Run a git command, forwarding stderr (fetch progress etc.) like index.ts's `run`. */
async function git(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileP('git', args);
  if (stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}

/**
 * Guard shared by the release pipeline entry and the registry-publish resume
 * path: refuse to proceed unless HEAD is `main`, the working tree is clean,
 * and local main matches `origin/main`. Extracted from `release/index.ts` so
 * `release-publish.ts` no longer imports the pipeline entry module back —
 * that import was one of the repo's two intra-module file cycles, which the
 * `no-module-cycles` boundary rule now forbids.
 */
export async function ensureCleanTreeOnMain(): Promise<void> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`Release must be run from main branch (currently on ${branch}).`);
  }
  const status = await git(['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash first.');
  }
  await git(['fetch', 'origin', 'main']);
  const local = await git(['rev-parse', 'HEAD']);
  const remote = await git(['rev-parse', 'origin/main']);
  if (local !== remote) {
    throw new Error('Local main is not up to date with origin/main.');
  }
}
