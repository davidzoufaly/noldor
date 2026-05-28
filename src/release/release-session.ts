import { readSession, writeSession, clearSession } from '../core/session';

export async function withReleaseSession<T>(cwd: string, work: () => Promise<T>): Promise<T> {
  const existing = readSession(cwd);
  if (existing && existing.path !== 'release-automation') {
    throw new Error(
      `Cannot start release: an active /gate session is present at .noldor/session.json ` +
        `(path=${existing.path}${existing.slug ? `, slug=${existing.slug}` : ''}). ` +
        `Finish the gate flow or delete the marker (rm .noldor/session.json) before running pnpm release.`,
    );
  }
  // existing.path === 'release-automation' falls through: stale marker from a
  // prior crashed release run, overwrite with a fresh startedAt.
  writeSession(cwd, {
    path: 'release-automation',
    startedAt: new Date().toISOString(),
  });
  try {
    return await work();
  } finally {
    clearSession(cwd);
  }
}
