// @tests: ui-design-review-lane
// The `ui-reviewer` lane: does the implemented UI match the design this session
// approved? Node resolves the `.pen` PATH and the surfaces in scope; the child
// reads the design through pencil MCP (encrypted file, only reader) and returns a
// verdict. Every terminating path writes exactly one sink — a lane with no sink is
// indistinguishable from a lane that passed (Q-0100).

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

import {
  defaultRunGit,
  discoverAddedFiles,
  discoverChangedFiles,
  resolveDefaultBase,
} from '../../core/branch-added.js';
import { loadConfig } from '../../core/config.js';
import { loadUiConfig } from '../../core/consumer-config.js';
import { ARCHIVE_DIR, penSlugFromFilename } from '../../core/design-artifact-names.js';
import { loadDocRoots } from '../../core/doc-roots.js';
import { readSession } from '../../core/session.js';
import { sessionUiVerdict, type UiFrontmatter } from '../../core/ui-predicate.js';
import { dialogueKeyFromSession } from '../../design/archive-resolve.js';
import { writeJsonAtomic } from '../atomic-write.js';
import { openLane } from '../filename.js';
import type { Finding, LaneFindings, LaneReasonCode } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { readFdSummary } from '../read-fd-summary.js';
import {
  UiDispatchError,
  dispatchUiReview,
  parseUiReviewReport,
  type UiFinding,
} from './ui-review-dispatch.js';

const LANE = 'ui-reviewer' as const;

/**
 * The ONLY FD field this lane reads. Deliberately not `FeatureFrontmatterSchema`:
 * validating the whole document here would turn any unrelated FD schema drift —
 * a legacy FD, a field `validate features` owns — into `fd-unreadable`, which
 * reds a UI round under `blocking` for a reason that has nothing to do with the
 * design. The trust boundary that matters is `design:` itself: an invalid value
 * there could be the very thing that would fire or suppress this lane.
 */
const fdDesignSliceSchema = z.object({ design: z.enum(['required', 'skip']).optional() });
const NO_FD_SUMMARY = '(no FD — fast-track change; review the diff on its own merits)';

type UiMode = 'blocking' | 'advisory';

/** What the child compared against, once Node has resolved it. */
interface ResolvedDesign {
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
interface Terminal {
  verdict: 'not-applicable' | 'cannot-review';
  reason: LaneReasonCode;
  detail: string;
}

type Resolution = { kind: 'review'; design: ResolvedDesign } | { kind: 'terminal'; at: Terminal };

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
async function readFd(
  fdPath: string,
): Promise<{ fm: UiFrontmatter; summary: string } | { reason: 'fd-unreadable'; detail: string }> {
  let raw: string;
  try {
    raw = await readFile(fdPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { fm: {}, summary: NO_FD_SUMMARY };
    }
    return { reason: 'fd-unreadable', detail: `FD unreadable: ${(err as Error).message}` };
  }
  let data: unknown;
  try {
    data = matter(raw).data;
  } catch (err) {
    return {
      reason: 'fd-unreadable',
      detail: `FD frontmatter unparseable: ${(err as Error).message}`,
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
        detail: `${dir} unreadable: ${(err as Error).message}`,
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
async function resolve(input: LaneInput): Promise<Resolution> {
  const repo = input.repoRoot;
  const run = defaultRunGit(repo);

  const uiConfig = loadUiConfig(repo);
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
    return terminal('cannot-review', 'range-unresolvable', (err as Error).message);
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
    owned = candidates.paths.filter((p) => new Set(discoverAddedFiles({ cwd: repo, base })).has(p));
  } catch (err) {
    return terminal('cannot-review', 'range-unresolvable', (err as Error).message);
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
      repoRelPath: owned[0],
      absPath: join(repo, owned[0]),
      surfaces: verdict.affectedSurfaces,
      unmappedPaths: verdict.unmappedPaths,
    },
  };
}

const sha256 = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

/** Child finding → sink finding: the two-sided evidence rides the message. */
const toFinding = (f: UiFinding): Finding => ({
  file: f.file,
  severity: f.severity,
  message: `[${f.designPage} › ${f.designElement}] ${f.message}`,
  ...(f.line !== undefined ? { line: f.line } : {}),
});

export async function runUiReview(input: LaneInput): Promise<LaneResult> {
  const { sinkPath, startedAt } = openLane(input, LANE);
  const cfg = await loadConfig(join(input.repoRoot, '.noldor', 'config.json')).catch(() => null);
  const mode: UiMode = cfg?.autonomous?.uiReviewMode ?? 'advisory';

  const write = async (
    payload: Omit<LaneFindings, 'lane' | 'artifact' | 'kind' | 'slug' | 'startedAt'>,
    ok: boolean,
  ): Promise<LaneResult> => {
    await mkdir(dirname(sinkPath), { recursive: true });
    await writeJsonAtomic(sinkPath, {
      lane: LANE,
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...payload,
    } satisfies LaneFindings);
    return { lane: LANE, sinkPath, ok };
  };

  const resolution = await resolve(input);
  if (resolution.kind === 'terminal') {
    const { verdict, reason, detail } = resolution.at;
    // A round that had nothing to review is green in both modes; one that had
    // something and could not perform it reds only under `blocking`.
    const reds = mode === 'blocking' && verdict === 'cannot-review';
    return write(
      {
        verdict,
        reason,
        blockers: reds
          ? [{ file: input.artifact, severity: 'high', message: `${reason}: ${detail}` }]
          : [],
        suggestions: [],
        summary: `${verdict}: ${reason}`,
        notes: [detail],
      },
      !reds,
    );
  }

  const { design } = resolution;
  const notes =
    design.unmappedPaths.length > 0
      ? [`changed UI paths outside every declared surface: ${design.unmappedPaths.join(', ')}`]
      : [];

  // Scratch COPY: pencil `execute` is the editor's write API, so the child never
  // gets a path inside the repo.
  let scratchDir: string | null = null;
  let scratchPen: string;
  let hashBefore: string;
  try {
    hashBefore = await sha256(design.absPath);
    // mkdtemp creates the directory with mode 0700 by design, so the private-dir
    // requirement needs no extra chmod — and it mints a unique name, which is what
    // makes concurrent worktree rounds and symlink clobbering non-issues.
    scratchDir = await mkdtemp(join(tmpdir(), 'noldor-ui-review-'));
    scratchPen = join(scratchDir, `${input.slug}.pen`);
    await copyFile(design.absPath, scratchPen);
  } catch (err) {
    if (scratchDir !== null) await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
    return write(
      {
        verdict: 'cannot-review',
        reason: 'scratch-unavailable',
        blockers:
          mode === 'blocking'
            ? [
                {
                  file: input.artifact,
                  severity: 'high',
                  message: `scratch-unavailable: ${(err as Error).message}`,
                },
              ]
            : [],
        suggestions: [],
        summary: 'cannot-review: scratch-unavailable',
        notes: [...notes, `could not stage a design copy: ${(err as Error).message}`],
      },
      mode !== 'blocking',
    );
  }

  try {
    const fd = await readFd(join(input.repoRoot, input.fdPath));
    const run = defaultRunGit(input.repoRoot);
    let raw: string;
    try {
      raw = await dispatchUiReview({
        penPath: scratchPen,
        surfaces: design.surfaces,
        baseSha: resolveDefaultBase(run),
        headSha: input.artifactSha,
        repoRoot: input.repoRoot,
        fdSummary: 'reason' in fd ? NO_FD_SUMMARY : fd.summary,
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      });
    } catch (err) {
      const reason: LaneReasonCode =
        err instanceof UiDispatchError ? err.reason : 'dispatch-failed';
      return write(
        {
          verdict: 'cannot-review',
          reason,
          blockers:
            mode === 'blocking'
              ? [
                  {
                    file: input.artifact,
                    severity: 'high',
                    message: `${reason}: ${(err as Error).message}`,
                  },
                ]
              : [],
          suggestions: [],
          summary: `cannot-review: ${reason}`,
          notes: [...notes, (err as Error).message],
        },
        mode !== 'blocking',
      );
    }

    // Integrity BEFORE the report is trusted: a design that changed under the
    // reviewer invalidates the review, whatever the review concluded. Hash, not
    // `git diff` — the index cannot fool a hash, and an uncommitted edit that was
    // already there is not a mutation.
    if ((await sha256(design.absPath)) !== hashBefore) {
      return write(
        {
          verdict: 'fail',
          reason: 'pen-modified',
          blockers: [
            {
              file: design.repoRelPath,
              severity: 'high',
              message: `pen-modified: the design changed during review — the verdict cannot be trusted`,
            },
          ],
          suggestions: [],
          summary: 'fail: pen-modified',
          notes,
        },
        false,
      );
    }

    const report = parseUiReviewReport(raw);
    if (report === null) {
      return write(
        {
          verdict: 'cannot-review',
          reason: 'malformed-output',
          blockers:
            mode === 'blocking'
              ? [
                  {
                    file: input.artifact,
                    severity: 'high',
                    message: `malformed-output: ${raw.slice(0, 200)}`,
                  },
                ]
              : [],
          suggestions: [],
          summary: 'cannot-review: malformed-output',
          notes: [...notes, `unparseable child report: ${raw.slice(0, 200)}`],
        },
        mode !== 'blocking',
      );
    }
    if (report.verdict === 'cannot-review') {
      const reason: LaneReasonCode =
        report.reason === 'pen-unreadable' ? 'pen-unreadable' : 'no-feature-pen';
      return write(
        {
          verdict: 'cannot-review',
          reason,
          blockers:
            mode === 'blocking'
              ? [
                  {
                    file: design.repoRelPath,
                    severity: 'high',
                    message: `${reason}: child could not read the design`,
                  },
                ]
              : [],
          suggestions: [],
          summary: `cannot-review: ${reason}`,
          notes: [...notes, `child reported ${report.reason}`],
        },
        mode !== 'blocking',
      );
    }
    if (report.verdict === 'pass') {
      return write(
        {
          verdict: 'pass',
          blockers: [],
          suggestions: [],
          summary: 'implementation matches the approved design',
          ...(notes.length > 0 ? { notes } : {}),
        },
        true,
      );
    }
    const findings = report.findings.map(toFinding);
    return mode === 'blocking'
      ? write(
          {
            verdict: 'fail',
            blockers: findings,
            suggestions: [],
            summary: 'implementation contradicts the approved design',
            ...(notes.length > 0 ? { notes } : {}),
          },
          false,
        )
      : write(
          {
            verdict: 'fail',
            blockers: [],
            suggestions: findings.map((f) => ({ ...f, severity: 'low' as const })),
            summary: 'ADVISORY: implementation contradicts the approved design (advisory mode)',
            ...(notes.length > 0 ? { notes } : {}),
          },
          true,
        );
  } finally {
    // Cleanup never rewrites an already-written sink: losing a tmpdir costs disk,
    // rewriting a sink costs the round's honesty.
    await rm(scratchDir, { recursive: true, force: true }).catch((err: Error) => {
      console.error(`ui-review: scratch cleanup failed for ${scratchDir}: ${err.message}`);
    });
  }
}
