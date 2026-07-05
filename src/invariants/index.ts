import { boundaries, makeBoundariesInvariant } from './boundaries.js';
import { makePublicApiTsdocInvariant, publicApiTsdoc } from './public-api-tsdoc.js';
import { makeRuleConflictsInvariant, ruleConflicts } from './rule-conflicts.js';

import type { Invariant, InvariantResult } from './types.js';

/**
 * All architecture invariants, in execution order. Adding a new invariant:
 * write the plugin under `scripts/invariants/`, import it here, append.
 */
export const invariants: readonly Invariant[] = [
  ruleConflicts,
  publicApiTsdoc,
  boundaries,
] as const;

/**
 * Build the invariant registry for a specific repo root.
 *
 * @param repoRoot - Repository root whose files should be scanned.
 * @returns Fresh plugin instances bound to that root.
 */
export function makeInvariants(repoRoot: string): readonly Invariant[] {
  return [
    makeRuleConflictsInvariant(repoRoot),
    makePublicApiTsdocInvariant(repoRoot),
    makeBoundariesInvariant(repoRoot),
  ] as const;
}

function formatInvariantError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Run one invariant without allowing infrastructure errors to abort the batch.
 *
 * @param invariant - Plugin to execute.
 * @returns The plugin result, or a violation describing the thrown error.
 */
export async function runInvariantSafely(invariant: Invariant): Promise<InvariantResult> {
  const start = Date.now();
  try {
    return await invariant.run();
  } catch (error) {
    return {
      invariant: invariant.name,
      violations: [{ message: `invariant failed: ${formatInvariantError(error)}` }],
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Run all invariants in parallel and always return one result per plugin.
 *
 * @param invs - Plugins to execute.
 * @returns One result per invariant, including thrown-error violations.
 */
export async function runInvariants(
  invs: readonly Invariant[],
): Promise<readonly InvariantResult[]> {
  return Promise.all(invs.map(runInvariantSafely));
}

export type { Invariant, InvariantResult, InvariantViolation } from './types.js';
