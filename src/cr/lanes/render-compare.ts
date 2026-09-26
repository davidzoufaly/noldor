// @tests: ui-design-review-lane
// The `render-compare` lane: boot the consumer's app from its `uiBoot` recipe,
// capture what each surface's real route renders, and pixel-diff it against the
// session's committed `.pen` design — a deterministic comparison, not a second
// model-judgment pass (the one dispatched agent is the design EXPORTER; its
// words never decide a verdict, its output files do). Every terminating path
// writes exactly one sink (Q-0100), and a per-surface failure never aborts the
// round — outcomes aggregate by `fail` > `cannot-review` > `pass` (spec R7).

import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { PNG } from 'pngjs';

import { errMessage } from '../../core/err-message.js';
import { loadConsumerConfig } from '../../core/consumer-config.js';
import type { UiBootRecipe } from '../../core/consumer-config.js';
import { runCapture } from '../../core/run-capture.js';
import type { CaptureResult } from '../../core/run-capture.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
import { forEachBootedSurface, type BootProbeDeps } from './boot-probe.js';
import {
  MAX_RASTER_BYTES,
  aggregateOutcomes,
  decodePng,
  diffDecoded,
  selectFinalPage,
  severityForRatio,
  substituteScreenshotCommand,
} from './render-compare-core.js';
import type { SurfaceOutcome } from './render-compare-core.js';
import {
  RenderExportError,
  dispatchRenderExport,
  type RenderExportReport,
} from './render-export-dispatch.js';
import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';
import type { LaneAnswer } from '../lane-answer.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';

const LANE = 'render-compare' as const;

/**
 * Ratio formatting for findings and notes: six decimals so a boundary failure
 * like 0.250001 > 0.25 stays visibly consistent with the strict comparison —
 * four would render it as an apparent tie.
 */
const fmtRatio = (r: number): string => r.toFixed(6);

interface RenderCompareDeps extends BootProbeDeps {
  capture: typeof runCapture;
}

let deps: RenderCompareDeps = {
  boot: bootServer,
  capture: runCapture,
  fetchImpl: fetch,
  resolvePort,
  routeProbeBudgetMs: 15_000,
};

/** Test seam — production code never calls this. */
export function setRenderCompareDeps(partial: Partial<RenderCompareDeps>): void {
  deps = { ...deps, ...partial };
}

/** A recipe the pixel lane can run: `withRecipe` admits only these. */
type ScreenshotRecipe = UiBootRecipe & { screenshotCommand: string };

/** A surface's per-round working state, keyed off its recipe + design raster. */
interface SurfaceJob {
  surface: string;
  sanitized: string;
  /** Built only from `withRecipe`, so `screenshotCommand` is always present. */
  recipe: ScreenshotRecipe;
  /** Raw bytes, persisted as the design artifact. */
  designBuf: Buffer;
  /** Decoded once at export validation; feeds {width}/{height} and the diff. */
  designPng: PNG;
  shotBuf?: Buffer;
  diffBuf?: Buffer;
}

const cannot = (surface: string, reason: LaneReasonCode, detail: string): SurfaceOutcome => ({
  surface,
  kind: 'cannot-review',
  reason,
  detail,
});

export async function runRenderCompare(input: LaneInput): Promise<LaneResult> {
  const opened = await openDesignReviewRound(
    input,
    LANE,
    'renderCompareMode',
    'noldor-render-compare',
  );
  if (opened.kind === 'done') return opened.result;
  const { mode } = opened;
  const { write, writeTerminal, design, notes } = opened.ctx;

  // Scratch roles, explicit per spec R5: the REPO file's hash is the only
  // `pen-modified` trigger; the scratch copy is expendable — the exporter may
  // touch it, and no hash is taken of it.
  const { dir: scratchDir, penPath: scratchPen, designChanged } = opened.ctx.scratch;

  // One config parse for the whole round: `uiBoot` and `verifyCommands` come
  // from the same validated object, so the superRefine cross-checks (recipe
  // keys ⊆ uiSurfaces, verifyCommand → kind "server") hold for exactly the
  // values used below. The scratch dir is already staged, so this failure path
  // must release it too.
  // Maps, not raw records: Object.entries copies OWN keys only, so a surface
  // named like an inherited property ('constructor') cannot alias prototype
  // members in lookups.
  let recipes: Map<string, UiBootRecipe>;
  let declaredSurfaces: string[];
  let verifyCommands: Map<string, ReturnType<typeof loadConsumerConfig>['verifyCommands'][string]>;
  try {
    const consumer = loadConsumerConfig(input.repoRoot);
    recipes = new Map(Object.entries(consumer.uiBoot ?? {}));
    declaredSurfaces = Object.keys(consumer.uiSurfaces ?? {});
    verifyCommands = new Map(Object.entries(consumer.verifyCommands));
  } catch (err) {
    // pen-modified precedence is absolute (spec R7) — checked even on this
    // pre-pipeline terminal, since the reference hash already exists.
    const integrity = await designChanged();
    await cleanupPenScratch(scratchDir, 'render-compare');
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail, notes);
    }
    return writeTerminal(
      { verdict: 'cannot-review', reason: 'config-unreadable', detail: errMessage(err) },
      notes,
    );
  }

  /** The one absolute red (spec R7): the shared shape, with per-surface rows as forensics. */
  const penModified = (detail: string, rowNotes: string[]): Promise<LaneResult> =>
    writePenModified(write, design.repoRelPath, detail, [...notes, ...rowNotes]);

  try {
    const outcomes: SurfaceOutcome[] = [];
    const artifactRelDir = `.noldor/cr/render-compare/${input.slug}`;
    const rel = (sanitized: string, kind: 'design' | 'shot' | 'diff'): string =>
      `${artifactRelDir}/${sanitized}.${kind}.png`;

    // Zero AFFECTED surfaces (an FD `design: required` override with no changed
    // path matching `uiPaths`) must not aggregate to a "0 surfaces" pass —
    // that would be a blocking-mode bypass for exactly the operator-forced
    // sessions. Mirror the sibling lane's whole-design posture: review every
    // configured recipe; with none configured there is nothing honest to boot.
    let surfaces = design.surfaces;
    if (surfaces.length === 0) {
      // The union of DECLARED surfaces and recipe keys, not recipes alone: a
      // declared surface without a recipe must still land as a no-boot-recipe
      // row, or partial coverage would silently read as a whole-design pass.
      surfaces = [...new Set([...declaredSurfaces, ...recipes.keys()])].sort();
      if (surfaces.length === 0) {
        // pen-modified precedence holds on this terminal too (spec R7).
        const integrity = await designChanged();
        if (integrity.changed) return penModified(integrity.detail, []);
        return writeTerminal(
          {
            verdict: 'cannot-review',
            reason: 'no-boot-recipe',
            detail:
              'zero affected surfaces resolved (FD design override with no matching changed paths) and no consumer.uiBoot recipe to fall back to',
          },
          notes,
        );
      }
      notes.push(
        `zero affected surfaces resolved — reviewing every declared surface: ${surfaces.join(', ')}`,
      );
    }

    // R3 addition: an affected surface with no recipe is a full per-surface
    // outcome, so a round with an unconfigured affected surface never
    // aggregates to `pass`.
    // A recipe without `screenshotCommand` is as unusable to THIS lane as no
    // recipe at all — the field became optional when `geometryCommand` landed
    // — so both get the same row with different details.
    const withRecipe = surfaces.filter((s) => recipes.get(s)?.screenshotCommand !== undefined);
    for (const s of surfaces) {
      const recipe = recipes.get(s);
      if (recipe === undefined) {
        outcomes.push(cannot(s, 'no-boot-recipe', `surface '${s}' has no consumer.uiBoot recipe`));
      } else if (recipe.screenshotCommand === undefined) {
        outcomes.push(
          cannot(
            s,
            'no-boot-recipe',
            `surface '${s}' has a uiBoot recipe but no screenshotCommand`,
          ),
        );
      }
    }

    // ---- R5: design raster export (one child for every recipe surface) ----
    const exportDir = join(scratchDir, 'export');
    const shotDir = join(scratchDir, 'shots');
    await mkdir(exportDir, { recursive: true });
    await mkdir(shotDir, { recursive: true });

    const jobs: SurfaceJob[] = [];
    if (withRecipe.length > 0) {
      const requests = withRecipe.map((surface) => ({
        surface,
        ...(recipes.get(surface)?.page !== undefined
          ? { pageSelector: recipes.get(surface)?.page }
          : {}),
        outPath: join(exportDir, `${sanitizeSurfaceName(surface)}.design.png`),
      }));
      let answer: LaneAnswer<RenderExportReport> | null = null;
      let exportFailure: string | null = null;
      try {
        answer = await dispatchRenderExport(
          {
            penPath: scratchPen,
            requests,
            ...(input.dispatchTimeoutMs !== undefined
              ? { timeoutMs: input.dispatchTimeoutMs }
              : {}),
          },
          input,
        );
      } catch (err) {
        exportFailure =
          err instanceof RenderExportError
            ? err.message
            : `exporter dispatch failed: ${errMessage(err)}`;
      }
      const report = exportFailure === null && answer?.ok === true ? answer.answer : null;
      if (exportFailure !== null) {
        for (const r of requests) outcomes.push(cannot(r.surface, 'export-failed', exportFailure));
      } else if (report === null) {
        // Without a parseable report there is no trustworthy page enumeration,
        // so a PNG on disk could be a raster of the WRONG page — fail closed
        // rather than pass a comparison whose selection nobody verified.
        for (const r of requests) {
          outcomes.push(
            cannot(
              r.surface,
              'export-failed',
              'exporter report unparseable — no trustworthy FINAL: page enumeration',
            ),
          );
        }
      } else {
        // Duplicate rows for one surface are CONFLICTING enumerations from an
        // untrusted child — collapsing them (last row wins) could route a wrong
        // candidate list past the selection rule. Refuse the surface instead.
        const rowCounts = new Map<string, number>();
        for (const s of report.surfaces) {
          rowCounts.set(s.surface, (rowCounts.get(s.surface) ?? 0) + 1);
        }
        const bySurface = new Map(report.surfaces.map((s) => [s.surface, s]));
        for (const r of requests) {
          if ((rowCounts.get(r.surface) ?? 0) > 1) {
            outcomes.push(
              cannot(
                r.surface,
                'export-failed',
                `exporter report carries ${rowCounts.get(r.surface)} conflicting rows for surface '${r.surface}'`,
              ),
            );
            continue;
          }
          const reported = bySurface.get(r.surface);
          if (reported === undefined) {
            outcomes.push(
              cannot(
                r.surface,
                'export-failed',
                `exporter report omits surface '${r.surface}' — no page enumeration to validate`,
              ),
            );
            continue;
          }
          // The child ENUMERATES, Node SELECTS: the selection rule runs here,
          // over the reported candidates, so the child's own judgment (and the
          // prompt's prose copy of the rule) never decides which page was
          // compared. A file for an unresolvable selection is not evidence.
          const selection = selectFinalPage(r.surface, reported.candidates, r.pageSelector);
          if (!selection.ok) {
            outcomes.push(cannot(r.surface, 'page-ambiguous', selection.detail));
            continue;
          }
          const unreviewed = reported.candidates
            .map((c) => c.trim())
            .filter((c) => c !== selection.page);
          if (unreviewed.length > 0) {
            notes.push(`[${r.surface}] unreviewed FINAL: pages: ${unreviewed.join(', ')}`);
          }
          // Trusted evidence: the file itself. Exists + bounded + decodes +
          // positive dims, or the surface is `export-failed` regardless of the
          // report. Size is checked via stat BEFORE the read — a runaway
          // exporter must not get multi-gigabyte bytes into memory just to be
          // rejected by the decoder's cap.
          let buf: Buffer;
          try {
            const size = (await stat(r.outPath)).size;
            if (size > MAX_RASTER_BYTES) {
              outcomes.push(
                cannot(
                  r.surface,
                  'export-failed',
                  `export is ${size} bytes (cap ${MAX_RASTER_BYTES}) — refusing to read`,
                ),
              );
              continue;
            }
            buf = await readFile(r.outPath);
          } catch (err) {
            outcomes.push(
              cannot(r.surface, 'export-failed', `expected export missing: ${errMessage(err)}`),
            );
            continue;
          }
          const decoded = decodePng(buf);
          if (decoded.png === null) {
            outcomes.push(
              cannot(r.surface, 'export-failed', `export undecodable: ${decoded.detail}`),
            );
            continue;
          }
          jobs.push({
            surface: r.surface,
            sanitized: sanitizeSurfaceName(r.surface),
            recipe: recipes.get(r.surface) as ScreenshotRecipe,
            designBuf: buf,
            designPng: decoded.png,
          });
        }
      }
    }

    // ---- R4: boot per verifyCommand group, probe + capture per surface ----
    await forEachBootedSurface({
      jobs,
      verifyCommands,
      repoRoot: input.repoRoot,
      deps,
      unreachable: (job, reason, detail) => {
        outcomes.push(cannot(job.surface, reason, detail));
      },
      reached: async (job, url) => {
        const failShot = (detail: string): void => {
          outcomes.push(cannot(job.surface, 'screenshot-failed', detail));
        };
        const outAbs = join(shotDir, `${job.sanitized}.shot.png`);
        const command = substituteScreenshotCommand(job.recipe.screenshotCommand, {
          url,
          out: outAbs,
          width: String(job.designPng.width),
          height: String(job.designPng.height),
        });
        if (command === null) {
          failShot(
            `a substitution value contains a single quote and cannot be safely quoted (out=${outAbs})`,
          );
          return;
        }
        let cap: CaptureResult;
        try {
          cap = await deps.capture(command, input.repoRoot, job.recipe.captureTimeoutMs);
        } catch (err) {
          failShot(`capture threw: ${errMessage(err)}`);
          return;
        }
        // The stderr tail rides `notes` for EVERY failed-capture class (spec R4):
        // a timeout or an undecodable output needs the diagnosis as much as an exit.
        const failCapture = (detail: string): void => {
          if (cap.stderrTail !== '')
            notes.push(`[${job.surface}] capture stderr: ${cap.stderrTail}`);
          failShot(detail);
        };
        if (cap.timedOut) {
          failCapture(`capture timed out after ${job.recipe.captureTimeoutMs}ms`);
          return;
        }
        if (cap.code !== 0) {
          failCapture(`capture exited ${cap.code}`);
          return;
        }
        let shotBuf: Buffer;
        try {
          const size = (await stat(outAbs)).size;
          if (size > MAX_RASTER_BYTES) {
            failCapture(
              `capture output is ${size} bytes (cap ${MAX_RASTER_BYTES}) — refusing to read`,
            );
            return;
          }
          shotBuf = await readFile(outAbs);
        } catch (err) {
          failCapture(`capture wrote no output file: ${errMessage(err)}`);
          return;
        }
        job.shotBuf = shotBuf;
        // ---- R6: the diff engine (design already decoded at export time) ----
        const diff = diffDecoded(job.designPng, shotBuf);
        if (diff.kind === 'undecodable') {
          failCapture(`shot raster undecodable: ${diff.detail}`);
          return;
        }
        if (diff.kind === 'dimension-mismatch') {
          outcomes.push(cannot(job.surface, 'dimension-mismatch', diff.detail));
          return;
        }
        job.diffBuf = diff.diffPng;
        const threshold = job.recipe.maxDiffRatio;
        const base = { surface: job.surface, diffRatio: diff.diffRatio, threshold };
        // Strict: ratios exactly at the threshold pass (spec R6).
        outcomes.push(
          diff.diffRatio > threshold
            ? {
                ...base,
                kind: 'fail',
                severity: severityForRatio(diff.diffRatio, threshold),
                designPath: rel(job.sanitized, 'design'),
                shotPath: rel(job.sanitized, 'shot'),
                diffPath: rel(job.sanitized, 'diff'),
              }
            : { ...base, kind: 'pass' },
        );
      },
    });

    // ---- R6: persist artifacts, atomically per round ----
    // A round with no raster hands the swap an empty list, which keeps the prior
    // round's evidence (see round-artifacts.ts for why).
    const artifacts: RoundArtifact[] = [];
    for (const job of jobs) {
      artifacts.push({ name: `${job.sanitized}.design.png`, body: job.designBuf });
      if (job.shotBuf !== undefined) {
        artifacts.push({ name: `${job.sanitized}.shot.png`, body: job.shotBuf });
      }
      if (job.diffBuf !== undefined) {
        artifacts.push({ name: `${job.sanitized}.diff.png`, body: job.diffBuf });
      }
    }
    const swap = await swapRoundArtifacts(
      join(input.repoRoot, '.noldor', 'cr', 'render-compare'),
      input.slug,
      artifacts,
    );
    const persistFailure = swap.ok ? null : swap.detail;
    if (persistFailure !== null) notes.push(`artifact persist failed: ${persistFailure}`);

    // ---- rows (per-surface record, deterministic order) ----
    const sorted = [...outcomes].sort((a, b) =>
      a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0,
    );
    // Findings may reference image paths unconditionally: a persist failure
    // never reaches the fail write — it terminates as cannot-review above.
    const failFindings: Finding[] = sorted
      .filter((o): o is Extract<SurfaceOutcome, { kind: 'fail' }> => o.kind === 'fail')
      .map((o) => ({
        file: o.diffPath,
        severity: o.severity,
        message: `[${o.surface}] diffRatio ${fmtRatio(o.diffRatio)} > ${o.threshold} — design=${o.designPath} shot=${o.shotPath}`,
      }));
    const rowNotes: string[] = sorted.map((o) =>
      o.kind === 'pass'
        ? `[${o.surface}] diffRatio ${fmtRatio(o.diffRatio)} ≤ ${o.threshold}`
        : o.kind === 'fail'
          ? `[${o.surface}] fail: diffRatio ${fmtRatio(o.diffRatio)} > ${o.threshold}`
          : `[${o.surface}] ${o.reason}: ${o.detail}`,
    );

    // ---- pen-modified precedence: global, absolute (spec R7) ----
    const integrity = await designChanged();
    if (integrity.changed) return penModified(integrity.detail, rowNotes);

    // Persisting the evidence set is part of the round's contract (spec R6):
    // a verdict whose images could not be written is not auditable, so it must
    // not read as a clean `pass`/`fail` — blocking consumers red on it, and the
    // per-surface rows stay in `notes` as the record of what WAS computed.
    if (persistFailure !== null) {
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: 'persist-failed',
          detail: `artifact persist failed — evidence images unavailable: ${persistFailure}`,
        },
        [...notes, ...rowNotes],
      );
    }

    // ---- R7: aggregate + mode matrix ----
    const agg = aggregateOutcomes(outcomes);
    if (agg.verdict === 'pass') {
      return write(
        {
          verdict: 'pass',
          blockers: [],
          suggestions: [],
          summary: `every surface within threshold (${outcomes.length} surface${outcomes.length === 1 ? '' : 's'})`,
          notes: [...notes, ...rowNotes],
        },
        true,
      );
    }
    if (agg.verdict === 'cannot-review') {
      const reds = mode === 'blocking';
      return write(
        {
          verdict: 'cannot-review',
          reason: agg.reason,
          blockers: reds
            ? [
                {
                  file: input.artifact,
                  severity: 'high',
                  message: `${agg.reason}: ${agg.detail}`,
                },
              ]
            : [],
          suggestions: [],
          summary: `cannot-review: ${agg.reason}`,
          notes: [...notes, ...rowNotes],
        },
        !reds,
      );
    }
    // agg.verdict === 'fail'
    return writeFailByMode(
      write,
      mode,
      failFindings,
      'rendered routes drift past their design diff thresholds',
      [...notes, ...rowNotes],
    );
  } catch (err) {
    // Backstop for anything the per-stage handling above did not classify: a
    // round must never terminate without its sink (AC11). `pen-modified`
    // precedence is absolute even here — an unexpected throw that coincides
    // with a design change must red as pen-modified, not hide behind an
    // infrastructure reason. `dispatch-failed` is the shared lane vocabulary's
    // infra-failure class (same set the resolver's terminals draw from).
    const integrity = await designChanged();
    if (integrity.changed) {
      return penModified(
        integrity.detail || `during unexpected pipeline failure: ${errMessage(err)}`,
        [],
      );
    }
    return writeTerminal(
      {
        verdict: 'cannot-review',
        reason: 'dispatch-failed',
        detail: `unexpected pipeline failure: ${errMessage(err)}`,
      },
      notes,
    );
  } finally {
    await cleanupPenScratch(scratchDir, 'render-compare');
  }
}
