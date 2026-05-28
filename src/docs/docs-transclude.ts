import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const MARKER_RE = /<!--\s*example:start\s+([\w-]+)\s*-->[\s\S]*?<!--\s*example:end\s*-->/g;

/**
 * Replace each `<!-- example:start NAME -->` … `<!-- example:end -->` block
 * in `tutorial` with a fenced code block containing the matching example
 * source. Idempotent — running twice produces the same output.
 *
 * @param tutorial - Tutorial Markdown contents
 * @param sources - Map from example name to its TypeScript source
 * @returns The rewritten tutorial body
 * @throws If a marker references an example name that's not in `sources`
 */
export function transcludeMarkers(tutorial: string, sources: Map<string, string>): string {
  return tutorial.replace(MARKER_RE, (_match, name: string) => {
    const source = sources.get(name);
    if (source === undefined) {
      throw new Error(`Tutorial references missing example: ${name}`);
    }
    const body = source.replace(/\s+$/, '');
    return [
      `<!-- example:start ${name} -->`,
      '',
      '```typescript',
      body,
      '```',
      '',
      '<!-- example:end -->',
    ].join('\n');
  });
}

async function loadExamples(): Promise<Map<string, string>> {
  const dir = 'packages/examples/src';
  const map = new Map<string, string>();
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue;
      }
      if (entry.name === 'index.ts') {
        continue;
      }
      const name = entry.name.replace(/\.ts$/, '');
      const content = await readFile(join(dir, entry.name), 'utf8');
      map.set(name, content);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return map;
}

async function processTutorialDir(dir: string, sources: Map<string, string>): Promise<number> {
  let changed = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }
      const path = join(dir, entry.name);
      const raw = await readFile(path, 'utf8');
      if (!raw.includes('<!-- example:start')) {
        continue;
      }
      const next = transcludeMarkers(raw, sources);
      if (next !== raw) {
        await writeFile(path, next, 'utf8');
        changed += 1;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return changed;
}

async function main(): Promise<void> {
  const sources = await loadExamples();
  const changed = await processTutorialDir('docs/user/tutorials', sources);
  console.log(`Transcluded examples in ${changed} tutorial file(s).`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('docs-transclude');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
