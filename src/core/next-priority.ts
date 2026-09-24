import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots, milestonePath, readQueueFile } from './doc-roots.js';
import { pathErrorMessage, readFileNoFollow } from './slug-paths.js';
import { parseSlug } from './slug.js';
import { entryToPath, type GatePath } from './size-routing.js';
import { extractTouches } from './extract-touches.js';
import { FeatureFrontmatterSchema } from './feature-schema.js';
import { parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';

/**
 * Return the top-priority entry from a parsed roadmap (file order =
 * priority). Used by `pnpm next-priority` and consumed by `/noldor-gate` Step 0
 * (surface) and Step 5 (queue-empty exit-code gate).
 *
 * @param roadmapRaw - Raw contents of `docs/roadmap.md`.
 * @returns First entry in document order, or `null` when the roadmap is empty.
 */
export function getTopPriorityNext(roadmapRaw: string): BacklogEntry | null {
  if (roadmapRaw.length === 0) return null;
  const all = parseRoadmap(roadmapRaw);
  const sorted = all.toSorted((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return holdBack(sorted).open[0] ?? null;
}

/** A queued entry held back because a `blocked-by` ref still names a queued entry. */
export interface BlockedEntry {
  readonly slug: string;
  /** The refs (slug or entry ID, as written) that resolve to a still-queued entry. */
  readonly blockedBy: readonly string[];
}

/**
 * Find the entries whose `blocked-by` (or legacy `deps:`) names another entry
 * still in `entries`. A ref resolves by entry ID or slug; a ref to anything
 * outside the list (a shipped FD, a retired ID, a typo) is not a blocker here —
 * `validate triage`'s `unknown-blocked-by-ref` owns the typo case. Self-refs are
 * ignored (garden's `circular-blocked-by` reports them).
 *
 * @param entries - Queued entries, in priority order.
 * @returns One {@link BlockedEntry} per blocked entry, in the input order.
 */
export function findBlocked(entries: ReadonlyArray<BacklogEntry>): BlockedEntry[] {
  const queued = new Map<string, string>();
  for (const e of entries) {
    queued.set(e.slug, e.slug);
    if (e.id !== undefined) queued.set(e.id, e.slug);
  }
  const out: BlockedEntry[] = [];
  for (const e of entries) {
    const unmet = (e.deps ?? []).filter((ref) => {
      const target = queued.get(ref);
      return target !== undefined && target !== e.slug;
    });
    if (unmet.length > 0) out.push({ slug: e.slug, blockedBy: unmet });
  }
  return out;
}

/**
 * Drop blocked entries, so the gate never hands out an entry whose first act is
 * impossible (file order is priority, but a blocker ordered below its dependent
 * must still ship first). When the candidates block EACH OTHER so that none is
 * open, they hold a cycle — a finite acyclic set always has an unblocked member
 * — and dropping them all would read as "queue empty, ship-ready". The list is
 * returned unfiltered then; garden's `circular-blocked-by` reports the cycle.
 * Candidates emptied by blockers outside them (entries in `--skip`) are not a
 * cycle: they stay held, and the warning names them.
 *
 * @param sorted - The candidates, in priority order.
 * @param queue - Every queued entry. Defaults to `sorted`; the drain passes the
 *   pre-`--skip` roadmap, because a skipped blocker is still unshipped.
 */
function holdBack(
  sorted: ReadonlyArray<BacklogEntry>,
  queue: ReadonlyArray<BacklogEntry> = sorted,
): { open: ReadonlyArray<BacklogEntry>; held: BlockedEntry[] } {
  const candidates = new Set(sorted.map((e) => e.slug));
  const blocked = findBlocked(queue).filter((b) => candidates.has(b.slug));
  const heldSlugs = new Set(blocked.map((b) => b.slug));
  const open = sorted.filter((e) => !heldSlugs.has(e.slug));
  const cycle = open.length === 0 && findBlocked(sorted).length === sorted.length;
  return cycle ? { open: sorted, held: [] } : { open, held: blocked };
}

function warnBlocked(blocked: ReadonlyArray<BlockedEntry>): void {
  for (const b of blocked) {
    process.stderr.write(
      `next-priority: skipping '${b.slug}' — blocked-by ${b.blockedBy.join(', ')} still queued\n`,
    );
  }
}

interface FormatOpts {
  readonly json: boolean;
}

/**
 * Render the top-priority entry for human or JSON consumption.
 *
 * @param entry - Output of {@link getTopPriorityNext}, or `null` when empty.
 * @param opts - `json: true` for machine-readable output (consumed by `/noldor-gate` Step 0).
 * @returns Stringified rendering ready to print to stdout.
 */
export function formatEntry(entry: BacklogEntry | null, opts: FormatOpts): string {
  if (opts.json) {
    return entry === null ? 'null' : JSON.stringify(entry, null, 2);
  }
  if (entry === null) return 'queue empty — ship-ready';
  const slug = entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const meta: string[] = [];
  if (entry.type) meta.push(`type=${entry.type}`);
  if (entry.size) meta.push(`size=${entry.size}`);
  if (entry.impact) meta.push(`impact=${entry.impact}`);
  if (entry.parent) meta.push(`parent=${entry.parent}`);
  return [
    `Next: ${entry.name}`,
    `slug: ${slug}`,
    `${meta.join(' ')}`,
    `category: ${entry.category ?? '(none)'}`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

/**
 * Returns true when the deprecated `--write-pending` flag is present in the
 * argument set. Separate from the side-effecting `main()` so callers can test
 * the gating without spawning a subprocess.
 */
export function isWritePendingDeprecated(argv: ReadonlySet<string>): boolean {
  return argv.has('--write-pending');
}

/**
 * Parse the `--skip <csv>` value flag from a raw argv list into a set of slugs
 * to exclude. Returns an empty set when the flag is absent or has no value.
 * Used by the autonomous queue-drain runner (and any caller passing `--skip`)
 * to drop already-shipped/skipped roadmap entries from the suggestion buckets.
 */
export function parseSkip(argvList: readonly string[]): ReadonlySet<string> {
  const i = argvList.indexOf('--skip');
  if (i === -1 || i + 1 >= argvList.length) return new Set();
  return new Set(
    argvList[i + 1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export interface InProgressFd {
  slug: string;
  name: string;
  tier: 'specs-only' | 'full';
  /** Frontmatter `deps:` refs (slugs or Q-NNNN entry IDs); [] when absent. */
  deps: string[];
}

export interface SuggestionsInput {
  inProgressFds: ReadonlyArray<InProgressFd>;
  milestoneGate: string;
  /**
   * Slug of the active milestone, or `null` when none resolves.
   *
   * `null` means "no active milestone", never "the active milestone is
   * nothing": with no slug to compare against there is no other-milestone to
   * exclude, so the fallback runs over every entry exactly as it did before
   * this field existed.
   */
  activeMilestone?: string | null;
}

/**
 * A roadmap entry stamped with the gate path the size→path policy recommends
 * for it (see {@link entryToPath}). `/noldor-gate` Step 0 reads `suggestedPath` directly
 * instead of re-deriving the size→tier mapping in prose.
 */
export interface SuggestedEntry extends BacklogEntry {
  suggestedPath: GatePath;
}

export interface Suggestions {
  inProgress: ReadonlyArray<InProgressFd>;
  topPriority: ReadonlyArray<SuggestedEntry>;
  smallHighImpact: ReadonlyArray<SuggestedEntry>;
  milestoneAligned: SuggestedEntry | null;
  /** Up to 3 `type: fix` entries not surfaced by any bucket above, highest `impact` first. */
  bugfixes: ReadonlyArray<SuggestedEntry>;
  /**
   * Entries left out of every bucket because a `blocked-by` ref still names a
   * queued entry (see {@link findBlocked}). Empty when nothing is blocked, and
   * when everything is (a cycle — see {@link holdBack}).
   */
  blocked: ReadonlyArray<BlockedEntry>;
}

/**
 * Compute the structured suggestion set surfaced by `/noldor-gate` Step 0.
 *
 * Blocked entries (a `blocked-by` ref still queued — {@link findBlocked}) are
 * held out of every bucket and listed under `blocked` instead.
 *
 * Bucketing rules:
 * - `topPriority` — first 3 entries in file order (file order = priority).
 * - `smallHighImpact` — up to 2 entries with `size ∈ {XS, S}` AND
 *   `impact ∈ {high, critical}`, excluding anything already in `topPriority`.
 *   Ranked by file order (which is priority).
 * - `milestoneAligned` — at most 1 entry, excluding anything in
 *   `topPriority ∪ smallHighImpact`, picked in two branches: first an entry
 *   whose `milestone` names the active milestone, then — only if there is none
 *   — a high/critical-impact entry by bag-of-words overlap against that
 *   milestone's `## Gate` paragraph. Returns null when neither branch
 *   qualifies. See {@link findMilestoneMatch} for why the declared branch skips
 *   the guards the overlap branch keeps.
 * - `bugfixes` — up to 3 `type: fix` entries, excluding anything in the three
 *   buckets above, sorted by `impact` (critical → high → med → low → unset),
 *   file order breaking ties. Computed last so it never steals an entry from
 *   an existing bucket.
 *
 * @param roadmapRaw - Raw contents of `docs/roadmap.md`.
 * @param input - In-progress FDs (caller-discovered) + the active milestone's slug and gate paragraph.
 * @returns 3 top + 2 small×high-impact (disjoint from top) + 1 milestone-aligned (disjoint) + 3 bugfixes (disjoint) + inProgress (passed through verbatim). Each surfaced entry is stamped with a `suggestedPath` per the size→path policy ({@link entryToPath}).
 */
export function getSuggestions(
  roadmapRaw: string,
  input: SuggestionsInput,
  skip: ReadonlySet<string> = new Set(),
): Suggestions {
  const queue = parseRoadmap(roadmapRaw);
  const { open: sorted, held } = holdBack(
    queue
      .filter((e) => !skip.has(e.slug))
      .toSorted((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    queue,
  );
  const topPriority = sorted.slice(0, 3);
  const topSlugs = new Set(topPriority.map((e) => e.slug));

  const SMALL_SIZES = new Set(['XS', 'S']);
  const HIGH_IMPACT = new Set(['high', 'critical']);
  const smallHighImpact = sorted
    .filter(
      (e) =>
        !topSlugs.has(e.slug) && SMALL_SIZES.has(e.size ?? '') && HIGH_IMPACT.has(e.impact ?? ''),
    )
    .slice(0, 2);
  const smallSlugs = new Set(smallHighImpact.map((e) => e.slug));

  // The empty-gate short-circuit guards the overlap branch only. Applied to the
  // whole bucket, as it used to be, a milestone with a blank `## Gate` would
  // silently suppress an entry that explicitly declares it — the exact
  // guess-over-declaration inversion the declared branch exists to remove.
  const activeMilestone = input.activeMilestone ?? null;
  const milestoneAligned =
    input.milestoneGate.trim().length === 0 && activeMilestone === null
      ? null
      : findMilestoneMatch(
          sorted,
          input.milestoneGate,
          new Set([...topSlugs, ...smallSlugs]),
          activeMilestone,
        );

  const offered = new Set([...topSlugs, ...smallSlugs, milestoneAligned?.slug]);
  const IMPACT_ORDER = ['critical', 'high', 'med', 'low'];
  const impactRank = (e: BacklogEntry): number => {
    const i = IMPACT_ORDER.indexOf(e.impact ?? '');
    return i === -1 ? IMPACT_ORDER.length : i;
  };
  const bugfixes = sorted
    .filter((e) => e.type === 'fix' && !offered.has(e.slug))
    .toSorted((a, b) => impactRank(a) - impactRank(b))
    .slice(0, 3);

  return {
    inProgress: input.inProgressFds,
    topPriority: topPriority.map(withRouting),
    smallHighImpact: smallHighImpact.map(withRouting),
    milestoneAligned: milestoneAligned === null ? null : withRouting(milestoneAligned),
    bugfixes: bugfixes.map(withRouting),
    blocked: held,
  };
}

/**
 * Stamp a roadmap entry with the gate path recommended by the size→path policy.
 * The `-attach` variants are selected when the entry declares a `parent` FD, and
 * the paths its `Touches:` clause declares can move a small entry to `micro-chore`.
 */
function withRouting(entry: BacklogEntry): SuggestedEntry {
  const touches = extractTouches(entry.description).paths;
  return {
    ...entry,
    suggestedPath: entryToPath(entry.size, entry.parent !== undefined, touches),
  };
}

/**
 * MVP scoring: bag-of-words overlap. Words ≤3 chars are stop-word'd out
 * (intentional — skips "the", "and", "a"; also skips "win", "bug", "key",
 * which is acceptable noise for an L-impact MVP). A graphify-backed
 * semantic match is tracked as a future enhancement under "SDD Detector 5 —
 * Idea-Merge Semantic Similarity".
 */
function findMilestoneMatch(
  entries: ReadonlyArray<BacklogEntry>,
  gate: string,
  exclude: ReadonlySet<string>,
  activeSlug: string | null = null,
): BacklogEntry | null {
  // Branch 1 — a stated membership. It outranks the heuristic below, and skips
  // both of that heuristic's guards on purpose: the impact filter and the
  // empty-gate short-circuit exist to stop a *guess* surfacing the wrong entry,
  // and a declaration is not a guess. An empty `## Gate` must not suppress it.
  if (activeSlug !== null) {
    const declared = entries.find((e) => !exclude.has(e.slug) && e.milestone === activeSlug);
    if (declared) return declared;
  }

  const gateWords = new Set(
    gate
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3),
  );
  const HIGH_IMPACT = new Set(['high', 'critical']);
  let best: { entry: BacklogEntry; score: number } | null = null;
  for (const entry of entries) {
    if (exclude.has(entry.slug)) continue;
    // Branch 2 never overrules a declaration: an entry assigned to some *other*
    // milestone is out, or a word count would beat its own frontmatter. With no
    // active milestone there is no "other" to be assigned to, so the exclusion
    // is off and this is exactly the pre-existing behaviour.
    if (activeSlug !== null && entry.milestone !== undefined && entry.milestone !== activeSlug) {
      continue;
    }
    if (!HIGH_IMPACT.has(entry.impact ?? '')) continue;
    const text = `${entry.name} ${entry.description ?? ''}`.toLowerCase();
    const tokens = new Set(text.split(/\W+/).filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of gateWords) if (tokens.has(w)) overlap += 1;
    if (overlap === 0) continue;
    if (best === null || overlap > best.score) best = { entry, score: overlap };
  }
  return best?.entry ?? null;
}

/**
 * Walk `docs/features/*.md` under `cwd`, return entries with `phase: in-progress`
 * projected to {slug, name, tier}. Slug is derived from the filename stem.
 * Frontmatter is validated via {@link FeatureFrontmatterSchema}; malformed FDs
 * are skipped silently (the validator hook catches them elsewhere). FDs with
 * no `noldor-tier` are also skipped — `tier` is required on the in-progress
 * surface so /noldor-gate Step 0 can label correctly.
 *
 * @param cwd - Repo root. Tests use a tmpdir; the CLI uses `process.cwd()`.
 */
export function loadInProgressFds(cwd: string): InProgressFd[] {
  const dir = loadDocRoots(cwd).features;
  if (!existsSync(dir)) return [];
  const out: InProgressFd[] = [];
  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith('.md')) continue;
    const raw = readFileSync(join(dir, filename), 'utf8');
    const parsed = FeatureFrontmatterSchema.safeParse(matter(raw).data);
    if (!parsed.success) continue;
    if (parsed.data.phase !== 'in-progress') continue;
    const tier = parsed.data['noldor-tier'];
    if (tier === undefined) continue;
    // The stem becomes a branch name, a worktree directory and a rendered
    // command, so an FD filename that is not a slug cannot be worked on by
    // slug at all. It is excluded here — which covers every reader of this
    // list, including the drain's plans source, and avoids a throw deeper in
    // that would abort a whole drain run rather than skip one entry.
    //
    // Excluded LOUDLY: dropping it silently would show an operator an
    // incomplete in-progress queue with no hint that the repository holds a
    // malformed FD, which is the corrupt state they most need to see.
    const stem = filename.replace(/\.md$/, '');
    const parsedStem = parseSlug(stem);
    if (!parsedStem.ok) {
      process.stderr.write(
        `next-priority: skipping docs/features/${filename} — ${parsedStem.error.message}\n`,
      );
      continue;
    }
    out.push({
      slug: stem,
      name: parsed.data.name,
      tier,
      deps: parsed.data.deps,
    });
  }
  return out;
}

/**
 * The active milestone, as much of it as the gate's bucketing needs.
 *
 * Both halves, because both are used and they fail independently: a milestone
 * can be set with no `## Gate` paragraph, which leaves `slug` usable and `gate`
 * empty. Returning only the gate text — as this used to — made an explicitly
 * declared `- milestone:` unmatchable, since nothing downstream could tell which
 * milestone was active.
 */
export interface ActiveMilestone {
  /** Slug of the active milestone, or `null` when none resolves. */
  slug: string | null;
  /** First paragraph under `## Gate`, or `''` when absent. */
  gate: string;
}

const NO_MILESTONE: ActiveMilestone = { slug: null, gate: '' };

/**
 * Resolve the active milestone (per `docs/vision.md` frontmatter
 * `current-milestone:`) — its slug and its `## Gate` paragraph (first non-empty
 * paragraph under that heading).
 *
 * Returns {@link NO_MILESTONE} when no milestone is set, the milestone file is
 * missing, or the value is refused; `gate` alone is empty when the file exists
 * but declares no `## Gate`.
 *
 * @param cwd - Repo root.
 * @returns The active milestone's slug and gate paragraph.
 */
export function loadMilestoneGate(cwd: string): ActiveMilestone {
  const visionPath = loadDocRoots(cwd).vision;
  if (!existsSync(visionPath)) return NO_MILESTONE;
  const visionFm = matter(readFileSync(visionPath, 'utf8')).data as {
    'current-milestone'?: string;
  };
  const slug = visionFm['current-milestone'];
  if (slug === undefined || slug === '') return NO_MILESTONE;
  // This reader casts vision's frontmatter rather than parsing it with
  // visionFrontmatterSchema, so no schema tightening binds here — the guarded
  // builder is the only thing standing between a hand-edited value and a read.
  // A refusal is NOT "no gate configured": malformed frontmatter or a tampered
  // path would otherwise be indistinguishable from an unset milestone, which is
  // a fail-open on the field that decides gating. Report, then degrade.
  const parsed = parseSlug(slug);
  if (!parsed.ok) {
    process.stderr.write(`next-priority: ignoring current-milestone — ${parsed.error.message}\n`);
    return NO_MILESTONE;
  }
  const built = milestonePath(cwd, parsed.slug);
  if (!built.ok) {
    process.stderr.write(
      `next-priority: ignoring current-milestone — ${pathErrorMessage(built.error)}\n`,
    );
    return NO_MILESTONE;
  }
  if (!existsSync(built.path)) return NO_MILESTONE;
  const body = matter(readFileNoFollow(built.path)).content;
  const match = body.match(/##\s+Gate\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  const gate =
    match === null
      ? ''
      : ((match[1] ?? '')
          .trim()
          .split(/\n\s*\n/)[0]
          ?.trim() ?? '');
  return { slug: parsed.slug, gate };
}

async function main(): Promise<void> {
  const argv = new Set(process.argv.slice(2));
  if (isWritePendingDeprecated(argv)) {
    process.stderr.write(
      'warning: --write-pending is deprecated and ignored (the pending-priority file was removed; /noldor-gate reads top-of-roadmap directly).\n',
    );
  }
  const cwd = process.cwd();
  const roadmapRaw = await readQueueFile(loadDocRoots(cwd).roadmap);

  if (argv.has('--suggestions')) {
    const inProgressFds = loadInProgressFds(cwd);
    const active = loadMilestoneGate(cwd);
    const skip = parseSkip(process.argv.slice(2));
    const suggestions = getSuggestions(
      roadmapRaw,
      { inProgressFds, milestoneGate: active.gate, activeMilestone: active.slug },
      skip,
    );
    warnBlocked(suggestions.blocked);
    process.stdout.write(`${JSON.stringify(suggestions, null, 2)}\n`);
    // Exit 2 = nothing actionable (no in-progress AND no roadmap entries).
    process.exit(
      suggestions.inProgress.length === 0 && suggestions.topPriority.length === 0 ? 2 : 0,
    );
  }

  warnBlocked(holdBack(parseRoadmap(roadmapRaw)).held);
  const top = getTopPriorityNext(roadmapRaw);
  const opts: FormatOpts = { json: argv.has('--json') };
  process.stdout.write(`${formatEntry(top, opts)}\n`);
  // Exit 2 when the queue is empty so the skill caller can branch without
  // parsing the output. Exit 0 only when a real entry is surfaced.
  process.exit(top === null ? 2 : 0);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('next-priority');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
