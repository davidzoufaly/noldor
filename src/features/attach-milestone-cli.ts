import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { readFileNoFollow, resolveErrorMessage, resolveSlugPath } from '../core/slug-paths.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { resolveAttachMilestone } from './attach-milestone.js';

function usage(): never {
  console.error(`Usage: noldor features attach-milestone <entry-slug> <parent-slug>

Decide what an attach does with the entry's milestone. Exits 0 for noop/adopt
and 1 for conflict, so /noldor-promote's attach branch can branch on it.`);
  process.exit(2);
}

const [entrySlug, parentSlug] = process.argv.slice(2);
if (!entrySlug || !parentSlug) usage();

const cwd = process.cwd();

/** Read a queue file, distinguishing "absent" from "unreadable". */
function readQueue(rel: string): string {
  const p = join(cwd, rel);
  // An absent queue file is normal — a repo may carry only one. Anything else
  // (a permissions error, a directory where a file belongs) is a real failure
  // and must not read as "no entries", which would silently answer `noop`.
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

const entry = [
  ...parseRoadmap(readQueue('docs/roadmap.md')),
  ...parseBacklog(readQueue('docs/backlog.md')),
].find((e) => e.slug === entrySlug);
if (!entry) {
  console.error(`entry "${entrySlug}" not found in docs/roadmap.md or docs/backlog.md`);
  process.exit(2);
}

// Through the repo-wide choke point, never a bare join: `join(cwd,
// 'docs/features', '../vision.md')` escapes to docs/vision.md, and this command
// would then report an adopt instruction against a document that is not an FD.
const parentResolved = resolveSlugPath(cwd, ['docs', 'features'], parentSlug, { suffix: '.md' });
if (!parentResolved.ok) {
  console.error(`parent: ${resolveErrorMessage(parentResolved.error)}`);
  process.exit(2);
}
if (!existsSync(parentResolved.path)) {
  console.error(`parent FD "${parentSlug}" not found at docs/features/${parentSlug}.md`);
  process.exit(2);
}

const rawParentMilestone = (
  matter(readFileNoFollow(parentResolved.path)).data as { milestone?: unknown }
).milestone;

// A present-but-not-a-string `milestone:` (YAML `milestone: 123`, a list, a map)
// must not degrade to `undefined`: that reads as "the parent declares none" and
// answers `adopt`, authorizing a write over a value that is really there. The
// parent's frontmatter is malformed — say so and refuse to rule.
if (rawParentMilestone !== undefined && typeof rawParentMilestone !== 'string') {
  console.error(
    `parent FD "${parentSlug}" has a non-string milestone: ${JSON.stringify(rawParentMilestone)} — fix its frontmatter first`,
  );
  process.exit(2);
}

const verdict = resolveAttachMilestone(entry.milestone, rawParentMilestone);

process.stdout.write(
  `${verdict} — entry: ${entry.milestone ?? '(none)'}, parent: ${rawParentMilestone ?? '(none)'}\n`,
);
if (verdict === 'adopt') {
  process.stdout.write(
    `write "milestone: ${entry.milestone}" onto docs/features/${parentSlug}.md\n`,
  );
}
process.exit(verdict === 'conflict' ? 1 : 0);
