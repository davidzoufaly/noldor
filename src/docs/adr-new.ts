// @fd: architecture-decision-record-surface
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFile } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import {
  ADR_FILENAME_RE,
  nextAdrNumber,
  parseAdrFrontmatter,
  renderAdrTemplate,
} from './adr-schema.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AdrNewResult =
  | { success: true; file: string; supersededFile?: string }
  | { success: false; errors: string[] };

/**
 * Create the next decision record: mints max+1, writes the template with
 * `status: accepted` and today's date. With `supersedes`, additionally flips
 * the target record to `status: superseded` and stamps the pointers in both
 * directions — so the one-commit supersede discipline the validator enforces
 * (a lone flip reds the folder) costs one command.
 *
 * The target rewrite touches only the frontmatter block, never the body, so
 * it stays inside the pre-push check's allowed-mutation set by construction.
 *
 * @param opts.date - Injected so tests never read the clock
 */
export async function createAdr(opts: {
  cwd: string;
  slug: string;
  date: string;
  supersedes?: string;
}): Promise<AdrNewResult> {
  if (!SLUG_RE.test(opts.slug)) {
    return { success: false, errors: [`slug must be kebab-case, got: ${opts.slug}`] };
  }
  const dir = loadDocRoots(opts.cwd).adr;

  let existing: string[] = [];
  try {
    existing = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { success: false, errors: [`cannot read ${dir}: ${(err as Error).message}`] };
    }
  }

  let supersededRewrite: { path: string; content: string } | undefined;
  if (opts.supersedes !== undefined) {
    const targetName = existing.find((name) => {
      const m = ADR_FILENAME_RE.exec(name);
      return m !== null && m[1] === opts.supersedes;
    });
    if (targetName === undefined) {
      return { success: false, errors: [`no record numbered ${opts.supersedes} to supersede`] };
    }
    const targetPath = join(dir, targetName);
    let raw: string;
    try {
      raw = await readFile(targetPath, 'utf8');
    } catch (err) {
      return { success: false, errors: [`cannot read ${targetPath}: ${(err as Error).message}`] };
    }
    const parsed = parseAdrFrontmatter(raw);
    if (!parsed.success) {
      return { success: false, errors: [`${targetName}: ${parsed.errors.join('; ')}`] };
    }
    if (parsed.data.status !== 'accepted') {
      return { success: false, errors: [`${targetName} is already superseded`] };
    }
    supersededRewrite = { path: targetPath, content: raw };
  }

  const number = nextAdrNumber(existing);
  const filename = `${number}-${opts.slug}.md`;
  if (existing.includes(filename)) {
    return { success: false, errors: [`${filename} already exists`] };
  }

  await mkdir(dir, { recursive: true });

  if (supersededRewrite !== undefined && opts.supersedes !== undefined) {
    // Text-level frontmatter edit, not a gray-matter re-serialize: rewriting
    // the whole file would reflow the body, which the append-only pre-push
    // check rightly reads as a body change.
    const flipped = flipToSuperseded(supersededRewrite.content, number);
    if (!flipped.success) {
      return { success: false, errors: [flipped.error] };
    }
    await atomicWriteFile(supersededRewrite.path, flipped.content);
  }

  const file = join(dir, filename);
  await atomicWriteFile(
    file,
    renderAdrTemplate({ slug: opts.slug, date: opts.date, supersedes: opts.supersedes }),
  );
  return {
    success: true,
    file,
    ...(supersededRewrite === undefined ? {} : { supersededFile: supersededRewrite.path }),
  };
}

/**
 * Flip `status: accepted` to `superseded` and append the `superseded-by`
 * pointer, editing only lines inside the leading `---` frontmatter block.
 */
function flipToSuperseded(
  raw: string,
  successor: string,
): { success: true; content: string } | { success: false; error: string } {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { success: false, error: 'target record has no leading frontmatter block' };
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (close === -1) {
    return { success: false, error: 'target record frontmatter block never closes' };
  }
  const statusIdx = lines.findIndex(
    (line, i) => i > 0 && i < close && /^status:\s*accepted\s*$/.test(line.trim()),
  );
  if (statusIdx === -1) {
    return { success: false, error: 'target record has no `status: accepted` line to flip' };
  }
  const out = [...lines];
  out[statusIdx] = 'status: superseded';
  out.splice(close, 0, `superseded-by: '${successor}'`);
  return { success: true, content: out.join('\n') };
}

/** `noldor adr new <slug> [--supersedes NNNN]` — dispatched with args after `new`. */
async function main(args: string[]): Promise<number> {
  const supersedesIdx = args.indexOf('--supersedes');
  const supersedes = supersedesIdx === -1 ? undefined : args[supersedesIdx + 1];
  const slug = args.find(
    (a, i) => !a.startsWith('--') && (supersedesIdx === -1 || i !== supersedesIdx + 1),
  );
  if (!slug || (supersedesIdx !== -1 && !supersedes)) {
    console.error('usage: noldor adr new <slug> [--supersedes NNNN]');
    return 1;
  }
  const result = await createAdr({
    cwd: process.cwd(),
    slug,
    date: new Date().toISOString().slice(0, 10),
    ...(supersedes === undefined ? {} : { supersedes }),
  });
  if (!result.success) {
    for (const error of result.errors) console.error(error);
    return 1;
  }
  console.log(`created ${result.file}`);
  if (result.supersededFile !== undefined) {
    console.log(`superseded ${result.supersededFile}`);
  }
  return 0;
}

runIfDirect('adr-new', 'adr-new', main);
