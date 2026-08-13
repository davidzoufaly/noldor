// `noldor roadmap remove-block <slug> [--backlog]` — remove a schema-C block
// from docs/roadmap.md (or docs/backlog.md). Idempotent: an absent slug is a
// no-op success, so gate/drain flows can call it unconditionally. Portable CLI
// equivalent of the gate skill's former inline `tsx -e` snippet (consumer
// repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';
import { RETIRED_IDS_PATH_DEFAULT, recordRetiredId } from './retired-ids.js';

function main(): void {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
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
  const entry = parse(raw).find((e) => e.slug === slug);
  if (!entry) {
    process.stdout.write(`remove-block: ${slug} not present in ${rel} — nothing to do\n`);
    return;
  }
  writeFileSync(path, removeBlock(raw, slug).newRaw, 'utf8');
  process.stdout.write(`remove-block: removed ${slug} from ${rel}\n`);

  // Forward the entry's stable ID so `blocked-by:` refs to it keep resolving.
  // Promotion lifts `- id:` into FD frontmatter; the no-FD retirement paths
  // (fast-track, attach) come through here and would otherwise drop it.
  if (entry.id !== undefined) {
    const mapPath = join(process.cwd(), RETIRED_IDS_PATH_DEFAULT);
    if (existsSync(dirname(mapPath))) {
      const recorded = recordRetiredId(
        entry.id,
        { slug, retiredAt: new Date().toISOString().slice(0, 10) },
        mapPath,
      );
      if (recorded) {
        process.stdout.write(`remove-block: recorded ${entry.id} in ${RETIRED_IDS_PATH_DEFAULT}\n`);
      }
    }
  }
}

const invokedDirect = /[\\/]remove-block-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
