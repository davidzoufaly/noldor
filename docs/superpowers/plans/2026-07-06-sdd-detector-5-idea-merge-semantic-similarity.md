# SDD Detector 5 — Idea-Merge Semantic Similarity Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Give `/triage` a deterministic, structured merge-candidate corpus (all FDs + roadmap + backlog blocks) so its LLM can rank the top-3 hosts per idea and surface them explicitly — with FD matches proposed as `parent:`-linked new entries.
**Architecture:** One pure corpus builder in `src/triage` reusing existing loaders (`parseRoadmap`/`parseBacklog`/`loadSddFeatures`), a thin CLI wrapper wired into the `triage` command group, plus a `/triage` skill edit. No embeddings, no network, no new deps.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), tsx-run CLIs dispatched via `src/cli/manifest.ts`, vitest, gray-matter (already a dep).

---

## File Structure

- `src/core/fd-load.ts` — **Modify**: add pure `extractSummary(md): string` (co-located with `loadSddFeatures`/`FeatureRecord`).
- `src/core/__tests__/fd-load.test.ts` — **Create**: unit tests for `extractSummary`.
- `src/triage/merge-candidates.ts` — **Create**: `MergeCandidate` type + `async buildMergeCandidates(docRoot)`.
- `src/triage/__tests__/merge-candidates.test.ts` — **Create**: builder tests over an `mkdtemp` fixture doc tree.
- `src/triage/merge-candidates-cli.ts` — **Create**: CLI wrapper (`--json` machine output / default human table) + pure `formatTable`.
- `src/cli/manifest.ts` — **Modify**: wire `triage.merge-candidates`.
- `.claude/skills/triage/SKILL.md` + `templates/.claude/skills/triage/SKILL.md` — **Modify** (identical twins): step 3 captures the corpus; step 4 ranks top-3 + disposition rule + `cands:` surfacing.
- `docs/features/sdd-detector-5-idea-merge-semantic-similarity.md` — **Modify**: fill `links.code` / `links.tests`.

---

## Task 1: `extractSummary` in `fd-load.ts`

**Files:**
- Modify: `src/core/fd-load.ts`
- Test: `src/core/__tests__/fd-load.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/core/__tests__/fd-load.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extractSummary } from '../fd-load.js';

// @tests: sdd-detector-5-idea-merge-semantic-similarity
describe(extractSummary, () => {
  it('returns the trimmed Summary body', () => {
    const md = `---\nname: X\n---\n\n## Summary\n\nHello world.\n\n## Usage\n\nsteps`;
    expect(extractSummary(md)).toBe('Hello world.');
  });

  it('returns empty string when no Summary section exists', () => {
    expect(extractSummary(`## Usage\n\nx`)).toBe('');
  });

  it('captures a multi-paragraph Summary up to the next H2', () => {
    const md = `## Summary\n\nPara one.\n\nPara two.\n\n## Usage\n\nx`;
    expect(extractSummary(md)).toBe('Para one.\n\nPara two.');
  });

  it('captures a Summary at end-of-file (no trailing H2)', () => {
    expect(extractSummary(`## Summary\n\nOnly section.`)).toBe('Only section.');
  });
});
```

- [ ] **Step 2: Run the test — verify FAIL.**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/sdd-detector-5-idea-merge-semantic-similarity
pnpm vitest run src/core/__tests__/fd-load.test.ts 2>&1 | tail -12
```

Expected: fails to import — `extractSummary is not exported` / `is not a function` (TypeScript/vitest error), all 4 cases red.

- [ ] **Step 3: Implement `extractSummary`.** In `src/core/fd-load.ts`, add after the `loadSddFeatures` function (before `listSpecs`):

```ts
/**
 * Extract the trimmed body of an FD's `## Summary` section, or `''` when the
 * section is absent. Pure — operates on the raw markdown (gray-matter
 * frontmatter has no `## ` heading so it never matches). Mirrors the Summary
 * regex in `src/cr/read-fd-summary.ts` (that copy throws on absence; this one
 * returns `''` so a stub FD contributes an empty summary rather than crashing
 * a corpus build). Consolidating the two copies onto this core helper is a
 * deferred follow-up — `cr → core` is an allowed edge.
 *
 * @param md - Raw feature-MD file contents (frontmatter included).
 * @returns Trimmed `## Summary` body, or `''` when there is no Summary section.
 */
export function extractSummary(md: string): string {
  // `(?=^## |$(?![\s\S]))` = next H2 OR end-of-input (JS has no `\Z`).
  const m = md.match(/^## Summary\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  return m ? m[1]!.trim() : '';
}
```

- [ ] **Step 4: Run the test — verify PASS.**

```bash
pnpm vitest run src/core/__tests__/fd-load.test.ts 2>&1 | tail -8
```

Expected: `4 passed`, 0 failed.

- [ ] **Step 5: Commit.**

```bash
git add src/core/fd-load.ts src/core/__tests__/fd-load.test.ts
git commit -m "feat(triage): add extractSummary FD-body helper to fd-load" -m "Noldor-FD: sdd-detector-5-idea-merge-semantic-similarity"
```

---

## Task 2: `MergeCandidate` + `buildMergeCandidates`

**Files:**
- Create: `src/triage/merge-candidates.ts`
- Test: `src/triage/__tests__/merge-candidates.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/triage/__tests__/merge-candidates.test.ts`:

```ts
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMergeCandidates } from '../merge-candidates.js';

// @tests: sdd-detector-5-idea-merge-semantic-similarity

const FD_FOO = `---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
name: Foo Feature
packages:
  - scripts
phase: done
noldor-tier: specs-only
---

## Summary

Foo does things.

## Usage

Run foo.
`;

const FD_BAR = `---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
name: Bar Feature
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---

## Usage

Run bar.
`;

const ROADMAP = `# Roadmap

### Some Roadmap Thing

- id: Q-9001
- area: tooling
- type: feat
- size: M
- impact: med

A roadmap thing that does stuff.

### !!!

- area: tooling

Punctuation-only heading — slugifies to empty, must be filtered out.
`;

const BACKLOG = `# Backlog

### Some Backlog Item

- id: Q-9002
- area: tooling
- type: feat

A parked idea.
`;

let root: string;

async function write(rel: string, body: string): Promise<void> {
  const p = join(root, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'merge-cand-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(buildMergeCandidates, () => {
  it('enumerates FDs + roadmap + backlog with correct kinds and dispositions', async () => {
    await write('docs/features/foo.md', FD_FOO);
    await write('docs/features/bar.md', FD_BAR);
    await write('docs/roadmap.md', ROADMAP);
    await write('docs/backlog.md', BACKLOG);

    const out = await buildMergeCandidates(root);
    const bySlug = Object.fromEntries(out.map((c) => [c.slug, c]));

    // 2 features + 1 roadmap + 1 backlog = 4 (empty-slug '!!!' excluded)
    expect(out).toHaveLength(4);
    expect(bySlug['foo']).toMatchObject({ kind: 'feature', disposition: 'parent', summary: 'Foo does things.', phase: 'done' });
    expect(bySlug['bar']).toMatchObject({ kind: 'feature', disposition: 'parent', summary: '' });
    expect(bySlug['some-roadmap-thing']).toMatchObject({ kind: 'roadmap', disposition: 'merge', id: 'Q-9001', summary: 'A roadmap thing that does stuff.' });
    expect(bySlug['some-backlog-item']).toMatchObject({ kind: 'backlog', disposition: 'merge', id: 'Q-9002' });
  });

  it('excludes empty-slug entries (all-punctuation headings)', async () => {
    await write('docs/roadmap.md', ROADMAP);
    const out = await buildMergeCandidates(root);
    expect(out.every((c) => c.slug.length > 0)).toBe(true);
  });

  it('treats a missing roadmap/backlog file as empty (no throw)', async () => {
    await write('docs/features/foo.md', FD_FOO);
    // no roadmap.md, no backlog.md written
    const out = await buildMergeCandidates(root);
    expect(out.map((c) => c.kind)).toStrictEqual(['feature']);
  });
});
```

- [ ] **Step 2: Run the test — verify FAIL.**

```bash
pnpm vitest run src/triage/__tests__/merge-candidates.test.ts 2>&1 | tail -12
```

Expected: import error — `../merge-candidates.js` has no export `buildMergeCandidates` (module not found / not a function). All 3 cases red.

- [ ] **Step 3: Implement the builder.** Create `src/triage/merge-candidates.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { extractSummary, loadSddFeatures } from '../core/fd-load.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';

/**
 * One merge target for `/triage` to rank an untriaged idea against.
 * `disposition` is derived from `kind`: roadmap/backlog blocks accept a
 * sub-bullet merge (`merge`); FDs are already promoted, so an overlap becomes
 * a new entry carrying `parent: <slug>` (`parent`).
 */
export interface MergeCandidate {
  kind: 'feature' | 'roadmap' | 'backlog';
  slug: string;
  id?: string;
  name: string;
  summary: string;
  phase?: string;
  disposition: 'merge' | 'parent';
}

/** Read a doc file, treating a missing file (ENOENT) as empty; rethrow every other error. */
async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Enumerate every merge target — roadmap blocks, backlog blocks, and FDs — as a
 * flat corpus. Deterministic for a fixed doc tree. `docRoot` is injected
 * end-to-end via {@link loadDocRoots} (no module-global state) so tests point
 * it at a fixture dir. Entries whose slug is empty (all-punctuation headings,
 * see `parse-blocks.ts`) are dropped — they can't form a `merge:<slug>`.
 *
 * @param docRoot - Repo root; resolved to features/roadmap/backlog paths.
 * @returns The merge-candidate corpus, FD bodies re-read for their Summary.
 */
export async function buildMergeCandidates(docRoot: string): Promise<MergeCandidate[]> {
  const roots = loadDocRoots(docRoot);

  const roadmap = parseRoadmap(await readOrEmpty(roots.roadmap)).map(
    (e): MergeCandidate => ({
      kind: 'roadmap',
      slug: e.slug,
      id: e.id,
      name: e.name,
      summary: e.description,
      phase: e.phase,
      disposition: 'merge',
    }),
  );

  const backlog = parseBacklog(await readOrEmpty(roots.backlog)).map(
    (e): MergeCandidate => ({
      kind: 'backlog',
      slug: e.slug,
      id: e.id,
      name: e.name,
      summary: e.description,
      phase: e.phase,
      disposition: 'merge',
    }),
  );

  const records = await loadSddFeatures(roots.features);
  const features = await Promise.all(
    records.map(async (r): Promise<MergeCandidate> => {
      const raw = await readFile(join(roots.features, `${r.slug}.md`), 'utf8');
      return {
        kind: 'feature',
        slug: r.slug,
        id: r.frontmatter['entry-id'],
        name: r.frontmatter.name,
        summary: extractSummary(raw),
        phase: r.frontmatter.phase,
        disposition: 'parent',
      };
    }),
  );

  return [...roadmap, ...backlog, ...features].filter((c) => c.slug.length > 0);
}
```

- [ ] **Step 4: Run the test — verify PASS.**

```bash
pnpm vitest run src/triage/__tests__/merge-candidates.test.ts 2>&1 | tail -8
```

Expected: `3 passed`, 0 failed.

- [ ] **Step 5: Commit.**

```bash
git add src/triage/merge-candidates.ts src/triage/__tests__/merge-candidates.test.ts
git commit -m "feat(triage): add merge-candidate corpus builder" -m "Noldor-FD: sdd-detector-5-idea-merge-semantic-similarity"
```

---

## Task 3: CLI wrapper + manifest wiring

**Files:**
- Create: `src/triage/merge-candidates-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/triage/__tests__/merge-candidates.test.ts` (append `formatTable` cases)

- [ ] **Step 1: Write the failing test for `formatTable`.** Append to `src/triage/__tests__/merge-candidates.test.ts` (add the import to the existing top import line for `../merge-candidates-cli.js`):

```ts
import { formatTable } from '../merge-candidates-cli.js';

describe(formatTable, () => {
  it('renders one aligned row per candidate (kind, disposition, slug, name)', () => {
    const out = formatTable([
      { kind: 'feature', slug: 'foo', name: 'Foo Feature', summary: '', disposition: 'parent' },
      { kind: 'roadmap', slug: 'bar-thing', name: 'Bar Thing', summary: '', disposition: 'merge' },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('feature');
    expect(lines[0]).toContain('parent');
    expect(lines[0]).toContain('foo');
    expect(lines[0]).toContain('Foo Feature');
    expect(lines[1]).toContain('roadmap');
  });

  it('renders a placeholder for an empty corpus', () => {
    expect(formatTable([])).toBe('(no merge candidates)');
  });
});
```

- [ ] **Step 2: Run — verify FAIL.**

```bash
pnpm vitest run src/triage/__tests__/merge-candidates.test.ts 2>&1 | tail -10
```

Expected: cannot find `../merge-candidates-cli.js` / no export `formatTable`; the 2 new cases red (the 3 builder cases still pass).

- [ ] **Step 3: Implement the CLI.** Create `src/triage/merge-candidates-cli.ts`:

```ts
import { fileURLToPath } from 'node:url';

import { buildMergeCandidates, type MergeCandidate } from './merge-candidates.js';

/**
 * Render the corpus as an aligned, human-readable table (kind · disposition ·
 * slug · name) for eyeballing. The `--json` path bypasses this and emits the
 * raw array for `/triage`.
 */
export function formatTable(candidates: MergeCandidate[]): string {
  if (candidates.length === 0) return '(no merge candidates)';
  const rows = candidates.map((c) => [c.kind, c.disposition, c.slug, c.name] as const);
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  const w2 = Math.max(...rows.map((r) => r[2].length));
  return rows.map((r) => `${r[0].padEnd(w0)}  ${r[1].padEnd(w1)}  ${r[2].padEnd(w2)}  ${r[3]}`).join('\n');
}

async function main(): Promise<void> {
  const json = process.argv.slice(2).includes('--json');
  const candidates = await buildMergeCandidates(process.cwd());
  process.stdout.write(json ? `${JSON.stringify(candidates, null, 2)}\n` : `${formatTable(candidates)}\n`);
}

// True only when this module is the direct entry — dispatch reshapes argv so
// process.argv[1] === this module's path (see src/cli/index.ts:14-22).
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Wire the manifest.** In `src/cli/manifest.ts`, inside the `triage.subs` object, add after the `backfill-ids` entry (before the closing `},` of `subs`):

```ts
      'merge-candidates': {
        src: 'triage/merge-candidates-cli.ts',
        desc: 'Emit the merge-candidate corpus (FDs + roadmap + backlog) for /triage; --json for machine output',
      },
```

- [ ] **Step 5: Run the unit test — verify PASS.**

```bash
pnpm vitest run src/triage/__tests__/merge-candidates.test.ts 2>&1 | tail -8
```

Expected: `5 passed` (3 builder + 2 formatTable), 0 failed.

- [ ] **Step 6: Smoke-run the CLI end-to-end against the real repo.**

```bash
node bin/noldor.mjs triage merge-candidates --json 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);const k={};for(const c of a)k[c.kind]=(k[c.kind]||0)+1;console.log('total',a.length,'by kind',k);const me=a.find(c=>c.slug==='sdd-detector-5-idea-merge-semantic-similarity');console.log('self:',me&&{kind:me.kind,disposition:me.disposition,summaryLen:me.summary.length})})"
```

Expected: `total <N> by kind { feature: 64+, roadmap: <r>, backlog: <b> }`, and `self:` shows `{ kind: 'feature', disposition: 'parent', summaryLen: >0 }` (this FD is included, with its Summary). Also run the table form to confirm it renders:

```bash
node bin/noldor.mjs triage merge-candidates 2>&1 | head -5
```

Expected: aligned rows like `feature  parent  <slug>  <Name>`.

- [ ] **Step 7: Commit.**

```bash
git add src/triage/merge-candidates-cli.ts src/cli/manifest.ts src/triage/__tests__/merge-candidates.test.ts
git commit -m "feat(triage): add merge-candidates CLI + wire into triage command group" -m "Noldor-FD: sdd-detector-5-idea-merge-semantic-similarity"
```

---

## Task 4: `/triage` skill integration (twin edit)

**Files:**
- Modify: `templates/.claude/skills/triage/SKILL.md` (canonical)
- Modify: `.claude/skills/triage/SKILL.md` (mirror — identical content)

Both files are byte-identical twins (guarded by `src/checks/check-shared-files.ts`). Apply the **same two edits** to both. The top-level `.claude/skills/*` copy is blocked at pre-commit unless `NOLDOR_ALLOW_SHARED=1`, so the commit in Step 4 sets it.

- [ ] **Step 1: Edit step 3 (capture the corpus).** In **both** files, replace:

```
3. **Run** `pnpm noldor triage list-untriaged`. Capture the JSON output. If `untriaged` is empty, report "Nothing to triage" and stop.
```

with:

```
3. **Run** `pnpm noldor triage list-untriaged`. Capture the JSON output. If `untriaged` is empty, report "Nothing to triage" and stop. Then **run** `pnpm noldor triage merge-candidates --json` and capture the corpus — every FD, roadmap block, and backlog block as `{ kind, slug, id?, name, summary, phase?, disposition }`. On non-zero exit, note it and fall back to the manual scan of step 2 (the corpus is an aid, never a gate).
```

- [ ] **Step 2: Edit step 4 (rank + disposition + surface).** In **both** files, replace the first bullet under step 4:

```
4. **For each** untriaged bullet, first decide: **new entry** or **merge into existing**?
   - Scan the schema-C blocks enumerated in step 2. Use LLM judgment on the bullet text vs. each block's heading + summary paragraph: same capability, same problem, same component? If yes → propose `merge:<existing-slug>`. Bias toward merge when overlap is plausible — operator can reject in confirmation.
```

with:

```
4. **For each** untriaged bullet, first decide: **new entry** or **merge into existing**?
   - Rank the merge-candidate corpus (step 3) against the bullet text by judged overlap (name + summary): same capability, same problem, same component? Take the **top-3** as the candidate shortlist. Bias toward merge when overlap is plausible — operator can reject in confirmation. (On corpus fallback, scan the schema-C blocks enumerated in step 2 by hand instead.)
   - **Disposition follows the candidate `kind`:**
     - `roadmap` / `backlog` (disposition `merge`) → propose `merge:<slug>` (sub-bullet append, as below).
     - `feature` (disposition `parent`) → the idea overlaps an already-promoted FD; propose a **new entry** (roadmap/backlog per the rubric) carrying `- parent: <fd-slug>` so a later `/promote` attaches it (`*-attach`). Never sub-bullet-merge into an FD.
     - no candidate clears the bar → parent-less **new entry**.
   - **Surface the shortlist:** annotate each idea's row in the confirmation table with `cands: <slug1>, <slug2>, <slug3>` — the top-3 considered — so the (previously implicit) merge bias is visible and the operator can force a different host via `edit`.
```

- [ ] **Step 3: Verify twin parity + skill catalog + doc links.**

```bash
diff -q .claude/skills/triage/SKILL.md templates/.claude/skills/triage/SKILL.md && echo TWINS_IDENTICAL
node bin/noldor.mjs validate skill-catalog 2>&1 | tail -5
node bin/noldor.mjs sync doc-links 2>&1 | tail -5
```

Expected: `TWINS_IDENTICAL`; skill-catalog validation passes; doc-links sync clean (no error exit).

- [ ] **Step 4: Commit (override the shared-files guard for the `.claude/skills` mirror).**

```bash
git add .claude/skills/triage/SKILL.md templates/.claude/skills/triage/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(triage): surface merge-candidate shortlist in /triage step 4" -m "Noldor-FD: sdd-detector-5-idea-merge-semantic-similarity"
```

Expected: commit succeeds; hook summary shows `check-shared-files` overridden (`reason: override`).

---

## Task 5: FD link backfill + full verification

**Files:**
- Modify: `docs/features/sdd-detector-5-idea-merge-semantic-similarity.md`

- [ ] **Step 1: Fill `links.code` and `links.tests`.** In the FD frontmatter, replace:

```yaml
links:
  code: []
  tests: []
  spec: docs/superpowers/specs/2026-07-06-sdd-detector-5-idea-merge-semantic-similarity-design.md
```

with:

```yaml
links:
  code:
    - src/triage/merge-candidates.ts
    - src/triage/merge-candidates-cli.ts
    - src/core/fd-load.ts
    - src/cli/manifest.ts
    - .claude/skills/triage/SKILL.md
  tests:
    - src/triage/__tests__/merge-candidates.test.ts
    - src/core/__tests__/fd-load.test.ts
  spec: docs/superpowers/specs/2026-07-06-sdd-detector-5-idea-merge-semantic-similarity-design.md
```

- [ ] **Step 2: Validate features + test-link sync.**

```bash
node bin/noldor.mjs validate features 2>&1 | tail -5
node bin/noldor.mjs sync test-links 2>&1 | tail -5
```

Expected: `all OK`; test-link sync clean.

- [ ] **Step 3: Full verify (typecheck + tests + lint).**

```bash
pnpm verify 2>&1 | tail -25
```

Expected: typecheck clean, all tests pass (incl. the 7 new cases), lint clean. If `pnpm verify` is not defined, run `pnpm typecheck && pnpm vitest run && pnpm lint`.

- [ ] **Step 4: Commit.**

```bash
git add docs/features/sdd-detector-5-idea-merge-semantic-similarity.md
git commit -m "docs(features:sdd-detector-5-idea-merge-semantic-similarity): backfill links.code/tests" -m "Noldor-FD: sdd-detector-5-idea-merge-semantic-similarity"
```

- [ ] **Step 5: Handoff to gate Step 4.** Implementation complete. The gate end-of-flow owns: FD `phase: in-progress → done` flip, code-stage CR (`cr orchestrate --kind code`), and `pr-flow`. The **global** twin `~/.claude/skills/triage/SKILL.md` is outside the repo — note in the PR that it needs a manual mirror post-merge for the new step-4 behavior to be live in this environment.
