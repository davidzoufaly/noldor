// Shared format contract for the SDD report's review-skip count line. Owned
// here (the report producer) and consumed by the release-script guard
// (`src/release/sdd-report-diff.ts`) so the literal lives in exactly one place —
// a wording change can't silently desync the guard's matcher from the emitter.

/** Literal prefix of the review-skip count line, sans the trailing number. */
export const REVIEW_SKIP_COUNT_PREFIX = 'Gated commits missing `Noldor-Reviewed` trailer: ';

/** Builds the full review-skip count line `sdd-report.ts` emits. */
export function reviewSkipCountLine(count: number): string {
  return `${REVIEW_SKIP_COUNT_PREFIX}${count}`;
}
