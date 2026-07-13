import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../../utils/parse-blocks.js';

/**
 * One circular `blocked-by` chain flagged by the detector. `cycle` lists the
 * member slugs in the order Tarjan surfaced the strongly-connected component
 * (a self-loop is a single-element cycle). `/noldor-garden` renders these as
 * manual-edit findings — a cycle can never resolve automatically since any
 * member is a defensible edge to cut.
 */
export interface CircularBlockedByFinding {
  readonly detector: 'circular-blocked-by';
  readonly cycle: readonly string[];
  readonly message: string;
  readonly action: 'manual-edit';
}

/** One queue entry tagged with the file it was parsed from. */
export type SourcedEntry = BacklogEntry & { readonly source: 'roadmap' | 'backlog' };

/**
 * The shared `blocked-by` graph construction: merged roadmap+backlog entries
 * (tagged with their origin file), the slug-keyed adjacency list (refs — slug
 * or entry ID — resolved to target slugs), and the refs that resolved to
 * nothing (`dangling`, keyed by the referencing entry's slug). Consumed by
 * BOTH {@link findBlockedByCycles} and the dashboard `/blocked-by` loader so
 * displayed edges and detected cycles can never drift apart.
 */
export interface BlockedByBuild {
  readonly entries: readonly SourcedEntry[];
  readonly adj: Map<string, string[]>;
  readonly dangling: Map<string, string[]>;
}

/**
 * Build the `blocked-by` graph across the roadmap + backlog. Refs
 * (`blocked-by:`, or its legacy `deps:` alias) may be entry IDs or slugs; both
 * resolve to the target entry's slug before graph construction, so an ID→slug
 * cross-reference still closes a cycle. Refs matching no entry land in
 * `dangling` — {@link validateTriageInputs}'s `unknown-blocked-by-ref` owns
 * that validation signal; the dashboard renders them as dashed edges.
 */
export function buildBlockedByGraph(roadmapRaw: string, backlogRaw: string): BlockedByBuild {
  const entries: SourcedEntry[] = [
    ...parseRoadmap(roadmapRaw).map((e) => ({ ...e, source: 'roadmap' as const })),
    ...parseBacklog(backlogRaw).map((e) => ({ ...e, source: 'backlog' as const })),
  ];

  const idToSlug = new Map<string, string>();
  const slugs = new Set<string>();
  for (const e of entries) {
    if (e.slug.length === 0) continue;
    slugs.add(e.slug);
    if (e.id !== undefined) idToSlug.set(e.id, e.slug);
  }

  const resolve = (ref: string): string | null =>
    idToSlug.get(ref) ?? (slugs.has(ref) ? ref : null);

  const adj = new Map<string, string[]>();
  const dangling = new Map<string, string[]>();
  for (const s of slugs) adj.set(s, []);
  for (const e of entries) {
    if (e.slug.length === 0) continue;
    for (const dep of e.deps ?? []) {
      const target = resolve(dep);
      if (target !== null) adj.get(e.slug)?.push(target);
      else dangling.set(e.slug, [...(dangling.get(e.slug) ?? []), dep]);
    }
  }

  return { entries, adj, dangling };
}

/**
 * Cycles in an already-built graph — for callers that hold a
 * {@link BlockedByBuild} (the dashboard loader) and must not re-parse.
 * Returns one member-slug list per cycle (Tarjan SCC; self-loops included),
 * deduplicated so a shared cycle is reported once.
 */
export function findCyclesInBuild(build: BlockedByBuild): string[][] {
  return tarjanCycles(build.adj);
}

/**
 * Find every circular `blocked-by` chain across the roadmap + backlog (see
 * {@link buildBlockedByGraph} for ref-resolution rules; cycle semantics per
 * {@link findCyclesInBuild}).
 */
export function findBlockedByCycles(roadmapRaw: string, backlogRaw: string): string[][] {
  return findCyclesInBuild(buildBlockedByGraph(roadmapRaw, backlogRaw));
}

/**
 * Tarjan's strongly-connected-components, filtered to cycles: any component of
 * size &gt; 1, plus size-1 components that carry a self-edge. Graphs here are
 * tiny (roadmap + backlog entry count), so plain recursion is safe.
 */
function tarjanCycles(adj: Map<string, string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };

  for (const v of adj.keys()) if (!index.has(v)) strongconnect(v);

  const cycles: string[][] = [];
  for (const comp of sccs) {
    if (comp.length > 1) {
      cycles.push(comp);
    } else if ((adj.get(comp[0]) ?? []).includes(comp[0])) {
      cycles.push([comp[0]]);
    }
  }
  return cycles;
}

/** Read a file, returning `''` when it is absent (a repo may lack backlog.md). */
async function readOr(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Detector entrypoint: read `docs/roadmap.md` + `docs/backlog.md` under `repo`
 * and return one {@link CircularBlockedByFinding} per circular `blocked-by`
 * chain. Wired into `detectAll` (see `garden-detect.ts`).
 *
 * @param repo - Repository root.
 */
export async function detectCircularBlockedBy(repo: string): Promise<CircularBlockedByFinding[]> {
  const [roadmapRaw, backlogRaw] = await Promise.all([
    readOr(join(repo, 'docs/roadmap.md')),
    readOr(join(repo, 'docs/backlog.md')),
  ]);
  return findBlockedByCycles(roadmapRaw, backlogRaw).map((cycle) => ({
    detector: 'circular-blocked-by',
    cycle,
    action: 'manual-edit',
    message:
      cycle.length === 1
        ? `Self-referential blocked-by: '${cycle[0]}' lists itself. Remove the self-reference.`
        : `Circular blocked-by chain: ${cycle.join(' → ')} → ${cycle[0]}. Break it by removing one blocked-by ref.`,
  }));
}
