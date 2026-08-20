/**
 * The commit-body shape, as data — the single fact shared by the gate that enforces it
 * (`validate-summary-body.ts`) and the plan format contract that prescribes it to
 * executors (`src/prep/formats.ts`).
 *
 * A leaf module on purpose: `formats.ts` is otherwise a pure string module, and importing
 * the validator for these three constants would pull `execFile`, `node:fs/promises` and
 * the allowlist into every consumer of the format strings. Keeping the shared fact here
 * costs nothing and still leaves exactly one definition — restating the sections in the
 * contract is what let it prescribe a commit the gate refused (Q-0149).
 */

/** Section markers a summary-worthy commit body must carry. */
export const SECTIONS = ['Why', 'How', 'What'] as const;

/**
 * The separator each section marker must be followed by. The gate matches
 * `<section> —` literally, so a contract that names the bare word admits `Why:` — which
 * the gate then rejects. Prescribe the marker, never just the word.
 */
export const SECTION_SEPARATOR = '—';

/**
 * Minimum content per section, in non-whitespace characters.
 *
 * Long enough to reject `Why — x`, short enough never to block an honest
 * one-line reason. Any threshold is arbitrary; this one is cheap to change.
 */
export const MIN_SECTION_CHARS = 24;

/** The section markers as an executor must literally write them: `Why — / How — / What —`. */
export function sectionMarkers(): string {
  return SECTIONS.map((s) => `${s} ${SECTION_SEPARATOR}`).join(' / ');
}
