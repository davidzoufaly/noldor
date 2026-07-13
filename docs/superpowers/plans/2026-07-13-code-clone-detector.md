# Code-Clone Detector Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Deterministic token-based Type-1/2/3 clone detection over `scanPaths` — `noldor clones report|check` CLI, `## Code clones` sdd-report section, opt-in threshold gate. Zero new dependencies.

**Architecture:** New `src/clones/` module (tokenizer → Rabin-Karp detector → CLI); shared corpus walker exported from `src/core/repo-paths.ts`; optional `clones` config block in `src/core/config.ts`; one section hook in `src/garden/sdd-report.ts`.

**Tech Stack:** TypeScript, vitest, zod (existing deps only).

---

## File Structure

- `src/core/config.ts` — add `clonesConfigSchema` (per-field `.catch(undefined)`) + `clones` key on `noldorConfigSchema`
- `src/core/repo-paths.ts` — add exported `walkCodeFiles(root, { includeTests })` (reuses the sync-code-links regex/exclusion policy)
- `src/clones/tokenize.ts` — hand-rolled TS/JS scanner → `Token[]` (raw + normalized kinds)
- `src/clones/detect.ts` — `detectClones(files, opts)` — rolling hash, verify, extend, disjointness guards, gap-merge, containment dedup, report math
- `src/clones/clones-cli.ts` — `report`/`check` subcommands, config+flag resolution
- `src/cli/manifest.ts` — `clones` group registration
- `src/garden/sdd-report.ts` — `## Code clones` section
- `src/clones/__tests__/tokenize.test.ts`, `detect.test.ts`, `clones-cli.test.ts` — unit + CLI tests
- `docs/features/code-clone-detector.md` — links.code/links.tests fill at end

---

## Task 1: `clones` config block

**Files:**
- Modify: `src/core/config.ts`
- Test: `src/core/__tests__/config.test.ts`

- [ ] **Step 1: failing test** — append to `src/core/__tests__/config.test.ts`:

```ts
describe('clones config block', () => {
  it('parses a valid clones block and degrades malformed fields to undefined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-config-'));
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ clones: { minTokens: 40, thresholdPct: 'nope' } }),
      'utf8',
    );
    const cfg = await loadConfig(join(dir, 'config.json'));
    expect(cfg?.clones?.minTokens).toBe(40);
    expect(cfg?.clones?.thresholdPct).toBeUndefined();
  });
});
```

- [ ] **Step 2: run to FAIL** — `pnpm vitest run src/core/__tests__/config.test.ts` → red (`clones` unknown key / undefined).
- [ ] **Step 3: implement** — in `src/core/config.ts` add before `noldorConfigSchema`:

```ts
/** Clone-detector knobs. Each field degrades to unset on malformed input
 * (`.catch(undefined)`) so a config typo can't throw out of every
 * `loadConfig` caller — `clones check` treats unset threshold as green. */
export const clonesConfigSchema = z.object({
  minTokens: z.number().positive().optional().catch(undefined),
  minLines: z.number().positive().optional().catch(undefined),
  gapTokens: z.number().positive().optional().catch(undefined),
  thresholdPct: z.number().positive().optional().catch(undefined),
});
```

and add `clones: clonesConfigSchema.optional().catch(undefined),` to `noldorConfigSchema` — the block-level `.catch` covers a malformed BLOCK (`"clones": "aggressive"`, `"clones": []`), which per-field catches alone would let throw out of `loadConfig`. Extend the Task 1 test with `{ clones: [] }` → `cfg?.clones` undefined, parse does not throw.

- [ ] **Step 4: run to PASS** — same command → green.
- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/core/__tests__/config.test.ts
git commit -m "feat(core): clones config block with fail-open field parsing" -m "Noldor-FD: code-clone-detector"
```

## Task 2: shared corpus walker

**Files:**
- Modify: `src/core/repo-paths.ts`
- Test: `src/core/__tests__/repo-paths.test.ts`

- [ ] **Step 1: failing test** — append:

```ts
describe('walkCodeFiles', () => {
  it('collects code files, skipping tests/dist by default, including with flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-walk-'));
    mkdirSync(join(dir, 'a', '__tests__'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'a', 'x.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', 'y.test.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', '__tests__', 'z.ts'), 'export {};\n');
    writeFileSync(join(dir, 'dist', 'd.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', 'n.md'), '# no\n');
    const rel = (xs: string[]) => xs.map((p) => p.slice(dir.length + 1)).sort();
    expect(rel(walkCodeFiles(dir, { includeTests: false }))).toEqual(['a/x.ts']);
    expect(rel(walkCodeFiles(dir, { includeTests: true }))).toEqual([
      'a/__tests__/z.ts',
      'a/x.ts',
      'a/y.test.ts',
    ]);
    expect(walkCodeFiles(join(dir, 'missing'), { includeTests: false })).toEqual([]);
  });
});
```

- [ ] **Step 2: run to FAIL** — `pnpm vitest run src/core/__tests__/repo-paths.test.ts` → red.
- [ ] **Step 3: implement** — append to `src/core/repo-paths.ts` (mirrors `src/sync/sync-code-links.ts:11-13` policy; that module keeps its private copy — migrating the 5 existing walkers is out of scope):

```ts
const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const WALK_EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', 'fixtures']);

/**
 * Recursively collect code files under `root` (`.ts/.tsx/.js/.jsx`, the same
 * extension policy as sync-code-links). Test files (`*.test.*`, `*.spec.*`,
 * `__tests__/`) are skipped unless `includeTests`. Missing root → `[]`.
 */
export function walkCodeFiles(root: string, opts: { includeTests: boolean }): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (WALK_EXCLUDED_DIRS.has(entry.name)) continue;
        if (!opts.includeTests && entry.name === '__tests__') continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && CODE_FILE_RE.test(entry.name)) {
        if (!opts.includeTests && TEST_FILE_RE.test(entry.name)) continue;
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}
```

(`__tests__` moves out of the always-excluded set into the includeTests-conditional branch; add `readdirSync` to the fs import.)

- [ ] **Step 4: run to PASS** → green.
- [ ] **Step 5: Commit**

```bash
git add src/core/repo-paths.ts src/core/__tests__/repo-paths.test.ts
git commit -m "feat(core): walkCodeFiles shared corpus walker on repo-paths" -m "Noldor-FD: code-clone-detector"
```

## Task 3: tokenizer

**Files:**
- Create: `src/clones/tokenize.ts`
- Test: `src/clones/__tests__/tokenize.test.ts`

- [ ] **Step 1: failing test** — create test asserting: comments skipped; strings/templates collapse to one `LIT`; identifiers → `norm:'ID'` with raw text kept; keywords verbatim; numbers → `LIT`; line numbers accurate across newlines (complete test code in repo; assertions per spec Testing #1).
- [ ] **Step 2: run to FAIL** — `pnpm vitest run src/clones/__tests__/tokenize.test.ts` → module-not-found red.
- [ ] **Step 3: implement `src/clones/tokenize.ts`** — scanner with: `KEYWORDS` set (TS/JS reserved words), states for `//`, `/* */`, `'`, `"`, backtick templates (`${` nesting depth-tracked, whole template = one `LIT`), identifier runs `[A-Za-z_$][\w$]*`, number runs, single-char punctuation tokens. Export `Token { text, norm, line }` and `tokenize(source): Token[]`. Unknown chars → punctuation token (never throw).
- [ ] **Step 4: run to PASS** → green.
- [ ] **Step 5: Commit**

```bash
git add src/clones/tokenize.ts src/clones/__tests__/tokenize.test.ts
git commit -m "feat(clones): TS/JS clone tokenizer with Type-2 normalization" -m "Noldor-FD: code-clone-detector"
```

## Task 4: detector

**Files:**
- Create: `src/clones/detect.ts`
- Test: `src/clones/__tests__/detect.test.ts`

- [ ] **Step 1: failing tests** — spec Testing #2–#6 + #8: Type-1 cross-file group; Type-2 renamed; Type-3 gap-merge vs separate; minTokens/minLines floors; repetitive-run: no overlapping instances + count ≤ 1 after containment dedup; duplicationPct dedup math; determinism (deep-equal on repeat).
- [ ] **Step 2: run to FAIL** → red.
- [ ] **Step 3: implement `src/clones/detect.ts`** per spec Unit 2: window hash map over normalized streams → candidate pairs → verify token-equal → discard overlapping seed pairs → greedy extend → discard pairs whose EXTENDED ranges overlap → same-pair gap-merge (≤ gapTokens) → minTokens/minLines floors → containment dedup (injective mapping onto distinct instances of a larger group) → coverage-dedup duplicatedTokens → `CloneReport`. Export `CloneOptions`, `CloneInstance`, `CloneGroup`, `CloneReport`, `detectClones`, `DEFAULT_CLONE_OPTIONS = { minTokens: 50, minLines: 5, gapTokens: 10 }`.
- [ ] **Step 4: run to PASS** → green.
- [ ] **Step 5: Commit**

```bash
git add src/clones/detect.ts src/clones/__tests__/detect.test.ts
git commit -m "feat(clones): Rabin-Karp clone detector with overlap guards and containment dedup" -m "Noldor-FD: code-clone-detector"
```

## Task 5: CLI + manifest

**Files:**
- Create: `src/clones/clones-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/clones/__tests__/clones-cli.test.ts`

- [ ] **Step 1: failing tests** — fixture repo (config + seeded duplicate files): `report --json` emits CloneReport shape; `check` exit 0 with no threshold, exit 1 when `thresholdPct` exceeded; flags override config.
- [ ] **Step 2: run to FAIL** → red.
- [ ] **Step 3: implement** — `runClones(argv, cwd): Promise<number>` (injectable for tests) reading `scanRoots(cwd)` + `walkCodeFiles`, `loadConfig` for the `clones` block, flag parse (`--json`, `--min-tokens`, `--min-lines`, `--gap-tokens`, `--include-tests`); human summary top-10 `file:start-end ⇄ file:start-end (N tokens)`; `main()` guard on direct invocation (existing CLI-module convention). Manifest: `clones: { desc: 'Token-based code-clone detection', subs: { report: {...}, check: {...} } }`.
- [ ] **Step 4: run to PASS**; also `pnpm noldor clones report` live → deterministic summary, exit 0; `pnpm noldor clones check` → exit 0 (no threshold configured).
- [ ] **Step 5: Commit**

```bash
git add src/clones/clones-cli.ts src/cli/manifest.ts src/clones/__tests__/clones-cli.test.ts
git commit -m "feat(cli): noldor clones report/check subcommands" -m "Noldor-FD: code-clone-detector"
```

## Task 6: sdd-report section

**Files:**
- Modify: `src/garden/sdd-report.ts`
- Test: existing sdd-report tests stay green; regen `docs/sdd-report.md`

- [ ] **Step 1: implement** — in `main()` after the Summary block: REUSE the already-walked `allRepoPaths` corpus (sdd-report.ts:891-896 walks every scan root once) — filter it with the same `CODE_FILE_RE`/`TEST_FILE_RE` policy (export the two regexes alongside `walkCodeFiles` in repo-paths.ts and filter `allRepoPaths` by them; no second tree walk, no divergent exclusion policy), read the surviving files, `detectClones` with config/default opts, push `## Code clones` + `- N clone groups, X.Y% duplicated tokens across M files` + top-5 groups as `- path:start-end and path:start-end (N tokens)` bullets (no `_`/`*` in generated strings — oxfmt gotcha).
- [ ] **Step 2: verify** — `pnpm vitest run src/garden` green; `pnpm noldor garden sdd-report` regen → section present, `pnpm noldor fmt --check docs/sdd-report.md` clean; commit regen with the code.
- [ ] **Step 3: Commit**

```bash
git add src/garden/sdd-report.ts docs/sdd-report.md
git commit -m "feat(garden): Code clones section in sdd-report" -m "Noldor-FD: code-clone-detector"
```

## Task 7: FD links + full verify

**Files:**
- Modify: `docs/features/code-clone-detector.md`

- [ ] **Step 1:** fill `links.code` (config.ts, repo-paths.ts, tokenize.ts, detect.ts, clones-cli.ts, manifest.ts, sdd-report.ts); links.tests auto-synced by hook.
- [ ] **Step 2:** `pnpm typecheck && pnpm vitest run` → all green.
- [ ] **Step 3: Commit**

```bash
git add docs/features/code-clone-detector.md
git commit -m "docs(features:code-clone-detector): fill links.code" -m "Noldor-FD: code-clone-detector"
```
