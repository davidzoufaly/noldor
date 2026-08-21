// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Count occurrences of string values. One line of logic, extracted because two
// unrelated modules had grown the identical "build a Map of counts, then report
// the entries over a threshold" shape and the clone ratchet is a real gate.

/**
 * Occurrence count per distinct value, in first-seen order.
 *
 * @param values - Any iterable of strings; duplicates are what the caller cares about.
 */
export function tally(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}
