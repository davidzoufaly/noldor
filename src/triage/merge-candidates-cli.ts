import { fileURLToPath } from 'node:url';

import { buildMergeCandidates, type MergeCandidate } from './merge-candidates.js';

/**
 * Render the corpus as an aligned, human-readable table (kind · disposition ·
 * slug · name) for eyeballing. The `--json` path bypasses this and emits the
 * raw array for `/noldor-triage`.
 */
export function formatTable(candidates: MergeCandidate[]): string {
  if (candidates.length === 0) return '(no merge candidates)';
  const rows = candidates.map((c) => [c.kind, c.disposition, c.slug, c.name] as const);
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  const w2 = Math.max(...rows.map((r) => r[2].length));
  return rows
    .map((r) => `${r[0].padEnd(w0)}  ${r[1].padEnd(w1)}  ${r[2].padEnd(w2)}  ${r[3]}`)
    .join('\n');
}

async function main(): Promise<void> {
  const json = process.argv.slice(2).includes('--json');
  const candidates = await buildMergeCandidates(process.cwd());
  process.stdout.write(
    json ? `${JSON.stringify(candidates, null, 2)}\n` : `${formatTable(candidates)}\n`,
  );
}

// True only when this module is the direct entry — dispatch reshapes argv so
// process.argv[1] === this module's path (see src/cli/index.ts:14-22).
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
