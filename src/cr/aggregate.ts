import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import type { Slug } from '../core/slug.js';
import { join } from 'node:path';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import { laneFindingsSchema } from './findings-schema.js';
import { inferLaneFromFilename } from './filename.js';
import { readExpectedLanes, type DispatchedHead } from './expected-lanes.js';
import { PROMPT_TEMPLATE_PATH } from './deep-review-spawn.js';

/**
 * A blocker as this module surfaces it — a {@link Finding} plus the lane that
 * filed it. Declared HERE, next to the only producer, and imported by consumers
 * (`cr autofix`): a second copy of the shape elsewhere needs a cast to bridge the
 * two, and that cast is exactly what would swallow a later change to this type.
 */
export type LaneBlocker = Finding & {
  lane: Lane;
  /**
   * Set when the blocker is about the SINK rather than about the artifact: an
   * unreadable / unparseable / schema-invalid file, a payload whose lane
   * disagrees with its filename, or a corrupt expected-lanes record. Such a
   * blocker says "this verdict cannot be trusted", which no amount of fixing the
   * artifact addresses — so it must keep gating even where a caller has decided
   * that review findings no longer do (`aggregate --unresolved-only`). Absent on
   * every finding a lane actually filed.
   */
  integrity?: true;
};

/**
 * A round whose sinks describe a tree the checkout has moved past (Q-0211).
 *
 * `orchestrate` refuses at the round cap by returning BEFORE it records the
 * round, so nothing rewrites the sinks — and the previous round's findings then
 * read as current. On PR #437 that meant three reported blockers of which two
 * had already been fixed in a later commit, with nothing in the output to say
 * so. A stale sink must be distinguishable from a fresh one.
 */
export interface StaleRound {
  kind: ArtifactKind;
  /** The expected-lanes record that named the round. */
  file: string;
  /** `HEAD` when the round was dispatched. */
  headSha: string;
  /** That commit's tree — `null` when the commit no longer resolves (history rewritten). */
  roundTree: string | null;
  /** `HEAD^{tree}` now. */
  currentTree: string;
}

export interface AggregateResult {
  ok: boolean;
  blockers: LaneBlocker[];
  unresolved: Lane[];
  /**
   * Rounds whose findings are no longer about this tree. A separate channel from
   * {@link AggregateResult.blockers} on purpose: the ledger fingerprints that
   * array (`orchestrate` hashes it to decide a round's verdict, and
   * `buildSkeleton` re-derives the hash to prove the sinks still describe the
   * arbitrated round), so a synthesized entry there would change what every
   * existing round hashes to.
   */
  stale: StaleRound[];
  summaries: Partial<Record<Lane, string>>;
  notes: Partial<Record<Lane, string[]>>;
}

export interface AggregateOpts {
  cwd?: string;
}

const CR_SUBDIR = '.noldor/cr';

export async function aggregate(
  slug: Slug,
  kind?: ArtifactKind,
  opts: AggregateOpts = {},
): Promise<AggregateResult> {
  const dir = join(opts.cwd ?? process.cwd(), CR_SUBDIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const prefix = kind ? `${slug}-${kind}-` : `${slug}-`;
  const files = entries
    .filter((e) => e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name));

  const blockers: LaneBlocker[] = [];
  const unresolved: Lane[] = [];
  const summaries: Partial<Record<Lane, string>> = {};
  const notes: Partial<Record<Lane, string[]>> = {};
  const seen = new Set<Lane>();

  for (const file of files) {
    const filenameLane = inferLaneFromFilename(file);
    if (filenameLane === null) {
      blockers.push({
        severity: 'high',
        file,
        message: `non-conforming filename: ${file}`,
        lane: 'manual',
        integrity: true,
      });
      continue;
    }
    seen.add(filenameLane);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      blockers.push({
        severity: 'high',
        file,
        message: `read error: ${(err as Error).message}`,
        lane: filenameLane,
        integrity: true,
      });
      summaries[filenameLane] = 'read error';
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      blockers.push({
        severity: 'high',
        file,
        message: `JSON parse error: ${(err as Error).message}`,
        lane: filenameLane,
        integrity: true,
      });
      summaries[filenameLane] = 'parse error';
      continue;
    }
    const parsed = laneFindingsSchema.safeParse(json);
    if (!parsed.success) {
      blockers.push({
        severity: 'high',
        file,
        message: `schema error: ${parsed.error.message}`,
        lane: filenameLane,
        integrity: true,
      });
      summaries[filenameLane] = 'schema error';
      continue;
    }
    if (parsed.data.lane !== filenameLane) {
      blockers.push({
        severity: 'high',
        file,
        message: `lane mismatch: payload lane ${parsed.data.lane} ≠ filename lane ${filenameLane}`,
        lane: filenameLane,
        integrity: true,
      });
      summaries[filenameLane] = 'lane mismatch';
      continue;
    }
    summaries[filenameLane] = parsed.data.summary;
    if (parsed.data.notes) notes[filenameLane] = [...parsed.data.notes];
    if (!parsed.data.finishedAt) unresolved.push(filenameLane);
    blockers.push(...parsed.data.blockers.map((b) => ({ ...b, lane: filenameLane })));

    // templateSha drift detection. Standalone lane only.
    if (filenameLane === 'standalone' && parsed.data.templateSha) {
      const currentSha = await templateShaFor(
        join(opts.cwd ?? process.cwd(), PROMPT_TEMPLATE_PATH),
      );
      if (currentSha && currentSha !== parsed.data.templateSha) {
        notes[filenameLane] = notes[filenameLane] ?? [];
        notes[filenameLane]!.push(
          `standalone template SHA drifted: stub=${parsed.data.templateSha} current=${currentSha}`,
        );
      }
    }
  }

  // A lane orchestrate resolved but that never wrote a sink is `unresolved`,
  // not invisible — a lane killed before its first write must not read as a
  // pass (Q-0100). An absent expected-lanes record (pre-Q-0100 rounds) yields
  // an empty set, preserving the old discovery-only behavior; a corrupt record
  // is a blocker, since dropping it silently would re-open the fail-open hole.
  const expected = await readExpectedLanes(opts.cwd ?? process.cwd(), slug, kind);
  for (const e of expected.errors) {
    blockers.push({
      severity: 'high',
      file: e.file,
      message: e.message,
      lane: 'manual',
      integrity: true,
    });
  }
  for (const lane of expected.lanes) {
    if (!seen.has(lane) && !unresolved.includes(lane)) unresolved.push(lane);
  }

  const stale = staleRounds(opts.cwd ?? process.cwd(), expected.heads);

  return {
    ok: blockers.length === 0 && unresolved.length === 0 && stale.length === 0,
    blockers,
    unresolved,
    stale,
    summaries,
    notes,
  };
}

/**
 * `rev^{tree}`, or `null` when git cannot answer — no repo, no such commit, no
 * git on PATH. The subprocess is the boundary this converts at (expected
 * failures do not throw past it); the caller disambiguates the two meanings by
 * resolving `HEAD` first.
 */
function treeOf(cwd: string, rev: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', `${rev}^{tree}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Which of the recorded rounds no longer describe this tree.
 *
 * TREES, not commits: `orchestrate` amends the review receipt onto the tip after
 * its lanes run and `cr bootstrap` rewrites commit messages later, both
 * tree-preserving — comparing commit shas would call every green round stale.
 * It is the same `HEAD^{tree}` identity the push-gate receipt is bound to, so a
 * sink counts as current exactly when the receipt earned beside it does.
 *
 * Unresolvable `HEAD` disables the check rather than failing it: a tmpdir with
 * no repo has nothing to be stale against. A round whose own commit is gone
 * (rebased away, gc'd) IS stale — history was rewritten under it — and the
 * resolved `HEAD` is what tells those two apart.
 */
function staleRounds(cwd: string, heads: readonly DispatchedHead[]): StaleRound[] {
  if (heads.length === 0) return [];
  const currentTree = treeOf(cwd, 'HEAD');
  if (currentTree === null) return [];
  const stale: StaleRound[] = [];
  for (const h of heads) {
    const roundTree = treeOf(cwd, h.headSha);
    if (roundTree === currentTree) continue;
    stale.push({ kind: h.kind, file: h.file, headSha: h.headSha, roundTree, currentTree });
  }
  return stale;
}

/** One line an operator can act on: what moved, and what re-earns a live verdict. */
export function describeStale(s: StaleRound): string {
  const what =
    s.roundTree === null
      ? `commit ${s.headSha.slice(0, 7)} no longer resolves — history was rewritten under it`
      : `tree ${s.roundTree.slice(0, 7)} (commit ${s.headSha.slice(0, 7)}), HEAD is now tree ${s.currentTree.slice(0, 7)}`;
  return `stale ${s.kind} round: sinks describe ${what}. Findings above are not about this tree — re-run \`pnpm noldor cr orchestrate --kind ${s.kind}\` before acting on them (${s.file})`;
}

async function templateShaFor(path: string): Promise<string | null> {
  try {
    const { createHash } = await import('node:crypto');
    const raw = await readFile(path, 'utf8');
    return createHash('sha1').update(raw).digest('hex');
  } catch {
    return null;
  }
}
