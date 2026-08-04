import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { readSession } from '../core/session.js';
import { parseRoadmap } from '../utils/parse-blocks.js';
import { slugify } from '../utils/slugify.js';

/** A settled decision. `id` is `D<n>`, minted in source order and never reused. */
export interface Decision {
  id: string;
  text: string;
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
}

export interface LedgerState {
  /** Roadmap entry slug — the lookup key for scope resolution step 2. */
  entry: string | null;
  scope: string | null;
  decided: Decision[];
  open: OpenThread[];
  support: string[];
  /**
   * Section names whose body could not be parsed. The renderer surfaces these
   * and degrades; the writer refuses to touch a ledger with any of `Decided` /
   * `Open` listed here (see {@link WRITE_CRITICAL_SECTIONS}).
   */
  unparsed: string[];
}

/** Sections the writer must be able to parse to mint the next ID safely. */
export const WRITE_CRITICAL_SECTIONS = ['Decided', 'Open'] as const;

const SECTIONS = ['Entry', 'Scope', 'Decided', 'Open', 'Existing support'] as const;
type SectionName = (typeof SECTIONS)[number];

/**
 * Collapse free text to a single storable line. Exactly two rules, both
 * *non-reintroducing* — neither output can re-create the pattern it removes,
 * which is what the no-forgery guarantee rests on:
 *
 * 1. any whitespace run containing a newline → one space, so a value cannot
 *    open a new line (and therefore cannot forge a section heading);
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
    .replace(/\s*\n\s*/g, ' ')
    .replace(/~{2,}/g, '~')
    .trim();
}

/**
 * Validate a slug-shaped CLI input. `--slug` and `--fd` are path components, so
 * a value containing `/` or `..` would escape `.noldor/design/` on write or make
 * `design context` read an arbitrary file; `--entry` is only an equality key but
 * is validated too, for one uniform error.
 *
 * @returns An error message, or `null` when the value is a valid slug.
 */
export function validateSlug(value: string, flag: string): string | null {
  if (value.length === 0) return `${flag}: must not be empty`;
  if (slugify(value) !== value) {
    return `${flag}: '${value}' is not a slug (expected '${slugify(value)}')`;
  }
  return null;
}

/** Absolute path of a dialogue's ledger. */
export function ledgerPath(cwd: string, slug: string): string {
  return join(cwd, '.noldor', 'design', `${slug}.md`);
}

const EMPTY: LedgerState = {
  entry: null,
  scope: null,
  decided: [],
  open: [],
  support: [],
  unparsed: [],
};

/** A ledger with every heading present and no content — the first-write shape. */
export function emptyLedger(): LedgerState {
  return { ...EMPTY, decided: [], open: [], support: [], unparsed: [] };
}

function splitSections(raw: string): Map<SectionName, string[]> {
  const out = new Map<SectionName, string[]>();
  let current: SectionName | null = null;
  for (const line of raw.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      const name = heading[1] as SectionName;
      current = (SECTIONS as readonly string[]).includes(name) ? name : null;
      if (current) out.set(current, []);
      continue;
    }
    if (current && line.trim().length > 0) out.get(current)!.push(line);
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
  const sections = splitSections(raw);
  const state: LedgerState = emptyLedger();

  const entryLines = sections.get('Entry') ?? [];
  if (entryLines.length > 0) {
    const value = unbullet(entryLines[0]);
    if (value === null) state.unparsed.push('Entry');
    else state.entry = value;
  }

  const scopeLines = sections.get('Scope') ?? [];
  if (scopeLines.length > 0) {
    const values = scopeLines.map(unbullet);
    if (values.some((v) => v === null)) state.unparsed.push('Scope');
    else state.scope = values.join(' ');
  }

  for (const line of sections.get('Decided') ?? []) {
    const m = line.match(/^- (D\d+) (.*)$/);
    if (!m) {
      state.unparsed.push('Decided');
      state.decided = [];
      break;
    }
    state.decided.push({ id: m[1], text: m[2] });
  }

  for (const line of sections.get('Open') ?? []) {
    const resolved = line.match(/^- (O\d+) ~~(.*)~~ → (D\d+|\(resolved\))$/);
    if (resolved) {
      state.open.push({ id: resolved[1], text: resolved[2], resolvedBy: resolved[3] });
      continue;
    }
    const plain = line.match(/^- (O\d+) (.*)$/);
    if (!plain) {
      state.unparsed.push('Open');
      state.open = [];
      break;
    }
    state.open.push({ id: plain[1], text: plain[2], resolvedBy: null });
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

  return state;
}

/** Render a ledger back to its on-disk form. Every value is a column-0 bullet. */
export function serializeLedger(slug: string, state: LedgerState): string {
  const lines = [`# Design ledger — ${slug}`, ''];
  const section = (name: SectionName, body: string[]): void => {
    lines.push(`## ${name}`, '');
    for (const b of body) lines.push(b);
    if (body.length > 0) lines.push('');
  };
  section('Entry', state.entry === null ? [] : [`- ${state.entry}`]);
  section('Scope', state.scope === null ? [] : [`- ${state.scope}`]);
  section(
    'Decided',
    state.decided.map((d) => `- ${d.id} ${d.text}`),
  );
  section(
    'Open',
    state.open.map((o) =>
      o.resolvedBy === null ? `- ${o.id} ${o.text}` : `- ${o.id} ~~${o.text}~~ → ${o.resolvedBy}`,
    ),
  );
  section(
    'Existing support',
    state.support.map((s) => `- ${s}`),
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Read a ledger from disk, or an empty state when the file does not exist. */
export function readLedger(cwd: string, slug: string): LedgerState {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return emptyLedger();
  return parseLedger(readFileSync(p, 'utf8'));
}

export function writeLedger(cwd: string, slug: string, state: LedgerState): void {
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
  if (opts.state.scope !== null) return opts.state.scope;

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
  const attachParent =
    session?.path === 'specs-only-attach' || session?.path === 'full-attach'
      ? (session.parent ?? null)
      : null;
  const fdSlug = opts.fdSlug ?? attachParent ?? opts.slug;
  const fdPath = join(roots.features, `${fdSlug}.md`);
  if (existsSync(fdPath)) {
    const m = readFileSync(fdPath, 'utf8').match(/^## Summary\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
    if (m) return normalize(m[1]);
  }

  return NO_SCOPE;
}
