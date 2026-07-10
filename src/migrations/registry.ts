import type { Migration } from './types.js';
import { migration_0_4_0 } from './0.4.0.js';
import { migration_0_5_0 } from './0.5.0.js';
import { migration_0_6_0 } from './0.6.0.js';

/**
 * Every shipped migration, in any order (the engine sorts by `to`). Each new
 * consumer-facing schema change adds an entry here in the same PR.
 */
export const MIGRATIONS: readonly Migration[] = [migration_0_4_0, migration_0_5_0, migration_0_6_0];
