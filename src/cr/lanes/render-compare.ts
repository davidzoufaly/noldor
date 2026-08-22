// @tests: ui-design-review-lane
// The `render-compare` lane: boot the consumer's app from its `uiBoot` recipe,
// capture what each surface's real route renders, and pixel-diff it against the
// session's committed `.pen` design — a deterministic comparison, not a second
// model-judgment pass (the one dispatched agent is the design EXPORTER; its
// words never decide a verdict, its output files do). Every terminating path
// writes exactly one sink (Q-0100), and a per-surface failure never aborts the
// round — outcomes aggregate by `fail` > `cannot-review` > `pass` (spec R7).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PNG } from 'pngjs';

import { errMessage } from '../../core/err-message.js';
import { loadConsumerConfig } from '../../core/consumer-config.js';
import type { UiBootRecipe } from '../../core/consumer-config.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
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
  parseRenderExportReport,
} from './render-export-dispatch.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';

const LANE = 'render-compare' as const;

/** Bounds the route probe — same cap the health check's probe fetches use. */
const ROUTE_PROBE_TIMEOUT_MS = 2000;
const STDERR_TAIL_CAP = 2000;
/**
 * Aggregate wall-clock ceiling across the whole group loop — the same posture
 * as smoke's total cap. Everything the loop does consumes it: boots (whose
 * `readyTimeoutMs` the schema does not bound), route probes, and captures —
 * the deadline is fixed once, so a slow early group shrinks what later groups
 * may spend booting.
 *
 * noldor:cut — enforcement is deliberately at BOOT ADMISSION only (once per
 * group): every step inside a group is already individually bounded (route
 * probe ≤ 15s, capture ≤ `captureTimeoutMs` ≤ 120s, both schema/constant
 * enforced), and the surface count is the consumer's declared config, so the
 * only unbounded quantity the budget must cap is boot time. Checking mid-group
 * would abandon surfaces whose own caps were about to hold anyway.
 */
const TOTAL_ROUND_BUDGET_MS = 300_000;

/**
 * Ratio formatting for findings and notes: six decimals so a boundary failure
 * like 0.250001 > 0.25 stays visibly consistent with the strict comparison —
 * four would render it as an apparent tie.
 */
const fmtRatio = (r: number): string => r.toFixed(6);

/** What a `screenshotCommand` run produced: exit code, cap status, stderr tail. */
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
    // Byte tail, decoded ONCE at the end: per-chunk decoding plus a UTF-16
    // slice can still split characters at the tail seam. A byte-boundary
    // partial at the very head of the tail decodes to one replacement char —
    // acceptable for diagnostic text.
    let stderrTail = Buffer.alloc(0);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-STDERR_TAIL_CAP);
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
    // Group-kill on EVERY exit path, not only timeout: a capture command that
    // exits while a spawned descendant (a browser, a daemonized helper) lives
    // on would otherwise leak it past the round.
    const reapGroup = (): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* group already gone */
        }
      }
    };
    child.on('error', (err) => {
      clearTimeout(timer);
      reapGroup();
      resolve({ code: 1, timedOut: false, stderrTail: errMessage(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      reapGroup();
      resolve({ code: code ?? 1, timedOut, stderrTail: stderrTail.toString('utf8').trim() });
    });
  });
}

interface RenderCompareDeps {
  boot: typeof bootServer;
  capture: typeof runCapture;
  fetchImpl: typeof fetch;
  resolvePort: typeof resolvePort;
  /** Total retry budget for the route probe (cold dev routes compile on demand). */
  routeProbeBudgetMs: number;
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

/** A surface's per-round working state, keyed off its recipe + design raster. */
interface SurfaceJob {
  surface: string;
  sanitized: string;
  recipe: UiBootRecipe;
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
    const withRecipe = surfaces.filter((s) => recipes.has(s));
    for (const s of surfaces) {
      if (!recipes.has(s)) {
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
        ...(recipes.get(surface)?.page !== undefined
          ? { pageSelector: recipes.get(surface)?.page }
          : {}),
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
      const report = exportFailure === null ? parseRenderExportReport(raw ?? '') : null;
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
            recipe: recipes.get(r.surface) as UiBootRecipe,
            designBuf: buf,
            designPng: decoded.png,
          });
        }
      }
    }

    // ---- R4: boot per verifyCommand group, probe + capture per surface ----
    const groups = new Map<string, SurfaceJob[]>();
    for (const job of jobs) {
      groups.set(job.recipe.verifyCommand, [...(groups.get(job.recipe.verifyCommand) ?? []), job]);
    }
    const roundDeadline = Date.now() + TOTAL_ROUND_BUDGET_MS;
    for (const [cmdName, groupJobs] of groups) {
      const entry = verifyCommands.get(cmdName);
      // noldor:cut — unreachable under a schema-valid config (the superRefine
      // guarantees the reference resolves to a server entry); kept because the
      // Record index type is honest about `undefined` and a boot against a
      // missing entry must degrade to rows, never throw.
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
      // An injected/edge boot rejection must land as this group's boot-failed
      // rows, never escape the round without per-surface outcomes (AC11).
      let boot: Awaited<ReturnType<typeof deps.boot>>;
      try {
        const remaining = roundDeadline - Date.now();
        if (remaining <= 0) {
          for (const job of groupJobs) {
            outcomes.push(
              cannot(
                job.surface,
                'boot-failed',
                `round budget (${TOTAL_ROUND_BUDGET_MS}ms) exhausted before this group booted`,
              ),
            );
          }
          continue;
        }
        boot = await deps.boot(entry, port, input.repoRoot, deps.fetchImpl, remaining);
      } catch (err) {
        for (const job of groupJobs) {
          outcomes.push(cannot(job.surface, 'boot-failed', `boot threw: ${errMessage(err)}`));
        }
        continue;
      }
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
          // status must be 2xx. RETRIED under a small budget because dev
          // servers compile routes on demand — the first hit on a cold route
          // routinely outlives one 2s fetch even after the health path
          // answered. Any HTTP status is a real answer and ends the loop;
          // only no-response shapes (timeout, refused) retry.
          let status: number | null = null;
          let probeErr = '';
          const probeDeadline = Date.now() + deps.routeProbeBudgetMs;
          for (;;) {
            try {
              const res = await deps.fetchImpl(url, {
                signal: AbortSignal.timeout(ROUTE_PROBE_TIMEOUT_MS),
                redirect: 'follow',
              });
              status = res.status;
              // Release the connection: an unconsumed body keeps the socket busy
              // until timeout/GC, which the capture right behind it competes with.
              await res.body?.cancel().catch(() => {
                /* already consumed or closed */
              });
              break;
            } catch (err) {
              probeErr = errMessage(err);
              if (Date.now() >= probeDeadline) break;
              await new Promise((r) => setTimeout(r, 250));
            }
          }
          if (status === null) {
            outcomes.push(
              cannot(
                job.surface,
                'route-unreachable',
                `GET ${url} got no response within ${deps.routeProbeBudgetMs}ms: ${probeErr}`,
              ),
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
            width: String(job.designPng.width),
            height: String(job.designPng.height),
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
          let cap: CaptureResult;
          try {
            cap = await deps.capture(command, input.repoRoot, job.recipe.captureTimeoutMs);
          } catch (err) {
            outcomes.push(
              cannot(job.surface, 'screenshot-failed', `capture threw: ${errMessage(err)}`),
            );
            continue;
          }
          // The stderr tail rides `notes` for EVERY failed-capture class (spec
          // R4) — a timeout or an undecodable output needs the diagnosis at
          // least as much as a non-zero exit does.
          const noteStderr = (): void => {
            if (cap.stderrTail !== '') {
              notes.push(`[${job.surface}] capture stderr: ${cap.stderrTail}`);
            }
          };
          if (cap.timedOut) {
            noteStderr();
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
            noteStderr();
            outcomes.push(cannot(job.surface, 'screenshot-failed', `capture exited ${cap.code}`));
            continue;
          }
          let shotBuf: Buffer;
          try {
            const size = (await stat(outAbs)).size;
            if (size > MAX_RASTER_BYTES) {
              noteStderr();
              outcomes.push(
                cannot(
                  job.surface,
                  'screenshot-failed',
                  `capture output is ${size} bytes (cap ${MAX_RASTER_BYTES}) — refusing to read`,
                ),
              );
              continue;
            }
            shotBuf = await readFile(outAbs);
          } catch (err) {
            noteStderr();
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
          // ---- R6: the diff engine (design already decoded at export time) ----
          const diff = diffDecoded(job.designPng, shotBuf);
          if (diff.kind === 'undecodable') {
            noteStderr();
            outcomes.push(
              cannot(job.surface, 'screenshot-failed', `shot raster undecodable: ${diff.detail}`),
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
        // Fire-and-forget SIGKILL is sufficient here: every group boots on its
        // own fresh ephemeral port (resolvePort binds :0 per group), so a
        // dying predecessor cannot contend with the next boot, and bootServer's
        // pre-boot occupancy check is the backstop for anything external.
        boot.kill();
      }
    }

    // ---- R6: persist artifacts, atomically per round ----
    // Skipped entirely when the round produced NO rasters (exporter dispatch
    // failed, every surface no-boot-recipe/export-failed): swapping in an
    // empty directory would destroy the prior round's evidence to record
    // nothing. The prior set stays put; this round's sink references no image.
    // noldor:cut — deliberate arbitration between two review rounds that asked
    // for opposite behaviors here (round 8: never delete prior evidence on a
    // no-raster round; round 9: rebuild unconditionally). Evidence-preserving
    // wins: images are only ever interpreted through the sink that references
    // them, and a zero-raster round's sink references none.
    const artifactRoot = join(input.repoRoot, '.noldor', 'cr', 'render-compare');
    const finalDir = join(artifactRoot, input.slug);
    const unique = `${input.slug}-${process.pid}-${Date.now()}`;
    const tmpDir = join(artifactRoot, `.tmp-${unique}`);
    const trashDir = join(artifactRoot, `.trash-${unique}`);
    let persistFailure: string | null = null;
    const persistJobs = async (): Promise<void> => {
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
      // Swap without a delete-then-rename window: the prior round moves ASIDE
      // first, so a failure between the two renames still leaves one complete
      // evidence set on disk (restored below on failure, deleted on success).
      // noldor:cut — spec R6's contract is "a crashed round never leaves a
      // MIXED set", which this satisfies; a hard crash exactly between the two
      // renames can leave finalDir absent-with-trash-intact, and closing that
      // window would need an atomic directory exchange Node does not expose.
      // Absent-but-recoverable beats mixed-and-wrong.
      try {
        await rename(finalDir, trashDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      try {
        await rename(tmpDir, finalDir);
      } catch (err) {
        await rename(trashDir, finalDir).catch(() => {
          /* no prior round to restore */
        });
        throw err;
      }
      await rm(trashDir, { recursive: true, force: true }).catch(() => {
        /* stale trash is disk cost only; the fresh set is already in place */
      });
    };
    if (jobs.length > 0) {
      try {
        await persistJobs();
      } catch (err) {
        // The round downgrades to cannot-review below. Only the per-round temp
        // and trash dirs are removed (unique names would pile up across failed
        // rounds) — NEVER finalDir: whatever it holds is a complete coherent set
        // (the untouched prior round, or the one the inner catch just restored),
        // and deleting a restore we deliberately performed would be a
        // contradiction. This round's sink references no image either way.
        persistFailure = errMessage(err);
        notes.push(`artifact persist failed: ${persistFailure}`);
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {
          /* best-effort */
        });
        // trashDir may be the ONLY surviving evidence set when both renames
        // failed (restore included) — remove it only when finalDir still holds
        // a set, otherwise leave it as the recoverable copy.
        if (existsSync(finalDir)) {
          await rm(trashDir, { recursive: true, force: true }).catch(() => {
            /* best-effort */
          });
        }
      }
    }

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
