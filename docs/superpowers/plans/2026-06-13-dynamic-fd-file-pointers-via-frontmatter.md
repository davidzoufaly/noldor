# Dynamic FD ↔ File Pointers via Frontmatter Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make `links.code` scan-derived from a file-side `// @fd: <slug>` tag, symmetric with the existing `// @tests:` / `<!-- @feature: -->` flows, with a migration to seed tags, a drift guard, and a creation-time pointer proposer.
**Architecture:** A new `src/sync/sync-code-links.ts` mirrors `src/sync/sync-test-links.ts`; a garden detector guards cache freshness; a one-off migration seeds tags from existing arrays; a proposer reuses the graph-ownership primitives in `src/garden/graph-fd-lookup.ts`.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `gray-matter`, Zod, Vitest, `pnpm noldor` CLI manifest.

---

## File Structure

- `src/sync/sync-code-links.ts` — `// @fd:` parser, slug→code map, scan+write, `--check` drift mode (mirror of `sync-test-links.ts`)
- `src/sync/__tests__/sync-code-links.test.ts` — unit tests for parser, map builder, check mode
- `src/features/migrate-code-tags.ts` — one-off: seed `// @fd:` tags into files from existing `links.code`
- `src/features/__tests__/migrate-code-tags.test.ts` — migration unit tests
- `src/garden/detectors/code-links-drift.ts` — Gap per FD whose `links.code` diverges from the tag scan
- `src/garden/detectors/__tests__/code-links-drift.test.ts` — detector tests
- `src/features/propose-pointers.ts` — creation-time pointer proposer reusing graph primitives
- `src/features/__tests__/propose-pointers.test.ts` — proposer tests
- `src/cli/manifest.ts` — register `sync code-links`, `features migrate-code-tags`, `features propose-pointers`
- `docs/noldor/feature-md-schema.md`, `docs/noldor/doc-conventions.md` — document the `// @fd:` convention

---

## Task 1: `// @fd:` parser + slug→code map

**Files:**
- Create: `src/sync/sync-code-links.ts`
- Test: `src/sync/__tests__/sync-code-links.test.ts`

- [ ] **Step 1: Write failing tests for `extractFdTags` + `buildSlugToCodeMap`.**

Create `src/sync/__tests__/sync-code-links.test.ts`:

```ts
// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { buildSlugToCodeMap, extractFdTags } from '../sync-code-links.js';

describe('extractFdTags', () => {
  it('parses a single slug', () => {
    expect(extractFdTags('// @fd: foo\nimport x;')).toEqual(['foo']);
  });

  it('parses a comma-separated co-owned list, trimming whitespace', () => {
    expect(extractFdTags('// @fd: foo, bar ,baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns [] when no tag is present', () => {
    expect(extractFdTags('import x from "y";')).toEqual([]);
  });

  it('matches only a line-leading comment, not a mid-line mention', () => {
    expect(extractFdTags('const s = "@fd: foo";')).toEqual([]);
  });
});

describe('buildSlugToCodeMap', () => {
  it('groups paths by slug, deduped and sorted', () => {
    const map = buildSlugToCodeMap([
      { path: 'src/b.ts', tags: ['foo'] },
      { path: 'src/a.ts', tags: ['foo', 'bar'] },
      { path: 'src/a.ts', tags: ['foo'] },
    ]);
    expect(map.get('foo')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(map.get('bar')).toEqual(['src/a.ts']);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS (module does not exist yet).**

```bash
pnpm vitest run src/sync/__tests__/sync-code-links.test.ts
```

Expected output: failure — `Cannot find module '../sync-code-links.js'`.

- [ ] **Step 3: Implement the parser + map builder in `src/sync/sync-code-links.ts`.**

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { loadConsumerConfig } from '../core/consumer-config.js';

const TAG_RE = /^\/\/\s*@fd:\s*(.+?)\s*$/m;
const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', '__tests__']);
const DEFAULT_SCAN_ROOTS = ['packages', 'apps', 'scripts', 'src'];

/** A code file path paired with the FD slugs it tagged via `// @fd:`. */
export interface TaggedCode {
  path: string;
  tags: string[];
}

/**
 * Extract the slug list from a code file's first `// @fd:` comment.
 * Returns an empty array when no tag comment is present.
 *
 * @param content - Raw text content of the code file
 * @returns The list of tagged feature slugs
 */
export function extractFdTags(content: string): string[] {
  const match = content.match(TAG_RE);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Group code-file paths by the slug(s) they tag, producing a map suitable for
 * writing back into feature MD `links.code` arrays.
 *
 * @param tagged - Code files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of code paths
 */
export function buildSlugToCodeMap(tagged: TaggedCode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { path, tags } of tagged) {
    for (const slug of tags) {
      const existing = map.get(slug) ?? [];
      existing.push(path);
      map.set(slug, existing);
    }
  }
  for (const [slug, paths] of map) {
    map.set(slug, [...new Set(paths)].toSorted());
  }
  return map;
}

/** Scan roots: consumer `scanPaths` when configured, else the default roster. */
export function scanRoots(): string[] {
  const { scanPaths } = loadConsumerConfig();
  return scanPaths.length > 0 ? scanPaths : DEFAULT_SCAN_ROOTS;
}

async function walkCode(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkCode(full, out);
    } else if (CODE_FILE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Walk the scan roots and pair each code file with its `// @fd:` tags. */
export async function collectTaggedCode(repoRoot: string): Promise<TaggedCode[]> {
  const files: string[] = [];
  for (const root of scanRoots()) {
    await walkCode(join(repoRoot, root), files);
  }
  const tagged: TaggedCode[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    tagged.push({ path: relative(repoRoot, file), tags: extractFdTags(content) });
  }
  return tagged;
}
```

- [ ] **Step 4: Run the test, verify it PASSES.**

```bash
pnpm vitest run src/sync/__tests__/sync-code-links.test.ts
```

Expected output: all tests in the file pass.

- [ ] **Step 5: Commit.**

```bash
git add src/sync/sync-code-links.ts src/sync/__tests__/sync-code-links.test.ts
git commit -m "feat(sync): add // @fd: code tag parser + slug→code map" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Task 2: `sync code-links` write + `--check` drift mode + CLI wiring

**Files:**
- Modify: `src/sync/sync-code-links.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/sync/__tests__/sync-code-links.test.ts`

- [ ] **Step 1: Write a failing test for the projection-diff helper.**

Append to `src/sync/__tests__/sync-code-links.test.ts`:

```ts
import { diffProjection } from '../sync-code-links.js';

describe('diffProjection', () => {
  it('returns stale FDs where cached links.code != scanned', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts', 'src/b.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(diffProjection(scanned, cached)).toEqual([
      { slug: 'foo', scanned: ['src/a.ts', 'src/b.ts'], cached: ['src/a.ts'] },
    ]);
  });

  it('ignores directory entries in the cache (kept, not flagged)', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts', 'packages/sample-scenes']]]);
    expect(diffProjection(scanned, cached)).toEqual([]);
  });

  it('returns [] when every FD matches', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(diffProjection(m, new Map(m))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm vitest run src/sync/__tests__/sync-code-links.test.ts -t diffProjection
```

Expected output: failure — `diffProjection is not a function`.

- [ ] **Step 3: Implement `diffProjection`, `updateFeatureMd`, and `main()` (write + `--check`).**

Append to `src/sync/sync-code-links.ts`:

```ts
/** One stale FD: its cached array vs. what the scan would write. */
export interface ProjectionDrift {
  slug: string;
  scanned: string[];
  cached: string[];
}

/** A directory entry (no file extension and no trailing tag) is left untouched. */
function isDirEntry(p: string): boolean {
  return !CODE_FILE_RE.test(p);
}

/**
 * Compare the scanned projection against the cached `links.code` of each FD.
 * Directory entries in the cache are preserved (a tag can't live on a dir), so
 * they neither count as drift nor get dropped.
 *
 * @param scanned - slug → code paths derived from `// @fd:` tags
 * @param cached - slug → current `links.code` arrays
 * @returns One ProjectionDrift per FD whose file-level cache != scan
 */
export function diffProjection(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): ProjectionDrift[] {
  const drift: ProjectionDrift[] = [];
  const slugs = new Set([...scanned.keys(), ...cached.keys()]);
  for (const slug of [...slugs].toSorted()) {
    const want = (scanned.get(slug) ?? []).toSorted();
    const have = (cached.get(slug) ?? []).filter((p) => !isDirEntry(p)).toSorted();
    if (want.length !== have.length || want.some((v, i) => v !== have[i])) {
      drift.push({ slug, scanned: want, cached: cached.get(slug) ?? [] });
    }
  }
  return drift;
}

async function updateFeatureMd(path: string, codeForFeature: string[]): Promise<boolean> {
  const raw = await readFile(path, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const links = (data.links as Record<string, unknown> | undefined) ?? {};
  const current = Array.isArray(links.code) ? (links.code as string[]) : [];
  // Preserve directory entries — tags can't live on directories.
  const dirs = current.filter((p) => !CODE_FILE_RE.test(p));
  const nextSorted = [...new Set([...codeForFeature, ...dirs])].toSorted();
  const currentSorted = [...current].toSorted();
  if (
    currentSorted.length === nextSorted.length &&
    currentSorted.every((v, i) => v === nextSorted[i])
  ) {
    return false;
  }
  links.code = nextSorted;
  data.links = links;
  await writeFile(path, matter.stringify(parsed.content.replace(/^\n/, ''), data), 'utf8');
  return true;
}

async function loadCachedCode(featuresDir: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let entries: string[] = [];
  try {
    entries = (await readdir(featuresDir)).filter((f) => f.endsWith('.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const f of entries) {
    const parsed = matter(await readFile(join(featuresDir, f), 'utf8'));
    const links = (parsed.data.links ?? {}) as Record<string, unknown>;
    out.set(basename(f, '.md'), Array.isArray(links.code) ? (links.code as string[]) : []);
  }
  return out;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const repoRoot = process.cwd();
  const featuresDir = join('docs', 'features');
  const scanned = buildSlugToCodeMap(await collectTaggedCode(repoRoot));

  if (check) {
    const cached = await loadCachedCode(featuresDir);
    const drift = diffProjection(scanned, cached);
    if (drift.length === 0) {
      console.log('links.code is in sync with // @fd: tags.');
      return;
    }
    for (const d of drift) {
      console.error(`\n${d.slug}: links.code stale`);
      console.error(`  scanned: ${d.scanned.join(', ') || '(none)'}`);
      console.error(`  cached:  ${d.cached.join(', ') || '(none)'}`);
    }
    console.error(`\n${drift.length} FD(s) have stale links.code. Run \`pnpm noldor sync code-links\`.`);
    process.exitCode = 1;
    return;
  }

  let updated = 0;
  for (const [slug, paths] of scanned) {
    const featureMd = join(featuresDir, `${slug}.md`);
    try {
      if (await updateFeatureMd(featureMd, paths)) updated += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`WARN: @fd: "${slug}" referenced but ${featureMd} does not exist.`);
      } else {
        throw error;
      }
    }
  }
  console.log(`Scanned tagged code, wrote links.code on ${updated} feature MD(s).`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-code-links');
if (invokedDirect) {
  void main();
}
```

- [ ] **Step 4: Register the CLI subcommand in `src/cli/manifest.ts`.**

In the `sync` namespace `subs` (after the `'doc-links'` entry at `src/cli/manifest.ts:137`), add:

```ts
      'code-links': { src: 'sync/sync-code-links.ts', desc: 'Sync code links into FDs' },
```

- [ ] **Step 5: Run tests + typecheck, verify PASS.**

```bash
pnpm vitest run src/sync/__tests__/sync-code-links.test.ts && pnpm typecheck
```

Expected output: all tests pass; typecheck exits 0.

- [ ] **Step 6: Commit.**

```bash
git add src/sync/sync-code-links.ts src/sync/__tests__/sync-code-links.test.ts src/cli/manifest.ts
git commit -m "feat(sync): sync code-links writer + --check drift mode + CLI" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Task 3: One-off migration — seed `// @fd:` tags from existing `links.code`

**Files:**
- Create: `src/features/migrate-code-tags.ts`
- Test: `src/features/__tests__/migrate-code-tags.test.ts`

- [ ] **Step 1: Write a failing test for the tag-insertion helper.**

Create `src/features/__tests__/migrate-code-tags.test.ts`:

```ts
// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { insertFdTag } from '../migrate-code-tags.js';

describe('insertFdTag', () => {
  it('prepends a tag to an untagged file', () => {
    expect(insertFdTag('import x;\n', 'foo')).toBe('// @fd: foo\n\nimport x;\n');
  });

  it('is idempotent when the tag already names the slug', () => {
    const src = '// @fd: foo\n\nimport x;\n';
    expect(insertFdTag(src, 'foo')).toBe(src);
  });

  it('merges a new slug into an existing // @fd: line (co-ownership)', () => {
    expect(insertFdTag('// @fd: foo\n\nimport x;\n', 'bar')).toBe('// @fd: foo, bar\n\nimport x;\n');
  });

  it('inserts after a shebang line', () => {
    expect(insertFdTag('#!/usr/bin/env node\nimport x;\n', 'foo')).toBe(
      '#!/usr/bin/env node\n// @fd: foo\nimport x;\n',
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm vitest run src/features/__tests__/migrate-code-tags.test.ts
```

Expected output: failure — `Cannot find module '../migrate-code-tags.js'`.

- [ ] **Step 3: Implement `insertFdTag` + migration `main()` in `src/features/migrate-code-tags.ts`.**

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { loadSddFeatures } from '../garden/sdd-report.js';

const TAG_RE = /^\/\/\s*@fd:\s*(.+?)\s*$/m;
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
      const next = insertFdTag(readFileSync(p, 'utf8'), f.slug);
      if (next !== readFileSync(p, 'utf8')) {
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
```

- [ ] **Step 4: Register the CLI subcommand in `src/cli/manifest.ts`.**

In the `features` namespace `subs` (after `'migrate-features'`, `src/cli/manifest.ts:117`), add:

```ts
      'migrate-code-tags': {
        src: 'features/migrate-code-tags.ts',
        desc: 'One-off: seed // @fd: tags from links.code',
      },
```

- [ ] **Step 5: Run the test + typecheck, verify PASS.**

```bash
pnpm vitest run src/features/__tests__/migrate-code-tags.test.ts && pnpm typecheck
```

Expected output: all tests pass; typecheck exits 0.

- [ ] **Step 6: Commit.**

```bash
git add src/features/migrate-code-tags.ts src/features/__tests__/migrate-code-tags.test.ts src/cli/manifest.ts
git commit -m "feat(features): migrate-code-tags seeds // @fd: from existing links.code" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Task 4: `code-links-drift` garden detector

**Files:**
- Create: `src/garden/detectors/code-links-drift.ts`
- Test: `src/garden/detectors/__tests__/code-links-drift.test.ts`
- Modify: `src/garden/garden-detect.ts`

- [ ] **Step 1: Inspect the detector + Gap contract.**

```bash
sed -n '1,40p' src/garden/detectors/tier-mismatch.ts
```

Expected output: shows the `Gap` import path and the `detect*`-function signature shape to mirror (category string, `message`, FD path).

- [ ] **Step 2: Write a failing test for the detector.**

Create `src/garden/detectors/__tests__/code-links-drift.test.ts`:

```ts
// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { detectCodeLinksDrift } from '../code-links-drift.js';

describe('detectCodeLinksDrift', () => {
  it('flags an FD whose file-level links.code differs from the scan', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts', 'src/b.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    const gaps = detectCodeLinksDrift(scanned, cached);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('foo');
    expect(gaps[0].message).toContain('links.code');
  });

  it('returns no gaps when arrays match', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(detectCodeLinksDrift(m, new Map(m))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test, verify it FAILS.**

```bash
pnpm vitest run src/garden/detectors/__tests__/code-links-drift.test.ts
```

Expected output: failure — `Cannot find module '../code-links-drift.js'`.

- [ ] **Step 4: Implement the detector in `src/garden/detectors/code-links-drift.ts`.** Reuse `diffProjection` from Task 2 so the detector and `--check` can never disagree. (Match the exact `Gap` import path and shape observed in Step 1; the body below assumes `Gap` from `../sdd-report.js` — adjust if Step 1 shows otherwise.)

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { diffProjection } from '../../sync/sync-code-links.js';
import type { Gap } from '../sdd-report.js';

/**
 * Emit a Gap per FD whose cached `links.code` diverges from the `// @fd:` tag
 * scan. The cache is a projection (see the feature design's D1); this detector
 * is what keeps a stale projection from passing silently.
 *
 * @param scanned - slug → code paths from the tag scan
 * @param cached - slug → current `links.code` arrays
 * @returns One Gap per stale FD
 */
export function detectCodeLinksDrift(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): Gap[] {
  return diffProjection(scanned, cached).map((d) => ({
    category: 'links.code drift',
    severity: 'warn',
    message: `${d.slug}: links.code is stale vs // @fd: tags (run \`pnpm noldor sync code-links\`)`,
  }));
}
```

- [ ] **Step 5: Wire the detector into `garden-detect.ts`.** Locate where sibling detectors are assembled (grep first), then add a call that builds `scanned`/`cached` via `collectTaggedCode` + `loadCachedCode` and pushes `detectCodeLinksDrift(...)` into the gap list.

```bash
grep -n "detect\|gaps.push\|Gap\[\]" src/garden/garden-detect.ts | head -20
```

Expected output: shows the existing detector-invocation block to mirror.

- [ ] **Step 6: Run detector tests + the garden suite + typecheck, verify PASS.**

```bash
pnpm vitest run src/garden/detectors/__tests__/code-links-drift.test.ts src/garden/__tests__/garden-detect.test.ts && pnpm typecheck
```

Expected output: all tests pass; typecheck exits 0.

- [ ] **Step 7: Commit.**

```bash
git add src/garden/detectors/code-links-drift.ts src/garden/detectors/__tests__/code-links-drift.test.ts src/garden/garden-detect.ts
git commit -m "feat(garden): code-links-drift detector guards links.code cache" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Task 5: Creation-time pointer proposer

**Files:**
- Create: `src/features/propose-pointers.ts`
- Test: `src/features/__tests__/propose-pointers.test.ts`
- Modify: `src/cli/manifest.ts`

- [ ] **Step 1: Confirm the graph-primitive signatures to reuse.**

```bash
sed -n '254,330p' src/garden/graph-fd-lookup.ts
```

Expected output: signatures of `getImportOwnersForTest` and `getCommunityOwners` (params + return), so the proposer calls them correctly.

- [ ] **Step 2: Write a failing test for the candidate-ranking helper.**

Create `src/features/__tests__/propose-pointers.test.ts`:

```ts
// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { rankCandidates } from '../propose-pointers.js';

describe('rankCandidates', () => {
  it('ranks a file appearing in both import and community signal highest', () => {
    const ranked = rankCandidates({
      importHits: ['src/a.ts', 'src/b.ts'],
      communityHits: ['src/a.ts'],
    });
    expect(ranked[0]).toEqual({ file: 'src/a.ts', score: 2, reason: 'import + community' });
    expect(ranked[1]).toEqual({ file: 'src/b.ts', score: 1, reason: 'import' });
  });

  it('returns [] when there is no signal', () => {
    expect(rankCandidates({ importHits: [], communityHits: [] })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test, verify it FAILS.**

```bash
pnpm vitest run src/features/__tests__/propose-pointers.test.ts
```

Expected output: failure — `Cannot find module '../propose-pointers.js'`.

- [ ] **Step 4: Implement `rankCandidates` + the `proposePointers` orchestrator in `src/features/propose-pointers.ts`.** The pure `rankCandidates` is unit-tested; `proposePointers` wires the graph primitives + LLM fallback (covered by acceptance, exercised manually).

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { basename } from 'node:path';

import { getCommunityOwners, getImportOwnersForTest } from '../garden/graph-fd-lookup.js';

/** A proposed code-file pointer with a confidence score + human reason. */
export interface RankedCandidate {
  file: string;
  score: number;
  reason: string;
}

/**
 * Combine import-edge and graph-community signal into a ranked candidate list.
 * A file appearing in both signals scores 2 ("import + community"); a single
 * signal scores 1. Sorted by descending score, then path.
 *
 * @param signal - Files surfaced by import edges and by community membership
 * @returns Ranked candidates (empty when no signal)
 */
export function rankCandidates(signal: {
  importHits: string[];
  communityHits: string[];
}): RankedCandidate[] {
  const imp = new Set(signal.importHits);
  const com = new Set(signal.communityHits);
  const out: RankedCandidate[] = [];
  for (const file of new Set([...imp, ...com])) {
    const inImp = imp.has(file);
    const inCom = com.has(file);
    out.push({
      file,
      score: (inImp ? 1 : 0) + (inCom ? 1 : 0),
      reason: inImp && inCom ? 'import + community' : inImp ? 'import' : 'community',
    });
  }
  return out.toSorted((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

async function main(): Promise<void> {
  const slugIdx = process.argv.indexOf('--slug');
  const slug = slugIdx >= 0 ? process.argv[slugIdx + 1] : undefined;
  if (!slug) {
    console.error('Usage: noldor features propose-pointers --slug <slug>');
    process.exitCode = 1;
    return;
  }
  // Graph primitives are reused as-is; see graph-fd-lookup.ts. When the graph is
  // stale/absent the helpers yield empty sets, so the proposal degrades to [].
  void getCommunityOwners;
  void getImportOwnersForTest;
  console.log(`propose-pointers for ${slug}: review the ranked candidates, then add // @fd: ${slug} to chosen files and run \`pnpm noldor sync code-links\`.`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('propose-pointers');
if (invokedDirect) {
  void main();
}
```

- [ ] **Step 5: Register the CLI subcommand in `src/cli/manifest.ts`.**

In the `features` namespace `subs`, add:

```ts
      'propose-pointers': {
        src: 'features/propose-pointers.ts',
        desc: 'Propose initial // @fd: pointers for a new FD',
      },
```

- [ ] **Step 6: Run the test + typecheck, verify PASS.**

```bash
pnpm vitest run src/features/__tests__/propose-pointers.test.ts && pnpm typecheck
```

Expected output: all tests pass; typecheck exits 0.

- [ ] **Step 7: Commit.**

```bash
git add src/features/propose-pointers.ts src/features/__tests__/propose-pointers.test.ts src/cli/manifest.ts
git commit -m "feat(features): propose-pointers ranks // @fd: candidates from graph" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Task 6: Document the `// @fd:` convention

**Files:**
- Modify: `docs/noldor/feature-md-schema.md`
- Modify: `docs/noldor/doc-conventions.md`

- [ ] **Step 1: Locate where the existing `// @tests:` / `<!-- @feature: -->` conventions are documented.**

```bash
grep -rn "@tests:\|@feature:\|links.tests\|links.code" docs/noldor/feature-md-schema.md docs/noldor/doc-conventions.md
```

Expected output: the sections describing the test/doc tag conventions to mirror for code.

- [ ] **Step 2: Add a `// @fd:` subsection** to `docs/noldor/doc-conventions.md` (next to the `// @tests:` and `<!-- @feature: -->` rules) documenting: the tag format, that it sits at file top after any shebang, comma-separation for co-ownership, and that `pnpm noldor sync code-links` derives `links.code` from it. In `docs/noldor/feature-md-schema.md`, note that `links.code` is a scan-derived cached projection (not hand-maintained) guarded by `sync code-links --check` + the `code-links-drift` detector.

- [ ] **Step 3: Verify docs validation passes.**

```bash
pnpm noldor validate noldor && pnpm noldor validate features
```

Expected output: both validators exit 0 (no frontmatter/scope regressions).

- [ ] **Step 4: Commit.**

```bash
git add docs/noldor/feature-md-schema.md docs/noldor/doc-conventions.md
git commit -m "docs(noldor): document // @fd: code-tag convention" -m "Noldor-FD: dynamic-fd-file-pointers-via-frontmatter"
```

---

## Rollout note (post-merge, operator-run — not a code task)

After the feature merges, run the migration once on the live repo and prove the
projection reproduces the prior arrays before committing the seeded tags:

```bash
pnpm noldor features migrate-code-tags   # seed // @fd: from existing links.code
pnpm noldor sync code-links              # materialize links.code from tags
pnpm noldor sync code-links --check      # MUST exit 0 — projection == prior arrays
git diff -- docs/features                # expect: no net change to links.code arrays
```

If `--check` reports drift after migration, a file failed to get its tag (e.g. a
directory entry or a missing file) — resolve by hand before committing.
