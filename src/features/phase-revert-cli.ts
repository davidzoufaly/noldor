// `noldor features phase-revert <slug>` — revert an FD's phase done → in-progress
// for an attach session. Portable CLI equivalent of the gate skill's former
// inline `tsx -e` snippet (consumer repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { revertPhaseForAttach } from '../core/phase-revert.js';

function main(): void {
  const slug = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
  if (!slug) {
    process.stderr.write('usage: noldor features phase-revert <slug>\n');
    process.exit(1);
  }
  const path = join(process.cwd(), 'docs', 'features', `${slug}.md`);
  if (!existsSync(path)) {
    process.stderr.write(`phase-revert: FD not found: docs/features/${slug}.md\n`);
    process.exit(1);
  }
  const md = readFileSync(path, 'utf8');
  const out = revertPhaseForAttach(md);
  if (out === md) {
    process.stdout.write(`phase-revert: ${slug} unchanged (phase is not done)\n`);
    return;
  }
  writeFileSync(path, out, 'utf8');
  process.stdout.write(`phase-revert: ${slug} → in-progress\n`);
}

const invokedDirect = /[\\/]phase-revert-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
