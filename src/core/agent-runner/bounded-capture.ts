// @fd: review-run-lifecycle-module
/**
 * Bounded accumulator for a child's diagnostic stream.
 *
 * Below {@link BoundedCaptureOpts.limitChars} this is a plain string concat and
 * {@link BoundedCapture.value} returns the input verbatim — identical to the unbounded
 * accumulation it replaces, for every case ever measured (codex's worst observed stderr is
 * ~326 KB). Above it, the buffer collapses to a head slice plus a tail slice with the middle
 * elided, which bounds heap without discarding either half anyone reads: `AUTH_HINT_RE` in
 * `codex-failure.ts` scans the head (the actionable auth line sits at byte ~400 of 326,525),
 * and `formatStderrTail` renders the tail.
 *
 * The valve engages only above the measured ceiling on purpose. The `noldor:cut` this replaces
 * argued a bound needed a real runaway to design against; the two consumers above pin the shape
 * without one, and keeping the limit above every observed case means behaviour is unchanged in
 * practice rather than merely believed to be.
 */
export interface BoundedCaptureOpts {
  /** Retained prefix once the limit trips. Sized so an auth-shaped line sits well inside it. */
  headChars?: number;
  /** Retained suffix. `formatStderrTail` reads 4000 chars, so this is comfortably above it. */
  tailChars?: number;
  /** Collapse threshold. ~1.5x codex's measured worst case. */
  limitChars?: number;
}

export interface BoundedCapture {
  push(chunk: string): void;
  /** Verbatim below the limit; `head + elision marker + tail` above it. */
  value(): string;
  /**
   * TRUE pre-elision size in bytes, not the length of what {@link value} returns.
   * `formatStderrTail` reports "of M bytes" and M must stay honest about what the child
   * actually emitted — a bounded capture that under-reported its own truncation would be
   * worse than no bound at all.
   */
  totalBytes(): number;
}

const DEFAULT_HEAD_CHARS = 64_000;
const DEFAULT_TAIL_CHARS = 64_000;
const DEFAULT_LIMIT_CHARS = 512_000;

/**
 * True when `code` is the FIRST half of a surrogate pair, so cutting immediately after it
 * would strand it. JS strings are UTF-16 code units and `slice` respects no pair boundary.
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True when `code` is the SECOND half, so cutting immediately before it strands it. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * First `n` code units, nudged back one when that cut would split a surrogate pair.
 *
 * Without the nudge this helper reintroduces the exact artefact its sibling fix removes: a
 * lone surrogate renders as U+FFFD, and `registry.ts` switched to `setEncoding` precisely to
 * stop emitting those at chunk boundaries. Losing one astral character beats corrupting it.
 */
function sliceHead(s: string, n: number): string {
  if (n >= s.length) return s;
  const end = isHighSurrogate(s.charCodeAt(n - 1)) ? n - 1 : n;
  return s.slice(0, end);
}

/** Last `n` code units, nudged forward one when that cut would split a surrogate pair. */
function sliceTail(s: string, n: number): string {
  if (n >= s.length) return s;
  const start = s.length - n;
  return s.slice(isLowSurrogate(s.charCodeAt(start)) ? start + 1 : start);
}

export function createBoundedCapture(opts: BoundedCaptureOpts = {}): BoundedCapture {
  const headChars = opts.headChars ?? DEFAULT_HEAD_CHARS;
  const tailChars = opts.tailChars ?? DEFAULT_TAIL_CHARS;
  const limitChars = opts.limitChars ?? DEFAULT_LIMIT_CHARS;

  // `whole` holds everything until the limit trips, then goes null and the head/tail pair takes
  // over. Two representations rather than always keeping head+tail, because the verbatim case is
  // the only one that has ever occurred and it must stay byte-identical.
  let whole: string | null = '';
  let head = '';
  let tail = '';
  let bytes = 0;

  return {
    push(chunk: string): void {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (whole !== null) {
        whole += chunk;
        if (whole.length <= limitChars) return;
        head = sliceHead(whole, headChars);
        tail = sliceTail(whole, tailChars);
        whole = null;
        return;
      }
      // Past the limit: only the trailing window matters. Slicing per chunk keeps this O(chunk)
      // rather than growing without bound, which is the whole point of the collapsed state.
      tail = sliceTail(tail + chunk, tailChars);
    },

    value(): string {
      if (whole !== null) return whole;
      const elided = bytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
      return `${head}\n[… elided ${elided} bytes …]\n${tail}`;
    },

    totalBytes(): number {
      return bytes;
    },
  };
}
