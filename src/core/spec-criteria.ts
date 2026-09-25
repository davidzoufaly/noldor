// @fd: feature-pen-coverage-from-acceptance-criteria
// A design spec's acceptance criteria, read one way for every reader:
// split-check's S2 counts them and the feature-design coverage check numbers them.

import { stepFence, type FenceState } from '../utils/markdown-sections.js';

/** One top-level item of a spec's `## Acceptance*` section. */
export interface AcceptanceCriterion {
  /** 1-based position among the section's top-level items — the number a coverage table cites. */
  readonly position: number;
  /** The number typed before `. ` on an ordered item; `null` on a `- ` item. */
  readonly typed: number | null;
}

const ACCEPTANCE_HEADING_RE = /^##\s+Acceptance/i;
const SECTION_HEADING_RE = /^## /;
const TOP_LEVEL_ITEM_RE = /^(?:-|(\d+)\.) /;

/**
 * The top-level `- ` / `N. ` items from the first `## Acceptance*` heading
 * (any case) up to the next `## ` heading, skipping every line inside a fence.
 * Indented items are details of a criterion, not criteria. No such heading → `[]`.
 */
export function readCriteria(specMd: string): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  let open: FenceState | null = null;
  let inSection = false;
  for (const line of specMd.split(/\r\n|\r|\n/)) {
    const before = open;
    ({ open } = stepFence(line, open));
    if (before !== null || open !== null) continue;
    if (!inSection) {
      inSection = ACCEPTANCE_HEADING_RE.test(line);
      continue;
    }
    if (SECTION_HEADING_RE.test(line)) break;
    const item = TOP_LEVEL_ITEM_RE.exec(line);
    if (item === null) continue;
    criteria.push({
      position: criteria.length + 1,
      typed: item[1] === undefined ? null : Number(item[1]),
    });
  }
  return criteria;
}
