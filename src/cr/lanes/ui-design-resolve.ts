// @tests: ui-design-review-lane
// Everything the `ui-reviewer` lane decides BEFORE dispatch: is this round
// UI-bearing, and which design does the session own? Split from the lane's sink
// policy (`ui-review.ts`) so each half reads as one job — resolution answers
// "what, if anything, do we compare?", the lane answers "what does the sink say?".

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import {
  defaultRunGit,
  discoverAddedFiles,
  discoverChangedFiles,
  resolveDefaultBase,
} from '../../core/branch-added.js';
import { loadUiConfig } from '../../core/consumer-config.js';
import { ARCHIVE_DIR, penSlugFromFilename } from '../../core/design-artifact-names.js';
import { loadDocRoots } from '../../core/doc-roots.js';
import { readSession } from '../../core/session.js';
import { sessionUiVerdict, type UiFrontmatter } from '../../core/ui-predicate.js';
import { dialogueKeyFromSession } from '../../design/archive-resolve.js';
import type { LaneReasonCode } from '../findings-schema.js';
import { errMessage } from '../lane-spawn.js';
import type { LaneInput } from '../lane-types.js';
import { readFdSummary } from '../read-fd-summary.js';

/** Sentinel summary for a session whose FD does not exist (fast-track ships none). */
export const NO_FD_SUMMARY = '(no FD — fast-track change; review the diff on its own merits)';

/**
 * The ONLY FD field this lane reads. Deliberately not `FeatureFrontmatterSchema`:
 * validating the whole document here would turn any unrelated FD schema drift —
 * a legacy FD, a field `validate features` owns — into `fd-unreadable`, which
 * reds a UI round under `blocking` for a reason that has nothing to do with the
 * design. The trust boundary that matters is `design:` itself: an invalid value
 * there could be the very thing that would fire or suppress this lane.
 */
const fdDesignSliceSchema = z.object({ design: z.enum(['required', 'skip']).optional() });

/** What the child compared against, once Node has resolved it. */
export interface ResolvedDesign {
  /** Whole-feature base the predicate used; the child reviews the same range. */
  base: string;
  /** FD `## Summary` (or the no-FD sentence), already read during resolution. */
  fdSummary: string;
  /** Repo-relative path of the design this session owns. */
  repoRelPath: string;
  /** Absolute path of the same file. */
  absPath: string;
  /** Surfaces in scope; empty means "every `FINAL:` page". */
  surfaces: string[];
  /** Changed UI paths no declared surface owns — a config gap, reported as a note. */
  unmappedPaths: string[];
}

/**
 * A step that decided the round is over before any comparison happened. Returned
 * rather than thrown: these are expected outcomes of a review lane, and the
 * caller must confront both branches (error-result-types).
 */
export interface Terminal {
  verdict: 'not-applicable' | 'cannot-review';
  reason: LaneReasonCode;
  detail: string;
}

export type Resolution =
  | { kind: 'review'; design: ResolvedDesign }
  | { kind: 'terminal'; at: Terminal };

const terminal = (
  verdict: Terminal['verdict'],
  reason: LaneReasonCode,
  detail: string,
): Resolution => ({ kind: 'terminal', at: { verdict, reason, detail } });

/**
 * FD frontmatter slice the predicate needs, plus its `## Summary`.
 *
 * An absent FD is legitimate (fast-track ships none), and defaults to no
 * `design:` override so the predicate decides on globs alone. A present but
 * MALFORMED FD is not legitimate: its `design:` field could be the very thing
 * that would have fired or suppressed this lane, so it terminates the round.
 */
export async function readFd(
  fdPath: string,
): Promise<{ fm: UiFrontmatter; summary: string } | { reason: 'fd-unreadable'; detail: string }> {
  let raw: string;
  try {
    raw = await readFile(fdPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { fm: {}, summary: NO_FD_SUMMARY };
    }
    return { reason: 'fd-unreadable', detail: `FD unreadable: ${errMessage(err)}` };
  }
  let data: unknown;
  try {
    data = matter(raw).data;
  } catch (err) {
    return {
      reason: 'fd-unreadable',
      detail: `FD frontmatter unparseable: ${errMessage(err)}`,
    };
  }
  const parsed = fdDesignSliceSchema.safeParse(data);
  if (!parsed.success) {
    return { reason: 'fd-unreadable', detail: `FD design: field invalid: ${parsed.error.message}` };
  }
  const summary = await readFdSummary(fdPath).catch(() => NO_FD_SUMMARY);
  // `design` stays absent rather than explicitly `undefined`: the predicate's
  // override branches test presence, and exactOptionalPropertyTypes is on.
  const fm: UiFrontmatter = parsed.data.design ? { design: parsed.data.design } : {};
  return { fm, summary };
}

/**
 * Candidate design files for `key`, archive first (gate Step 4 archives the `.pen`
 * in the flip commit, which precedes this lane), each as a repo-relative path.
 * A missing directory is "no design here"; one that exists but cannot be read is
 * a distinct failure — collapsing them would report a permissions problem as an
 * absent design.
 */
async function collectCandidates(
  designUi: string,
  repo: string,
  key: string,
): Promise<{ paths: string[] } | { reason: 'design-dir-unreadable'; detail: string }> {
  const found: string[] = [];
  for (const dir of [join(designUi, ARCHIVE_DIR), designUi]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return {
        reason: 'design-dir-unreadable',
        detail: `${dir} unreadable: ${errMessage(err)}`,
      };
    }
    for (const entry of entries) {
      if (!entry.endsWith('.pen')) continue;
      if (penSlugFromFilename(entry) !== key) continue;
      found.push(
        join(dir, entry)
          .slice(repo.length + 1)
          .split('\\')
          .join('/'),
      );
    }
  }
  return { paths: found };
}

/**
 * Everything Node decides before dispatch: is this round UI-bearing, and which
 * design does it own? Split out so the sink-writing half below reads as one
 * mapping from outcome to payload.
 */
export async function resolveUiReviewTarget(input: LaneInput): Promise<Resolution> {
  const repo = input.repoRoot;
  const run = defaultRunGit(repo);

  // `loadUiConfig` returns null only for a MISSING config; a present-but-invalid
  // one throws (`loadConsumerConfig`), and an escaping throw would leave the lane
  // with no sink at all.
  let uiConfig: ReturnType<typeof loadUiConfig>;
  try {
    uiConfig = loadUiConfig(repo);
  } catch (err) {
    return terminal('cannot-review', 'config-unreadable', errMessage(err));
  }
  if (uiConfig === null) {
    return terminal(
      'not-applicable',
      'no-consumer-config',
      'no consumer config — UI stage unadopted',
    );
  }

  const fd = await readFd(join(repo, input.fdPath));
  if ('reason' in fd) return terminal('cannot-review', fd.reason, fd.detail);

  // Both bases are the DEFAULT BRANCH, never `input.baseSha`: every delta shape
  // narrows that (fullReview deletes it, receipt re-earn and autofix pass a tip),
  // and a fragment of the branch describes neither the as-built UI nor which
  // commit added the design.
  let base: string;
  let changed: string[];
  try {
    base = resolveDefaultBase(run);
    if (input.artifactSha === '') throw new Error('no HEAD sha (git unavailable)');
    changed = discoverChangedFiles({ cwd: repo, base, head: input.artifactSha });
  } catch (err) {
    return terminal('cannot-review', 'range-unresolvable', errMessage(err));
  }

  const verdict = sessionUiVerdict(fd.fm, changed, uiConfig);
  if (verdict.verdict === 'skip') {
    return fd.fm.design === 'skip'
      ? terminal('not-applicable', 'design-skip', 'FD design: skip')
      : terminal('not-applicable', 'no-ui-paths', 'no changed path matches uiPaths');
  }
  if (verdict.affectedSurfaces.length === 0 && verdict.unmappedPaths.length > 0) {
    return terminal(
      'cannot-review',
      'surfaces-unmapped',
      `changed UI paths belong to no declared surface (${verdict.unmappedPaths.join(', ')}) — extend consumer.uiSurfaces`,
    );
  }

  const session = (() => {
    try {
      return readSession(repo);
    } catch {
      // A torn marker is unreadable, not absent — same fail-closed read
      // orchestrate applies for the codex mandate.
      return null;
    }
  })();
  if (session === null) {
    return terminal('cannot-review', 'no-session-key', 'no readable session marker');
  }
  if (session.uiWaiver) {
    return terminal('not-applicable', 'waived', `operator waiver: ${session.uiWaiver.reason}`);
  }
  const key = dialogueKeyFromSession(session);
  if (key.kind === 'none') {
    // A session with no design dialogue that DID change UI paths is not a pass —
    // `not-applicable` here would be a blocking-mode bypass for exactly the
    // sessions most likely to skip the design stage.
    return terminal('cannot-review', 'no-design-artifact', `${session.path} carries no design`);
  }
  if (key.kind === 'invalid') {
    return terminal('cannot-review', 'no-session-key', `session marker missing ${key.missing}`);
  }

  const candidates = await collectCandidates(loadDocRoots(repo).designUi, repo, key.key);
  if ('reason' in candidates) {
    return terminal('cannot-review', candidates.reason, candidates.detail);
  }
  let owned: string[];
  try {
    // Two git subprocesses, resolved ONCE — inside the filter this ran per candidate.
    const added = new Set(discoverAddedFiles({ cwd: repo, base }));
    owned = candidates.paths.filter((p) => added.has(p));
  } catch (err) {
    return terminal('cannot-review', 'range-unresolvable', errMessage(err));
  }
  if (owned.length === 0) {
    return terminal('cannot-review', 'no-feature-pen', `no design artifact for key '${key.key}'`);
  }
  if (owned.length > 1) {
    return terminal(
      'cannot-review',
      'ambiguous-design',
      `multiple designs match: ${owned.join(', ')}`,
    );
  }

  return {
    kind: 'review',
    design: {
      base,
      fdSummary: fd.summary,
      repoRelPath: owned[0],
      absPath: join(repo, owned[0]),
      surfaces: verdict.affectedSurfaces,
      unmappedPaths: verdict.unmappedPaths,
    },
  };
}
