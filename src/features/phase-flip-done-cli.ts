// `noldor features phase-flip-done <slug>` — flip an FD's phase in-progress → done.
// Portable CLI equivalent of the gate skill's former inline `tsx -e` snippet:
// consumer repos have no ./src/ tree to import from, so the skill shells here.
import { existsSync } from 'node:fs';

import { featurePath } from '../core/doc-roots.js';
import { pathErrorMessage, readFileNoFollow, writeFileNoFollow } from '../core/slug-paths.js';
import { parseSlug } from '../core/slug.js';
import { flipPhaseToDone } from '../core/phase-flip-done.js';

function main(): void {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) {
    process.stderr.write('usage: noldor features phase-flip-done <slug>\n');
    process.exit(1);
  }
  // Parse before the existsSync: the read is itself a slug-derived operation,
  // and `../../../escape` resolved outside the repo before this guard existed.
  const parsed = parseSlug(slug);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error.message}\n`);
    process.exit(1);
  }
  const built = featurePath(process.cwd(), parsed.slug);
  if (!built.ok) {
    process.stderr.write(`${pathErrorMessage(built.error)}\n`);
    process.exit(1);
  }
  const path = built.path;
  if (!existsSync(path)) {
    process.stderr.write(`phase-flip-done: FD not found: docs/features/${slug}.md\n`);
    process.exit(1);
  }
  const md = readFileNoFollow(path);
  const out = flipPhaseToDone(md);
  if (out === md) {
    process.stdout.write(`phase-flip-done: ${slug} unchanged (phase is not in-progress)\n`);
    return;
  }
  writeFileNoFollow(path, out);
  process.stdout.write(`phase-flip-done: ${slug} → done\n`);
}

const invokedDirect = /[\\/]phase-flip-done-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
