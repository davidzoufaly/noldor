import { SPEC_BLOCKING_BASES, type SpecBlockingBasis } from './finding-class.js';

/**
 * What blocks a merge: the one definition every review lane's prompt renders (Q-0250), with a
 * spec-stage counterpart below (Q-0263).
 *
 * Before it, no lane was told what blocks. Every reviewer Important item blocked while the
 * prompt never said so, and the codex prompt gave no definition at all. The round-cause
 * forensics behind Q-0250 found reviewers approving over Important items they had filed, and
 * nits keeping rounds red on their own. Kept in ONE place so the reviewer and codex prompts
 * cannot drift apart; {@link isNeverBlockingMessage} is its code half.
 */
export const BLOCKING_DEFINITION = `What blocks the merge: a finding blocks only when shipping the change as it is would
- produce wrong behaviour;
- break a stated contract or an existing caller;
- open a security hole;
- lose or corrupt data;
- leave a test that cannot fail; or
- put a false statement into docs that an agent or operator will act on.
Everything else never blocks: cleanup, naming, wording, formatting, cross-references, style, and any finding marked \`maybe:\` or \`unverified:\`. If you would approve this change, no finding blocks.`;

/**
 * What blocks a spec: the text both prompts render at kind `spec`, in place of the code one
 * (Q-0263). A spec is a document an implementer acts on, so the code definition's
 * false-statement clause covers almost any inaccuracy in one and narrows nothing at the spec
 * stage; the closed set of {@link SPEC_BLOCKING_BASES} is what does.
 */
export const SPEC_BLOCKING_DEFINITION = `What blocks this spec: a finding blocks only when it names one of these three as its "basis".
- "requirement": something the feature has to do is missing, or two parts of the spec (or the spec and its feature summary) contradict each other;
- "feasibility": the design cannot be built as written, because it relies on code, a contract or a behaviour that does not exist or does not work the way the spec says;
- "risk": building the spec as written would ship wrong behaviour, a broken contract or caller, a security hole, lost or corrupt data, or a test that cannot fail, and the spec neither prevents that nor accepts it under Risks / trade-offs.
Nothing else blocks a spec: wording, formatting, cross-references and line numbers, section structure, detail an implementer can decide, a preference between two designs that would both work, re-arguing a choice the spec records under Non-goals or Open questions (resolved), the feature MD's own sections (they are written after the spec on purpose), and any finding marked \`maybe:\` or \`unverified:\`. A recorded choice that cannot be built still blocks, under "feasibility". If you would approve this spec, no finding blocks.`;

/** The code half of the spec definition: true only for one of {@link SPEC_BLOCKING_BASES}. */
export function isSpecBlockingBasis(basis: unknown): basis is SpecBlockingBasis {
  return SPEC_BLOCKING_BASES.some((b) => b === basis);
}

/** Never-blocks prefixes, matched on the trimmed message, case-insensitively. */
const NEVER_BLOCKS_PREFIX = /^(?:maybe|unverified):/i;

/**
 * The code half of the definition: true when a message marks its finding `maybe:` or
 * `unverified:`, which never blocks whatever a lane put it under. Prompt text is not
 * enforcement, so every lane that sorts blockers calls this.
 */
export function isNeverBlockingMessage(message: string): boolean {
  return NEVER_BLOCKS_PREFIX.test(message.trim());
}
