// `noldor features phase-flip-done <slug>` — flip an FD's phase in-progress → done.
// Portable CLI equivalent of the gate skill's former inline `tsx -e` snippet:
// consumer repos have no ./src/ tree to import from, so the skill shells here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { flipPhaseToDone } from '../core/phase-flip-done.js';

function main(): void {
  const slug = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
  if (!slug) {
    process.stderr.write('usage: noldor features phase-flip-done <slug>\n');
    process.exit(1);
  }
  const path = join(process.cwd(), 'docs', 'features', `${slug}.md`);
  if (!existsSync(path)) {
    process.stderr.write(`phase-flip-done: FD not found: docs/features/${slug}.md\n`);
    process.exit(1);
  }
  const md = readFileSync(path, 'utf8');
  const out = flipPhaseToDone(md);
  if (out === md) {
    process.stdout.write(`phase-flip-done: ${slug} unchanged (phase is not in-progress)\n`);
    return;
  }
  writeFileSync(path, out, 'utf8');
  process.stdout.write(`phase-flip-done: ${slug} → done\n`);
}

const invokedDirect = /[\\/]phase-flip-done-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
