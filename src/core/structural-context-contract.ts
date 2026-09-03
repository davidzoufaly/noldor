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

/**
 * The marker grammar in full, as an author writes it in code.
 *
 * Built from {@link CUT_MARKER} rather than restating it, because the two used
 * to be independent literals in different modules — this one in
 * `src/cr/lanes/subagent-dispatch.ts`, the bare token here — for one contract.
 * The author half lives as prose in `.noldor/rules/lazy-decision-ladder.md` (+
 * its templates twin), and the subagent-dispatch test asserts the rule file
 * contains this exact string, so a rename in either place fails the suite
 * instead of letting review lanes enforce a stale grammar.
 */
export const CUT_MARKER_TOKEN = `${CUT_MARKER} <ceiling> — <upgrade path>`;

/**
 * What a review lane is told about a marked cut. ONE definition, read by both
 * the reviewer lane (`subagent-dispatch.ts`) and the codex lane
 * (`run-codex.ts`) — codex carried no cut guide at all until this landed, which
 * is why it re-flagged documented cut sites five times in a single Q-0146
 * review while the reviewer left them alone.
 *
 * Phrased without naming any dimension. The reviewer prompt promises "these
 * dimensions only", so a dimension name here would either invite findings
 * against an out-of-scope dimension or read as scoping the waiver. The
 * never-exempt sentence mirrors the rule file's five never-cut carve-outs
 * semantically — defect, vulnerability, race, unintended state change,
 * accessibility, explicitly-requested behaviour.
 */
export const CUT_MARKER_GUIDE = `\nRespect \`${CUT_MARKER_TOKEN}\` markers: a marked cut is a deliberate decision. When a finding argues the code should be simpler, leaner, faster, placed at a different layer, or reuse something existing, do not flag the marked cut itself — flag only a wrong ceiling or a real cut left unmarked. A marker never waives a finding about a defect, a vulnerability, a race, an unintended state change, an accessibility regression, or explicitly-requested behaviour that was cut.\n`;
