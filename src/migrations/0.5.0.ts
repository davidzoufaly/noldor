import type { Migration } from './types.js';

/**
 * No-op bridge anchor: keeps the chain contiguous for consumers still at 0.4.0
 * when the 0.6.0 skill-rename migration lands. No schema transform at 0.5.0.
 */
export const migration_0_5_0: Migration = {
  from: '0.4.0',
  to: '0.5.0',
  description: 'bridge anchor — no schema transform',
  dryRun: () => [],
  migrate: () => [],
};
