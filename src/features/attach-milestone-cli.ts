import { existsSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { readQueueFile } from '../core/doc-roots.js';
import { readFileNoFollow, resolveErrorMessage, resolveSlugPath } from '../core/slug-paths.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { resolveAttachMilestone } from './attach-milestone.js';

function usage(): never {
  console.error(`Usage: noldor features attach-milestone <entry-slug> <parent-slug>

Decide what an attach does with the entry's milestone. Exit 0 = noop or adopt,
1 = conflict, 2 = could not rule (bad input, unreadable file, malformed
frontmatter), so /noldor-promote's attach branch can branch on the code.`);
  process.exit(2);
}

/**
 * Compute the verdict, or explain why it cannot be computed.
 *
 * Every failure funnels through the `ok: false` branch rather than throwing,
 * because an escaping throw exits **1** — the code this command defines as
 * `conflict`. The skill stops the promotion and tells the operator the entry and
 * its parent name different milestones, so a corrupt FD or an unreadable queue
 * file would be reported as a stated disagreement that does not exist.
 * `src/triage/has-block-cli.ts` guards the same collision the same way.
 */
async function computeVerdict(
  entrySlug: string,
  parentSlug: string,
  cwd: string,
): Promise<
  { ok: true; verdict: string; line: string; adopt?: string } | { ok: false; why: string }
> {
  const entry = [
    ...parseRoadmap(await readQueueFile(join(cwd, 'docs/roadmap.md'))),
    ...parseBacklog(await readQueueFile(join(cwd, 'docs/backlog.md'))),
  ].find((e) => e.slug === entrySlug);
  if (!entry) {
    return {
      ok: false,
      why: `entry "${entrySlug}" not found in docs/roadmap.md or docs/backlog.md`,
    };
  }

  // Through the repo-wide choke point, never a bare join: `join(cwd,
  // 'docs/features', '../vision.md')` escapes to docs/vision.md, and this
  // command would then rule on a document that is not an FD.
  const parent = resolveSlugPath(cwd, ['docs', 'features'], parentSlug, { suffix: '.md' });
  if (!parent.ok) return { ok: false, why: `parent: ${resolveErrorMessage(parent.error)}` };
  if (!existsSync(parent.path)) {
    return {
      ok: false,
      why: `parent FD "${parentSlug}" not found at docs/features/${parentSlug}.md`,
    };
  }

  const raw = (matter(readFileNoFollow(parent.path)).data as { milestone?: unknown }).milestone;
  // A present-but-not-a-string `milestone:` must not degrade to `undefined`:
  // that reads as "the parent declares none" and answers `adopt`, authorizing a
  // write over a value that is really there.
  if (raw !== undefined && typeof raw !== 'string') {
    return {
      ok: false,
      why: `parent FD "${parentSlug}" has a non-string milestone: ${JSON.stringify(raw)} — fix its frontmatter first`,
    };
  }

  const verdict = resolveAttachMilestone(entry.milestone, raw);
  return {
    ok: true,
    verdict,
    line: `${verdict} — entry: ${entry.milestone ?? '(none)'}, parent: ${raw ?? '(none)'}`,
    ...(verdict === 'adopt'
      ? { adopt: `write "milestone: ${entry.milestone}" onto docs/features/${parentSlug}.md` }
      : {}),
  };
}

const [entrySlug, parentSlug] = process.argv.slice(2);
if (!entrySlug || !parentSlug) usage();

let result: Awaited<ReturnType<typeof computeVerdict>>;
try {
  result = await computeVerdict(entrySlug, parentSlug, process.cwd());
} catch (err) {
  // Same reasoning as the `ok: false` branch: an IO or YAML fault must not reach
  // the operator wearing the `conflict` exit code.
  console.error(`attach-milestone: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

if (!result.ok) {
  console.error(result.why);
  process.exit(2);
}

process.stdout.write(`${result.line}\n`);
if (result.adopt) process.stdout.write(`${result.adopt}\n`);
process.exit(result.verdict === 'conflict' ? 1 : 0);
