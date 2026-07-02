// `noldor roadmap remove-block <slug> [--backlog]` — remove a schema-C block
// from docs/roadmap.md (or docs/backlog.md). Idempotent: an absent slug is a
// no-op success, so gate/drain flows can call it unconditionally. Portable CLI
// equivalent of the gate skill's former inline `tsx -e` snippet (consumer
// repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';

function main(): void {
  const argv = process.argv.slice(2);
  const slug = argv.filter((a) => !a.startsWith('--'))[0];
  const backlog = argv.includes('--backlog');
  if (!slug) {
    process.stderr.write('usage: noldor roadmap remove-block <slug> [--backlog]\n');
    process.exit(1);
  }
  const rel = backlog ? 'docs/backlog.md' : 'docs/roadmap.md';
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) {
    process.stderr.write(`remove-block: ${rel} not found\n`);
    process.exit(1);
  }
  const raw = readFileSync(path, 'utf8');
  const parse = backlog ? parseBacklog : parseRoadmap;
  if (!parse(raw).some((e) => e.slug === slug)) {
    process.stdout.write(`remove-block: ${slug} not present in ${rel} — nothing to do\n`);
    return;
  }
  writeFileSync(path, removeBlock(raw, slug).newRaw, 'utf8');
  process.stdout.write(`remove-block: removed ${slug} from ${rel}\n`);
}

const invokedDirect = /[\\/]remove-block-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
