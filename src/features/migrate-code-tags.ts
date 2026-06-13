// @fd: dynamic-fd-file-pointers-via-frontmatter

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { loadSddFeatures } from '../garden/sdd-report.js';

// Trailing match is horizontal whitespace only ([^\S\n]) so the replace path
// can't swallow the newline(s) that follow the tag line.
const TAG_RE = /^\/\/\s*@fd:\s*(.+?)[^\S\n]*$/m;
const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;

/**
 * Insert (or merge into) a `// @fd:` tag for `slug` at the top of `content`.
 * Idempotent: a no-op when the slug is already named; merges into an existing
 * `// @fd:` line for a co-owned file; inserts after a leading shebang.
 *
 * @param content - Raw source file text
 * @param slug - FD slug to declare
 * @returns The content with the tag present
 */
export function insertFdTag(content: string, slug: string): string {
  const existing = content.match(TAG_RE);
  if (existing) {
    const slugs = existing[1].split(',').map((s) => s.trim());
    if (slugs.includes(slug)) return content;
    return content.replace(TAG_RE, `// @fd: ${[...slugs, slug].join(', ')}`);
  }
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n');
    return `${content.slice(0, nl + 1)}// @fd: ${slug}\n${content.slice(nl + 1)}`;
  }
  return `// @fd: ${slug}\n\n${content}`;
}

async function main(): Promise<void> {
  const features = await loadSddFeatures('docs/features');
  let tagged = 0;
  const skippedDirs: string[] = [];
  for (const f of features) {
    for (const p of f.frontmatter.links.code) {
      if (!CODE_FILE_RE.test(p)) {
        skippedDirs.push(`${f.slug}: ${p}`);
        continue;
      }
      if (!existsSync(p)) {
        console.warn(`WARN: ${f.slug} links.code references missing file ${p}`);
        continue;
      }
      const before = readFileSync(p, 'utf8');
      const next = insertFdTag(before, f.slug);
      if (next !== before) {
        writeFileSync(p, next, 'utf8');
        tagged += 1;
      }
    }
  }
  console.log(`Seeded // @fd: tags into ${tagged} file(s).`);
  if (skippedDirs.length > 0) {
    console.log(`\nDirectory entries left manual (cannot carry a tag):`);
    for (const d of skippedDirs) console.log(`  - ${d}`);
  }
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('migrate-code-tags');
if (invokedDirect) {
  void main();
}
