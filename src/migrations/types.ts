import type { ConsumerConfig } from '../core/consumer-config.js';

/** One file a migration would change. `before === ''` means the file is created. */
export interface MigrationStep {
  readonly path: string; // consumer-relative
  readonly before: string;
  readonly after: string;
}

/** A single version-to-version codemod over the consumer tree. */
export interface Migration {
  /** Anchor version this applies FROM (exclusive lower bound of the chain step). */
  readonly from: string;
  /** Anchor version this brings the consumer TO. */
  readonly to: string;
  readonly description: string;
  /** Compute steps without writing to disk. */
  dryRun(cwd: string, config: ConsumerConfig): MigrationStep[];
  /** Apply steps to disk; returns the steps applied. */
  migrate(cwd: string, config: ConsumerConfig): MigrationStep[];
}

export interface ChainResult {
  readonly migration: Migration;
  readonly steps: MigrationStep[];
}
