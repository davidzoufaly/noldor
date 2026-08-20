// @tests: ui-design-review-lane
// The `ui-reviewer` lane: does the implemented UI match the design this session
// approved? Node resolves the `.pen` PATH and the surfaces in scope; the child
// reads the design through pencil MCP (encrypted file, only reader) and returns a
// verdict. Every terminating path writes exactly one sink — a lane with no sink is
// indistinguishable from a lane that passed (Q-0100).

import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import { loadLaneMode } from '../lane-mode.js';
import { openLaneSink } from '../lane-sink.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { resolveUiReviewTarget, type Terminal } from './ui-design-resolve.js';
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
  const { write } = openLaneSink(input, LANE);
  const mode = await loadLaneMode(input.repoRoot, 'uiReviewMode');

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
      await rm(scratchDir, { recursive: true, force: true }).catch((e: unknown) => {
        console.error(`ui-review: scratch cleanup failed: ${errMessage(e)}`);
      });
    }
    return writeTerminal(
      {
        verdict: 'cannot-review',
        reason: 'scratch-unavailable',
        detail: `could not stage a design copy: ${errMessage(err)}`,
      },
      notes,
    );
  }

  try {
    /** Integrity verdict for the repo's design file across the dispatch. */
    const designChanged = async (): Promise<{ changed: boolean; detail: string }> => {
      try {
        return { changed: (await sha256(design.absPath)) !== hashBefore, detail: '' };
      } catch (err) {
        // The design became unreadable DURING its own review — deleted or
        // chmod'd. That is the mutation class the hash exists to catch, so it
        // reads as changed rather than escaping as an unhandled throw.
        return {
          changed: true,
          detail: `design unreadable after review: ${errMessage(err)}`,
        };
      }
    };
    const writePenModified = (detail: string): Promise<LaneResult> =>
      write(
        {
          verdict: 'fail',
          reason: 'pen-modified',
          blockers: [
            {
              file: design.repoRelPath,
              severity: 'high',
              message: `pen-modified: the design changed during review — the verdict cannot be trusted${detail ? ` (${detail})` : ''}`,
            },
          ],
          suggestions: [],
          summary: 'fail: pen-modified',
          ...(notes.length > 0 ? { notes } : {}),
        },
        false,
      );

    const cap = input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {};
    let raw: string | null = null;
    let dispatchFailure: { reason: LaneReasonCode; message: string } | null = null;
    try {
      raw = await dispatchUiReview({
        penPath: scratchPen,
        surfaces: design.surfaces,
        baseSha: design.base,
        headSha: input.artifactSha,
        repoRoot: input.repoRoot,
        fdSummary: design.fdSummary,
        ...cap,
      });
    } catch (err) {
      dispatchFailure = {
        reason: err instanceof UiDispatchError ? err.reason : 'dispatch-failed',
        message: errMessage(err),
      };
    }

    // Integrity is checked BEFORE the dispatch outcome is acted on — including a
    // failed dispatch. A child that edits the design and then times out would
    // otherwise land as an advisory-green `timeout` instead of the mandatory
    // `pen-modified` blocker.
    const integrity = await designChanged();
    if (integrity.changed) return writePenModified(integrity.detail);

    if (dispatchFailure !== null) {
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: dispatchFailure.reason,
          detail: dispatchFailure.message,
        },
        notes,
      );
    }

    const report = parseUiReviewReport(raw ?? '');
    if (report === null) {
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: 'malformed-output',
          detail: `unparseable child report: ${(raw ?? '').slice(0, 200)}`,
        },
        notes,
      );
    }
    if (report.verdict === 'cannot-review') {
      // The child's two reasons stay distinct: `no-final-pages` means the design
      // exists but pins nothing for the scope, `pen-unreadable` that it could not
      // be opened at all. Different remediation, so different codes.
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: report.reason,
          detail: `child reported ${report.reason}`,
        },
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
    await rm(scratchDir, { recursive: true, force: true }).catch((err: unknown) => {
      console.error(`ui-review: scratch cleanup failed for ${scratchDir}: ${errMessage(err)}`);
    });
  }
}
