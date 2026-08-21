import { normalize, type Decision, type LedgerState, type OpenThread } from './ledger.js';

/** One addressable artifact heading, with the digest of its current body. */
export interface RenderHeading {
  name: string;
  depth: 2 | 3;
  /** sha256 prefix of the body as it stands now — the CLI hashes, not the renderer. */
  digest: string;
}

export interface RenderOpts {
  slug: string;
  kind: 'spec' | 'plan';
  /** Scope text already resolved by `loadScope` — the renderer does no I/O. */
  scope: string;
  /** The heading under discussion. Absent → no focus block, everything collapsed. */
  section?: string;
  /** Body of `section` as it stands on disk. Absent → the focus block says so. */
  sectionProse?: string;
  /** Every addressable heading of the located artifact, in document order. */
  headings?: RenderHeading[];
  /** Expand every value and every field, everywhere. */
  full?: boolean;
  /** Why there is no artifact to read, when there is none. */
  artifactNote?: string;
}

const RULE = '─'.repeat(60);

/**
 * Sentence boundary: terminal punctuation, whitespace, then something that can
 * start a sentence.
 *
 * No abbreviation dictionary. The consequence of a miss is a *longer* collapsed
 * line, never a truncated-and-inverted one, so the cheap rule is the safe one.
 */
const BOUNDARY = /([.!?])\s+(?=[A-Z0-9])/g;

/** Split on sentence boundaries, keeping terminal punctuation with its sentence. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  BOUNDARY.lastIndex = 0;
  for (let m = BOUNDARY.exec(text); m !== null; m = BOUNDARY.exec(text)) {
    out.push(text.slice(last, m.index + m[1]!.length));
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  // A terminatorless trailing fragment is still a sentence — it is content the
  // collapsed line is hiding, so it has to be counted.
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * One line standing in for a longer record: its first sentence, plus a marker
 * naming what was withheld.
 *
 * Takes the entry rather than a bare string because the marker names fields the
 * text does not contain. The withheld-marker is the whole contract of the digest:
 * an operator can see that a rationale exists without reading it, and knows to
 * open the ledger or pass `--full` when it matters.
 */
export function collapse(entry: { text: string; why?: string; insteadOf?: string }): string {
  const parts = sentences(entry.text);
  const head = parts[0] ?? entry.text;
  const marks: string[] = [];
  if (parts.length > 1) marks.push(`(+${parts.length - 1} more)`);
  if (entry.why !== undefined) marks.push('(+why)');
  if (entry.insteadOf !== undefined) marks.push('(+alt)');
  return marks.length > 0 ? `${head} ${marks.join(' ')}` : head;
}

/** Field lines beneath an expanded decision, in canonical order. */
function fieldLines(d: Decision, indent: string): string[] {
  const out: string[] = [];
  if (d.section !== undefined) out.push(`${indent}section: ${d.section}`);
  if (d.why !== undefined) out.push(`${indent}why: ${d.why}`);
  if (d.insteadOf !== undefined) out.push(`${indent}instead-of: ${d.insteadOf}`);
  return out;
}

/**
 * Prose as it reaches chat: every line indented four spaces.
 *
 * Four is load-bearing, not cosmetic. CommonMark allows a fenced-code delimiter
 * or an ATX heading at most *three* spaces of indentation, so a four-space indent
 * makes a ``` line, a ~~~ line and a `## …` line inside the drafted prose all
 * inert — and a four-space-indented fence cannot close the fenced block the skill
 * wraps this output in. That is the second forgery layer this module has always
 * relied on; printing drafted prose verbatim would have broken it.
 *
 * Blank lines stay blank rather than becoming four spaces, so paragraphs read as
 * paragraphs and no trailing whitespace lands in the transcript.
 */
function indentProse(prose: string): string[] {
  return prose.split('\n').map((l) => (l.trim() === '' ? '' : `    ${l}`));
}

/**
 * Marker for one heading. `▸` outranks confirmation state.
 *
 * `authoritative` is false for a repeated name's second and later occurrences.
 * Everything else in the block — `extractSection`, the confirmation digest, the
 * heading position — resolves a duplicated name to its first occurrence, so
 * marking the later ones current or confirmed would contradict the rest of the
 * output. They render plain, and the duplicate itself is a warning.
 */
function marker(
  h: RenderHeading,
  opts: RenderOpts,
  confirmedBy: Map<string, string>,
  authoritative: boolean,
): string {
  if (!authoritative) return '·';
  if (opts.section === h.name) return '▸';
  const digest = confirmedBy.get(h.name);
  if (digest === undefined) return '·';
  return digest === h.digest ? '✓' : '✎';
}

/**
 * Render the design-context block: the running state an operator needs to answer
 * a design question without reconstructing it from memory.
 *
 * **This block is the operator's digest; `.noldor/design/<slug>.md` is the
 * complete record.** That split is what licenses the collapsing below. An earlier
 * revision of this module capped nothing, arguing that hiding early decisions
 * invites self-contradiction — true, but the reader that invariant protects is the
 * *agent*, and the agent can read the ledger file directly. What the operator
 * needs is a block short enough to actually read, so every entry outside the
 * heading under discussion collapses to one line and `full` restores the lot.
 *
 * Fixed order — status → headings → scope → focus → collapsed buckets →
 * warnings → unparsed — because the caller pastes this immediately *above* the
 * question, so the question stays the last thing read.
 *
 * Pure — same state and options in, same string out. All I/O lives in
 * `ledger.ts`, `artifact-locate.ts` and the CLIs; in particular the renderer
 * never hashes a body, which is why {@link RenderHeading} carries a digest.
 */
export function renderContext(state: LedgerState, opts: RenderOpts): string {
  const headings = opts.headings ?? [];
  const openThreads = state.open.filter((o) => o.resolvedBy === null);
  const confirmedBy = new Map(state.confirmed.map((c) => [c.name, c.digest]));
  const known = new Set(headings.map((h) => h.name));
  const focus = opts.section !== undefined && known.has(opts.section) ? opts.section : null;
  const expand = opts.full === true;

  const lines: string[] = [RULE, `DESIGN CONTEXT — ${opts.slug}`];

  if (headings.length > 0) {
    const fresh = state.confirmed.filter((c) => confirmedDigestMatches(c.name, c.digest, headings));
    const stale = state.confirmed.length - fresh.length;
    const position = focus === null ? null : headings.findIndex((h) => h.name === focus) + 1;
    const parts = [
      position === null ? `${headings.length} headings` : `heading ${position}/${headings.length}`,
      `${fresh.length} confirmed`,
    ];
    if (stale > 0) parts.push(`${stale} stale`);
    lines.push(parts.join(' · '));
  }
  lines.push('');

  if (headings.length > 0) {
    lines.push('Headings');
    for (const [i, h] of headings.entries()) {
      const first = headings.findIndex((x) => x.name === h.name) === i;
      lines.push(`  ${marker(h, opts, confirmedBy, first)} ${'  '.repeat(h.depth - 2)}${h.name}`);
    }
    lines.push('');
  }

  lines.push(opts.kind === 'plan' ? 'Plan scope' : 'Scope');
  lines.push(`- ${expand ? opts.scope : collapse({ text: opts.scope })}`, '');

  if (opts.artifactNote !== undefined) {
    lines.push(`Draft`, `- ${opts.artifactNote}`, '');
  }

  const shownHere = new Set<string>();
  if (focus !== null) {
    lines.push(`${focus} — current draft`);
    lines.push(
      ...(opts.sectionProse === undefined || opts.sectionProse.trim() === ''
        ? ['    (this heading has no body yet)']
        : indentProse(opts.sectionProse)),
    );
    const bound = state.decided.filter((d) => d.section === focus);
    if (bound.length > 0) {
      lines.push('', '  Decided here');
      for (const d of bound) {
        shownHere.add(d.id);
        lines.push(`  - ${d.id} ${d.text}`, ...fieldLines(d, '      '));
      }
    }
    lines.push('');
  }

  const elsewhere = state.decided.filter((d) => !shownHere.has(d.id));
  // Under a focus heading the bucket may list fewer rows than the ledger holds,
  // so the label names both numbers rather than a count that disagrees with the
  // rows. Keyed on the focus, not on whether anything was actually bound to it:
  // "Decided (3)" under an active focus reads as though nothing was withheld.
  lines.push(
    focus !== null
      ? `Decided elsewhere (${elsewhere.length} of ${state.decided.length})`
      : `Decided (${state.decided.length})`,
  );
  if (elsewhere.length === 0) {
    lines.push(
      state.decided.length === 0 ? '- (no decisions recorded yet)' : '- (all shown above)',
    );
  } else {
    for (const d of elsewhere) {
      lines.push(`- ${d.id} ${expand ? d.text : collapse(d)}`);
      if (expand) lines.push(...fieldLines(d, '    '));
    }
  }
  lines.push('');

  lines.push(`Open (${openThreads.length})`);
  if (openThreads.length === 0) lines.push('- (none open)');
  else for (const o of openThreads) lines.push(`- ${o.id} ${expand ? o.text : collapse(o)}`);
  lines.push('');

  lines.push(`Existing support (${state.support.length})`);
  if (state.support.length === 0) lines.push('- (none recorded)');
  else for (const s of state.support) lines.push(`- ${expand ? s : collapse({ text: s })}`);

  const warnings = collectWarnings(state, opts, headings, known);
  if (warnings.length > 0) lines.push('', 'Warnings', ...warnings);

  for (const section of state.unparsed) {
    lines.push('', `⚠ ledger section unparsed: ${section}`);
  }

  lines.push(RULE);
  return `${lines.join('\n')}\n`;
}

function confirmedDigestMatches(
  name: string,
  digest: string,
  headings: readonly RenderHeading[],
): boolean {
  const h = headings.find((x) => x.name === name);
  return h !== undefined && h.digest === digest;
}

/**
 * Everything the operator should distrust in what they are reading.
 *
 * Suppressed wholesale when no artifact was located: without a heading list
 * nothing is judgeable, and warning about every stored tag would be noise on the
 * one path where the operator can do nothing about it.
 */
function collectWarnings(
  state: LedgerState,
  opts: RenderOpts,
  headings: readonly RenderHeading[],
  known: ReadonlySet<string>,
): string[] {
  if (headings.length === 0) return [];
  const out: string[] = [];
  const legal = headings.map((h) => h.name).join(', ');

  if (opts.section !== undefined && !known.has(opts.section)) {
    // `--section` arrives straight from argv, so it is the one value in this block
    // that has not been through the ledger writer. Without `normalize` a value
    // carrying a line terminator plus a fence would emit extra lines into output
    // the skills paste inside a fenced block — the forgery `indentProse` and
    // `ledger.normalize` exist to close.
    out.push(`⚠ --section '${normalize(opts.section)}' matches no heading — legal: ${legal}`);
  }

  const tagged: (Decision | OpenThread)[] = [...state.decided, ...state.open];
  for (const e of tagged) {
    if (e.section !== undefined && !known.has(e.section)) {
      out.push(`⚠ ${e.id} section '${e.section}' matches no heading`);
    }
  }

  for (const c of state.confirmed) {
    if (!known.has(c.name)) {
      out.push(`⚠ confirmed heading '${c.name}' matches no heading`);
      continue;
    }
    if (!confirmedDigestMatches(c.name, c.digest, headings)) {
      out.push(`⚠ confirmed heading '${c.name}' has changed since it was confirmed`);
    }
  }

  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h.name, (counts.get(h.name) ?? 0) + 1);
  for (const [name, n] of counts) {
    if (n > 1) out.push(`⚠ heading '${name}' appears ${n} times — using the first`);
  }

  return out;
}
