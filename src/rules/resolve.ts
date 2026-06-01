import { minimatch } from 'minimatch';
import type { Stage } from '../core/rules/stage.js';
import type { Rule } from './types.js';

export interface ResolveQuery {
  /** Target file (relative POSIX path). Omit for a stage-only resolution. */
  file?: string;
  /** Lifecycle stage. Omit to match rules regardless of stage. */
  stage?: Stage;
}

export interface ResolveResult {
  injected: Rule[];
  enforce: Rule[];
}

/** Literal (non-wildcard) leading segments — higher = more specific. */
function specificity(glob: string): number {
  let n = 0;
  for (const seg of glob.split('/')) {
    if (seg.includes('*') || seg.includes('?') || seg.includes('{')) break;
    n++;
  }
  return n;
}

function stageMatches(rule: Rule, stage?: Stage): boolean {
  if (rule.stage.length === 0) return true;
  if (stage === undefined) return true;
  return rule.stage.includes(stage);
}

function fileMatches(rule: Rule, file?: string): boolean {
  if (file === undefined) return rule.appliesTo.length === 0; // stage-only query
  if (rule.appliesTo.length === 0) return false; // stage-level rule, not file-scoped
  return rule.appliesTo.some((g) => minimatch(file, g));
}

export function resolveRules(rules: Rule[], query: ResolveQuery): ResolveResult {
  const matched = rules
    .map((rule, declIndex) => ({ rule, declIndex }))
    .filter(({ rule }) => stageMatches(rule, query.stage) && fileMatches(rule, query.file));

  // Total order: specificity desc, declaration order asc as tiebreak.
  matched.sort((a, b) => {
    const sa = Math.max(0, ...a.rule.appliesTo.map(specificity));
    const sb = Math.max(0, ...b.rule.appliesTo.map(specificity));
    if (sa !== sb) return sb - sa;
    return a.declIndex - b.declIndex;
  });

  const injected: Rule[] = [];
  const enforce: Rule[] = [];
  for (const { rule } of matched) (rule.enforce ? enforce : injected).push(rule);
  return { injected, enforce };
}
