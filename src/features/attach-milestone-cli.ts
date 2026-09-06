import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

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
const read = (rel: string): string => {
  const p = join(cwd, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

const entry = [
  ...parseRoadmap(read('docs/roadmap.md')),
  ...parseBacklog(read('docs/backlog.md')),
].find((e) => e.slug === entrySlug);
if (!entry) {
  console.error(`entry "${entrySlug}" not found in docs/roadmap.md or docs/backlog.md`);
  process.exit(2);
}

const parentPath = join(cwd, 'docs/features', `${parentSlug}.md`);
if (!existsSync(parentPath)) {
  console.error(`parent FD "${parentSlug}" not found at docs/features/${parentSlug}.md`);
  process.exit(2);
}
const parentMilestone = (matter(readFileSync(parentPath, 'utf8')).data as { milestone?: unknown })
  .milestone;

const verdict = resolveAttachMilestone(
  entry.milestone,
  typeof parentMilestone === 'string' ? parentMilestone : undefined,
);

process.stdout.write(
  `${verdict} — entry: ${entry.milestone ?? '(none)'}, parent: ${
    typeof parentMilestone === 'string' ? parentMilestone : '(none)'
  }\n`,
);
if (verdict === 'adopt') {
  process.stdout.write(
    `write "milestone: ${entry.milestone}" onto docs/features/${parentSlug}.md\n`,
  );
}
process.exit(verdict === 'conflict' ? 1 : 0);
