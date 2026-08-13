// `noldor roadmap remove-block <slug> [--backlog] [--retired-into <fd-slug>]` —
// remove a schema-C block from docs/roadmap.md (or docs/backlog.md). Idempotent:
// an absent slug is a no-op success, so gate/drain flows can call it
// unconditionally. Portable CLI equivalent of the gate skill's former inline
// `tsx -e` snippet (consumer repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';
import { ENTRY_ID_RE } from './entry-id.js';
import { RETIRED_IDS_PATH_DEFAULT, recordRetiredId } from './retired-ids.js';

/** Parsed `remove-block` argv. `retiredInto` is the attach path's parent FD. */
export interface RemoveBlockArgs {
  slug?: string;
  backlog: boolean;
  retiredInto?: string;
}

/**
 * Parse `remove-block` argv. `--retired-into <fd-slug>` (or `=` form) names the
 * FD that absorbed the entry, so an attach retirement records *where the ID
 * went* and not merely that it went; fast-track carries no FD and omits it.
 * An empty value — or a following token that is itself a flag, as in
 * `remove-block foo --retired-into --backlog` — is dropped rather than
 * recorded, keeping the map's optional field absent-or-meaningful.
 */
export function parseRemoveBlockArgs(argv: readonly string[]): RemoveBlockArgs {
  const flagIndex = argv.indexOf('--retired-into');
  const inline = argv.find((a) => a.startsWith('--retired-into='));
  const spaced = argv[flagIndex + 1];
  const retiredInto =
    flagIndex >= 0
      ? spaced?.startsWith('--')
        ? undefined
        : spaced
      : inline?.slice('--retired-into='.length);
  const slug = argv.find((a, i) => !a.startsWith('--') && !(flagIndex >= 0 && i === flagIndex + 1));
  return {
    slug,
    backlog: argv.includes('--backlog'),
    ...(retiredInto !== undefined && retiredInto.length > 0 ? { retiredInto } : {}),
  };
}

function main(): void {
  const { slug, backlog, retiredInto } = parseRemoveBlockArgs(process.argv.slice(2));
  if (!slug) {
    process.stderr.write(
      'usage: noldor roadmap remove-block <slug> [--backlog] [--retired-into <fd-slug>]\n',
    );
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
      recordRetiredId(
        entry.id,
        {
          slug,
          ...(retiredInto !== undefined ? { retiredInto } : {}),
          retiredAt: new Date().toISOString().slice(0, 10),
        },
        mapPath,
      )
    ) {
      process.stdout.write(`remove-block: recorded ${entry.id} in ${RETIRED_IDS_PATH_DEFAULT}\n`);
    }
  }

  // Warn before the roadmap write, not after: a failing write must not swallow
  // the "this ID will dangle" note, which is the whole point of the skip branch.
  if (recordNote.length > 0) process.stderr.write(recordNote);
  writeFileSync(path, removeBlock(raw, slug).newRaw, 'utf8');
  process.stdout.write(`remove-block: removed ${slug} from ${rel}\n`);
}

const invokedDirect = /[\\/]remove-block-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
