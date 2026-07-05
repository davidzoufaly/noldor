import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { loadCategories } from '../core/consumer-config.js';
import { howtoFrontmatterSchema } from './howto-schema.js';

import type { Category } from '../core/feature-schema.js';
import type { HowtoFrontmatter } from './howto-schema.js';

/**
 * One parsed how-to MD ready to render into the index.
 */
export interface Howto {
  /** Filename without `.md`. */
  slug: string;
  /** Validated frontmatter parsed from the how-to MD. */
  frontmatter: HowtoFrontmatter;
  /** First non-empty body paragraph (used as the bullet's one-liner). */
  oneLiner: string;
}

/**
 * Render the `docs/user/how-to/index.md` body from how-to frontmatter.
 *
 * @param howtos - All how-to MDs found under `docs/user/how-to/`
 * @returns The full Markdown body (with `generated` header)
 */
export function renderHowToIndex(howtos: Howto[]): string {
  const lines: string[] = [
    '<!-- generated: do-not-edit -->',
    '# How-to Guides',
    '',
    'Each guide shows how to accomplish one task. Tutorials live in',
    '`../tutorials/`; conceptual background in `../explanation/`; API and format',
    'reference in `../reference/`.',
    '',
  ];

  if (howtos.length === 0) {
    lines.push('_No how-to guides yet._', '');
    return lines.join('\n');
  }

  const byCategory = new Map<Category, Howto[]>();
  for (const h of howtos) {
    const list = byCategory.get(h.frontmatter.category) ?? [];
    list.push(h);
    byCategory.set(h.frontmatter.category, list);
  }

  for (const category of loadCategories()) {
    const items = byCategory.get(category);
    if (!items || items.length === 0) {
      continue;
    }
    items.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
    lines.push(`## ${category}`, '');
    for (const h of items) {
      const suffix = h.oneLiner ? ` — ${h.oneLiner}` : '';
      lines.push(`- [${h.frontmatter.title}](${h.slug}.md)${suffix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function firstParagraph(body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => !p.startsWith('#'))
    .filter((p) => !p.startsWith('<!--'));
  return paragraphs[0] ?? '';
}

async function loadHowtos(dir: string): Promise<Howto[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const howtos: Howto[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    if (entry.name === 'index.md') {
      continue;
    }
    const path = join(dir, entry.name);
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const frontmatter = howtoFrontmatterSchema.parse(parsed.data);
    const slug = entry.name.replace(/\.md$/, '');
    howtos.push({
      frontmatter,
      oneLiner: firstParagraph(parsed.content),
      slug,
    });
  }

  return howtos;
}

async function main(): Promise<void> {
  const outDir = 'docs/user/how-to';
  await mkdir(outDir, { recursive: true });
  const howtos = await loadHowtos(outDir);
  const md = renderHowToIndex(howtos);
  await writeFile(join(outDir, 'index.md'), md, 'utf8');
  console.log(`Wrote ${join(outDir, 'index.md')} (${howtos.length} how-to(s))`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('docs-howto');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
