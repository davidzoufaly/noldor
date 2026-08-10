/**
 * Blocker classification carried on a {@link Finding}.
 *
 * `mechanical` — the fix is determined by the finding itself (a missing required
 * section, an unanswered open question, a lint-class defect, a stated contract
 * not met). Safe for the gate to apply without asking.
 *
 * `design` — the fix requires a judgment call the reviewer is not making for
 * you (disagreement about an approach, a default, a trade-off). Needs operator
 * arbitration.
 *
 * The REVIEWER assigns this, never the controller that would apply the fix:
 * whoever applies a fix must not also decide it is safe to apply unasked, or it
 * is grading its own permission slip.
 */
export const FINDING_CLASSES = ['mechanical', 'design'] as const;
export type FindingClass = (typeof FINDING_CLASSES)[number];

/** A bullet split into its optional leading class tag and the remaining message. */
export interface ClassTagSplit {
  readonly class?: FindingClass;
  readonly message: string;
}

/**
 * Matches a recognized class tag at the very start of a bullet, e.g.
 * `[mechanical] Acceptance criteria section absent`. Case-insensitive because
 * agents deviate; anchored so a bracket later in the message is never eaten.
 *
 * The trailing `(?=\S)` requires something to remain AFTER the tag. Without it a
 * degenerate bullet of nothing but a tag (`- [mechanical]`) stripped to an empty
 * `message`, which `findingSchema` rejects (`min(1)`); the lane writes its sink
 * unvalidated, so `aggregate` then failed the whole file's `safeParse` and
 * replaced EVERY real blocker in it with one synthetic `schema error` — losing
 * the reviewer's actual findings at the autofix seam and at `cr escalate`. A
 * tag-only bullet now falls through as an untagged message instead.
 */
const CLASS_TAG_RE = new RegExp(`^\\[(${FINDING_CLASSES.join('|')})\\]\\s*(?=\\S)`, 'i');

/**
 * Split a reviewer bullet into its class tag and message.
 *
 * An absent tag yields no `class` key — the sink records what the reviewer
 * actually said, and the fail-safe read ("untagged means `design`") is applied
 * at the decision site in `autofix.ts`, not written into the sink. An
 * unrecognized bracket prefix (`[perf] …`) is left in the message untouched
 * rather than guessed at.
 */
export function splitClassTag(bullet: string): ClassTagSplit {
  const m = CLASS_TAG_RE.exec(bullet);
  if (!m) return { message: bullet };
  return {
    class: m[1]!.toLowerCase() as FindingClass,
    message: bullet.slice(m[0].length),
  };
}
