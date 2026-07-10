import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Append a `(source)`-tagged breadcrumb to `.noldor/overrides.log` so every
 * enforcement bypass — trailer override, pre-commit env override, release
 * skip-env — leaves the same durable, `/noldor-garden`-auditable record.
 *
 * Line shape: `<ISO timestamp>\t<reason>\t(<source>)`. The untagged 2-column
 * variant written by `validate-trailer` at the commit-msg layer predates this
 * helper and stays as-is.
 *
 * A failed write is swallowed: logging must never block the bypass itself.
 */
export function appendOverrideLog(cwd: string, reason: string, source: string): void {
  try {
    appendFileSync(
      join(cwd, '.noldor', 'overrides.log'),
      `${new Date().toISOString()}\t${reason}\t(${source})\n`,
    );
  } catch {
    // logging failure must not block the bypass itself
  }
}
