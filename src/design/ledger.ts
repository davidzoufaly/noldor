import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { slugPath } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { parseSlug } from '../core/slug.js';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { extractSummary } from '../core/fd-load.js';
import { readSession } from '../core/session.js';
import { parseRoadmap } from '../utils/parse-blocks.js';
import { slugify } from '../utils/slugify.js';

/**
 * A settled decision. `id` is `D<n>`, minted in source order and never reused.
 *
 * The three optional fields are what make a decision auditable instead of merely
 * recorded: `why` is the reasoning, `insteadOf` the alternative that was rejected
 * and why not, `section` the artifact heading the decision binds. All three are
 * absent on any ledger written before they existed, which is why they are
 * optional rather than defaulted — see {@link serializeLedger}.
 */
export interface Decision {
  id: string;
  text: string;
  section?: string;
  why?: string;
  insteadOf?: string;
}

/**
 * An open thread. `id` is `O<n>`. `resolvedBy` is the `D<n>` the thread became,
 * or the literal `'(resolved)'` when a `--resolve` arrived without a decision in
 * the same invocation. `null` means still open — the only threads the renderer
 * shows.
 */
export interface OpenThread {
  id: string;
  text: string;
  resolvedBy: string | null;
  /**
   * Artifact heading this thread belongs to. A thread carries no `why` or
   * `insteadOf`: it is a question, so it has no reasoning and no road not taken
   * yet. Either field under an `O` entry is a fail-closed parse error rather
   * than a tolerated extra, so a mis-flagged value can never be silently lost.
   */
  section?: string;
}

/**
 * An operator-confirmed artifact heading, with the digest of the body they
 * approved. `digest` is the first eight lowercase hex characters of the sha256
 * of `extractSection`'s output for that heading — enough to notice an edit, and
 * short enough to keep the ledger line readable.
 */
export interface Confirmation {
  name: string;
  digest: string;
}

export interface LedgerState {
  /** Roadmap entry slug — the lookup key for scope resolution step 2. */
  entry: string | null;
  scope: string | null;
  decided: Decision[];
  open: OpenThread[];
  support: string[];
  /** Confirmed headings in confirmation order. */
  confirmed: Confirmation[];
  /**
   * Section names whose body could not be parsed, deduped. The renderer surfaces
   * these and degrades; the writer refuses to touch a ledger with any entry here
   * (see the note above `SECTIONS`).
   */
  unparsed: string[];
}

/**
 * Every heading a ledger carries. The writer refuses a file with ANY of them in
 * {@link LedgerState.unparsed} — hence no separate "critical sections" list.
 *
 * `Decided`/`Open` are load-bearing for ID minting: guessing the next id from a
 * half-read section would re-issue one. The other three matter for a different
 * reason: the writer reserializes the whole ledger from parsed state, so an
 * unparseable `Scope`/`Entry`/`Existing support` would be *erased* by the next
 * `design log` rather than merely ignored. Refusing beats silent data loss;
 * reading (and rendering) still degrades gracefully.
 */
const SECTIONS = ['Entry', 'Scope', 'Decided', 'Open', 'Existing support', 'Confirmed'] as const;
type SectionName = (typeof SECTIONS)[number];

/**
 * Collapse free text to a single storable line. Exactly two rules, both
 * *non-reintroducing* — neither output can re-create the pattern it removes,
 * which is what the no-forgery guarantee rests on:
 *
 * 1. any whitespace run containing a line terminator → one space, so a value
 *    cannot open a new line (and therefore cannot forge a section heading).
 *    Matches every JS line terminator, not just `\n`: a bare `\r`, `\u2028`, or
 *    `\u2029` survives a `\n`-only rule, serializes happily, and then fails every
 *    bullet regex on re-read (JS `.` excludes line terminators) — which would
 *    brick the dialogue's ledger, since the writer then refuses the file forever;
 * 2. any run of two-or-more tildes → one tilde, so a value cannot forge the
 *    `~~…~~ →` resolved-thread marker. Note `'~~~'.replaceAll('~~', '~ ~')`
 *    yields `'~ ~~'` — still marker-shaped — which is why the rule collapses
 *    runs instead of substituting pairs.
 *
 * No `#` escaping is needed: every value is stored as a column-0 bullet, so
 * normalized text never begins a line.
 */
export function normalize(text: string): string {
  return text
    .replace(/\s*[\n\r\u2028\u2029]\s*/g, ' ')
    .replace(/~{2,}/g, '~')
    .trim();
}

/**
 * Validate a slug-shaped CLI input. `--slug` and `--fd` are path components, so
 * a value containing `/` or `..` would escape `.noldor/design/` on write or make
 * `design context` read an arbitrary file; `--entry` is only an equality key but
 * is validated too, for one uniform error.
 *
 * The accept/reject decision is {@link parseSlug}'s, not a second one: this
 * wrapper only adds the corrected-value suggestion, which is worth keeping
 * because a typo is the common case at a CLI flag. One rule, two messages —
 * what must not diverge is which values are legal.
 *
 * @param value - Untrusted flag text.
 * @param flag - Flag name, for the diagnostic.
 * @returns An error message, or `null` when the value is a valid slug.
 */
export function validateSlug(value: string, flag: string): string | null {
  if (value.length === 0) return `${flag}: must not be empty`;
  if (parseSlug(value).ok) return null;
  const suggestion = slugify(value);
  if (suggestion.length === 0) {
    return `${flag}: '${value}' has no slug-safe characters (expected lowercase [a-z0-9-])`;
  }
  return `${flag}: '${value}' is not a slug (expected '${suggestion}')`;
}

/**
 * Validate several slug-shaped CLI inputs at once, skipping absent ones.
 *
 * Shared by both CLIs: they validate the same pair of flags in the same order,
 * and two copies of the loop would eventually disagree about which inputs are
 * path components.
 *
 * @returns The first error message, or `null` when every present value is valid.
 */
export function validateSlugs(
  pairs: readonly (readonly [flag: string, value: string | undefined])[],
): string | null {
  for (const [flag, value] of pairs) {
    if (value === undefined) continue;
    const problem = validateSlug(value, flag);
    if (problem) return problem;
  }
  return null;
}

/**
 * Validate a heading-name CLI input — `--section`, `--confirm-section`,
 * `--unconfirm-section`.
 *
 * A heading name is used two ways that must agree: looked up in the artifact
 * *raw*, and stored in the ledger *normalized*. {@link normalize} collapses `~~`
 * runs and every line terminator, so a name it would rewrite confirms against the
 * artifact and then stores under a different key — the checklist marker never
 * appears and `⚠ … matches no heading` sticks forever with nothing to diagnose
 * from. Requiring the value to be normalize-stable makes the two keys identical
 * by construction, and leaves `normalize`'s forgery guarantees untouched.
 *
 * Shared by both CLIs deliberately: the reader and the writer must accept exactly
 * the same heading universe, and two copies of this rule would eventually not.
 *
 * @returns An error message, or `null` when the value is usable as a heading key.
 */
export function validateHeadingName(value: string, flag: string): string | null {
  const stable = normalize(value);
  if (stable === value) return null;
  return (
    `${flag}: heading names must contain no line break and no '~~' run ` +
    `(got '${value}', which would be stored as '${stable}')`
  );
}

/**
 * Absolute path of a dialogue's ledger.
 *
 * The slug is branded, so the only reachable refusal is repository tampering
 * inside `.noldor/design` — a symlink or a relocated root. Reading or writing a
 * ledger has no result channel of its own, so that fails loudly.
 */
export function ledgerPath(cwd: string, slug: Slug): string {
  const built = slugPath(cwd, ['.noldor', 'design'], slug, { suffix: '.md' });
  if (!built.ok) throw new Error(`cannot resolve design ledger: ${built.error.kind}`);
  return built.path;
}

/** A ledger with every heading present and no content — the first-write shape. */
export function emptyLedger(): LedgerState {
  return {
    entry: null,
    scope: null,
    decided: [],
    open: [],
    support: [],
    confirmed: [],
    unparsed: [],
  };
}

/**
 * Split a ledger into its known sections.
 *
 * A repeated heading is reported in `duplicates` rather than resetting the
 * section: a second `## Decided` would otherwise drop every earlier decision
 * *silently*, leaving `unparsed` empty and letting the next `design log` re-mint
 * `D1` — breaking the never-reuse guarantee through the one door the fail-closed
 * check doesn't watch.
 */
function splitSections(raw: string): {
  sections: Map<SectionName, string[]>;
  duplicates: SectionName[];
  unknown: string[];
} {
  const sections = new Map<SectionName, string[]>();
  const duplicates: SectionName[] = [];
  const unknown: string[] = [];
  let current: SectionName | null = null;
  for (const line of raw.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      const name = heading[1] as SectionName;
      const known = (SECTIONS as readonly string[]).includes(name);
      // An unrecognized H2 (`## Notes`, `##  Entry` with a stray space) would
      // otherwise have its body attributed to nothing and be erased by the next
      // write, which reserializes from parsed state — the same silent-data-loss
      // class this design refuses. Report it so the writer refuses the file.
      if (!known) unknown.push(name);
      current = known ? name : null;
      if (current) {
        if (sections.has(current)) {
          duplicates.push(current);
          // Skip the duplicate's body instead of appending it into the first
          // section: merging them would surface duplicate `D`/`O` ids in the
          // rendered block. The writer already refuses the file either way.
          current = null;
        } else {
          sections.set(current, []);
        }
      }
      continue;
    }
    if (current && line.trim().length > 0) sections.get(current)!.push(line);
  }
  return { sections, duplicates, unknown };
}

/** Canonical sub-bullet: exactly two leading spaces, a known key, a non-blank value. */
const SUBBULLET_RE = /^ {2}- (section|why|instead-of): (\S.*)$/;

/** Storage line for an entry (`- D1 …` / `- O1 …`): a bullet at column 0. */
const ENTRY_LINE_RE = /^- \S/;

/** Confirmed line: `- <name> · <8 hex>`. */
const CONFIRMED_RE = /^- (\S.*?) · ([0-9a-f]{8})$/;

/** Field key as stored, mapped to the {@link Decision} property it fills. */
const FIELD_KEYS = {
  section: 'section',
  why: 'why',
  'instead-of': 'insteadOf',
} as const;
type FieldKey = keyof typeof FIELD_KEYS;

/**
 * Group a section's lines into entries with their sub-bullets.
 *
 * @returns `null` when any line fails the grammar — an orphan sub-bullet, a
 *   near-miss sub-bullet shape, an unknown key, a duplicate key, or a line that
 *   is neither. The caller turns that into an `unparsed` entry; there is no
 *   partial success, because a half-read `Decided` would let the next write
 *   re-mint an existing id.
 */
function groupEntries(
  body: readonly string[],
): { line: string; fields: Partial<Record<FieldKey, string>> }[] | null {
  const out: { line: string; fields: Partial<Record<FieldKey, string>> }[] = [];
  for (const line of body) {
    const canonical = line.match(SUBBULLET_RE);
    if (canonical) {
      const last = out[out.length - 1];
      if (last === undefined) return null; // sub-bullet before any entry
      const key = canonical[1] as FieldKey;
      if (last.fields[key] !== undefined) return null; // duplicate key
      last.fields[key] = canonical[2]!;
      continue;
    }
    if (ENTRY_LINE_RE.test(line)) {
      out.push({ line, fields: {} });
      continue;
    }
    // Anything else fails closed, which is what covers the near-misses: one or
    // three spaces of indentation, an unknown key, an empty value. The writer
    // reserializes from parsed state, so a line merely *ignored* here would be
    // erased on the next write — the silent-data-loss class the unknown-heading
    // rule already refuses.
    return null;
  }
  return out;
}

/** Strip the storage bullet from a value line, or `null` when not a bullet. */
function unbullet(line: string): string | null {
  const m = line.match(/^- (.*)$/);
  return m ? m[1] : null;
}

/**
 * Parse a ledger. Tolerant by design: a section whose body does not match its
 * expected bullet shape is dropped and its name recorded in
 * {@link LedgerState.unparsed}, so rendering degrades instead of throwing. The
 * writer checks `unparsed` before touching the file.
 */
export function parseLedger(raw: string): LedgerState {
  const { sections, duplicates, unknown } = splitSections(raw);
  const state: LedgerState = emptyLedger();
  state.unparsed.push(...duplicates, ...unknown.map((name) => `unknown heading '${name}'`));

  const entryLines = sections.get('Entry') ?? [];
  if (entryLines.length > 0) {
    // `## Entry` holds exactly one bullet. Extra lines mean the file was
    // hand-edited: flag it rather than silently honouring the first line and
    // erasing the rest on the next write.
    const value = entryLines.length === 1 ? unbullet(entryLines[0]) : null;
    if (value === null) state.unparsed.push('Entry');
    else state.entry = value;
  }

  const scopeLines = sections.get('Scope') ?? [];
  if (scopeLines.length > 0) {
    const values = scopeLines.map(unbullet);
    if (values.some((v) => v === null)) state.unparsed.push('Scope');
    else state.scope = values.join(' ');
  }

  const decidedEntries = groupEntries(sections.get('Decided') ?? []);
  if (decidedEntries === null) state.unparsed.push('Decided');
  else {
    for (const entry of decidedEntries) {
      const m = entry.line.match(/^- (D\d+) (.*)$/);
      if (!m) {
        state.unparsed.push('Decided');
        state.decided = [];
        break;
      }
      const d: Decision = { id: m[1]!, text: m[2]! };
      for (const [key, prop] of Object.entries(FIELD_KEYS)) {
        const value = entry.fields[key as FieldKey];
        if (value !== undefined) d[prop] = value;
      }
      state.decided.push(d);
    }
  }

  const openEntries = groupEntries(sections.get('Open') ?? []);
  if (openEntries === null) state.unparsed.push('Open');
  else {
    for (const entry of openEntries) {
      // `why`/`instead-of` are decision-only: a thread has no reasoning yet, so
      // accepting one here would store a value the renderer never shows and the
      // next write would drop. Fail closed instead.
      if (entry.fields.why !== undefined || entry.fields['instead-of'] !== undefined) {
        state.unparsed.push('Open');
        state.open = [];
        break;
      }
      const resolved = entry.line.match(/^- (O\d+) ~~(.*)~~ → (D\d+|\(resolved\))$/);
      const plain = resolved ? null : entry.line.match(/^- (O\d+) (.*)$/);
      const m = resolved ?? plain;
      if (!m) {
        state.unparsed.push('Open');
        state.open = [];
        break;
      }
      const o: OpenThread = {
        id: m[1]!,
        text: m[2]!,
        resolvedBy: resolved ? resolved[3]! : null,
      };
      if (entry.fields.section !== undefined) o.section = entry.fields.section;
      state.open.push(o);
    }
  }

  for (const line of sections.get('Existing support') ?? []) {
    const value = unbullet(line);
    if (value === null) {
      state.unparsed.push('Existing support');
      state.support = [];
      break;
    }
    state.support.push(value);
  }

  for (const line of sections.get('Confirmed') ?? []) {
    const m = line.match(CONFIRMED_RE);
    // A duplicate name would make one heading both fresh and stale depending on
    // which record the renderer reached first.
    if (!m || state.confirmed.some((c) => c.name === m[1])) {
      state.unparsed.push('Confirmed');
      state.confirmed = [];
      break;
    }
    state.confirmed.push({ name: m[1]!, digest: m[2]! });
  }

  // A section can trip two detectors at once (duplicate heading *and* an
  // unparseable body); report each name once so the writer's error names it once.
  state.unparsed = [...new Set(state.unparsed)];
  return state;
}

/**
 * Render a ledger back to its on-disk form. Every entry value is a column-0
 * bullet; every field is a two-space-indented sub-bullet beneath its entry, in
 * canonical `section → why → instead-of` order.
 *
 * `Decision` stores named fields with no memory of input order, so a hand-written
 * ledger whose sub-bullets arrive in another order re-serializes canonically.
 * That is the one respect in which the round trip is semantic rather than
 * byte-preserving.
 *
 * `Confirmed` is the only heading emitted conditionally. Every other heading is
 * written whether or not it has a body — the shape every ledger predating this
 * change already has on disk — so emitting an empty `## Confirmed` too would
 * rewrite all of them on their next touch.
 */
export function serializeLedger(slug: string, state: LedgerState): string {
  const lines = [`# Design ledger — ${slug}`, ''];
  const section = (name: SectionName, body: string[]): void => {
    lines.push(`## ${name}`, '');
    for (const b of body) lines.push(b);
    if (body.length > 0) lines.push('');
  };
  const fields = (d: Decision | OpenThread): string[] =>
    (Object.entries(FIELD_KEYS) as [FieldKey, (typeof FIELD_KEYS)[FieldKey]][])
      .map(([key, prop]) => [key, (d as Decision)[prop]] as const)
      .filter((pair): pair is [FieldKey, string] => pair[1] !== undefined)
      .map(([key, value]) => `  - ${key}: ${value}`);

  section('Entry', state.entry === null ? [] : [`- ${state.entry}`]);
  section('Scope', state.scope === null ? [] : [`- ${state.scope}`]);
  section(
    'Decided',
    state.decided.flatMap((d) => [`- ${d.id} ${d.text}`, ...fields(d)]),
  );
  section(
    'Open',
    state.open.flatMap((o) => [
      o.resolvedBy === null ? `- ${o.id} ${o.text}` : `- ${o.id} ~~${o.text}~~ → ${o.resolvedBy}`,
      ...fields(o),
    ]),
  );
  section(
    'Existing support',
    state.support.map((s) => `- ${s}`),
  );
  if (state.confirmed.length > 0) {
    section(
      'Confirmed',
      state.confirmed.map((c) => `- ${c.name} · ${c.digest}`),
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Read a ledger from disk, or an empty state when the file does not exist. */
export function readLedger(cwd: string, slug: Slug): LedgerState {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return emptyLedger();
  return parseLedger(readFileSync(p, 'utf8'));
}

export function writeLedger(cwd: string, slug: Slug, state: LedgerState): void {
  const p = ledgerPath(cwd, slug);
  mkdirSync(dirname(p), { recursive: true });
  atomicWriteFileSync(p, serializeLedger(slug, state));
}

/** Next unused `D`/`O` id — max existing + 1, so ids are never reused. */
export function nextId(prefix: 'D' | 'O', existing: readonly { id: string }[]): string {
  const max = existing.reduce((acc, e) => {
    const n = Number.parseInt(e.id.slice(1), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `${prefix}${max + 1}`;
}

/** The literal rendered when no scope could be resolved from any source. */
export const NO_SCOPE = '(scope not recorded)';

/**
 * Resolve the Scope text, first hit wins:
 *
 * 1. the ledger's own `## Scope` (explicit, via `design log --scope`);
 * 2. the `docs/roadmap.md` block whose slug equals the ledger's `## Entry`
 *    (falling back to the dialogue slug, which is the entry slug on `*-new`
 *    paths). Re-read every call, so an entry retired mid-dialogue falls through;
 * 3. `## Summary` of `docs/features/<fd-slug>.md`, where `<fd-slug>` is the
 *    caller's `--fd`, else the `parent` of an attach session marker, else the
 *    dialogue slug;
 * 4. {@link NO_SCOPE}.
 *
 * Steps 2 and 3 are what make attach paths work: there the dialogue slug is
 * `<parent>-<enhancement>`, which matches neither the entry slug nor the FD
 * filename.
 */
export function loadScope(
  cwd: string,
  opts: { slug: string; state: LedgerState; fdSlug?: string },
): string {
  // An explicitly-blank `--scope ""` is not a scope — fall through to the repo
  // sources rather than short-circuiting on an empty string.
  if (opts.state.scope !== null && opts.state.scope.length > 0) return opts.state.scope;

  const roots = loadDocRoots(cwd);
  const entrySlug = opts.state.entry ?? opts.slug;
  if (existsSync(roots.roadmap)) {
    const hit = parseRoadmap(readFileSync(roots.roadmap, 'utf8')).find((e) => e.slug === entrySlug);
    if (hit) return normalize(hit.description);
  }

  const session = (() => {
    try {
      return readSession(cwd);
    } catch {
      // A malformed or foreign session marker must never break a design
      // dialogue — fall through to the dialogue slug.
      return null;
    }
  })();
  const markerParent =
    session?.path === 'specs-only-attach' || session?.path === 'full-attach'
      ? (session.parent ?? null)
      : null;
  // The marker is written by the gate, but it is a file on disk like any other:
  // validate before it becomes a path component (same rule as `--fd`).
  const attachParent =
    markerParent !== null && validateSlug(markerParent, 'session parent') === null
      ? markerParent
      : null;
  const fdSlug = opts.fdSlug ?? attachParent ?? opts.slug;
  const fdPath = join(roots.features, `${fdSlug}.md`);
  if (existsSync(fdPath)) {
    // Reuse the core helper rather than a fourth copy of the Summary regex
    // (`design → core` is an allowed edge — see the other core imports above).
    // A missing or empty `## Summary` yields `''`, which is no scope at all, so
    // fall through instead of rendering a blank Scope line.
    const summary = normalize(extractSummary(readFileSync(fdPath, 'utf8')));
    if (summary.length > 0) return summary;
  }

  return NO_SCOPE;
}
