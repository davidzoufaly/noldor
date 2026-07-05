import semver from 'semver';

import type { ConsumerConfig } from '../core/consumer-config.js';
import type { ChainResult, Migration, MigrationStep } from './types.js';

/**
 * Select the migrations needed to move a consumer from `from` to `to`:
 * every migration whose `to` is in `(from, to]`, sorted ascending by `to`.
 * Asserts the chain is contiguous (each migration's `from` equals the running
 * cursor). Throws on downgrade (`from > to`) or a gap in the chain.
 */
export function resolveChain(
  migrations: readonly Migration[],
  from: string,
  to: string,
): Migration[] {
  if (semver.compare(from, to) > 0) {
    throw new Error(`downgrade unsupported: anchored ${from} > installed ${to}`);
  }
  const selected = migrations
    .filter((m) => semver.compare(m.to, from) > 0 && semver.compare(m.to, to) <= 0)
    .toSorted((a, b) => semver.compare(a.to, b.to));
  let cursor = from;
  for (const m of selected) {
    if (semver.compare(m.from, cursor) !== 0) {
      throw new Error(
        `migration chain gap: expected a migration from ${cursor}, got ${m.from} (→${m.to})`,
      );
    }
    cursor = m.to;
  }
  return selected;
}

/** Run each migration's `dryRun` (or `migrate`) in order, collecting steps. */
export function runChain(
  chain: readonly Migration[],
  cwd: string,
  config: ConsumerConfig,
  opts: { dryRun: boolean },
): ChainResult[] {
  return chain.map((migration) => ({
    migration,
    steps: opts.dryRun ? migration.dryRun(cwd, config) : migration.migrate(cwd, config),
  }));
}

/** Deterministic per-file line diff for the `--dry-run` printout. */
export function renderSteps(steps: readonly MigrationStep[]): string {
  const out: string[] = [];
  for (const s of steps) {
    out.push(`--- ${s.path}`);
    const before = s.before.split('\n');
    const after = s.after.split('\n');
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const b = before[i];
      const a = after[i];
      if (b === a) continue;
      if (b !== undefined && b !== '') out.push(`-${b}`);
      if (a !== undefined && a !== '') out.push(`+${a}`);
    }
  }
  return out.join('\n');
}
