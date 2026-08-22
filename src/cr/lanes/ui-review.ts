// @tests: ui-design-review-lane
// The `ui-reviewer` lane: does the implemented UI match the design this session
// approved? Node resolves the `.pen` PATH and the surfaces in scope; the child
// reads the design through pencil MCP (encrypted file, only reader) and returns a
// verdict. Every terminating path writes exactly one sink — a lane with no sink is
// indistinguishable from a lane that passed (Q-0100).

import { errMessage } from '../../core/err-message.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';
import {
  UiDispatchError,
  dispatchUiReview,
  parseUiReviewReport,
  type UiFinding,
} from './ui-review-dispatch.js';

const LANE = 'ui-reviewer' as const;

/** Child finding → sink finding: the two-sided evidence rides the message. */
const toFinding = (f: UiFinding): Finding => ({
  file: f.file,
  severity: f.severity,
  message: `[${f.designPage} › ${f.designElement}] ${f.message}`,
  ...(f.line !== undefined ? { line: f.line } : {}),
});

export async function runUiReview(input: LaneInput): Promise<LaneResult> {
  const opened = await openDesignReviewRound(input, LANE, 'uiReviewMode', 'noldor-ui-review');
  if (opened.kind === 'done') return opened.result;
  const { mode } = opened;
  const { write, writeTerminal, design, notes } = opened.ctx;
  const { dir: scratchDir, penPath: scratchPen, designChanged } = opened.ctx.scratch;

  try {
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
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail, notes);
    }

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
    return writeFailByMode(
      write,
      mode,
      report.findings.map(toFinding),
      'implementation contradicts the approved design',
      notes,
    );
  } finally {
    await cleanupPenScratch(scratchDir, 'ui-review');
  }
}
