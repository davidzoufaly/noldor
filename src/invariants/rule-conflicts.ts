import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { INVARIANTS } from './rule-pairs.js';

import type { RulePairInvariant as RuleInvariant } from './rule-pairs.js';
import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

/**
 * Build a rule-conflicts invariant plugin. Wraps the existing
 * `rule-pairs.ts` seed data — exactly-one-side-matches → violation.
 *
 * @param repoRoot - Absolute path to repo root (where `docA`/`docB` paths resolve from).
 * @param pairs - Rule pairs to check. Defaults to seed list.
 * @returns Invariant plugin instance.
 */
export function makeRuleConflictsInvariant(
  repoRoot: string,
  pairs: readonly RuleInvariant[] = INVARIANTS,
): Invariant {
  return {
    description: 'Doc pairs must agree on canonical phrasings',
    name: 'rule-conflicts',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const violations: InvariantViolation[] = [];
      for (const pair of pairs) {
        const [a, b] = await Promise.all([
          readFile(join(repoRoot, pair.docA), 'utf8').catch(() => ''),
          readFile(join(repoRoot, pair.docB), 'utf8').catch(() => ''),
        ]);
        const matchesA = pair.patternA.test(a);
        const matchesB = pair.patternB.test(b);
        if (matchesA !== matchesB) {
          violations.push({
            file: matchesA ? pair.docB : pair.docA,
            message: pair.message,
          });
        }
      }
      return {
        invariant: 'rule-conflicts',
        violations,
        durationMs: Date.now() - start,
      };
    },
  };
}

/**
 * Default plugin instance bound to repo root via env. Used by the registry.
 */
export const ruleConflicts: Invariant = makeRuleConflictsInvariant(process.cwd());
