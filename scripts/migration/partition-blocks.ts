/**
 * Split a roadmap.md / backlog.md body into framework + product fragments.
 *
 * Two doc layouts supported:
 *
 * - **Roadmap layout:** H3 (`### Category`) groups H4 (`#### Entry`) children.
 *   H4 slug matched against `frameworkSlugs`; H3 carries to whichever side at
 *   least one child landed (emitted once, in original order).
 * - **Backlog layout:** H3 (`### Entry`) is the entry itself; no H4 nesting.
 *   H3 slug matched against `frameworkSlugs`; emitted as a top-level block.
 *
 * Slug matching: titles are human-readable; classification uses kebab-case
 * slugs. Titles are slugified before lookup (mirrors `utils/slugify.ts`).
 *
 * Preamble (everything before first H3/H4) stays with the product side.
 *
 * @param body - Raw file contents
 * @param frameworkSlugs - Kebab-case slugs to extract into the framework fragment
 * @returns `{ framework, product }`. Caller adds the H1 header when writing
 *          the framework fragment to `packages/noldor/docs/`.
 */
export function partitionBlocks(
  body: string,
  frameworkSlugs: ReadonlySet<string>,
): { framework: string; product: string } {
  const lines = body.split('\n');

  // Locate end of preamble — first H3 or H4 line.
  let preambleEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('### ') || lines[i].startsWith('#### ')) {
      preambleEnd = i;
      break;
    }
  }
  const preamble = lines.slice(0, preambleEnd).join('\n');

  type H4Entry = {
    type: 'h4';
    parentH3: string | null;
    slug: string;
    chunk: string;
  };
  type H3Entry = { type: 'h3'; slug: string; chunk: string };
  type Block = H4Entry | H3Entry;

  const blocks: Block[] = [];

  let currentH3Line: string | null = null;
  let currentH3HasH4 = false;
  let currentH3Buf: string[] = [];
  let bufH4Slug: string | null = null;
  let bufH4Lines: string[] = [];

  function flushH4(): void {
    if (bufH4Slug !== null) {
      blocks.push({
        type: 'h4',
        parentH3: currentH3Line,
        slug: bufH4Slug,
        chunk: bufH4Lines.join('\n'),
      });
      currentH3HasH4 = true;
    }
    bufH4Slug = null;
    bufH4Lines = [];
  }

  function flushH3(): void {
    flushH4();
    if (currentH3Line !== null && !currentH3HasH4) {
      blocks.push({
        type: 'h3',
        slug: slugify(currentH3Line.replace(/^### /, '')),
        chunk: currentH3Buf.join('\n'),
      });
    }
    currentH3Line = null;
    currentH3HasH4 = false;
    currentH3Buf = [];
  }

  for (let i = preambleEnd; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('### ') && !line.startsWith('#### ')) {
      flushH3();
      currentH3Line = line;
      currentH3Buf = [line];
    } else if (line.startsWith('#### ')) {
      flushH4();
      bufH4Slug = slugify(line.replace(/^#### /, ''));
      bufH4Lines = [line];
    } else {
      if (bufH4Slug !== null) {
        bufH4Lines.push(line);
      }
      if (currentH3Line !== null) {
        currentH3Buf.push(line);
      }
    }
  }
  flushH3();

  const frameworkParts: string[] = [];
  const productParts: string[] = [preamble];
  const fwH3Emitted = new Set<string>();
  const prodH3Emitted = new Set<string>();

  for (const block of blocks) {
    if (block.type === 'h4') {
      const isFw = frameworkSlugs.has(block.slug);
      const target = isFw ? frameworkParts : productParts;
      const emitted = isFw ? fwH3Emitted : prodH3Emitted;
      if (block.parentH3 !== null && !emitted.has(block.parentH3)) {
        target.push(block.parentH3);
        target.push('');
        emitted.add(block.parentH3);
      }
      target.push(block.chunk);
    } else {
      const isFw = frameworkSlugs.has(block.slug);
      const target = isFw ? frameworkParts : productParts;
      target.push(block.chunk);
    }
  }

  const framework = frameworkParts.join('\n').trim();
  const product = productParts.join('\n').trim() + '\n';

  return { framework, product };
}

/**
 * Slugify (local copy — avoids cross-package import from a script).
 * Mirrors `packages/noldor/src/utils/slugify.ts`.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
