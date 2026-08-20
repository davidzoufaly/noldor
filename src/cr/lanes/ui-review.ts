// @tests: ui-design-review-lane
// The `ui-reviewer` lane: does the implemented UI match the design this session
// approved? Node resolves the `.pen` PATH and the surfaces in scope; the child
// reads the design through pencil MCP (encrypted file, only reader) and returns a
// verdict. Every terminating path writes exactly one sink — a lane with no sink is
// indistinguishable from a lane that passed (Q-0100).

import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { defaultRunGit, resolveDefaultBase } from '../../core/branch-added.js';
import { writeJsonAtomic } from '../atomic-write.js';
import { openLane } from '../filename.js';
import { loadLaneMode } from '../lane-mode.js';
import type { Finding, LaneFindings, LaneReasonCode } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import {
  NO_FD_SUMMARY,
  readFd,
  resolveUiReviewTarget,
  type Terminal,
} from './ui-design-resolve.js';
import {
  UiDispatchError,
  dispatchUiReview,
  parseUiReviewReport,
  type UiFinding,
} from './ui-review-dispatch.js';

const LANE = 'ui-reviewer' as const;

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
  const mode = await loadLaneMode(input.repoRoot, 'uiReviewMode');

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

  /**
   * The one writer for every outcome that performed no comparison. A round that
   * had nothing to review is green in both modes; one that had something and
   * could not perform it reds only under `blocking`. `file` is the artifact
   * unless the failure is about the design file itself.
   */
  const writeTerminal = (
    { verdict, reason, detail }: Terminal,
    extraNotes: string[] = [],
    file: string = input.artifact,
  ): Promise<LaneResult> => {
    const reds = mode === 'blocking' && verdict === 'cannot-review';
    return write(
      {
        verdict,
        reason,
        blockers: reds ? [{ file, severity: 'high', message: `${reason}: ${detail}` }] : [],
        suggestions: [],
        summary: `${verdict}: ${reason}`,
        notes: [...extraNotes, detail],
      },
      !reds,
    );
  };

  const resolution = await resolveUiReviewTarget(input);
  if (resolution.kind === 'terminal') return writeTerminal(resolution.at);

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
    if (scratchDir !== null) {
      await rm(scratchDir, { recursive: true, force: true }).catch((e: Error) => {
        console.error(`ui-review: scratch cleanup failed: ${e.message}`);
      });
    }
    return writeTerminal(
      {
        verdict: 'cannot-review',
        reason: 'scratch-unavailable',
        detail: `could not stage a design copy: ${(err as Error).message}`,
      },
      notes,
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
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: 'malformed-output',
          detail: `unparseable child report: ${raw.slice(0, 200)}`,
        },
        notes,
      );
    }
    if (report.verdict === 'cannot-review') {
      const reason: LaneReasonCode =
        report.reason === 'pen-unreadable' ? 'pen-unreadable' : 'no-feature-pen';
      return writeTerminal(
        { verdict: 'cannot-review', reason, detail: `child reported ${report.reason}` },
        notes,
        design.repoRelPath,
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
