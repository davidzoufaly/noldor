// @tests: per-task-dev-environment-bootstrap
const PROBE_FETCH_TIMEOUT_MS = 2000;

/**
 * Poll `url` until it returns HTTP 200 or `deadlineMs` passes. Each fetch is
 * bounded so a half-open server cannot hang the loop. Shared by the verify
 * smoke floor and the per-task dev-surface boot.
 *
 * @returns true on a 200 before the deadline, false otherwise.
 */
export async function waitForHttp200(
  url: string,
  deadlineMs: number,
  fetchImpl: typeof fetch = fetch,
  /** Polled each iteration; lets a caller that raced this probe against a
   *  failure signal stop the loop instead of leaving it fetching until the
   *  deadline (where it could even probe a later server reusing the port). */
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  while (Date.now() < deadlineMs && !shouldStop()) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS) });
      if (res.status === 200) return true;
    } catch {
      /* not accepting connections yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
