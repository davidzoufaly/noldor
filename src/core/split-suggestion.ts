/**
 * Oversize-assessment heuristics behind `pnpm noldor noldor split-check`.
 *
 * Lives next to `size-routing.ts` (the size-policy home). `sizeToPath()`
 * routes purely on the operator's `size:` label; nothing cross-checks the
 * label against the body it describes — a mislabeled `S` with an L-sized body
 * sails through to a doomed drain iteration (the `prefix-skills-with-noldor`
 * incident). These heuristics measure the artifact itself at each commit
 * point (/noldor-promote step 1.7, noldor-plan post-save, gate Step 2.5
 * kind=plan and kind=spec, headless drain entry) and *suggest* a split; the framework never
 * auto-splits and never re-sizes.
 *
 * Thresholds are deliberately exported constants, not config (spec D1/D5):
 * they fire only on genuine outliers, and tuning is a one-line diff here.
 */
import type { BacklogEntry } from '../utils/parse-blocks.js';
import { extractTouches } from './extract-touches.js';

export interface SplitSignal {
  readonly rule: string; // 'E1' | 'E2' | 'E3' | 'F1' | 'P1' | 'S1' | 'S2'
  readonly value: number;
  readonly threshold: number;
  readonly message: string; // human sentence incl. suggested remedy
}

export const ENTRY_WORD_THRESHOLD = 300;
export const ENTRY_BULLET_THRESHOLD = 6;
export const ENTRY_TOUCHES_THRESHOLD = 8;
export const FD_LINKS_CODE_THRESHOLD = 30;
export const PLAN_ROW_THRESHOLD = 1000;
export const SPEC_WORD_THRESHOLD = 6000;
export const SPEC_CRITERIA_THRESHOLD = 20;

const SCOPE_BULLET_RE = /^\s*-\s+/;

/** Whitespace-token word count, empty-safe. Shared by E1 and S1 so the two cannot drift. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * E1/E2/E3 heuristics over a roadmap/backlog entry body — the free-text
 * `description` that `parseRoadmap`/`parseBacklog` already separate from the
 * `- key: value` bullet fields. One signal per tripped rule, in rule order.
 * All comparisons are strictly greater-than: a body AT a threshold is clean.
 */
export function assessEntrySplit(entry: Pick<BacklogEntry, 'description'>): SplitSignal[] {
  const signals: SplitSignal[] = [];
  const words = countWords(entry.description);
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
 *
 * The message names the *vertical* cut on purpose. "Each independently shippable"
 * alone reads as satisfiable by halving the task list, and the obvious horizontal
 * cut yields a first part of pure library units that ships no capability at all
 * (Q-0150, hit twice splitting the Q-0139 plan). Row count is the trigger, but
 * capability — not row count — is the seam. The entry point may be an existing
 * one: read literally the rule manufactures public API, which is how one split
 * minted four throwaway `design geometry-*` commands (see `noldor-plan` step 6).
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
        `part files (docs/design/plans/YYYY-MM-DD-<slug>-part<N>.md). Cut along capability, ` +
        `never along the task list: each part must move one user-visible capability end to ` +
        `end, through a new or existing entry point.`,
    },
  ];
}

const SPEC_ACCEPTANCE_HEADING_RE = /^##\s+Acceptance/i;
const SECTION_HEADING_RE = /^## /;
const TOP_LEVEL_CRITERION_RE = /^(?:-|\d+\.) /;

/**
 * Top-level list items (`- ` or `N. ` — 6 of the corpus's acceptance
 * sections are ordered lists) inside the acceptance section: from the first
 * line matching `## Acceptance*` (case-insensitive — covers `## Acceptance
 * criteria` and bare `## Acceptance`) up to the next `## ` heading or EOF.
 * Nested (indented) items are not counted. No matching heading → 0.
 */
function countSpecCriteria(specMd: string): number {
  const lines = specMd.split('\n');
  const start = lines.findIndex((l) => SPEC_ACCEPTANCE_HEADING_RE.test(l));
  if (start === -1) return 0;
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) break;
    if (TOP_LEVEL_CRITERION_RE.test(lines[i])) count += 1;
  }
  return count;
}

/**
 * S1/S2 heuristics over a design-spec markdown body. A spec with no
 * `## Acceptance*` heading is S2-silent by design — with no criteria section
 * there is no criteria bloat to measure, and S1 still covers raw bulk.
 */
export function assessSpecSplit(specMd: string): SplitSignal[] {
  const signals: SplitSignal[] = [];
  const words = countWords(specMd);
  if (words > SPEC_WORD_THRESHOLD) {
    signals.push({
      rule: 'S1',
      value: words,
      threshold: SPEC_WORD_THRESHOLD,
      message:
        `spec is ${words} words (threshold ${SPEC_WORD_THRESHOLD}) — split the design into ` +
        `sibling attach enhancements, one per concern, before implementation.`,
    });
  }
  const criteria = countSpecCriteria(specMd);
  if (criteria > SPEC_CRITERIA_THRESHOLD) {
    signals.push({
      rule: 'S2',
      value: criteria,
      threshold: SPEC_CRITERIA_THRESHOLD,
      message:
        `spec has ${criteria} acceptance criteria (threshold ${SPEC_CRITERIA_THRESHOLD}; ` +
        `budget ~12) — collapse per-detail criteria into behavior-level ones or split the scope.`,
    });
  }
  return signals;
}
