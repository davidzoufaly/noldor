// @fd: review-run-lifecycle-module
/**
 * Resolve with `p`'s value, or with `fallback` once `ms` elapses — whichever happens first.
 * Never rejects: a rejection from `p` also yields `fallback`.
 *
 * The point is that the CALLER always settles, whatever the underlying work does. Node's
 * `execFile` timeout does not give you this: it kills the child and then still waits for the
 * callback, which fires on stream close rather than on the signal — so a child in
 * uninterruptible sleep, or one whose own children inherited the stdio pipes, leaves the
 * callback pending forever. Killing is best-effort by nature; settling must not be.
 *
 * The never-throw handler is attached to `p` itself rather than to a race result, so an
 * abandoned promise that rejects after the timer already won cannot surface as an unhandled
 * rejection. `Promise.race` would absorb that too, but only because of how race is built —
 * this does not depend on which shape the caller assumed.
 */
export function settleWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    // A pending probe must never be the reason the process stays alive.
    timer.unref?.();
    void p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
