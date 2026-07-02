import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import matter from 'gray-matter';

import { LOST_SENTINEL } from '../features/feature-schema.js';

const START_MARKER = '<!-- generated: resources -->';
const END_MARKER = '<!-- /generated: resources -->';

/**
 * Compute the rewrite target for a FD `links.spec` path when the source has
 * been moved to its sibling `archive/` directory (the convention `/garden`
 * uses via `git mv <path> <dirname>/archive/<basename>`). Returns `null`
 * when no rewrite is appropriate — either because the current path still
 * exists, the input is empty, or no archive variant exists either.
 *
 * @param currentPath - Current `links.spec` value from the FD frontmatter.
 * @param exists - Predicate that returns `true` when a path exists on disk.
 *   Injected so the helper stays pure for unit testing.
 * @returns Archive path to write into the FD, or `null` when no change.
 */
export function resolveSpecPath(
  currentPath: string | undefined,
  exists: (p: string) => boolean,
): string | null {
  if (!currentPath || currentPath.length === 0) return null;
  if (exists(currentPath)) return null;
  const archivePath = join(dirname(currentPath), 'archive', basename(currentPath));
  if (!exists(archivePath)) return null;
  return archivePath;
}

/**
 * Frontmatter shape this script reads. Tolerates extra fields and missing
 * link arrays (treats missing as empty).
 */
interface FdFrontmatter {
  links?: {
    code?: string[];
    commits?: string[];
    docs?: string[];
    plan?: string | string[];
    spec?: string;
    tests?: string[];
  };
}

/**
 * Build the body of the auto-generated `## Resources` section from the FD
 * frontmatter's `links.*` entries. Returns a markdown block bounded by
 * sentinel comments so the next sync run can replace it cleanly.
 *
 * @param fm - Parsed FD frontmatter
 * @returns Markdown block including the start/end markers, or an empty
 *   string when the FD has no link entries to render.
 */
export function buildResourcesBlock(fm: FdFrontmatter): string {
  const links = fm.links ?? {};
  const lines: string[] = [];

  if (links.spec === LOST_SENTINEL) {
    // Charuy-era artifact that never migrated (see migrate-link-rot) — plain
    // text, not a link to a file that exists nowhere.
    lines.push(`- **Spec:** _${LOST_SENTINEL}_`);
  } else if (links.spec && links.spec.trim().length > 0) {
    lines.push(`- **Spec:** [\`${links.spec}\`](../../${links.spec})`);
  }

  const plan = links.plan;
  if (typeof plan === 'string' && plan.trim().length > 0) {
    appendList(lines, 'Plan', [plan], true);
  } else if (Array.isArray(plan) && plan.length > 0) {
    appendList(lines, 'Plan', plan, true);
  }

  appendList(lines, 'Code', links.code, true);
  appendList(lines, 'Tests', links.tests, true);
  appendList(lines, 'Docs', links.docs, true);

  if (lines.length === 0) return '';

  return [START_MARKER, '', '## Resources', '', ...lines, '', END_MARKER].join('\n');
}

function appendList(
  out: string[],
  label: string,
  entries: string[] | undefined,
  pathLink: boolean,
): void {
  if (!entries || entries.length === 0) return;
  if (entries.length === 1 && entries[0] === 'n/a') {
    out.push(`- **${label}:** _n/a (opt-out)_`);
    return;
  }
  out.push(`- **${label}:**`);
  for (const e of entries) {
    if (e === LOST_SENTINEL) {
      out.push(`  - _${LOST_SENTINEL}_`);
    } else if (pathLink && !e.startsWith('http')) {
      out.push(`  - [\`${e}\`](../../${e})`);
    } else {
      out.push(`  - ${e}`);
    }
  }
}

/**
 * Insert or replace the generated Resources block in `body`. The block is
 * appended at the end (separated by a blank line) on first sync; on
 * subsequent runs the existing block is replaced in-place.
 *
 * @param body - The FD body (post-frontmatter markdown)
 * @param block - Output of {@link buildResourcesBlock}; pass empty string
 *   to remove an existing block (FD lost all links).
 * @returns New body with the generated section synced.
 */
export function applyBlock(body: string, block: string): string {
  const startIdx = body.indexOf(START_MARKER);
  const endIdx = body.indexOf(END_MARKER);
  const trimmed = body.replace(/\s+$/, '');

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = body.slice(0, startIdx).replace(/\s+$/, '');
    const after = body.slice(endIdx + END_MARKER.length).replace(/^\s+/, '');
    if (block.length === 0) {
      return [before, after].filter(Boolean).join('\n\n').concat('\n');
    }
    return [before, block, after].filter(Boolean).join('\n\n').concat('\n');
  }

  if (block.length === 0) return body;
  return `${trimmed}\n\n${block}\n`;
}

export async function syncFile(path: string): Promise<boolean> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const fm = parsed.data as FdFrontmatter;

  // gray-matter caches its parsed `data` object by raw input. Two FDs (or two
  // syncFile passes) with identical frontmatter would share the same reference,
  // so any in-place mutation here leaks across calls. Shallow-copy before
  // touching anything we plan to change.
  const data: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
  let frontmatterChanged = false;
  if (fm.links !== undefined) {
    const rewritten = resolveSpecPath(fm.links.spec, existsSync);
    if (rewritten !== null) {
      data.links = { ...fm.links, spec: rewritten };
      frontmatterChanged = true;
    }
  }

  const block = buildResourcesBlock(data as FdFrontmatter);
  const nextBody = applyBlock(parsed.content, block);
  if (!frontmatterChanged && nextBody === parsed.content) return false;
  // oxfmt wants a blank line after the frontmatter close and exactly one
  // trailing newline. `matter.stringify` concatenates `---\n${yaml}---\n` with
  // the body verbatim, so we prepend `\n` to force the separator and collapse
  // any trailing-newline accumulation back to a single `\n`.
  const body = `\n${nextBody.replace(/^\n+/, '')}`;
  const out = matter.stringify(body, data).replace(/\n+$/, '\n');
  await writeFile(path, out, 'utf8');
  return true;
}

async function main(): Promise<void> {
  const dir = 'docs/features';
  const entries = await readdir(dir, { withFileTypes: true });
  let updated = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (await syncFile(join(dir, entry.name))) updated += 1;
  }
  console.log(`Synced ${entries.length} feature MD(s), updated ${updated}.`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-fd-resources');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
