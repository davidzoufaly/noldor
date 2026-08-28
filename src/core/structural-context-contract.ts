/**
 * The Structural context unit, as data — the one fact shared by everything that
 * prescribes it (`SPEC_FORMAT` in `src/prep/formats.ts`, `renderAdrTemplate` in
 * `src/docs/adr-schema.ts`) and the detector that reports it unfilled
 * (`src/garden/detectors/structural-context.ts`).
 *
 * A leaf module on purpose, mirroring `summary-body-contract.ts`: the format
 * strings must not pull IO-bearing modules into every consumer, and restating
 * the heading in three places is exactly what would let a template prescribe a
 * section the detector cannot find.
 */

/** Heading text, matched case-sensitively. H3 in a spec, H2 in a record. */
export const STRUCTURAL_CONTEXT_HEADING = 'Structural context';

/**
 * The placeholder `renderAdrTemplate` writes, and the exact literal the
 * detector's ADR clause matches. A record whose section is nothing but this
 * has prescribed the unit without answering it.
 */
export const ADR_STRUCTURAL_CONTEXT_PLACEHOLDER =
  'Which communities, god nodes, and cross-community edges does this decision move?';

/**
 * Minimum content, in non-whitespace characters, before a section stops reading
 * as a stub. Same threshold and same reasoning as
 * `summary-body-contract.ts`'s `MIN_SECTION_CHARS`: long enough to reject a
 * two-word gesture, short enough never to punish an honest one-line answer.
 * Deliberately a separate constant — these two contracts are free to diverge.
 */
export const MIN_STRUCTURAL_CONTEXT_CHARS = 24;

/** The marker that records a deliberate skip. Same spelling `/noldor-refactor` greps. */
export const CUT_MARKER = 'noldor:cut';
