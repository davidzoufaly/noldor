// scripts/features/migrate-changelog-unreleased.ts
// @tests: dynamic-fd-changelog

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

const CHANGELOG_HEADING = '## Changelog';
const COMMITS_SUBHEADING = '#### Commits';
const SUBHEADING_RE = /^#### /m;

/** Outcome of a migration pass on a single FD body. */
export type MigrateAction = 'promoted' | 'stripped' | 'clash' | 'noop';

/** Result of {@link migrateChangelogContent}. */
export interface MigrateResult {
  newBody: string;
  action: MigrateAction;
  warnings: string[];
}

/**
 * Migrate one FD body's `## Changelog` section to the dynamic-FD-changelog
 * policy:
 *
 * - Drop any `#### Commits` subsections inside any `### <version>` block
 *   (commits render live on the dashboard now).
 * - When a `### Unreleased` block exists:
 *   - If `frontmatter.updated` is set and no clashing `### <updated>` block
 *     already exists, rename `### Unreleased` → `### <updated>` (preserves
 *     operator-staged Summary as the next-release Summary).
 *   - If `frontmatter.updated` is set but a `### <updated>` block already
 *     exists, leave both untouched and emit a warning — operator decides.
 *   - If `frontmatter.updated` is not set, drop the `### Unreleased` block
 *     entirely (auto-polish will populate the next release's Summary).
 *
 * Idempotent: a second run on a migrated body produces the same body and
 * `action: 'noop'`.
 *
 * @param body - FD body markdown (frontmatter already stripped)
 * @param frontmatter - parsed frontmatter (only `updated` is consulted)
 * @returns Migrated body + action taken + any warnings
 */
export function migrateChangelogContent(
  body: string,
  frontmatter: { updated?: string },
): MigrateResult {
  const warnings: string[] = [];
  const headingMatch = body.match(/^## Changelog\b/m);
  if (!headingMatch || headingMatch.index === undefined) {
    return { newBody: body, action: 'noop', warnings };
  }

  const headingEnd = headingMatch.index + CHANGELOG_HEADING.length;
  const head = body.slice(0, headingEnd);
  const sectionRaw = body.slice(headingEnd);

  // Defensive: stop the section at the next `## ` heading if any.
  const nextH2 = sectionRaw.match(/^## /m);
  const sectionEnd = nextH2 && nextH2.index !== undefined ? nextH2.index : sectionRaw.length;
  const section = sectionRaw.slice(0, sectionEnd);
  const tail = sectionRaw.slice(sectionEnd);

  const { blocks, preface } = parseChangelogSection(section);
  const strippedBlocks = blocks.map((b) => ({
    heading: b.heading,
    content: stripCommitsSubsection(b.content),
  }));
  const commitsStripped = strippedBlocks.some((b, i) => b.content !== blocks[i].content);

  const unreleasedIdx = strippedBlocks.findIndex((b) => b.heading === 'Unreleased');
  let action: MigrateAction = commitsStripped ? 'stripped' : 'noop';

  if (unreleasedIdx !== -1) {
    const updated = frontmatter.updated;
    if (updated !== undefined && updated !== '') {
      const clashIdx = strippedBlocks.findIndex(
        (b, i) => i !== unreleasedIdx && b.heading === updated,
      );
      if (clashIdx !== -1) {
        warnings.push(
          `Both ### Unreleased and ### ${updated} exist — operator must reconcile manually.`,
        );
        action = 'clash';
      } else {
        strippedBlocks[unreleasedIdx].heading = updated;
        action = 'promoted';
      }
    } else {
      strippedBlocks.splice(unreleasedIdx, 1);
      action = 'stripped';
    }
  }

  const newSection = renderSection(strippedBlocks, preface);
  const newBody = head + newSection + tail;
  return { newBody, action, warnings };
}

interface VersionBlock {
  heading: string; // e.g. "Unreleased" or "0.3.0" — heading text after `### `
  content: string; // text after the heading line, up to next `### ` or end
}

function parseChangelogSection(section: string): { preface: string; blocks: VersionBlock[] } {
  // Section starts immediately after "## Changelog". Strip leading newlines.
  const trimmedHead = section.replace(/^\n+/, '');
  // Split by `^### ` boundaries (lookahead so the heading stays with its block).
  const parts = trimmedHead.split(/(?=^### )/m);
  const blocks: VersionBlock[] = [];
  let preface = '';
  for (const part of parts) {
    const m = /^### (.+?)\s*$/m.exec(part);
    if (!m) {
      preface += part;
      continue;
    }
    const heading = m[1].trim();
    const lineEnd = part.indexOf('\n');
    const rawContent = lineEnd === -1 ? '' : part.slice(lineEnd + 1);
    const content = rawContent.replace(/^\n+/, '');
    blocks.push({ heading, content });
  }
  return { preface, blocks };
}

function stripCommitsSubsection(content: string): string {
  const idx = content.indexOf(COMMITS_SUBHEADING);
  if (idx === -1) return content;
  // Anchor: line must start with `#### Commits` to avoid matching prose.
  // indexOf is good enough for current FDs (no inline `#### Commits` prose
  // exists in practice). Verify line-anchored.
  const before = content.slice(0, idx);
  if (before.length > 0 && !before.endsWith('\n')) return content; // not at line start
  // Slice from start of "#### Commits" to next subheading or end of block.
  const after = content.slice(idx + COMMITS_SUBHEADING.length);
  const nextSub = after.match(SUBHEADING_RE);
  const subEnd = nextSub && nextSub.index !== undefined ? nextSub.index : after.length;
  const headTrimmed = before.replace(/\n+$/, '');
  const rest = after.slice(subEnd);
  if (rest.length === 0) return headTrimmed + '\n';
  return headTrimmed + '\n\n' + rest.replace(/^\n+/, '');
}

function renderSection(blocks: VersionBlock[], preface: string): string {
  const trimmedPreface = preface.replace(/^\n+/, '').replace(/\n+$/, '');
  const parts: string[] = [];
  if (trimmedPreface.length > 0) {
    parts.push(trimmedPreface);
  }
  for (const b of blocks) {
    const trimmedContent = b.content.replace(/\n+$/, '');
    parts.push(`### ${b.heading}\n\n${trimmedContent}`.replace(/\n+$/, ''));
  }
  if (parts.length === 0) {
    return '\n';
  }
  return '\n\n' + parts.join('\n\n') + '\n';
}

/** CLI entrypoint result for one FD file. */
interface FileResult {
  path: string;
  slug: string;
  action: MigrateAction;
  warnings: string[];
}

/**
 * Walk every `<featuresDir>/*.md`, run {@link migrateChangelogContent} on
 * each, and either write the result back (apply) or just collect a summary
 * (dry run).
 */
export async function migrateFeaturesDir(
  featuresDir: string,
  options: { dryRun: boolean } = { dryRun: false },
): Promise<FileResult[]> {
  const entries = await readdir(featuresDir, { withFileTypes: true });
  const results: FileResult[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(featuresDir, entry.name);
    const slug = entry.name.replace(/\.md$/, '');
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const fm = parsed.data as { updated?: string };
    const result = migrateChangelogContent(parsed.content, { updated: fm.updated });
    results.push({ path, slug, action: result.action, warnings: result.warnings });
    if (!options.dryRun && result.action !== 'noop') {
      const newContent = matter.stringify(result.newBody.replace(/^\n/, ''), parsed.data);
      await writeFile(path, newContent, 'utf8');
    }
  }
  return results;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const dir = 'docs/features';
  const results = await migrateFeaturesDir(dir, { dryRun });
  for (const r of results) {
    if (r.action === 'noop') continue;
    console.log(`${r.action.padEnd(9)} ${r.path}`);
    for (const w of r.warnings) {
      console.log(`           warning: ${w}`);
    }
  }
  const counts = { promoted: 0, stripped: 0, clash: 0, noop: 0 };
  for (const r of results) counts[r.action] += 1;
  console.log(
    `\n${dryRun ? '[dry run] ' : ''}` +
      `promoted=${counts.promoted} stripped=${counts.stripped} clash=${counts.clash} noop=${counts.noop}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
