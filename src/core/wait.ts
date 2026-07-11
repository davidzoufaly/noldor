/**
 * Runner-agnostic wait/poll primitive: poll a JSON snapshot until a predicate
 * matches. The pure core (no I/O, no clock) so it is testable with fake timers.
 * The CLI wrapper lives in {@link ./wait-cli.ts}. Modeled on the injected-clock
 * shape of `pollAutoMerge` in `./pr-flow.ts`.
 */

/** A parsed `--until` / `--fail-if` / `--emit`-adjacent predicate. */
export type Predicate =
  | { kind: 'exists'; path: string }
  | { kind: 'eq'; path: string; literal: string }
  | { kind: 'neq'; path: string; literal: string };

/** Thrown by {@link parsePredicate} on malformed input; CLI maps it to exit 3. */
export class PredicateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateParseError';
  }
}

/** Dotpath charset: segment chars, `.` separators, and `-` for kebab-case keys. */
export const DOTPATH_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Resolve a dot-separated path against a value. Numeric segments index arrays.
 * Null-safe: a null/undefined root or intermediate yields `undefined`.
 */
export function getPath(obj: unknown, dotpath: string): unknown {
  return dotpath
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function validateDotpath(raw: string): string {
  const path = raw.trim();
  if (!DOTPATH_RE.test(path)) {
    throw new PredicateParseError(
      `invalid dotpath '${raw}': only letters, digits, '_', '.', '-' are allowed`,
    );
  }
  return path;
}

/**
 * Parse a predicate string. Grammar:
 *   - `<dotpath>?`            -> exists (trailing '?', detected first)
 *   - `<dotpath> == <value>`  -> eq   (leftmost operator wins)
 *   - `<dotpath> != <value>`  -> neq
 * Only the dotpath is charset-checked; the literal is unconstrained. A literal
 * may not end in '?' (that routes to the exists branch and the '=' in the path
 * is then rejected).
 */
export function parsePredicate(src: string): Predicate {
  const s = src.trim();
  if (s === '') throw new PredicateParseError('empty predicate');

  if (s.endsWith('?')) {
    return { kind: 'exists', path: validateDotpath(s.slice(0, -1)) };
  }

  const eqIdx = s.indexOf('==');
  const neqIdx = s.indexOf('!=');
  let kind: 'eq' | 'neq' | null = null;
  let idx = -1;
  if (eqIdx !== -1 && (neqIdx === -1 || eqIdx < neqIdx)) {
    kind = 'eq';
    idx = eqIdx;
  } else if (neqIdx !== -1) {
    kind = 'neq';
    idx = neqIdx;
  }
  if (kind === null) {
    throw new PredicateParseError(
      `invalid predicate '${src}': expected '<dotpath> == <value>', '<dotpath> != <value>', or '<dotpath>?'`,
    );
  }
  return { kind, path: validateDotpath(s.slice(0, idx)), literal: s.slice(idx + 2).trim() };
}

/**
 * Evaluate a predicate against a snapshot. `eq`/`neq` short-circuit to `false`
 * on an absent (null/undefined) resolved value, so a partially-written or wrong
 * file never yields a false terminal; comparison via `String(v)` only runs once
 * the path resolves to a non-null value.
 */
export function evalPredicate(pred: Predicate, snapshot: unknown): boolean {
  const v = getPath(snapshot, pred.path);
  if (pred.kind === 'exists') return v != null;
  if (v == null) return false;
  const eq = String(v) === pred.literal;
  return pred.kind === 'eq' ? eq : !eq;
}

/** The terminal result of {@link waitUntil}. */
export type WaitOutcome =
  | { outcome: 'matched'; snapshot: unknown }
  | { outcome: 'failed'; snapshot: unknown }
  | { outcome: 'timeout'; lastSnapshot: unknown; everReadable: boolean };

export interface WaitDeps {
  /** Read + parse the state file; return `null` on missing/unreadable/bad JSON. */
  read: () => unknown;
  /** Success predicate. */
  until: Predicate;
  /** Optional fast-fail predicate; evaluated before `until` each poll. */
  failIf?: Predicate;
  /** Fixed poll interval (ms). */
  intervalMs: number;
  /** Wall-clock budget (ms); `0` disables the timeout (poll forever). */
  timeoutMs: number;
  /** Injected clock (defaults to `Date.now`). */
  now?: () => number;
  /** Injected sleep (defaults to `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  /** Per-poll observer, for progress reporting. */
  onPoll?: (snapshot: unknown, elapsedMs: number) => void;
}

/**
 * Poll `read()` on a fixed interval until `until` matches (matched), `failIf`
 * matches (failed, and it wins when both match the same snapshot), or the
 * timeout elapses (timeout). A `null` read (startup race / bad JSON) never
 * matches — the loop keeps polling.
 */
export async function waitUntil(deps: WaitDeps): Promise<WaitOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  let everReadable = false;
  let lastSnapshot: unknown = null;

  for (;;) {
    const snapshot = deps.read();
    lastSnapshot = snapshot;
    if (snapshot != null) everReadable = true;
    deps.onPoll?.(snapshot, now() - start);

    if (snapshot != null && deps.failIf && evalPredicate(deps.failIf, snapshot)) {
      return { outcome: 'failed', snapshot };
    }
    if (snapshot != null && evalPredicate(deps.until, snapshot)) {
      return { outcome: 'matched', snapshot };
    }
    if (deps.timeoutMs > 0 && now() - start >= deps.timeoutMs) {
      return { outcome: 'timeout', lastSnapshot, everReadable };
    }
    await sleep(deps.intervalMs);
  }
}
