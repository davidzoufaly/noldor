// @tests: ui-design-review-lane
// Pure half of the `render-compare` lane: page selection, shell-safe template
// substitution, artifact-name sanitization, the pixel-diff engine, and the
// multi-surface aggregation. No IO and no process state, so every verdict rule
// the spec pins (R2 selection shapes, R6 constants, R7 precedence) is testable
// without booting an app or opening a `.pen`.

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

import { SCREENSHOT_PLACEHOLDERS } from '../../core/ui-boot.js';
import type { ScreenshotPlaceholder } from '../../core/ui-boot.js';
import type { LaneReasonCode, Severity } from '../findings-schema.js';

/**
 * Result-affecting pixelmatch options — pinned constants, not config (spec R6).
 * `threshold` is the per-pixel color tolerance (antialiasing-friendly);
 * `includeAA: false` keeps anti-aliased pixels out of the count. Fixture
 * expectations in the tests pin both, so a bump here fails loudly.
 */
export const PIXELMATCH_THRESHOLD = 0.2;
export const PIXELMATCH_INCLUDE_AA = false;

/**
 * Every placeholder substitutes as a single-quoted shell token (spec R2): the
 * value is wrapped in `'…'`, and since the route charset forbids `'` and the
 * lane generates `{out}` itself, no escape sequence is ever needed — a value
 * that would need one fails the round instead of being spliced in. `null` =
 * unquotable (the caller maps it to `screenshot-failed`).
 */
export function substituteScreenshotCommand(
  template: string,
  values: Record<ScreenshotPlaceholder, string>,
): string | null {
  let out = template;
  for (const p of SCREENSHOT_PLACEHOLDERS) {
    const v = values[p];
    if (v.includes("'")) return null;
    out = out.replaceAll(`{${p}}`, `'${v}'`);
  }
  return out;
}

/** One `FINAL:<surface>: <name>` page name, already stripped to its `<name>` segment. */
export type PageName = string;

export type PageSelection = { ok: true; page: PageName } | { ok: false; detail: string };

/**
 * Which `FINAL:` page the route's screenshot diffs against (spec R2/D8).
 * Matching is exact string equality on the trimmed `<name>` segment,
 * case-sensitive. Every unresolvable shape — zero pages, several without a
 * selector, a dangling selector, duplicate names — is `page-ambiguous`, with
 * the message naming the candidates found (possibly none).
 */
export function selectFinalPage(
  surface: string,
  pages: readonly PageName[],
  selector?: string,
): PageSelection {
  const trimmed = pages.map((p) => p.trim());
  const candidates = trimmed.length > 0 ? `candidates: ${trimmed.join(', ')}` : 'candidates: none';
  if (trimmed.length === 0) {
    return { ok: false, detail: `surface '${surface}' has no FINAL: page (${candidates})` };
  }
  const seen = new Set<string>();
  for (const p of trimmed) {
    if (seen.has(p)) {
      return {
        ok: false,
        detail: `surface '${surface}' has duplicate FINAL: page name '${p}' — nothing to disambiguate by (${candidates})`,
      };
    }
    seen.add(p);
  }
  if (selector !== undefined) {
    const want = selector.trim();
    if (!seen.has(want)) {
      return {
        ok: false,
        detail: `surface '${surface}' recipe page '${want}' matches no FINAL: page (${candidates})`,
      };
    }
    return { ok: true, page: want };
  }
  if (trimmed.length === 1) return { ok: true, page: trimmed[0] };
  return {
    ok: false,
    detail: `surface '${surface}' has ${trimmed.length} FINAL: pages and the recipe declares no page selector (${candidates})`,
  };
}

/** Ratio-derived, fully deterministic severity (spec R6): high past 2× the threshold. */
export function severityForRatio(diffRatio: number, maxDiffRatio: number): Severity {
  return diffRatio > 2 * maxDiffRatio ? 'high' : 'med';
}

export type DiffOutcome =
  | { kind: 'diff'; diffRatio: number; width: number; height: number; diffPng: Buffer }
  | { kind: 'dimension-mismatch'; detail: string }
  | { kind: 'undecodable'; which: 'design' | 'shot'; detail: string };

/** Decode helper: pngjs strict decode, positive dimensions required. */
export function decodePng(buf: Buffer): { png: PNG; detail: '' } | { png: null; detail: string } {
  try {
    const png = PNG.sync.read(buf);
    if (png.width <= 0 || png.height <= 0) {
      return { png: null, detail: `decoded to non-positive dimensions ${png.width}x${png.height}` };
    }
    return { png, detail: '' };
  } catch (err) {
    return { png: null, detail: (err as Error).message };
  }
}

/**
 * The diff engine (spec R6): both images decoded to RGBA via pngjs, alpha
 * compared as pixelmatch sees it (no pre-flattening), constants pinned above.
 * A dimension mismatch after R4's sizing means something in the capture
 * pipeline lied — the lane never resizes-and-pretends, and the message states
 * both observed sizes to make a scale-factor misconfiguration one-glance.
 */
export function diffRasters(designBuf: Buffer, shotBuf: Buffer): DiffOutcome {
  const design = decodePng(designBuf);
  if (design.png === null) return { kind: 'undecodable', which: 'design', detail: design.detail };
  return diffDecoded(design.png, shotBuf);
}

/**
 * The lane's entry point: the design raster was already decoded once during
 * export validation, so only the screenshot decodes here.
 */
export function diffDecoded(
  design: PNG,
  shotBuf: Buffer,
): Exclude<DiffOutcome, { which: 'design' }> {
  const shot = decodePng(shotBuf);
  if (shot.png === null) return { kind: 'undecodable', which: 'shot', detail: shot.detail };
  if (design.width !== shot.png.width || design.height !== shot.png.height) {
    return {
      kind: 'dimension-mismatch',
      detail: `design is ${design.width}x${design.height}, screenshot is ${shot.png.width}x${shot.png.height} — pin your screenshot tool's device scale factor to 1`,
    };
  }
  const { width, height } = design;
  const diff = new PNG({ width, height });
  const differing = pixelmatch(design.data, shot.png.data, diff.data, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: PIXELMATCH_INCLUDE_AA,
  });
  return {
    kind: 'diff',
    diffRatio: differing / (width * height),
    width,
    height,
    diffPng: PNG.sync.write(diff),
  };
}

/** One surface's terminal state after the pipeline ran (or declined) for it. */
export type SurfaceOutcome =
  | { surface: string; kind: 'pass'; diffRatio: number; threshold: number }
  | {
      surface: string;
      kind: 'fail';
      diffRatio: number;
      threshold: number;
      severity: Severity;
      designPath: string;
      shotPath: string;
      diffPath: string;
    }
  | { surface: string; kind: 'cannot-review'; reason: LaneReasonCode; detail: string };

export interface Aggregated {
  verdict: 'pass' | 'fail' | 'cannot-review';
  /** Headline reason + detail — set only for `cannot-review` (spec R7;
   * `pen-modified` is the caller's override). */
  reason?: LaneReasonCode;
  detail?: string;
}

/**
 * Deterministic, total multi-surface aggregation (spec R7/D9): worst outcome by
 * `fail` > `cannot-review` > `pass`; the headline reason is the failing class of
 * the highest-precedence surface, ties broken by surface name ascending. Every
 * per-surface outcome stays in the sink regardless — the single reason is a
 * headline, not the record.
 */
export function aggregateOutcomes(outcomes: readonly SurfaceOutcome[]): Aggregated {
  if (outcomes.some((o) => o.kind === 'fail')) return { verdict: 'fail' };
  const cannots = outcomes
    .filter(
      (o): o is Extract<SurfaceOutcome, { kind: 'cannot-review' }> => o.kind === 'cannot-review',
    )
    .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0));
  if (cannots.length > 0) {
    return { verdict: 'cannot-review', reason: cannots[0].reason, detail: cannots[0].detail };
  }
  return { verdict: 'pass' };
}
