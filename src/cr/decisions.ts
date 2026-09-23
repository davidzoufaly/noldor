/**
 * The series' decided findings (Q-0261, docs/adr/0004).
 *
 * One file per slug+kind series, `.noldor/cr/decisions/<slug>-<kind>.json`, scoped to the gate
 * session with the round ledger's key. Two writers, both between rounds: `cr orchestrate` records
 * a `fixed` decision for each prior a lane answered resolved, and `cr arbitration dispose` records
 * an operator's ruling. Every read that fails is reported and read as "nothing decided", which
 * carries blockers rather than suppressing one.
 *
 * A subdirectory of `.noldor/cr` for the reason `ledgerDir` documents: `aggregate` reads every
 * `.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink. NOT tracked by git; what reaches
 * `main` is the `Noldor-CR-Settled:` trailers a green code round's receipt amend writes from it.
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

import { readFileNoFollowAsync, slugKindJsonPath } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { DISPOSITIONS } from './arbitration.js';
import { writeJsonAtomic } from './atomic-write.js';
import { isSameSeries } from './autofix-ledger.js';
import { artifactKindSchema, findingSchema, laneSchema } from './findings-schema.js';
import type { ArtifactKind, Finding } from './findings-schema.js';

// Every schema here is strict: an unknown key is rejected rather than stripped, so a store a
// newer version wrote reads as unusable (and carries) instead of losing that key on a rewrite.

/** The text of one line span a ruling cites, read at the head its round reviewed. */
export const citationSchema = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    text: z.string().min(1),
  })
  .strict();
export type Citation = z.infer<typeof citationSchema>;

export const decisionSchema = z
  .object({
    /** The finding's `fingerprintBlocker` id. */
    id: z.string().min(1),
    finding: findingSchema,
    lanes: z.array(laneSchema).min(1),
    disposition: z.enum(['fixed', ...DISPOSITIONS]),
    /** The lane's `why` for `fixed`, the operator's note for a ruling. */
    reason: z.string(),
    round: z.number().int().nonnegative(),
    /** What an operator ruling cites. Absent on `fixed`, and on a ruling that cites nothing. */
    cites: z.array(citationSchema).optional(),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;

export const decisionStoreSchema = z
  .object({
    version: z.literal(1),
    slug: z.string().min(1),
    kind: artifactKindSchema,
    sessionStartedAt: z.string(),
    decisions: z.array(decisionSchema),
  })
  .strict();
export type DecisionStore = z.infer<typeof decisionStoreSchema>;

/**
 * Store path for a `slug`+`kind` pair. Branded slug in, so a refusal here means a symlink or a
 * relocated root under `.noldor/cr/decisions` — tampering, not a bad argument.
 */
export function decisionsPath(cwd: string, slug: Slug, kind: ArtifactKind): string {
  return slugKindJsonPath(cwd, ['.noldor', 'cr', 'decisions'], slug, kind, 'decision store');
}

export type DecisionsRead =
  | { ok: true; decisions: Decision[] }
  | { ok: false; path: string; detail: string };

/**
 * The current session's decisions for a series. Empty when the file is absent, belongs to another
 * session, or there is no session at all: the empty key is shared by every sessionless run, so
 * reading under it would carry one series' rulings into the next — `hasClosingRound` refuses that
 * key for the same reason. Never throws: every other failure — a refused path, an unreadable file,
 * JSON or a schema that does not parse — is `ok: false`, and every caller then proceeds as though
 * nothing were decided.
 */
export async function readDecisions(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  sessionStartedAt: string,
): Promise<DecisionsRead> {
  if (sessionStartedAt === '') return { ok: true, decisions: [] };
  let path = `.noldor/cr/decisions (${kind})`;
  try {
    path = decisionsPath(cwd, slug, kind);
    const parsed = decisionStoreSchema.safeParse(JSON.parse(await readFileNoFollowAsync(path)));
    if (!parsed.success)
      return { ok: false, path, detail: `schema mismatch: ${parsed.error.message}` };
    return {
      ok: true,
      decisions: isSameSeries(parsed.data, sessionStartedAt) ? parsed.data.decisions : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, decisions: [] };
    return { ok: false, path, detail: (err as Error).message };
  }
}

export type DecisionsWrite = { ok: true; decisions: Decision[] } | { ok: false; reason: string };

/**
 * Re-read the store, apply `change`, and write the result atomically. Re-reading here, rather
 * than writing a list read earlier, narrows the window in which a ruling made while a round ran
 * could be overwritten by that round's `fixed` write. Refuses with no session (see
 * {@link readDecisions}), and refuses rather than replaces a file it cannot read: deleting it is
 * the operator's call.
 */
// noldor:cut check-then-act, one mutating process per slug+kind at a time — the gate runs
// orchestrate and `dispose` in sequence, as it does orchestrate and `cr autofix record` over the
// round ledger; a lock around the read-through-rename span is the upgrade path.
export async function updateDecisions(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  sessionStartedAt: string,
  change: (current: readonly Decision[]) => Decision[],
): Promise<DecisionsWrite> {
  if (sessionStartedAt === '')
    return {
      ok: false,
      reason:
        'no session marker — decisions are kept per gate session, and a run outside one records none',
    };
  const current = await readDecisions(cwd, slug, kind, sessionStartedAt);
  if (!current.ok)
    return {
      ok: false,
      reason: `decision store unreadable (${current.path}): ${current.detail} — remove it to start this series' decisions over`,
    };
  const decisions = change(current.decisions);
  const path = decisionsPath(cwd, slug, kind);
  const store: DecisionStore = { version: 1, slug, kind, sessionStartedAt, decisions };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeJsonAtomic(path, store);
  } catch (err) {
    return { ok: false, reason: `decision store not written (${path}): ${(err as Error).message}` };
  }
  return { ok: true, decisions };
}

/** `decisions` with `d` in place of any decision for the same id. */
export function upsertDecision(decisions: readonly Decision[], d: Decision): Decision[] {
  return [...decisions.filter((x) => x.id !== d.id), d];
}

/** What reading one path at one revision found. `unreadable` means git itself failed. */
export type TreeRead =
  | { kind: 'file'; text: string }
  | { kind: 'missing' }
  | { kind: 'unreadable'; detail: string };
export type TreeReader = (rev: string, path: string) => Promise<TreeRead>;

/** Every git read here is bounded: a hung subprocess must not hang a CLI or a round. */
const GIT_TIMEOUT_MS = 30_000;

const execFileP = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileP('git', [...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * A path a finding names is model output. It is read through git, so it resolves against the
 * commit's tree and never the working tree — a symlink cannot lead outside the checkout — and an
 * absolute path or a `..` segment is refused before git sees it.
 */
function isTreePath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').includes('..');
}

/** Reads a file at a revision through git; the production {@link TreeReader}. */
export function gitTreeReader(cwd: string): TreeReader {
  return async (rev, path) => {
    if (!isTreePath(path)) return { kind: 'missing' };
    let entry: string;
    try {
      entry = await git(cwd, ['ls-tree', '--full-tree', rev, '--', path]);
    } catch (err) {
      return { kind: 'unreadable', detail: (err as Error).message };
    }
    // `<mode> blob <sha>\t<path>` for a file; nothing for a path the tree lacks, `tree` for a dir.
    if (!/^\S+ blob \S+\t/.test(entry)) return { kind: 'missing' };
    try {
      return { kind: 'file', text: await git(cwd, ['cat-file', 'blob', `${rev}:${path}`]) };
    } catch (err) {
      return { kind: 'unreadable', detail: (err as Error).message };
    }
  };
}

/** Whether git can read `rev` as a commit — `dispose` records nothing when it cannot. */
export async function readCommit(
  cwd: string,
  rev: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await git(cwd, ['cat-file', '-e', `${rev}^{commit}`]);
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** Where a finding points: a reviewer finding's `locations`, or a codex finding's `file` and `line`. */
function pointsAt(f: Finding): readonly { file: string; line?: number; endLine?: number }[] {
  if (f.locations !== undefined && f.locations.length > 0) return f.locations;
  return f.line !== undefined && f.line > 0 ? [{ file: f.file, line: f.line }] : [];
}

/**
 * What an operator ruling cites: the text of every line span the finding points at, read at the
 * head its round reviewed. A location with no line, one whose file the head lacks, and a span with
 * no text in it each add no citation; the finding's other locations still do. `ok: false` means git
 * failed, and the caller records no decision.
 */
export async function captureCitations(
  f: Finding,
  rev: string,
  read: TreeReader,
): Promise<{ ok: true; cites: Citation[] } | { ok: false; detail: string }> {
  const cites: Citation[] = [];
  for (const loc of pointsAt(f)) {
    if (loc.line === undefined) continue;
    const got = await read(rev, loc.file);
    if (got.kind === 'unreadable') return { ok: false, detail: got.detail };
    if (got.kind === 'missing') continue;
    const end = loc.endLine !== undefined && loc.endLine > loc.line ? loc.endLine : loc.line;
    const text = got.text
      .split('\n')
      .slice(loc.line - 1, end)
      .join('\n');
    if (text.trim() === '') continue;
    cites.push({
      file: loc.file,
      line: loc.line,
      ...(end > loc.line ? { endLine: end } : {}),
      text,
    });
  }
  return { ok: true, cites };
}

/**
 * Whether an operator ruling still holds at `rev`: every block of lines it cites is still in its
 * file, as whole lines, wherever they have moved. Whole lines, not a substring: a cited line that
 * gained text is an edit, not the same line. A ruling that cites nothing holds for the rest of the
 * series. A file git cannot read at `rev` reads as changed, so the ruling suppresses nothing.
 */
export async function stillHolds(d: Decision, rev: string, read: TreeReader): Promise<boolean> {
  for (const c of d.cites ?? []) {
    const got = await read(rev, c.file);
    if (got.kind !== 'file' || !`\n${got.text}\n`.includes(`\n${c.text}\n`)) return false;
  }
  return true;
}

/** The trailer a green code round's receipt amend writes, one per operator ruling of the session. */
export const SETTLED_TRAILER = 'Noldor-CR-Settled';

/** One trailer value: the kind, the disposition, the id's first 12 characters, the note on one line. */
export function settledTrailerValue(kind: ArtifactKind, d: Decision): string {
  const note = d.reason.replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${kind} ${d.disposition} ${d.id.slice(0, 12)}${note === '' ? '' : ` — ${note}`}`;
}
