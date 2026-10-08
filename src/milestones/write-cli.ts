import { milestoneRefusalMessage, type MilestoneWriteResult } from './lib.js';

/**
 * Run one milestone write for a `milestones` CLI leaf; on refusal print the
 * message alone and exit 1. Slug refusals come back as results, while the
 * repository-state ones (already exists, shipped is terminal, …) still throw —
 * both print without the router's stack trace.
 */
export function writeOrExit(write: () => MilestoneWriteResult): void {
  let result: MilestoneWriteResult;
  try {
    result = write();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(milestoneRefusalMessage(result.error));
    process.exit(1);
  }
}
