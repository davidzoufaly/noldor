// `noldor roadmap remove-block <slug> [--backlog]` — remove a schema-C block
// from docs/roadmap.md (or docs/backlog.md). Idempotent: an absent slug is a
// no-op success, so gate/drain flows can call it unconditionally. Portable CLI
// equivalent of the gate skill's former inline `tsx -e` snippet (consumer
// repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';
import { ENTRY_ID_RE } from './entry-id.js';
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
  // Forward the entry's stable ID so `blocked-by:` refs to it keep resolving.
  // Promotion lifts `- id:` into FD frontmatter; the no-FD retirement paths
  // (fast-track, attach) come through here and would otherwise drop it.
  // Runs BEFORE the roadmap write so a corrupt map fails the removal closed
  // (block still present) instead of leaving it removed with the ID dropped.
  // A dropped ID is the dangling-ref failure the map exists to prevent, so the
  // skip branches warn rather than stay silent — but they don't block removal
  // (a repo without .noldor/ hasn't adopted state; a malformed `- id:` is the
  // source block's defect, not this command's).
  let recordNote = '';
  if (entry.id !== undefined) {
    const mapPath = join(process.cwd(), RETIRED_IDS_PATH_DEFAULT);
    if (!ENTRY_ID_RE.test(entry.id)) {
      recordNote = `remove-block: id '${entry.id}' is malformed (expected Q-NNNN) — not recorded; blocked-by refs to it will dangle\n`;
    } else if (!existsSync(dirname(mapPath))) {
      recordNote = `remove-block: ${RETIRED_IDS_PATH_DEFAULT} not written (no .noldor/ directory) — blocked-by refs to ${entry.id} will dangle\n`;
    } else if (
      recordRetiredId(entry.id, { slug, retiredAt: new Date().toISOString().slice(0, 10) }, mapPath)
    ) {
      process.stdout.write(`remove-block: recorded ${entry.id} in ${RETIRED_IDS_PATH_DEFAULT}\n`);
    }
  }

  writeFileSync(path, removeBlock(raw, slug).newRaw, 'utf8');
  process.stdout.write(`remove-block: removed ${slug} from ${rel}\n`);
  if (recordNote.length > 0) process.stderr.write(recordNote);
}

const invokedDirect = /[\\/]remove-block-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
