/**
 * Oversize-assessment heuristics behind `pnpm noldor noldor split-check`.
 *
 * Lives next to `size-routing.ts` (the size-policy home). `sizeToPath()`
 * routes purely on the operator's `size:` label; nothing cross-checks the
 * label against the body it describes — a mislabeled `S` with an L-sized body
 * sails through to a doomed drain iteration (the `prefix-skills-with-noldor`
 * incident). These heuristics measure the artifact itself at each commit
 * point (/noldor-promote step 1.7, noldor-plan post-save, gate Step 2.5 kind=plan,
 * headless drain entry) and *suggest* a split; the framework never
 * auto-splits and never re-sizes.
 *
 * Thresholds are deliberately exported constants, not config (spec D1/D5):
 * they fire only on genuine outliers, and tuning is a one-line diff here.
 */
import type { BacklogEntry } from '../utils/parse-blocks.js';
import { extractTouches } from './extract-touches.js';

export interface SplitSignal {
  readonly rule: string; // 'E1' | 'E2' | 'E3' | 'F1' | 'P1'
  readonly value: number;
  readonly threshold: number;
  readonly message: string; // human sentence incl. suggested remedy
}

export const ENTRY_WORD_THRESHOLD = 300;
export const ENTRY_BULLET_THRESHOLD = 6;
export const ENTRY_TOUCHES_THRESHOLD = 8;
export const FD_LINKS_CODE_THRESHOLD = 30;
export const PLAN_ROW_THRESHOLD = 1000;

const SCOPE_BULLET_RE = /^\s*-\s+/;

/**
 * E1/E2/E3 heuristics over a roadmap/backlog entry body — the free-text
 * `description` that `parseRoadmap`/`parseBacklog` already separate from the
 * `- key: value` bullet fields. One signal per tripped rule, in rule order.
 * All comparisons are strictly greater-than: a body AT a threshold is clean.
 */
export function assessEntrySplit(entry: Pick<BacklogEntry, 'description'>): SplitSignal[] {
  const signals: SplitSignal[] = [];
  const trimmed = entry.description.trim();
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  if (words > ENTRY_WORD_THRESHOLD) {
    signals.push({
      rule: 'E1',
      value: words,
      threshold: ENTRY_WORD_THRESHOLD,
      message:
        `entry body is ${words} words (threshold ${ENTRY_WORD_THRESHOLD}) — split the block ` +
        `into sibling entries, one per concern, before committing to a path.`,
    });
  }
  const bullets = entry.description.split('\n').filter((l) => SCOPE_BULLET_RE.test(l)).length;
  if (bullets > ENTRY_BULLET_THRESHOLD) {
    signals.push({
      rule: 'E2',
      value: bullets,
      threshold: ENTRY_BULLET_THRESHOLD,
      message:
        `entry body has ${bullets} scope bullets (threshold ${ENTRY_BULLET_THRESHOLD}) — each ` +
        `scope bullet is a candidate sibling entry; split before promoting.`,
    });
  }
  const touches = extractTouches(entry.description).paths.length;
  if (touches > ENTRY_TOUCHES_THRESHOLD) {
    signals.push({
      rule: 'E3',
      value: touches,
      threshold: ENTRY_TOUCHES_THRESHOLD,
      message:
        `Touches: clause names ${touches} paths (threshold ${ENTRY_TOUCHES_THRESHOLD}) — split ` +
        `by subsystem so each slice touches a reviewable file set.`,
    });
  }
  return signals;
}

/**
 * F1 — "attach would make this parent an everything-FD". Fires when the
 * deduplicated union of the parent's `links.code` and the attach's pending
 * touches exceeds the threshold. Returns `null` when within bounds.
 */
export function assessFdBreadth(
  linksCode: readonly string[],
  addedTouches: readonly string[],
): SplitSignal | null {
  const union = new Set([...linksCode, ...addedTouches]).size;
  if (union <= FD_LINKS_CODE_THRESHOLD) return null;
  return {
    rule: 'F1',
    value: union,
    threshold: FD_LINKS_CODE_THRESHOLD,
    message:
      `attach would grow the parent's links.code to ${union} paths (threshold ` +
      `${FD_LINKS_CODE_THRESHOLD}) — scaffold a child FD instead of attaching.`,
  };
}

/**
 * P1 — plan bulk. A "row" is a raw markdown line (`split('\n').length`), per
 * the roadmap entry's ~1000-rows framing (spec D4); one part ≈ 1000 rows, so
 * the suggested part count is `ceil(rows / threshold)`.
 */
export function assessPlanSplit(planMd: string): SplitSignal[] {
  const rows = planMd.split('\n').length;
  if (rows <= PLAN_ROW_THRESHOLD) return [];
  const parts = Math.ceil(rows / PLAN_ROW_THRESHOLD);
  return [
    {
      rule: 'P1',
      value: rows,
      threshold: PLAN_ROW_THRESHOLD,
      message:
        `plan is ${rows} rows (threshold ${PLAN_ROW_THRESHOLD}) — restructure into ${parts} ` +
        `part files (docs/design/plans/YYYY-MM-DD-<slug>-part<N>.md), each independently ` +
        `shippable.`,
    },
  ];
}
