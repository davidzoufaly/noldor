import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const HEADER = '<!-- generated: do-not-edit -->\n';

/**
 * Prepend a do-not-edit marker to a generated MD file. Idempotent — running
 * twice does not double the header.
 *
 * @param content - Raw MD content to annotate
 * @returns The annotated content
 */
export function addGeneratedHeader(content: string): string {
  if (content.startsWith(HEADER)) {
    return content;
  }
  return `${HEADER}${content}`;
}

async function walkMd(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMd(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}

async function annotateAll(dir: string): Promise<number> {
  const files: string[] = [];
  await walkMd(dir, files);
  let touched = 0;
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const out = addGeneratedHeader(raw);
    if (out !== raw) {
      await writeFile(file, out, 'utf8');
      touched += 1;
    }
  }
  return touched;
}

async function main(): Promise<void> {
  console.log('→ typedoc');
  await execFileP('pnpm', ['exec', 'typedoc']);
  const apiDir = 'docs/user/reference/api';
  const annotated = await annotateAll(apiDir);
  console.log(`Annotated ${annotated} generated file(s) under ${apiDir}.`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('docs-api');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
