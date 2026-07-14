import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const INLINE_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;
const EXTERNAL_RE = /^(https?:|mailto:|#)/;
const ROOT_ABSOLUTE_RE = /^\//;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', 'design']);

/**
 * One internal link extracted from a markdown body.
 */
export interface ExtractedLink {
  href: string;
  line: number;
}

/**
 * Per-file link-check result.
 */
export interface FileError {
  file: string;
  issues: string[];
}

/**
 * Strip fenced code blocks and inline code spans before link extraction.
 * Code spans render as literal text — link syntax inside them is not a link.
 * Replaces stripped regions with same-length whitespace so line numbers stay aligned.
 *
 * @param content - Raw MD body
 * @returns Body with code regions blanked
 */
export function stripCodeRegions(content: string): string {
  let out = content.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
  return out;
}

/**
 * Extract inline markdown links and skip external URLs, bare anchors,
 * root-absolute paths (dashboard routes like `/features/<slug>`), and
 * any link inside a code span or fenced block.
 *
 * @param content - Raw MD body
 * @returns Each internal link with its 1-based line number
 */
export function extractLinks(content: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const lines = stripCodeRegions(content).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const re = new RegExp(INLINE_LINK_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const href = match[1] ?? '';
      if (EXTERNAL_RE.test(href)) {
        continue;
      }
      if (ROOT_ABSOLUTE_RE.test(href)) {
        continue;
      }
      out.push({ href, line: i + 1 });
    }
  }
  return out;
}

/**
 * GitHub-flavored slug for a heading title (lowercase, strip punctuation,
 * replace spaces with dashes).
 *
 * @param title - Raw heading text
 * @returns The GFM-compatible slug
 */
export function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function extractHeadings(content: string): Set<string> {
  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  const re = new RegExp(HEADING_RE.source, 'gm');
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const baseSlug = slugifyHeading(match[2] ?? '');
    const count = counts.get(baseSlug) ?? 0;
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    slugs.add(slug);
    counts.set(baseSlug, count + 1);
  }
  return slugs;
}

/**
 * Validate that every internal link in the given MD files resolves to an
 * existing file (and, when present, an existing heading anchor).
 *
 * @param paths - Markdown file paths to check
 * @returns One FileError per file with broken links
 */
export async function checkLinks(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];

  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    const links = extractLinks(raw);
    const issues: string[] = [];
    const baseDir = dirname(path);

    for (const link of links) {
      const [hrefPath = '', anchor] = link.href.split('#');
      const targetPath = resolve(baseDir, hrefPath);

      let targetContent: string | null = null;
      try {
        targetContent = await readFile(targetPath, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          issues.push(`line ${link.line}: missing file ${hrefPath}`);
          continue;
        }
        if (code === 'EISDIR') {
          // Directory link (e.g. docs/features/) — exists, no anchor check.
          continue;
        }
        throw error;
      }

      if (anchor) {
        const headings = extractHeadings(targetContent);
        if (!headings.has(anchor)) {
          issues.push(`line ${link.line}: missing anchor #${anchor} in ${hrefPath}`);
        }
      }
    }

    if (issues.length > 0) {
      errors.push({ file: path, issues });
    }
  }

  return errors;
}

async function walkMd(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      continue;
    }
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMd(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const paths: string[] = [];
  await walkMd('docs', paths);
  if (await fileExists('README.md')) {
    paths.push('README.md');
  }
  if (await fileExists('CHANGELOG.md')) {
    paths.push('CHANGELOG.md');
  }

  const errors = await checkLinks(paths);
  if (errors.length === 0) {
    console.log(`Checked ${paths.length} MD file(s) — all internal links resolve.`);
    return;
  }
  for (const err of errors) {
    console.error(`\n${err.file}`);
    for (const issue of err.issues) {
      console.error(`  - ${issue}`);
    }
  }
  console.error(`\n${errors.length} file(s) with broken internal links.`);
  process.exitCode = 1;
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('docs-check');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
