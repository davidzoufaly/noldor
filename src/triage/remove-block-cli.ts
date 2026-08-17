// `noldor roadmap remove-block <slug> [--backlog]
//   [--retired-into <fd-slug> | --split-into <slug>,<slug>]` —
// remove a schema-C block from docs/roadmap.md (or docs/backlog.md). Idempotent:
// an absent slug is a no-op success, so gate/drain flows can call it
// unconditionally. Portable CLI equivalent of the gate skill's former inline
// `tsx -e` snippet (consumer repos have no ./src/ tree to import from).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseBacklog, parseRefList, parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';
import { ENTRY_ID_RE } from './entry-id.js';
import { RETIRED_IDS_PATH_DEFAULT, recordRetiredId } from './retired-ids.js';

/**
 * Parsed `remove-block` argv. `retiredInto` is the attach path's parent FD;
 * `splitInto` names the sibling entries a split replaced the block with. The
 * two are mutually exclusive, so a well-formed value carries at most one.
 */
export interface RemoveBlockArgs {
  slug?: string;
  backlog: boolean;
  retiredInto?: string;
  splitInto?: string[];
}

/** Parse outcome. A usage conflict is an expected failure, not a throw. */
export type ParseRemoveBlockResult =
  | { success: true; data: RemoveBlockArgs }
  | { success: false; errors: string[] };

/** One value-taking flag's reading: whether it appeared, and what it carried. */
interface FlagRead {
  present: boolean;
  value?: string;
  /** argv index of a spaced value this flag consumed, so it can't bind as the slug. */
  valueIndex?: number;
}

/**
 * Read one `--flag <value>` / `--flag=<value>` pair.
 *
 * `present` is deliberately independent of `value`: a valueless `--split-into`
 * still counts as supplied, so mutual-exclusion is decided on what the operator
 * typed rather than on what survived extraction. An empty or flag-shaped value
 * yields `present: true` with no `value`, keeping downstream optional fields
 * absent-or-meaningful.
 */
function readFlag(argv: readonly string[], flag: string): FlagRead {
  const inlinePrefix = `${flag}=`;
  const inlineIndex = argv.findIndex((a) => a.startsWith(inlinePrefix));
  if (inlineIndex >= 0) {
    const raw = argv[inlineIndex].slice(inlinePrefix.length);
    return { present: true, ...(raw.length > 0 ? { value: raw } : {}) };
  }
  const index = argv.indexOf(flag);
  if (index < 0) return { present: false };
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) return { present: true };
  return { present: true, value: next, valueIndex: index + 1 };
}

/**
 * Parse `remove-block` argv.
 *
 * `--retired-into <fd-slug>` names the FD that absorbed the entry, so an attach
 * retirement records *where the ID went* and not merely that it went;
 * fast-track carries no FD and omits it. `--split-into <slug>,<slug>` is the
 * split counterpart, naming the sibling entries that replaced the block.
 *
 * The positional slug skips every index a flag consumed as its value, so
 * `remove-block --split-into a,b my-slug` binds `my-slug` and not `a,b` —
 * otherwise the command resolves no block and exits 0 with "nothing to do",
 * a silent no-op that gate and drain flows read as success.
 */
export function parseRemoveBlockArgs(argv: readonly string[]): ParseRemoveBlockResult {
  const retired = readFlag(argv, '--retired-into');
  const split = readFlag(argv, '--split-into');
  if (retired.present && split.present) {
    return {
      success: false,
      errors: [
        '--retired-into and --split-into are mutually exclusive: an entry is either absorbed by a parent FD or split into sibling entries, not both.',
      ],
    };
  }
  const consumed = new Set(
    [retired.valueIndex, split.valueIndex].filter((i): i is number => i !== undefined),
  );
  const slug = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i));
  const splitInto = split.value === undefined ? [] : parseRefList(split.value);
  return {
    success: true,
    data: {
      slug,
      backlog: argv.includes('--backlog'),
      ...(retired.value !== undefined ? { retiredInto: retired.value } : {}),
      ...(splitInto.length > 0 ? { splitInto } : {}),
    },
  };
}

const USAGE =
  'usage: noldor roadmap remove-block <slug> [--backlog] [--retired-into <fd-slug> | --split-into <slug>,<slug>]\n';

function main(): void {
  const parsed = parseRemoveBlockArgs(process.argv.slice(2));
  if (!parsed.success) {
    for (const error of parsed.errors) process.stderr.write(`remove-block: ${error}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const { slug, backlog, retiredInto, splitInto } = parsed.data;
  if (!slug) {
    process.stderr.write(USAGE);
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
          ...(splitInto !== undefined ? { splitInto } : {}),
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
