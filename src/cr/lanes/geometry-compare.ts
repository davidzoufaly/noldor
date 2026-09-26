// @tests: ui-design-review-lane
// The `geometry-compare` lane (spec D5–D7): compare LAYOUT, not paint, against a
// booted app. A shell over the shared round, boot, review and aggregate helpers;
// every terminating path writes exactly one sink.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  loadConsumerConfig,
  type UiBootRecipe,
  type VerifySurface,
} from '../../core/consumer-config.js';
import { errMessage } from '../../core/err-message.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import { GEOMETRY_FAMILIES } from '../geometry/geometry-compare-core.js';
import {
  buildSurfaceReport,
  familySeverity,
  nodeLabel,
  type SurfaceReport,
  type UnmatchedValue,
} from '../geometry/geometry-report.js';
import type { GeometryDoc } from '../geometry/geometry-doc.js';
import { compareSurfaceGeometry, extractDesignDocs } from '../geometry/geometry-review.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { forEachBootedSurface, type BootProbeDeps } from './boot-probe.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
import { aggregateOutcomes } from './render-compare-core.js';
import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';

const LANE = 'geometry-compare' as const;

interface SurfaceJob {
  surface: string;
  sanitized: string;
  recipe: UiBootRecipe & { geometryCommand: string };
}

/** Per-surface outcome; a compared surface carries its evidence report. */
type Outcome =
  | { surface: string; kind: 'pass' | 'fail'; report: SurfaceReport }
  | { surface: string; kind: 'cannot-review'; reason: LaneReasonCode; detail: string };

const cannot = (surface: string, reason: LaneReasonCode, detail: string): Outcome => ({
  surface,
  kind: 'cannot-review',
  reason,
  detail,
});

/** Jobs and declines; a surface without `geometryCommand` is a full row, so partial coverage never passes. */
function planSurfaceJobs(
  surfaces: readonly string[],
  recipes: ReadonlyMap<string, UiBootRecipe>,
): { jobs: SurfaceJob[]; declined: Outcome[] } {
  const jobs: SurfaceJob[] = [];
  const declined: Outcome[] = [];
  for (const surface of surfaces) {
    const recipe = recipes.get(surface);
    const geometryCommand = recipe?.geometryCommand;
    if (recipe === undefined || geometryCommand === undefined) {
      const why =
        recipe === undefined
          ? 'has no consumer.uiBoot recipe'
          : 'has a uiBoot recipe but no geometryCommand';
      declined.push(cannot(surface, 'no-geometry-recipe', `surface '${surface}' ${why}`));
      continue;
    }
    jobs.push({
      surface,
      sanitized: sanitizeSurfaceName(surface),
      recipe: { ...recipe, geometryCommand },
    });
  }
  return { jobs, declined };
}

const bySurface = (a: Outcome, b: Outcome): number =>
  a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0;

/** One `notes` row per surface, in surface order — the record of what was computed. */
function roundRows(outcomes: readonly Outcome[]): string[] {
  return [...outcomes].sort(bySurface).map((o) => {
    if (o.kind === 'cannot-review') return `[${o.surface}] ${o.reason}: ${o.detail}`;
    const fams = GEOMETRY_FAMILIES.map(
      (f) => `${f} ${o.report.families[f].unmatched}/${o.report.families[f].budget}`,
    );
    return `[${o.surface}] ${o.kind}: ${fams.join(', ')}`;
  });
}

const fmt = (v: number): string => String(Number(v.toFixed(2)));
const sideList = (entries: readonly UnmatchedValue[]): string =>
  entries
    .map((e) => `${fmt(e.value)} (${e.nodes.map(nodeLabel).join(', ') || 'no node'})`)
    .join(', ');

/** One finding per failing family, naming the values, their nodes and the evidence file. */
function roundFindings(slug: string, outcomes: readonly Outcome[]): Finding[] {
  return [...outcomes].sort(bySurface).flatMap((o) => {
    if (o.kind !== 'fail') return [];
    const { report } = o;
    const failing = GEOMETRY_FAMILIES.filter(
      (f) => report.families[f].unmatched > report.families[f].budget,
    );
    return failing.map((f) => {
      const fam = report.families[f];
      const on = (side: 'design' | 'impl') =>
        report.unmatched.filter((u) => u.family === f && u.side === side);
      const sides = [
        on('design').length > 0 ? `design-only [${sideList(on('design'))}]` : '',
        on('impl').length > 0 ? `impl-only [${sideList(on('impl'))}]` : '',
      ].filter((s) => s !== '');
      return {
        file: `.noldor/cr/${LANE}/${slug}/${sanitizeSurfaceName(o.surface)}.report.json`,
        severity: familySeverity(fam.unmatched),
        message: `[${o.surface}] ${f}: ${fam.unmatched} unmatched > budget ${fam.budget} — ${sides.join(' ')}`,
      };
    });
  });
}

let deps: BootProbeDeps = {
  boot: bootServer,
  fetchImpl: fetch,
  resolvePort,
  routeProbeBudgetMs: 15_000,
};

/** Test seam — production code never calls this. */
export function setGeometryCompareDeps(partial: Partial<BootProbeDeps>): void {
  deps = { ...deps, ...partial };
}

export async function runGeometryCompare(input: LaneInput): Promise<LaneResult> {
  const opened = await openDesignReviewRound(
    input,
    LANE,
    'geometryCompareMode',
    'noldor-geometry-compare',
  );
  if (opened.kind === 'done') return opened.result;
  const { mode } = opened;
  const { write, writeTerminal, design, notes } = opened.ctx;
  const { dir: scratchDir, penPath: scratchPen, designChanged } = opened.ctx.scratch;
  /** `pen-modified` precedence is absolute (spec D5): checked before every terminal. */
  const terminal = async (
    reason: LaneReasonCode,
    detail: string,
    rows: string[] = [],
  ): Promise<LaneResult> => {
    const integrity = await designChanged();
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail || detail, [
        ...notes,
        ...rows,
      ]);
    }
    return writeTerminal({ verdict: 'cannot-review', reason, detail }, [...notes, ...rows]);
  };

  try {
    // Maps, not raw records: Object.entries copies OWN keys only, so a surface
    // named like an inherited property cannot alias a prototype member.
    let recipes: Map<string, UiBootRecipe>;
    let declaredSurfaces: string[];
    let verifyCommands: Map<string, VerifySurface>;
    try {
      const consumer = loadConsumerConfig(input.repoRoot);
      recipes = new Map(Object.entries(consumer.uiBoot ?? {}));
      declaredSurfaces = Object.keys(consumer.uiSurfaces ?? {});
      verifyCommands = new Map(Object.entries(consumer.verifyCommands));
    } catch (err) {
      return await terminal('config-unreadable', errMessage(err));
    }

    // Zero AFFECTED surfaces must not aggregate to a "0 surfaces" pass (a
    // blocking-mode bypass); same whole-design fallback render-compare uses.
    let surfaces = design.surfaces;
    if (surfaces.length === 0) {
      surfaces = [...new Set([...declaredSurfaces, ...recipes.keys()])].sort();
      if (surfaces.length === 0) {
        return await terminal(
          'no-geometry-recipe',
          'zero affected surfaces resolved and no consumer.uiBoot recipe to fall back to',
        );
      }
      notes.push(
        `zero affected surfaces resolved — reviewing every declared surface: ${surfaces.join(', ')}`,
      );
    }

    const { jobs, declined } = planSurfaceJobs(surfaces, recipes);
    const outcomes: Outcome[] = [...declined];
    const artifacts: RoundArtifact[] = [];
    const workDir = join(scratchDir, 'geometry'); // removed with the scratch dir
    await mkdir(workDir, { recursive: true });

    // ONE reader dispatch for every surface, BEFORE any boot: no dev server waits
    // on an agent, and a surface whose design cannot be read is never booted.
    const extractions = await extractDesignDocs({
      penPath: scratchPen,
      surfaces: jobs.map((j) => ({
        surface: j.surface,
        ...(j.recipe.page !== undefined ? { pageSelector: j.recipe.page } : {}),
      })),
      outDir: workDir,
      repoRoot: input.repoRoot,
      slug: input.slug,
      ...(input.dispatchTimeoutMs !== undefined
        ? { dispatchTimeoutMs: input.dispatchTimeoutMs }
        : {}),
    });
    const ready: Array<SurfaceJob & { design: GeometryDoc; excluded: string[] }> = [];
    for (const job of jobs) {
      const e = extractions.get(job.surface);
      if (e?.kind !== 'extracted') {
        outcomes.push(
          cannot(
            job.surface,
            e?.reason ?? 'geometry-extract-failed',
            e?.detail ?? 'no extraction result',
          ),
        );
        continue;
      }
      ready.push({ ...job, design: e.design, excluded: e.excluded });
    }

    await forEachBootedSurface({
      jobs: ready,
      verifyCommands,
      repoRoot: input.repoRoot,
      deps,
      unreachable: (job, reason, detail) => {
        outcomes.push(cannot(job.surface, reason, detail));
      },
      reached: async (job, url) => {
        const result = await compareSurfaceGeometry({
          surface: job.surface,
          design: job.design,
          url,
          geometryCommand: job.recipe.geometryCommand,
          implPath: join(workDir, `${job.sanitized}.impl.json`),
          repoRoot: input.repoRoot,
          captureTimeoutMs: job.recipe.captureTimeoutMs,
          tolerance: job.recipe.geometryTolerance,
          budget: job.recipe.geometryBudget,
        });
        if (result.kind === 'declined') {
          outcomes.push(cannot(job.surface, result.reason, result.detail));
          return;
        }
        // Noted here, not at extraction: a surface that never got compared excluded nothing from a verdict.
        if (job.excluded.length > 0) {
          notes.push(`[${job.surface}] clipped design nodes excluded: ${job.excluded.join(', ')}`);
        }
        const report = buildSurfaceReport(
          job.surface,
          result.design,
          result.impl,
          result.comparison,
        );
        artifacts.push(
          { name: `${job.sanitized}.design.json`, body: JSON.stringify(result.design, null, 1) },
          { name: `${job.sanitized}.impl.json`, body: JSON.stringify(result.impl, null, 1) },
          { name: `${job.sanitized}.report.json`, body: JSON.stringify(report, null, 1) },
        );
        outcomes.push({ surface: job.surface, kind: result.comparison.verdict, report });
      },
    });

    const rows = roundRows(outcomes);
    // A round with no documents keeps the prior evidence (empty list = no-op).
    const swap = await swapRoundArtifacts(
      join(input.repoRoot, '.noldor', 'cr', LANE),
      input.slug,
      artifacts,
    );
    const integrity = await designChanged();
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail, [...notes, ...rows]);
    }
    if (!swap.ok)
      return await terminal('persist-failed', `evidence unavailable: ${swap.detail}`, rows);

    const all = [...notes, ...rows];
    const agg = aggregateOutcomes(outcomes);
    if (agg.verdict === 'pass') {
      const n = outcomes.length;
      const summary = `every family within budget (${n} surface${n === 1 ? '' : 's'})`;
      return write({ verdict: 'pass', blockers: [], suggestions: [], summary, notes: all }, true);
    }
    if (agg.verdict === 'cannot-review') {
      return writeTerminal(
        { verdict: 'cannot-review', reason: agg.reason, detail: agg.detail },
        all,
      );
    }
    const findings = roundFindings(input.slug, outcomes);
    return writeFailByMode(write, mode, findings, 'implemented layout drifts from the design', all);
  } catch (err) {
    // A round never terminates without its sink; pen-modified still wins.
    return await terminal('dispatch-failed', `unexpected pipeline failure: ${errMessage(err)}`);
  } finally {
    await cleanupPenScratch(scratchDir, LANE);
  }
}
