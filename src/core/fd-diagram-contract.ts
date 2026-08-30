// @fd: consumer-architecture-doc-surface
/**
 * The FD `## Diagram` section, as data — the one fact shared by everything that
 * writes it (`scaffoldFd` in `src/prep/scaffold.ts`, and by hand the
 * `/noldor-promote` and `/noldor-new-feature` templates plus
 * `docs/noldor/feature-md-schema.md`) and the detector that reports it unfilled
 * (`src/garden/detectors/fd-diagram.ts`).
 *
 * A leaf module on purpose, mirroring `structural-context-contract.ts`: the
 * format strings must not pull IO-bearing modules into every consumer, and
 * restating the heading in five places is exactly what would let a scaffold
 * write a section the detector cannot find.
 *
 * Deliberately absent: the placeholder *marker*. That is `PLACEHOLDER_MARKER` in
 * `src/docs/architecture-schema.ts`, and the detector imports it from there —
 * nothing under `src/core` imports `src/docs` today, and `core-is-foundation` in
 * `.noldor/config.json` does not list `docs`, so an inverted edge would ship
 * unflagged by dependency-cruiser. `src/garden/detectors/` already reaches into
 * `src/docs`, which makes the detector the right altitude for that import.
 *
 * Also deliberately absent: any floor date or floor version. Scope is a property
 * of the document — does it carry the heading? — not of a stamped constant that
 * could be recomputed wrongly (the `ADR_FLOOR_NUMBER` hazard).
 */

/** Heading text, matched case-sensitively at H2 in an FD body. */
export const FD_DIAGRAM_HEADING = 'Diagram';

/**
 * The block every scaffold writes, verbatim.
 *
 * An HTML comment, so it contributes nothing to prose density and a
 * scaffolded-but-untouched section measures as empty. That is what makes
 * `placeholder-only` distinguishable from a section whose comment was deleted
 * and then abandoned.
 *
 * This constant is the authority for what gets *written*; `PLACEHOLDER_MARKER`
 * is the authority for what the detector *reads*. Two jobs, deliberately not
 * one: matching this text exactly would stop recognising the placeholder the
 * first time someone improved the wording.
 */
export const FD_DIAGRAM_PLACEHOLDER = `<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->`;

/**
 * Minimum prose beside the diagram, in non-whitespace characters.
 *
 * Same value and same reasoning as `structural-context-contract.ts`'s
 * `MIN_STRUCTURAL_CONTEXT_CHARS`: long enough to reject a two-word gesture,
 * short enough never to punish an honest one-line answer. Deliberately a
 * separate constant — these two contracts are free to diverge, exactly as
 * `structural-context-contract.ts` forked from `summary-body-contract.ts`.
 */
export const MIN_FD_DIAGRAM_PROSE_CHARS = 24;
