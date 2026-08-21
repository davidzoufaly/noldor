/**
 * The Why/How/What summary shape, as data — the single fact shared by the gate that
 * enforces it (`validatePrSummary` in `src/core/pr-flow.ts`) and the plan format
 * contract that prescribes it to executors (`src/prep/formats.ts`).
 *
 * A leaf module on purpose: `formats.ts` is otherwise a pure string module, and importing
 * IO-bearing modules for these constants would pull process/fs surfaces into every
 * consumer of the format strings. Keeping the shared fact here costs nothing and still
 * leaves exactly one definition — restating the sections in the contract is what let it
 * prescribe a body the gate refused (Q-0149).
 *
 * Enforcement lives at the PR seam, not on individual commits: a PR explains itself
 * once, in the body `gh pr create` receives; commit bodies are free-form.
 */

/** Section markers a PR summary must carry. */
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

const TEMPLATE = [
  'Why — the problem or motivation, plainly, then the technical detail.',
  'How — the mechanism, and where it hooks in.',
  'What — the concrete outcome: files, commands, behaviour.',
].join('\n');

/** The three-line template, for callers rendering a rejection. */
export function summaryBodyTemplate(): string {
  return TEMPLATE;
}

/**
 * Content length of one section: everything from its marker to the next marker
 * (or the end of the body), with the marker itself and all whitespace removed.
 */
function sectionLength(body: string, section: string): number | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${section} ${SECTION_SEPARATOR}`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) =>
    SECTIONS.some((s) => l.startsWith(`${s} ${SECTION_SEPARATOR}`)),
  );
  const own = [
    lines[start]!.slice(`${section} ${SECTION_SEPARATOR}`.length),
    ...(end === -1 ? rest : rest.slice(0, end)),
  ];
  return own.join('').replace(/\s/g, '').length;
}

/**
 * Does this text carry all three sections, each with enough content?
 *
 * Pure section measurement + diagnostic. The `Why:` hint matters because a colon
 * form is a valid git trailer, so an author who wrote `Why:` in a commit body
 * would see it absorbed by interpret-trailers — the em-dash marker avoids that.
 */
export function measureSections(body: string): { ok: boolean; error?: string } {
  const missing: string[] = [];
  const thin: string[] = [];
  for (const section of SECTIONS) {
    const len = sectionLength(body, section);
    if (len === null) missing.push(section);
    else if (len < MIN_SECTION_CHARS) thin.push(section);
  }
  if (missing.length === 0 && thin.length === 0) return { ok: true };

  const colonForm = SECTIONS.filter((s) => new RegExp(`^${s}:`, 'm').test(body));
  const hint =
    colonForm.length > 0
      ? ` Found ${colonForm.map((s) => `\`${s}:\``).join(', ')} — use an em dash (\`${colonForm[0]} —\`), since \`${colonForm[0]}:\` is a valid git trailer and interpret-trailers absorbs it.`
      : '';

  const parts = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    thin.length > 0 ? `under ${MIN_SECTION_CHARS} chars: ${thin.join(', ')}` : '',
  ].filter(Boolean);

  return { ok: false, error: `${parts.join('; ')}.${hint}` };
}
