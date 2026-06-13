import type { Migration } from './types.js';

/**
 * Anchor migration: establishes the migration baseline. No schema transform —
 * a consumer at 0.3.0 owes nothing structural to reach 0.4.0 today. The first
 * real schema change adds its own `<version>.ts` with a genuine transform
 * (enforced by the migration-coverage garden detector).
 */
export const migration_0_4_0: Migration = {
  from: '0.3.0',
  to: '0.4.0',
  description: 'baseline anchor — no schema transform',
  dryRun: () => [],
  migrate: () => [],
};
