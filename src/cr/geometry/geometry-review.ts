// @tests: ui-design-review-lane
// Layout comparison in two steps. `extractDesignDocs` reads every requested
// surface's design through ONE pencil-MCP reader dispatch; `compareSurfaceGeometry`
// captures one surface at a URL and compares it with its pre-extracted design.
// The lane (part 5) extracts once before booting, so no dev server waits on an
// agent; `reviewSurfaceGeometry` runs the two back to back for the hand-run CLI.
// Both paths use the same reason codes, so a hand run and a lane row agree.

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import { runCapture, type CaptureResult } from '../../core/run-capture.js';
import type { Slug } from '../../core/slug.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import type { LaneReasonCode } from '../findings-schema.js';
import type { LaneAnswer } from '../lane-answer.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  selectVerifiedPage,
  type GeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { substituteScreenshotCommand } from '../lanes/render-compare-core.js';
import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  GEOMETRY_FAMILIES,
  type FamilyRecord,
  type GeometryComparison,
} from './geometry-compare-core.js';
import { parseGeometryDoc, type GeometryDoc } from './geometry-doc.js';

/** Byte ceiling before a producer's document is read into memory. */
const MAX_DOC_BYTES = 32 * 1024 * 1024;
/** Viewports may differ by less than a pixel (rounding), never more (spec D4). */
const VIEWPORT_EPSILON = 1;
/** The recipe schema's own `captureTimeoutMs` default. */
const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;

/** A stage that could not go on, with its reason code. */
export type Declined = { kind: 'declined'; reason: LaneReasonCode; detail: string };

export interface ExtractDesignInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  /** Every surface to read, with its `FINAL:<surface>: <name>` selector when it has one. */
  surfaces: readonly { surface: string; pageSelector?: string }[];
  /** Directory the design documents are written into. */
  outDir: string;
  repoRoot: string;
  /** Slug the reader child's answer file is filed under: the round's, or `GEOMETRY_ADHOC_SLUG`. */
  slug: Slug;
  dispatchTimeoutMs?: number;
}

/** One surface's design: the document, or why it could not be read. */
export type DesignExtraction =
  | { kind: 'extracted'; design: GeometryDoc; excluded: string[] }
  | Declined;

export interface CompareSurfaceInput {
  surface: string;
  /** The surface's design, from {@link extractDesignDocs}. */
  design: GeometryDoc;
  /** Where the implementation renders — already booted by the caller. */
  url: string;
  geometryCommand: string;
  /** Path the capture command must write the implementation document to. */
  implPath: string;
  repoRoot: string;
  captureTimeoutMs?: number;
  /** Per-family overrides; families left out keep {@link DEFAULT_TOLERANCE}. */
  tolerance?: Partial<FamilyRecord<number>>;
  /** Per-family overrides; families left out keep {@link DEFAULT_BUDGET}. */
  budget?: Partial<FamilyRecord<number>>;
}

export type SurfaceComparison =
  | { kind: 'compared'; comparison: GeometryComparison; design: GeometryDoc; impl: GeometryDoc }
  | Declined;

/** Both steps for one surface, as the hand-run CLI needs them. */
export interface ReviewSurfaceInput extends Omit<CompareSurfaceInput, 'design'> {
  penPath: string;
  pageSelector?: string;
  outDir: string;
  slug: Slug;
  dispatchTimeoutMs?: number;
}

export type ReviewSurfaceResult =
  | (Extract<SurfaceComparison, { kind: 'compared' }> & {
      /** Design nodes pen reported clipped, which the reader therefore dropped. */
      excluded: string[];
    })
  | Declined;

interface ReviewDeps {
  capture: typeof runCapture;
}
let deps: ReviewDeps = { capture: runCapture };

/** Test seam — production code never calls this. Passing `undefined` restores the default. */
export function setGeometryReviewDeps(partial: { capture?: typeof runCapture }): void {
  deps = { capture: partial.capture ?? runCapture };
}

/** Sub-pixel tolerance on the viewport; anything larger makes every edge drift. */
export const viewportsAgree = (
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean =>
  Math.abs(a.width - b.width) <= VIEWPORT_EPSILON &&
  Math.abs(a.height - b.height) <= VIEWPORT_EPSILON;

/**
 * Complete a partial per-family record. The recipe's `geometryTolerance` and
 * `geometryBudget` carry no zod defaults, so a recipe naming only `edgesX` must
 * keep the defaults for the other three families rather than compare them at
 * `undefined`.
 */
export function withFamilyDefaults(
  over: Partial<FamilyRecord<number>> | undefined,
  defaults: FamilyRecord<number>,
): FamilyRecord<number> {
  const out = { ...defaults };
  for (const family of GEOMETRY_FAMILIES) {
    const v = over?.[family];
    if (v !== undefined) out[family] = v;
  }
  return out;
}

const declined = (reason: LaneReasonCode, detail: string): Declined => ({
  kind: 'declined',
  reason,
  detail,
});

/**
 * Read every requested surface's design with ONE reader dispatch. A failed or
 * unusable dispatch declines every surface; otherwise each surface is judged on
 * its own answer row, page selection and document.
 */
export async function extractDesignDocs(
  input: ExtractDesignInput,
): Promise<Map<string, DesignExtraction>> {
  const out = new Map<string, DesignExtraction>();
  if (input.surfaces.length === 0) return out;
  const pathOf = (surface: string): string =>
    join(input.outDir, `${sanitizeSurfaceName(surface)}.design.json`);
  // A document left from an earlier run (possibly another page) must never pass
  // as this dispatch's output: a child that answers but writes nothing declines.
  for (const s of input.surfaces) await rm(pathOf(s.surface), { force: true });
  const declineAll = (detail: string): Map<string, DesignExtraction> => {
    for (const s of input.surfaces) out.set(s.surface, declined('geometry-extract-failed', detail));
    return out;
  };
  let answer: LaneAnswer<GeometryExtractReport>;
  try {
    answer = await dispatchGeometryExtract(
      {
        penPath: input.penPath,
        requests: input.surfaces.map((s) => ({
          surface: s.surface,
          ...(s.pageSelector !== undefined ? { pageSelector: s.pageSelector } : {}),
          outPath: pathOf(s.surface),
        })),
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      { repoRoot: input.repoRoot, slug: input.slug, kind: 'code' },
    );
  } catch (err) {
    return declineAll(
      err instanceof GeometryExtractError ? err.message : `dispatch failed: ${errMessage(err)}`,
    );
  }
  if (!answer.ok) {
    // Without a valid answer there is no trustworthy page enumeration, so a
    // document on disk could describe the WRONG page.
    return declineAll(
      `the reader gave no usable answer, so page selection is unverified — ${answer.detail}`,
    );
  }
  for (const s of input.surfaces) {
    const rows = answer.answer.surfaces.filter((r) => r.surface === s.surface);
    if (rows.length !== 1) {
      const detail = `the reader's answer carries ${rows.length} rows for surface '${s.surface}'`;
      out.set(s.surface, declined('geometry-extract-failed', detail));
      continue;
    }
    // The child ENUMERATES, this side SELECTS.
    const selection = await selectVerifiedPage(input.penPath, s.surface, rows[0], s.pageSelector);
    if (!selection.ok) {
      out.set(s.surface, declined(selection.reason, selection.detail));
      continue;
    }
    const doc = await readDoc(pathOf(s.surface), 'design', s.surface);
    out.set(
      s.surface,
      doc.ok
        ? { kind: 'extracted', design: doc.doc, excluded: rows[0].excluded }
        : declined(doc.reason, doc.detail),
    );
  }
  return out;
}

/** Capture one surface at `url` and compare it with its pre-extracted design. */
export async function compareSurfaceGeometry(
  input: CompareSurfaceInput,
): Promise<SurfaceComparison> {
  const { design } = input;
  // The design page's own size IS the capture viewport, so both sides measure
  // the same box rather than agreeing by luck.
  const command = substituteScreenshotCommand(input.geometryCommand, {
    url: input.url,
    out: input.implPath,
    width: String(design.viewport.width),
    height: String(design.viewport.height),
  });
  if (command === null) {
    return declined(
      'geometry-capture-failed',
      `a substitution value contains a single quote and cannot be safely quoted (out=${input.implPath})`,
    );
  }
  // Same staleness rule as the design side: an earlier capture must not pass as this one.
  await rm(input.implPath, { force: true });
  const timeoutMs = input.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  let cap: CaptureResult;
  try {
    // The placeholder contract has no {surface}; the script reads it from here.
    cap = await deps.capture(command, input.repoRoot, timeoutMs, {
      NOLDOR_GEOMETRY_SURFACE: input.surface,
    });
  } catch (err) {
    return declined('geometry-capture-failed', `capture threw: ${errMessage(err)}`);
  }
  if (cap.timedOut || cap.code !== 0) {
    const what = cap.timedOut
      ? `capture timed out after ${timeoutMs}ms`
      : `capture exited ${cap.code}`;
    return declined(
      'geometry-capture-failed',
      cap.stderrTail !== '' ? `${what} — ${cap.stderrTail}` : what,
    );
  }
  const impl = await readDoc(input.implPath, 'impl', input.surface);
  if (!impl.ok) return declined(impl.reason, impl.detail);
  const dv = design.viewport;
  const iv = impl.doc.viewport;
  if (!viewportsAgree(dv, iv)) {
    return declined(
      'viewport-mismatch',
      `design viewport ${dv.width}x${dv.height} vs capture ${iv.width}x${iv.height}`,
    );
  }
  return {
    kind: 'compared',
    comparison: compareGeometry(
      design,
      impl.doc,
      withFamilyDefaults(input.tolerance, DEFAULT_TOLERANCE),
      withFamilyDefaults(input.budget, DEFAULT_BUDGET),
    ),
    design,
    impl: impl.doc,
  };
}

/** Extract then compare one surface — the hand-run path. It boots nothing. */
export async function reviewSurfaceGeometry(
  input: ReviewSurfaceInput,
): Promise<ReviewSurfaceResult> {
  const { penPath, pageSelector, outDir, slug, dispatchTimeoutMs, ...compare } = input;
  const extractions = await extractDesignDocs({
    penPath,
    surfaces: [{ surface: input.surface, ...(pageSelector !== undefined ? { pageSelector } : {}) }],
    outDir,
    repoRoot: input.repoRoot,
    slug,
    ...(dispatchTimeoutMs !== undefined ? { dispatchTimeoutMs } : {}),
  });
  const extracted =
    extractions.get(input.surface) ?? declined('geometry-extract-failed', 'no extraction result');
  if (extracted.kind === 'declined') return extracted;
  const result = await compareSurfaceGeometry({ ...compare, design: extracted.design });
  return result.kind === 'declined' ? result : { ...result, excluded: extracted.excluded };
}

/** Read one side's document, mapping every failure onto its own reason code. */
async function readDoc(
  path: string,
  side: 'design' | 'impl',
  surface: string,
): Promise<{ ok: true; doc: GeometryDoc } | { ok: false; reason: LaneReasonCode; detail: string }> {
  const missing: LaneReasonCode =
    side === 'design' ? 'geometry-extract-failed' : 'geometry-capture-failed';
  let text: string;
  try {
    // Size-checked before the read: a runaway producer must not get gigabytes
    // into memory just to be rejected by the parser.
    const size = (await stat(path)).size;
    if (size > MAX_DOC_BYTES) {
      return {
        ok: false,
        reason: missing,
        detail: `${side} document is ${size} bytes (cap ${MAX_DOC_BYTES}) — refusing to read`,
      };
    }
    text = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: missing, detail: `${side} document missing: ${errMessage(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: 'geometry-unparseable',
      detail: `${side} document is not JSON: ${errMessage(err)}`,
    };
  }
  const parsed = parseGeometryDoc(raw, side, surface);
  if (!parsed.ok) return { ok: false, reason: 'geometry-unparseable', detail: parsed.detail };
  if (parsed.doc.nodes.length === 0) {
    return { ok: false, reason: 'geometry-empty', detail: `${side} document reports zero nodes` };
  }
  return { ok: true, doc: parsed.doc };
}
