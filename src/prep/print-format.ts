// noldor prep format <spec|plan> — print the canonical artifact format
// contract. The package-shipped twin of importing `formats.ts`: skills and
// agents in consumer repos (no noldor src/ checkout) read the contract here.

import { PLAN_FORMAT, SPEC_FORMAT } from './formats.js';

/**
 * Resolve a CLI kind argument to its format const.
 *
 * @param kind - Artifact kind from argv (`spec` or `plan`).
 * @returns The format string, or `null` when the kind is unknown.
 */
export function formatForKind(kind: string): string | null {
  if (kind === 'spec') return SPEC_FORMAT;
  if (kind === 'plan') return PLAN_FORMAT;
  return null;
}

function main(): number {
  const kind = process.argv[2];
  const out = kind === undefined ? null : formatForKind(kind);
  if (out === null) {
    process.stderr.write('usage: noldor prep format <spec|plan>\n');
    return 2;
  }
  process.stdout.write(`${out}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
