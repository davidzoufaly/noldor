// @tests: ui-design-review-lane
// The `render-compare` lane: boot the consumer's app from its `uiBoot` recipe,
// capture what each surface's real route renders, and pixel-diff it against the
// session's committed `.pen` design — a deterministic comparison, not a second
// model-judgment pass (the one dispatched agent is the design EXPORTER; its
// words never decide a verdict, its output files do). Every terminating path
// writes exactly one sink (Q-0100), and a per-surface failure never aborts the
// round — outcomes aggregate by `fail` > `cannot-review` > `pass` (spec R7).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import { loadUiBoot, loadVerifyCommands } from '../../core/consumer-config.js';
import type { UiBootRecipe } from '../../core/consumer-config.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import { loadLaneMode } from '../lane-mode.js';
import { openLaneSink } from '../lane-sink.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import {
  aggregateOutcomes,
  decodePng,
  diffRasters,
  severityForRatio,
  substituteScreenshotCommand,
} from './render-compare-core.js';
import type { SurfaceOutcome } from './render-compare-core.js';
import {
  RenderExportError,
  dispatchRenderExport,
  parseRenderExportReport,
} from './render-export-dispatch.js';
import { resolveUiReviewTarget, type Terminal } from './ui-design-resolve.js';

const LANE = 'render-compare' as const;

/** Bounds the route probe — same cap the health check's probe fetches use. */
const ROUTE_PROBE_TIMEOUT_MS = 2000;
const STDERR_TAIL_CAP = 2000;

const sha256 = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

export interface CaptureResult {
  code: number;
  timedOut: boolean;
  stderrTail: string;
}

/**
 * Run the substituted `screenshotCommand` under its cap: own process group so a
 * timeout SIGKILLs the whole capture tree, cwd = repo root, env inherited.
 */
function runCapture(command: string, cwd: string, timeoutMs: number): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CAP);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      }
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, timedOut: false, stderrTail: errMessage(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, timedOut, stderrTail: stderr.trim() });
    });
  });
}

interface RenderCompareDeps {
  boot: typeof bootServer;
  capture: typeof runCapture;
  fetchImpl: typeof fetch;
  resolvePort: typeof resolvePort;
}

let deps: RenderCompareDeps = {
  boot: bootServer,
  capture: runCapture,
  fetchImpl: fetch,
  resolvePort,
};

/** Test seam — production code never calls this. */
export function setRenderCompareDeps(partial: Partial<RenderCompareDeps>): void {
  deps = { ...deps, ...partial };
}

/** A surface's per-round working state, keyed off its recipe + design raster. */
interface SurfaceJob {
  surface: string;
  sanitized: string;
  recipe: UiBootRecipe;
  designBuf: Buffer;
  width: number;
  height: number;
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
  const { write } = openLaneSink(input, LANE);
  const mode = await loadLaneMode(input.repoRoot, 'renderCompareMode');

  /** Whole-round terminal writer — identical posture to the ui-reviewer lane. */
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

  const notes: string[] =
    design.unmappedPaths.length > 0
      ? [`changed UI paths outside every declared surface: ${design.unmappedPaths.join(', ')}`]
      : [];

  let uiBoot: Record<string, UiBootRecipe>;
  try {
    uiBoot = loadUiBoot(input.repoRoot);
  } catch (err) {
    return writeTerminal(
      { verdict: 'cannot-review', reason: 'config-unreadable', detail: errMessage(err) },
      notes,
    );
  }

  // Scratch COPY discipline reused from ui-review.ts, roles explicit (spec R5):
  // the REPO file's hash is the only `pen-modified` trigger; the scratch copy
  // is expendable — the exporter may touch it, and no hash is taken of it.
  let scratchDir: string | null = null;
  let scratchPen: string;
  let hashBefore: string;
  try {
    hashBefore = await sha256(design.absPath);
    scratchDir = await mkdtemp(join(tmpdir(), 'noldor-render-compare-'));
    scratchPen = join(scratchDir, `${input.slug}.pen`);
    await copyFile(design.absPath, scratchPen);
  } catch (err) {
    if (scratchDir !== null) {
      await rm(scratchDir, { recursive: true, force: true }).catch((e: unknown) => {
        console.error(`render-compare: scratch cleanup failed: ${errMessage(e)}`);
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
    const outcomes: SurfaceOutcome[] = [];
    const artifactRelDir = `.noldor/cr/render-compare/${input.slug}`;
    const rel = (sanitized: string, kind: 'design' | 'shot' | 'diff'): string =>
      `${artifactRelDir}/${sanitized}.${kind}.png`;

    // R3 addition: an affected surface with no recipe is a full per-surface
    // outcome, so a round with an unconfigured affected surface never
    // aggregates to `pass`.
    const withRecipe = design.surfaces.filter((s) => uiBoot[s] !== undefined);
    for (const s of design.surfaces) {
      if (uiBoot[s] === undefined) {
        outcomes.push(cannot(s, 'no-boot-recipe', `surface '${s}' has no consumer.uiBoot recipe`));
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
        ...(uiBoot[surface].page !== undefined ? { pageSelector: uiBoot[surface].page } : {}),
        outPath: join(exportDir, `${sanitizeSurfaceName(surface)}.design.png`),
      }));
      let raw: string | null = null;
      let exportFailure: string | null = null;
      try {
        raw = await dispatchRenderExport({
          penPath: scratchPen,
          requests,
          ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
        });
      } catch (err) {
        exportFailure =
          err instanceof RenderExportError
            ? err.message
            : `exporter dispatch failed: ${errMessage(err)}`;
      }
      if (exportFailure !== null) {
        for (const r of requests) outcomes.push(cannot(r.surface, 'export-failed', exportFailure));
      } else {
        const report = parseRenderExportReport(raw ?? '');
        if (report === null) {
          notes.push('exporter report unparseable — trusting output files only');
        }
        const bySurface = new Map(report?.surfaces.map((s) => [s.surface, s]) ?? []);
        for (const r of requests) {
          const reported = bySurface.get(r.surface);
          if (reported?.outcome === 'page-ambiguous') {
            const candidates =
              reported.candidates.length > 0 ? reported.candidates.join(', ') : 'none';
            outcomes.push(
              cannot(
                r.surface,
                'page-ambiguous',
                `surface '${r.surface}' FINAL: page selection unresolvable (candidates: ${candidates})`,
              ),
            );
            continue;
          }
          // Trusted evidence: the file itself. Exists + decodes + positive dims,
          // or the surface is `export-failed` regardless of the report.
          let buf: Buffer;
          try {
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
            recipe: uiBoot[r.surface],
            designBuf: buf,
            width: decoded.png.width,
            height: decoded.png.height,
          });
        }
      }
    }

    // ---- R4: boot per verifyCommand group, probe + capture per surface ----
    const verifyCommands = loadVerifyCommands(input.repoRoot);
    const groups = new Map<string, SurfaceJob[]>();
    for (const job of jobs) {
      groups.set(job.recipe.verifyCommand, [...(groups.get(job.recipe.verifyCommand) ?? []), job]);
    }
    for (const [cmdName, groupJobs] of groups) {
      const entry = verifyCommands[cmdName];
      if (entry === undefined || entry.kind !== 'server') {
        for (const job of groupJobs) {
          outcomes.push(
            cannot(
              job.surface,
              'boot-failed',
              `verifyCommand '${cmdName}' is ${entry === undefined ? 'missing from consumer.verifyCommands' : `kind "${entry.kind}", not "server"`}`,
            ),
          );
        }
        continue;
      }
      let port: number;
      try {
        port = await deps.resolvePort(input.repoRoot);
      } catch (err) {
        for (const job of groupJobs) {
          outcomes.push(cannot(job.surface, 'boot-failed', `no free port: ${errMessage(err)}`));
        }
        continue;
      }
      const boot = await deps.boot(entry, port, input.repoRoot, deps.fetchImpl);
      if (!boot.ok) {
        for (const job of groupJobs) {
          outcomes.push(cannot(job.surface, 'boot-failed', boot.observed));
        }
        continue;
      }
      try {
        for (const job of groupJobs) {
          const url = `http://127.0.0.1:${port}${job.recipe.route}`;
          // Route probe: keeps a 404/500 route from producing a confident pixel
          // verdict against an error page. Redirects are followed; the FINAL
          // status must be 2xx.
          let status: number | null = null;
          try {
            const res = await deps.fetchImpl(url, {
              signal: AbortSignal.timeout(ROUTE_PROBE_TIMEOUT_MS),
              redirect: 'follow',
            });
            status = res.status;
          } catch (err) {
            outcomes.push(
              cannot(job.surface, 'route-unreachable', `GET ${url} failed: ${errMessage(err)}`),
            );
            continue;
          }
          if (status < 200 || status >= 300) {
            outcomes.push(
              cannot(job.surface, 'route-unreachable', `GET ${url} → ${status} (want 2xx)`),
            );
            continue;
          }
          const outAbs = join(shotDir, `${job.sanitized}.shot.png`);
          const command = substituteScreenshotCommand(job.recipe.screenshotCommand, {
            url,
            out: outAbs,
            width: String(job.width),
            height: String(job.height),
          });
          if (command === null) {
            outcomes.push(
              cannot(
                job.surface,
                'screenshot-failed',
                `a substitution value contains a single quote and cannot be safely quoted (out=${outAbs})`,
              ),
            );
            continue;
          }
          const cap = await deps.capture(command, input.repoRoot, job.recipe.captureTimeoutMs);
          if (cap.timedOut) {
            outcomes.push(
              cannot(
                job.surface,
                'screenshot-failed',
                `capture timed out after ${job.recipe.captureTimeoutMs}ms`,
              ),
            );
            continue;
          }
          if (cap.code !== 0) {
            if (cap.stderrTail !== '')
              notes.push(`[${job.surface}] capture stderr: ${cap.stderrTail}`);
            outcomes.push(cannot(job.surface, 'screenshot-failed', `capture exited ${cap.code}`));
            continue;
          }
          let shotBuf: Buffer;
          try {
            shotBuf = await readFile(outAbs);
          } catch (err) {
            outcomes.push(
              cannot(
                job.surface,
                'screenshot-failed',
                `capture wrote no output file: ${errMessage(err)}`,
              ),
            );
            continue;
          }
          job.shotBuf = shotBuf;
          // ---- R6: the diff engine ----
          const diff = diffRasters(job.designBuf, shotBuf);
          if (diff.kind === 'undecodable') {
            outcomes.push(
              cannot(
                job.surface,
                diff.which === 'shot' ? 'screenshot-failed' : 'export-failed',
                `${diff.which} raster undecodable: ${diff.detail}`,
              ),
            );
            continue;
          }
          if (diff.kind === 'dimension-mismatch') {
            outcomes.push(cannot(job.surface, 'dimension-mismatch', diff.detail));
            continue;
          }
          job.diffBuf = diff.diffPng;
          const threshold = job.recipe.maxDiffRatio;
          // Strict: ratios exactly at the threshold pass (spec R6).
          if (diff.diffRatio > threshold) {
            outcomes.push({
              surface: job.surface,
              kind: 'fail',
              diffRatio: diff.diffRatio,
              threshold,
              severity: severityForRatio(diff.diffRatio, threshold),
              designPath: rel(job.sanitized, 'design'),
              shotPath: rel(job.sanitized, 'shot'),
              diffPath: rel(job.sanitized, 'diff'),
            });
          } else {
            outcomes.push({
              surface: job.surface,
              kind: 'pass',
              diffRatio: diff.diffRatio,
              threshold,
            });
          }
        }
      } finally {
        boot.kill();
      }
    }

    // ---- R6: persist artifacts, atomically per round ----
    try {
      const artifactRoot = join(input.repoRoot, '.noldor', 'cr', 'render-compare');
      const finalDir = join(artifactRoot, input.slug);
      const tmpDir = join(artifactRoot, `.tmp-${input.slug}-${process.pid}-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
      for (const job of jobs) {
        await writeFile(join(tmpDir, `${job.sanitized}.design.png`), job.designBuf);
        if (job.shotBuf !== undefined) {
          await writeFile(join(tmpDir, `${job.sanitized}.shot.png`), job.shotBuf);
        }
        if (job.diffBuf !== undefined) {
          await writeFile(join(tmpDir, `${job.sanitized}.diff.png`), job.diffBuf);
        }
      }
      await rm(finalDir, { recursive: true, force: true });
      await rename(tmpDir, finalDir);
    } catch (err) {
      // Losing evidence images costs diagnosis, not honesty — the sink rows
      // still carry the ratios; say what happened and keep going.
      notes.push(`artifact persist failed: ${errMessage(err)}`);
    }

    // ---- rows (per-surface record, deterministic order) ----
    const sorted = [...outcomes].sort((a, b) =>
      a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0,
    );
    const failFindings: Finding[] = sorted
      .filter((o): o is Extract<SurfaceOutcome, { kind: 'fail' }> => o.kind === 'fail')
      .map((o) => ({
        file: o.diffPath,
        severity: o.severity,
        message: `[${o.surface}] diffRatio ${o.diffRatio.toFixed(4)} > ${o.threshold} — design=${o.designPath} shot=${o.shotPath}`,
      }));
    const rowNotes: string[] = sorted.map((o) =>
      o.kind === 'pass'
        ? `[${o.surface}] diffRatio ${o.diffRatio.toFixed(4)} ≤ ${o.threshold}`
        : o.kind === 'fail'
          ? `[${o.surface}] fail: diffRatio ${o.diffRatio.toFixed(4)} > ${o.threshold}`
          : `[${o.surface}] ${o.reason}: ${o.detail}`,
    );

    // ---- pen-modified precedence: global, absolute (spec R7) ----
    let integrityDetail = '';
    let integrityChanged = false;
    try {
      integrityChanged = (await sha256(design.absPath)) !== hashBefore;
    } catch (err) {
      integrityChanged = true;
      integrityDetail = `design unreadable after review: ${errMessage(err)}`;
    }
    if (integrityChanged) {
      return write(
        {
          verdict: 'fail',
          reason: 'pen-modified',
          blockers: [
            {
              file: design.repoRelPath,
              severity: 'high',
              message: `pen-modified: the design changed during review — the verdict cannot be trusted${integrityDetail ? ` (${integrityDetail})` : ''}`,
            },
          ],
          suggestions: [],
          summary: 'fail: pen-modified',
          notes: [...notes, ...rowNotes],
        },
        false,
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
                  message: `${agg.reason}: ${agg.detail ?? 'render-compare could not review'}`,
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
    return mode === 'blocking'
      ? write(
          {
            verdict: 'fail',
            blockers: failFindings,
            suggestions: [],
            summary: 'rendered routes drift past their design diff thresholds',
            notes: [...notes, ...rowNotes],
          },
          false,
        )
      : write(
          {
            verdict: 'fail',
            blockers: [],
            suggestions: failFindings.map((f) => ({ ...f, severity: 'low' as const })),
            summary:
              'ADVISORY: rendered routes drift past their design diff thresholds (advisory mode)',
            notes: [...notes, ...rowNotes],
          },
          true,
        );
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch((err: unknown) => {
      console.error(`render-compare: scratch cleanup failed for ${scratchDir}: ${errMessage(err)}`);
    });
  }
}
