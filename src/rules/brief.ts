/**
 * Renders a resolved rule set as an author-facing brief.
 *
 * The cascade could always answer "which rules apply to this file"; nothing ever
 * asked it, so the `enforce` bucket enforced nothing. This is the render half of
 * closing that: `rules brief` (author, before an edit) and the code-stage CR
 * prompt (reviewer, after) both go through here, so both sides read the same
 * text.
 *
 * Pure — no fs, no git, no clock. Callers resolve and pass the result in.
 */
import type { Stage } from '../core/rules/stage.js';
import type { ResolveResult } from './resolve.js';
import type { Rule } from './types.js';

export interface BriefOptions {
  /** Files the brief was resolved for — named in the header so the scope is visible. */
  readonly files: readonly string[];
  readonly stage?: Stage;
  /** Drop the advisory section; the CR prompt carries binding rules only. */
  readonly enforceOnly?: boolean;
}

/** First-seen wins, so the per-file order `resolveRules` produced is preserved. */
function dedupeById(rules: readonly Rule[]): Rule[] {
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const rule of rules) {
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
  }
  return out;
}

/**
 * Merge per-file resolutions into one result, deduped by rule id.
 *
 * `resolveRules` already returns a total order (specificity desc, declaration
 * asc), so concatenating per-file results and keeping the first occurrence
 * preserves that order without a re-sort.
 *
 * That guarantee is per file, not across them: a rule shared by files A and B
 * stays at its file-A position even when it is B's most-specific match, and B's
 * unique rules all trail A's. Display order only — every matched rule is still
 * listed in the right bucket — so a global re-sort would buy nothing.
 */
export function unionResults(results: readonly ResolveResult[]): ResolveResult {
  return {
    injected: dedupeById(results.flatMap((r) => r.injected)),
    enforce: dedupeById(results.flatMap((r) => r.enforce)),
  };
}

const scopeOf = (rule: Rule): string =>
  `applies to ${rule.appliesTo.length > 0 ? rule.appliesTo.join(', ') : '(stage-level)'}` +
  `; stage ${rule.stage.length > 0 ? rule.stage.join(', ') : 'any'}`;

/** One `## <title>` block, or nothing when the bucket is empty. */
function renderSection(title: string, rules: readonly Rule[]): string[] {
  if (rules.length === 0) return [];
  const out = [`## ${title} (${rules.length})`];
  for (const rule of rules) {
    out.push('', `### ${rule.id} — ${scopeOf(rule)}`, '', rule.body);
    if (rule.links.length > 0) out.push('', `Links: ${rule.links.join(', ')}`);
  }
  return out;
}

/**
 * Render `result` as markdown: binding rules first, advisory second.
 *
 * An empty result renders an explicit "no rules match" line rather than an empty
 * string — silence would read as "briefed, nothing to know" when it may equally
 * mean a bad query. Callers that must not emit the line at all (the CR prompt)
 * decide from the resolved buckets, never by testing this output for emptiness.
 */
export function renderBrief(result: ResolveResult, opts: BriefOptions): string {
  const stage = opts.stage ?? 'any';
  const where = `${opts.files.join(', ')} (stage: ${stage})`;
  const advisory = opts.enforceOnly ? [] : result.injected;

  if (result.enforce.length === 0 && advisory.length === 0) {
    // Under `enforceOnly` advisory rules may well have matched — they were
    // suppressed, not absent — so a bare "no rules match" would be false.
    return `${opts.enforceOnly ? 'no binding rules match' : 'no rules match'} ${where}\n`;
  }

  const lines = [
    `# Rules for ${where}`,
    '',
    ...renderSection('ENFORCE — binding, not advisory', result.enforce),
  ];
  const advisorySection = renderSection('ADVISORY — context', advisory);
  if (advisorySection.length > 0) lines.push('', ...advisorySection);
  return `${lines.join('\n')}\n`;
}
