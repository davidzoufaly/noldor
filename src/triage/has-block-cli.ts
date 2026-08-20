// `noldor roadmap has-block <slug|Q-NNNN> [--backlog] [--quiet]` — is this entry
// still queued? Exit 0 = present, 1 = absent, 2 = usage/IO error.
//
// The predicate exists because the obvious hand-rolled version is wrong in the
// safe-looking direction. An entry's slug is `slugify(heading)` and never appears
// literally in the document, so `grep -q "$slug" docs/roadmap.md` returns FALSE for
// every live entry — and a script reading that as "already shipped, skip" then skips
// silently. It bit a hand-rolled XS drain runner into skipping all 6 eligible entries
// in 5 seconds with a clean exit, and it is the same root cause as the CR blocker on
// the 2026-08-12 triage commit, where 12 `[triaged → slug]` markers named shorthand
// slugs resolving to no block.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { resolveEntryRef } from './entry-id.js';

/** Parsed `has-block` argv. */
export interface HasBlockArgs {
  ref?: string;
  backlog: boolean;
  quiet: boolean;
}

/** Parse `has-block` argv. The first non-flag token is the ref. */
export function parseHasBlockArgs(argv: readonly string[]): HasBlockArgs {
  return {
    ref: argv.find((a) => !a.startsWith('--')),
    backlog: argv.includes('--backlog'),
    quiet: argv.includes('--quiet'),
  };
}

/**
 * Is `ref` present in `raw`? `ref` may be a slug or an entry ID (`Q-0042`) — the ID
 * alias resolves through {@link resolveEntryRef} against both queue documents and the
 * feature docs, so a caller holding an ID need not know the slug it became.
 *
 * Returns the resolved slug alongside the verdict so a caller can report which slug an
 * ID actually named — an unknown ID resolves to itself, which is indistinguishable from
 * a typo'd slug and worth surfacing rather than hiding.
 */
export function hasBlock(
  ref: string,
  raw: string,
  paths: { roadmapRaw: string; backlogRaw: string; featuresDir: string },
  backlog = false,
): { present: boolean; slug: string } {
  const slug = resolveEntryRef(ref, paths);
  const entries = backlog ? parseBacklog(raw) : parseRoadmap(raw);
  return { present: entries.some((e) => e.slug === slug), slug };
}

const USAGE = 'usage: noldor roadmap has-block <slug|Q-NNNN> [--backlog] [--quiet]\n';

function main(): void {
  const { ref, backlog, quiet } = parseHasBlockArgs(process.argv.slice(2));
  if (ref === undefined) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const cwd = process.cwd();
  const rel = backlog ? 'docs/backlog.md' : 'docs/roadmap.md';
  const path = join(cwd, rel);
  if (!existsSync(path)) {
    // Exit 2, never 1: "the document is missing" is not "the entry is absent", and a
    // script branching on 1 would read a broken checkout as a shipped entry.
    process.stderr.write(`has-block: ${rel} not found\n`);
    process.exit(2);
  }
  const roadmapPath = join(cwd, 'docs/roadmap.md');
  const backlogPath = join(cwd, 'docs/backlog.md');
  const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  const raw = readFileSync(path, 'utf8');
  const { present, slug } = hasBlock(
    ref,
    raw,
    {
      roadmapRaw: read(roadmapPath),
      backlogRaw: read(backlogPath),
      featuresDir: join(cwd, 'docs/features'),
    },
    backlog,
  );
  if (!quiet) {
    const named = slug === ref ? slug : `${ref} → ${slug}`;
    process.stdout.write(`has-block: ${named} ${present ? 'present in' : 'absent from'} ${rel}\n`);
  }
  process.exit(present ? 0 : 1);
}

const invokedDirect = /[\\/]has-block-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
