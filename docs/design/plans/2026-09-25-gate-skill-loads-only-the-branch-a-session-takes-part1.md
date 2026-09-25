# Gate Skill Loads Only the Branch a Session Takes Implementation Plan — Part 1: the skill-size ratchet

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor skill-size check` refuses a push from this repo that grows any `.claude/skills/**/*.md` file past its recorded word count, `pnpm noldor skill-size baseline` re-records it, and the one-commit micro-chore lane can carry the re-record.

**Architecture:**
- **One new file.** `src/checks/skill-size.ts` holds the measure, the compare, the baseline read/write and the CLI, in the shape of `src/indirection/indirection-cli.ts` but inside the existing `src/checks` module (spec D4: no new module, so no architecture design).
- **One shared reader.** Reading a schema-checked `.noldor/` state file without throwing becomes `readCheckedState` in `src/core/state-file.ts`. The clones and indirection baselines already carry that exact block, so the skill-size ratchet is its third site; routing all three through it is what keeps the clone ratchet's diff-scope verdict green.
- **Self-host wiring.** The job runs at pre-push from the root `lefthook.yml` only (spec D5); `checks push-gates` replays it with no code change.

**Tech Stack:** TypeScript, zod, vitest, lefthook.

**Parts:** 1 of 4. Part 2 makes `docs/noldor/drain-mode.md` the only drain contract; Part 3 splits the gate skill into a router and branch files; Part 4 adds the router-integrity rules. The integrity rules come last on purpose: they would refuse Part 3's intermediate commits, in which branch files exist before the router names them.

**Spec:** [`2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md) — § Skill-size ratchet; acceptance criteria 10–12.

---

## File Structure

- `src/core/state-file.ts` + `src/core/__tests__/state-file.test.ts` — **Modify.** Add `readCheckedState` / `CheckedStateRead<T>`.
- `src/clones/baseline.ts`, `src/indirection/baseline.ts` — **Modify.** `readBaseline` calls `readCheckedState` instead of repeating it.
- `src/checks/skill-size.ts` — **Create.** Measure, compare, baseline read/write, CLI `check|baseline`.
- `src/checks/__tests__/skill-size.test.ts` — **Create.** Real temp repos; includes the entry's +200-words deletion test.
- `src/cli/manifest.ts` — **Modify.** The `skill-size` verb group.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** One table row.
- `AGENTS.md` + `templates/AGENTS.md` — **Modify** (generated). Capability index.
- `src/core/allowlist.ts` + `src/core/__tests__/allowlist.test.ts` — **Modify.** `.noldor/skill-size-baseline.json` joins `MICRO_CHORE_GLOBS`.
- `lefthook.yml` — **Modify.** Self-host `pre-push` job `skill-size`.
- `.noldor/skill-size-baseline.json` — **Create.** The first record.

---

## Task 1: A shared reader for schema-checked state files

**Files:**
- Modify: `src/core/state-file.ts`, `src/clones/baseline.ts`, `src/indirection/baseline.ts`
- Test: `src/core/__tests__/state-file.test.ts`

- [ ] **Step 1: Brief the rules for these files.**

  Run: `pnpm noldor rules brief --file src/core/state-file.ts --file src/core/__tests__/state-file.test.ts --file src/clones/baseline.ts --file src/indirection/baseline.ts --stage code`

  Expected: an `ENFORCE` section that includes `error-result-types`, `state-file-schema-additive` and `test-real-behavior`. It is binding.

- [ ] **Step 2: Write the failing test.** Apply this change to `src/core/__tests__/state-file.test.ts` (it adds the `zod` and `readCheckedState` imports and a `readCheckedState` block):

~~~diff
diff --git a/src/core/__tests__/state-file.test.ts b/src/core/__tests__/state-file.test.ts
index 6c7341e..05fed73 100644
--- a/src/core/__tests__/state-file.test.ts
+++ b/src/core/__tests__/state-file.test.ts
@@ -4,5 +4,7 @@ import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } fro
 import { tmpdir } from 'node:os';
 import { join } from 'node:path';
-import { readJsonState, writeJsonState } from '../state-file.js';
+import { z } from 'zod';
+
+import { readCheckedState, readJsonState, writeJsonState } from '../state-file.js';
 
 const scratch = (): string => mkdtempSync(join(tmpdir(), 'sf-'));
@@ -53,2 +55,25 @@ describe('writeJsonState', () => {
   });
 });
+
+describe('readCheckedState', () => {
+  const schema = z.object({ n: z.number() }).strict();
+
+  it('returns the checked value', () => {
+    const target = join(scratch(), 'state.json');
+    writeJsonState(target, { n: 3 });
+    expect(readCheckedState(target, schema)).toEqual({ kind: 'ok', value: { n: 3 } });
+  });
+
+  it('reports a missing file as absent', () => {
+    expect(readCheckedState(join(scratch(), 'none.json'), schema)).toEqual({ kind: 'absent' });
+  });
+
+  it('reports unparseable JSON and a schema miss as unreadable, never throwing', () => {
+    const broken = join(scratch(), 'broken.json');
+    writeFileSync(broken, '{ nope');
+    expect(readCheckedState(broken, schema).kind).toBe('unreadable');
+    const wrong = join(scratch(), 'wrong.json');
+    writeJsonState(wrong, { n: 'three' });
+    expect(readCheckedState(wrong, schema).kind).toBe('unreadable');
+  });
+});
~~~

- [ ] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/core/__tests__/state-file.test.ts`

  Expected: FAIL — `readCheckedState` is not exported by `../state-file.js` (`TypeError: readCheckedState is not a function`).

- [ ] **Step 4: Implement.** Apply this change to `src/core/state-file.ts`:

~~~diff
diff --git a/src/core/state-file.ts b/src/core/state-file.ts
index 0d16a44..35431d3 100644
--- a/src/core/state-file.ts
+++ b/src/core/state-file.ts
@@ -1,4 +1,7 @@
 import { mkdirSync, readFileSync } from 'node:fs';
 import { dirname } from 'node:path';
+
+import type { z } from 'zod';
+
 import { atomicWriteFileSync } from './atomic-write.js';
 
@@ -71,2 +74,29 @@ export function writeJsonState(path: string, value: unknown): void {
   atomicWriteFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
 }
+
+/** Outcome of reading a schema-checked state file. */
+export type CheckedStateRead<T> =
+  | { kind: 'ok'; value: T }
+  | { kind: 'absent' }
+  | { kind: 'unreadable'; reason: string };
+
+/**
+ * Read a JSON state file and check it against `schema`, never throwing: a
+ * missing file is `absent`; an unreadable file, unparseable JSON or a schema
+ * miss is `unreadable` with the reason, so a ratchet can fail closed on it.
+ */
+export function readCheckedState<T>(path: string, schema: z.ZodType<T>): CheckedStateRead<T> {
+  let raw: unknown;
+  try {
+    raw = readJsonState<unknown>(path);
+  } catch (err) {
+    return { kind: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
+  }
+  if (raw === undefined) return { kind: 'absent' };
+  const parsed = schema.safeParse(raw);
+  if (parsed.success) return { kind: 'ok', value: parsed.data };
+  return {
+    kind: 'unreadable',
+    reason: parsed.error.issues[0]?.message ?? 'does not match its schema',
+  };
+}
~~~

- [ ] **Step 5: Route the two existing baselines through it.** Apply both changes:

~~~diff
diff --git a/src/clones/baseline.ts b/src/clones/baseline.ts
index 41d7291..ca8d0cb 100644
--- a/src/clones/baseline.ts
+++ b/src/clones/baseline.ts
@@ -17,5 +17,5 @@
 import { z } from 'zod';
 
-import { readJsonState, writeJsonState } from '../core/state-file.js';
+import { readCheckedState, writeJsonState } from '../core/state-file.js';
 import type { CloneOptions, CloneReport } from './detect.js';
 
@@ -122,16 +122,6 @@ export type BaselineRead =
 
 export function readBaseline(path: string): BaselineRead {
-  // `readJsonState` owns the absent-vs-corrupt split (its throw covers both an
-  // unreadable file and unparseable JSON); only schema validity is left here.
-  let json: unknown;
-  try {
-    json = readJsonState<unknown>(path);
-  } catch (err) {
-    return { kind: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
-  }
-  if (json === undefined) return { kind: 'absent' };
-  const parsed = cloneBaselineSchema.safeParse(json);
-  if (!parsed.success) return { kind: 'unreadable', reason: 'not a valid clones baseline' };
-  return { kind: 'ok', baseline: parsed.data };
+  const read = readCheckedState(path, cloneBaselineSchema);
+  return read.kind === 'ok' ? { kind: 'ok', baseline: read.value } : read;
 }
 
~~~

~~~diff
diff --git a/src/indirection/baseline.ts b/src/indirection/baseline.ts
index d25e92d..21aae53 100644
--- a/src/indirection/baseline.ts
+++ b/src/indirection/baseline.ts
@@ -14,5 +14,5 @@ import { join } from 'node:path';
 import { z } from 'zod';
 
-import { readJsonState, writeJsonState } from '../core/state-file.js';
+import { readCheckedState, writeJsonState } from '../core/state-file.js';
 import type { MeasuredIndirection } from './detect.js';
 
@@ -100,17 +100,7 @@ export type BaselineRead =
 
 export function readBaseline(path: string): BaselineRead {
-  let raw: unknown;
-  try {
-    raw = readJsonState(path);
-  } catch (e) {
-    // readJsonState throws StateFileCorruptError on unparseable content; the
-    // file is an external boundary, so convert rather than propagate.
-    return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) };
-  }
-  if (raw === undefined) return { kind: 'absent' };
-  const parsed = indirectionBaselineSchema.safeParse(raw);
-  return parsed.success
-    ? { kind: 'ok', baseline: parsed.data }
-    : { kind: 'unreadable', message: parsed.error.message };
+  const read = readCheckedState(path, indirectionBaselineSchema);
+  if (read.kind === 'ok') return { kind: 'ok', baseline: read.value };
+  return read.kind === 'absent' ? read : { kind: 'unreadable', message: read.reason };
 }
 
~~~

  A clones schema miss now reports zod's first issue instead of the fixed `not a valid clones baseline`; only the `kind` is asserted anywhere, and the reason is more useful to the reader of the refusal.

- [ ] **Step 6: Run to verify PASS.**

  Run: `pnpm vitest run src/core/__tests__/state-file.test.ts src/clones src/indirection`

  Expected: every file passes; the three new `readCheckedState` cases are among them.

- [ ] **Step 7: Typecheck, lint, format.**

  Run: `pnpm typecheck && pnpm exec oxlint src/core/state-file.ts src/clones/baseline.ts src/indirection/baseline.ts && pnpm noldor fmt src/core/state-file.ts src/core/__tests__/state-file.test.ts src/clones/baseline.ts src/indirection/baseline.ts`

  Expected: all exit 0, no lint findings.

- [ ] **Step 8: Commit.** This is the branch's first code-bearing commit, so its body carries the PR Summary sections.

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  refactor(features:gate-skill-loads-only-the-branch-a-session-takes): read schema-checked state files through one helper

  Why — `.claude/skills/noldor-gate/SKILL.md` is 13,690 words and loads whole into every gate session, interactive or drain, though each session runs one path. A rule that applies on only some paths sits deep in a long file, and nothing stops a trimmed skill from regrowing.

  How — the gate skill becomes a router of at most 3,000 words plus branch files cut by job and read at `**Read now:**` forks; drain, finish and drain-resume live only in `docs/noldor/drain-mode.md`; incident history moves to the runbooks; a per-file word-count ratchet and two router-integrity rules hold the result.

  What — this commit adds `readCheckedState` to `src/core/state-file.ts`, the absent / unreadable / ok read the clones and indirection baselines each carried, and routes both through it ahead of the skill-size ratchet, its third caller.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/state-file.ts src/core/__tests__/state-file.test.ts src/clones/baseline.ts src/indirection/baseline.ts
  git commit -F "$msg"
  ```

  Expected: the commit lands.

---

## Task 2: Measure skill files against a recorded baseline

**Files:**
- Create: `src/checks/skill-size.ts`
- Test: `src/checks/__tests__/skill-size.test.ts`

- [ ] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file src/checks/skill-size.ts --file src/checks/__tests__/skill-size.test.ts --stage code`

  Expected: `ENFORCE` includes `self-explanatory-code`, `test-real-behavior` and `test-mocking-boundaries` (a spy on `process.stdout` / `process.stderr` is a system boundary, allowed).

- [ ] **Step 2: Write the failing tests.** Create `src/checks/__tests__/skill-size.test.ts`:

  ```ts
  // @tests: gate-skill-loads-only-the-branch-a-session-takes
  import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { dirname, join } from 'node:path';
  import { afterEach, describe, expect, it, vi } from 'vitest';

  import {
    SKILL_SIZE_ALGORITHM_VERSION,
    SKILL_SIZE_BASELINE,
    compareSkillSizes,
    main,
    measureSkillSizes,
    readSkillSizeBaseline,
    writeSkillSizeBaseline,
  } from '../skill-size.js';

  function repoWith(files: Record<string, string>): { dir: string; [Symbol.dispose](): void } {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-skill-size-'));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body, 'utf8');
    }
    return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
  }

  async function run(
    argv: string[],
    dir: string,
  ): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
    const code = await main(argv, dir);
    vi.restoreAllMocks();
    return { code, out: out.join(''), err: err.join('') };
  }

  afterEach(() => vi.restoreAllMocks());

  const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  describe('measureSkillSizes', () => {
    it('counts every markdown file under .claude/skills, nested ones included, and nothing else', () => {
      using repo = repoWith({
        '.claude/skills/demo/SKILL.md': 'one two three\n',
        '.claude/skills/demo/branch.md': 'four five\n',
        '.claude/skills/demo/deep/more.md': 'six\n',
        '.claude/skills/demo/notes.txt': 'not markdown at all\n',
        'docs/design/specs/x-design.md': 'a spec is never counted\n',
      });
      expect(measureSkillSizes(repo.dir)).toEqual({
        '.claude/skills/demo/SKILL.md': 3,
        '.claude/skills/demo/branch.md': 2,
        '.claude/skills/demo/deep/more.md': 1,
      });
    });

    it('is empty when the repo has no skills folder', () => {
      using repo = repoWith({ 'README.md': 'hi\n' });
      expect(measureSkillSizes(repo.dir)).toEqual({});
    });
  });

  describe('compareSkillSizes', () => {
    it('names each file as grew, unrecorded, fell, same or gone', () => {
      const rows = compareSkillSizes(
        { 'a.md': 10, 'b.md': 10, 'c.md': 10, 'gone.md': 4 },
        { 'a.md': 12, 'b.md': 8, 'c.md': 10, 'new.md': 3 },
      );
      expect(rows).toEqual([
        { path: 'a.md', kind: 'grew', baseline: 10, words: 12 },
        { path: 'b.md', kind: 'fell', baseline: 10, words: 8 },
        { path: 'c.md', kind: 'same', words: 10 },
        { path: 'gone.md', kind: 'gone', baseline: 4 },
        { path: 'new.md', kind: 'unrecorded', words: 3 },
      ]);
    });
  });

  describe('readSkillSizeBaseline', () => {
    it('reads back what writeSkillSizeBaseline wrote', () => {
      using repo = repoWith({});
      writeSkillSizeBaseline(repo.dir, { 'a.md': 5 }, new Date('2026-09-25T00:00:00.000Z'));
      expect(readSkillSizeBaseline(repo.dir)).toEqual({
        kind: 'ok',
        baseline: {
          algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION,
          recordedAt: '2026-09-25T00:00:00.000Z',
          files: { 'a.md': 5 },
        },
      });
    });

    it('reports a missing file as absent and a corrupt one as unreadable', () => {
      using missing = repoWith({});
      expect(readSkillSizeBaseline(missing.dir)).toEqual({ kind: 'absent' });
      using corrupt = repoWith({ [SKILL_SIZE_BASELINE]: '{ not json' });
      expect(readSkillSizeBaseline(corrupt.dir).kind).toBe('unreadable');
    });

    it('refuses a baseline recorded by another algorithm version', () => {
      using repo = repoWith({
        [SKILL_SIZE_BASELINE]: JSON.stringify({
          algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION + 1,
          recordedAt: 'x',
          files: {},
        }),
      });
      expect(readSkillSizeBaseline(repo.dir).kind).toBe('unreadable');
    });
  });

  describe('noldor skill-size check', () => {
    const SKILL = '.claude/skills/demo/SKILL.md';

    it('passes when every file is within its baseline, a shrunk one included', async () => {
      using repo = repoWith({ [SKILL]: words(50), '.claude/skills/demo/branch.md': words(20) });
      await run(['baseline'], repo.dir);
      writeFileSync(join(repo.dir, SKILL), words(40));
      expect((await run(['check'], repo.dir)).code).toBe(0);
    });

    it('refuses a push that adds 200 words to a SKILL.md, naming the file, until the baseline is re-recorded', async () => {
      using repo = repoWith({ [SKILL]: words(100) });
      await run(['baseline'], repo.dir);
      writeFileSync(join(repo.dir, SKILL), words(300));
      const refused = await run(['check'], repo.dir);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain(`${SKILL} — 300 words, baseline 100 (+200)`);
      await run(['baseline'], repo.dir);
      expect((await run(['check'], repo.dir)).code).toBe(0);
    });

    it('refuses a new skill file that has no baseline entry', async () => {
      using repo = repoWith({ [SKILL]: words(10) });
      await run(['baseline'], repo.dir);
      writeFileSync(join(repo.dir, '.claude/skills/demo/new-branch.md'), words(5));
      const refused = await run(['check'], repo.dir);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('.claude/skills/demo/new-branch.md — 5 words, no baseline entry');
    });

    it('exits 3 with the record remedy when there is no baseline, or an unreadable one', async () => {
      using none = repoWith({ [SKILL]: words(10) });
      const missing = await run(['check'], none.dir);
      expect(missing.code).toBe(3);
      expect(missing.err).toContain('pnpm noldor skill-size baseline');
      using corrupt = repoWith({ [SKILL]: words(10), [SKILL_SIZE_BASELINE]: '[]' });
      expect((await run(['check'], corrupt.dir)).code).toBe(3);
    });

    it('exits 2 on an unknown subcommand or extra argument', async () => {
      using repo = repoWith({});
      expect((await run(['report'], repo.dir)).code).toBe(2);
      expect((await run(['check', '--json'], repo.dir)).code).toBe(2);
    });
  });

  describe('noldor skill-size baseline', () => {
    it('records every skill file and prints which ones moved', async () => {
      using repo = repoWith({
        '.claude/skills/a/SKILL.md': words(3),
        '.claude/skills/b/SKILL.md': words(4),
      });
      const first = await run(['baseline'], repo.dir);
      expect(first.code).toBe(0);
      expect(first.out).toContain('new .claude/skills/a/SKILL.md — 3 words');
      const stored = JSON.parse(readFileSync(join(repo.dir, SKILL_SIZE_BASELINE), 'utf8')) as {
        files: Record<string, number>;
      };
      expect(stored.files).toEqual({
        '.claude/skills/a/SKILL.md': 3,
        '.claude/skills/b/SKILL.md': 4,
      });
      writeFileSync(join(repo.dir, '.claude/skills/a/SKILL.md'), words(5));
      expect((await run(['baseline'], repo.dir)).out).toContain(
        'RAISED .claude/skills/a/SKILL.md — 5 words, baseline 3 (+2)',
      );
    });
  });
  ```

- [ ] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/checks/__tests__/skill-size.test.ts`

  Expected: FAIL — `Failed to load url ../skill-size.js` (the module does not exist).

- [ ] **Step 4: Implement.** Create `src/checks/skill-size.ts`:

  ```ts
  // @fd: gate-skill-loads-only-the-branch-a-session-takes
  /**
   * `noldor skill-size <check|baseline>` — a word-count ratchet over every markdown
   * file under `.claude/skills/`, one baseline entry per file.
   *
   *                              check   baseline
   *   every file within baseline   0        0
   *   a file grew, or is new       1        0   (records, prints direction)
   *   baseline absent              3        0
   *   baseline unreadable          3        0   (overwrites)
   *   usage error                  2        2
   */
  import { existsSync, readFileSync, readdirSync } from 'node:fs';
  import { join, relative, sep } from 'node:path';

  import { z } from 'zod';

  import { runIfDirect } from '../core/cli-entry.js';
  import { readCheckedState, writeJsonState } from '../core/state-file.js';
  import { countWords } from '../utils/word-count.js';

  export const SKILL_SIZE_BASELINE = '.noldor/skill-size-baseline.json';

  /**
   * Bumped when what the ratchet counts changes. A baseline from another version
   * reads as unreadable (exit 3) rather than as a skip: the ratchet runs in this
   * repo only, the bump lands in the same change as its re-record, and a skip
   * would leave the only repo it guards unguarded until someone noticed.
   */
  export const SKILL_SIZE_ALGORITHM_VERSION = 1;

  export const skillSizeBaselineSchema = z
    .object({
      algorithmVersion: z.number().int(),
      recordedAt: z.string().min(1),
      files: z.record(z.string(), z.number().int().nonnegative()),
    })
    .strict();
  export type SkillSizeBaseline = z.infer<typeof skillSizeBaselineSchema>;

  export type BaselineRead =
    | { kind: 'ok'; baseline: SkillSizeBaseline }
    | { kind: 'absent' }
    | { kind: 'unreadable'; reason: string };

  export type SkillSizeRow =
    | { path: string; kind: 'grew'; baseline: number; words: number }
    | { path: string; kind: 'unrecorded'; words: number }
    | { path: string; kind: 'fell'; baseline: number; words: number }
    | { path: string; kind: 'same'; words: number }
    | { path: string; kind: 'gone'; baseline: number };

  const byPath = (a: string, b: string): number => a.localeCompare(b, 'en');

  /** Every `.md` file under `dir`, recursively. */
  export function markdownFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return markdownFilesUnder(full);
      return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
    });
  }

  /**
   * Word count of every `.md` under `.claude/skills/`, keyed by repo-relative POSIX
   * path and sorted by it. Frontmatter and fenced blocks count: an agent loads them.
   */
  export function measureSkillSizes(repo: string): Record<string, number> {
    const root = join(repo, '.claude', 'skills');
    if (!existsSync(root)) return {};
    const sizes = markdownFilesUnder(root).map((file): [string, number] => [
      relative(repo, file).split(sep).join('/'),
      countWords(readFileSync(file, 'utf8')),
    ]);
    return Object.fromEntries(sizes.sort(([a], [b]) => byPath(a, b)));
  }

  /** One row per file in either map, sorted by path. */
  export function compareSkillSizes(
    baseline: Record<string, number>,
    current: Record<string, number>,
  ): SkillSizeRow[] {
    const rows: SkillSizeRow[] = [];
    for (const [path, words] of Object.entries(current)) {
      const recorded = baseline[path];
      if (recorded === undefined) rows.push({ path, kind: 'unrecorded', words });
      else if (words > recorded) rows.push({ path, kind: 'grew', baseline: recorded, words });
      else if (words < recorded) rows.push({ path, kind: 'fell', baseline: recorded, words });
      else rows.push({ path, kind: 'same', words });
    }
    for (const [path, recorded] of Object.entries(baseline)) {
      if (current[path] === undefined) rows.push({ path, kind: 'gone', baseline: recorded });
    }
    return rows.sort((a, b) => byPath(a.path, b.path));
  }

  /** Read `.noldor/skill-size-baseline.json`; a parse, schema or version failure is `unreadable`, never a throw. */
  export function readSkillSizeBaseline(repo: string): BaselineRead {
    const read = readCheckedState(join(repo, SKILL_SIZE_BASELINE), skillSizeBaselineSchema);
    if (read.kind !== 'ok') return read;
    if (read.value.algorithmVersion !== SKILL_SIZE_ALGORITHM_VERSION) {
      return {
        kind: 'unreadable',
        reason: `recorded by algorithm version ${read.value.algorithmVersion}; this is version ${SKILL_SIZE_ALGORITHM_VERSION}`,
      };
    }
    return { kind: 'ok', baseline: read.value };
  }

  /** Write the baseline for `files`, stamped with the current algorithm version. */
  export function writeSkillSizeBaseline(
    repo: string,
    files: Record<string, number>,
    now: Date = new Date(),
  ): void {
    const baseline: SkillSizeBaseline = {
      algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION,
      recordedAt: now.toISOString(),
      files,
    };
    writeJsonState(join(repo, SKILL_SIZE_BASELINE), baseline);
  }

  const REMEDY = 'pnpm noldor skill-size baseline';

  function describeRow(row: SkillSizeRow): string {
    switch (row.kind) {
      case 'grew':
        return `${row.path} — ${row.words} words, baseline ${row.baseline} (+${row.words - row.baseline})`;
      case 'unrecorded':
        return `${row.path} — ${row.words} words, no baseline entry`;
      case 'fell':
        return `${row.path} — ${row.words} words, baseline ${row.baseline} (${row.words - row.baseline})`;
      case 'same':
        return `${row.path} — ${row.words} words`;
      case 'gone':
        return `${row.path} — recorded at ${row.baseline} words, no longer on disk`;
    }
  }

  function check(repo: string): number {
    const read = readSkillSizeBaseline(repo);
    if (read.kind !== 'ok') {
      const why =
        read.kind === 'absent'
          ? `no baseline at ${SKILL_SIZE_BASELINE}`
          : `${SKILL_SIZE_BASELINE} is unreadable: ${read.reason}`;
      process.stderr.write(`✗ skill-size: ${why}. Record one: ${REMEDY}\n`);
      return 3;
    }
    const rows = compareSkillSizes(read.baseline.files, measureSkillSizes(repo));
    const over = rows.filter((r) => r.kind === 'grew' || r.kind === 'unrecorded');
    const gone = rows.filter((r) => r.kind === 'gone');
    for (const r of gone)
      process.stdout.write(`skill-size: ${describeRow(r)} (the next baseline drops it)\n`);
    if (over.length === 0) {
      process.stdout.write(
        `skill-size: ${rows.length - gone.length} skill files within their baseline\n`,
      );
      return 0;
    }
    process.stderr.write(`✗ skill-size: ${over.length} skill file(s) over the recorded baseline:\n`);
    for (const r of over) process.stderr.write(`    ${describeRow(r)}\n`);
    process.stderr.write(`  If the growth is deliberate, re-record in the same push: ${REMEDY}\n`);
    return 1;
  }

  function record(repo: string): number {
    const current = measureSkillSizes(repo);
    const read = readSkillSizeBaseline(repo);
    const previous = read.kind === 'ok' ? read.baseline.files : {};
    writeSkillSizeBaseline(repo, current);
    process.stdout.write(
      `skill-size: recorded ${Object.keys(current).length} skill files to ${SKILL_SIZE_BASELINE}\n`,
    );
    const label = { grew: 'RAISED', fell: 'lowered', unrecorded: 'new', gone: 'dropped' } as const;
    for (const r of compareSkillSizes(previous, current)) {
      if (r.kind !== 'same') process.stdout.write(`  ${label[r.kind]} ${describeRow(r)}\n`);
    }
    return 0;
  }

  /**
   * CLI entry: `noldor skill-size <check|baseline>`.
   *
   * @param argv - Arguments after the verb.
   * @param repo - Repository root.
   * @returns The exit code in the table at the top of this file.
   */
  export async function main(argv: string[], repo: string = process.cwd()): Promise<number> {
    const [sub, ...rest] = argv;
    if ((sub !== 'check' && sub !== 'baseline') || rest.length > 0) {
      process.stderr.write('usage: noldor skill-size <check|baseline>\n');
      return 2;
    }
    return sub === 'check' ? check(repo) : record(repo);
  }

  runIfDirect('skill-size', 'skill-size', (argv) => main(argv));
  ```

- [ ] **Step 5: Run to verify PASS.**

  Run: `pnpm vitest run src/checks/__tests__/skill-size.test.ts`

  Expected: `Tests  12 passed (12)`.

- [ ] **Step 6: Typecheck, lint, format, and the clone ratchet.**

  Run: `pnpm typecheck && pnpm exec oxlint src/checks/skill-size.ts src/checks/__tests__/skill-size.test.ts && pnpm noldor fmt src/checks/skill-size.ts src/checks/__tests__/skill-size.test.ts && git add -N src/checks/skill-size.ts && pnpm noldor clones check`

  Expected: all exit 0; `clones check: no clone group touches this change - green`.

- [ ] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(features:gate-skill-loads-only-the-branch-a-session-takes): measure skill files against a recorded word-count baseline

  Adds src/checks/skill-size.ts: it counts every .md under .claude/skills/, one entry per file, compares the counts with .noldor/skill-size-baseline.json and reads and writes that baseline. A file that grew or has no entry fails the check; a missing, unreadable or other-version baseline exits 3.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/skill-size.ts src/checks/__tests__/skill-size.test.ts
  git commit -F "$msg"
  ```

  Expected: the commit lands; the pre-commit `test-links` job adds the new test to the FD's `links.tests` and stages it.

---

## Task 3: The `skill-size` command

**Files:**
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`, `AGENTS.md`, `templates/AGENTS.md`

- [ ] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file src/cli/manifest.ts --file docs/noldor/script-catalog.md --stage code`

  Expected: `sibling-scope-trailer` appears for the catalog page (this commit mixes code with a `docs/noldor/` page).

- [ ] **Step 2: Verify the verb does not exist yet.**

  Run: `pnpm noldor skill-size check`

  Expected: non-zero, an unknown-command message naming `skill-size`.

- [ ] **Step 3: Register the verb group.** In `src/cli/manifest.ts`, insert after the `indirection: { … }` block (the one whose `src` is `indirection/indirection-cli.ts`):

  ```ts
  'skill-size': {
    desc: 'Per-file word-count ratchet over .claude/skills (this repo only)',
    subs: {
      '': { src: 'checks/skill-size.ts', desc: 'skill-size <check|baseline>' },
    },
  },
  ```

- [ ] **Step 4: Verify the verb runs.**

  Run: `pnpm noldor skill-size check`

  Expected: exit 3 with `✗ skill-size: no baseline at .noldor/skill-size-baseline.json. Record one: pnpm noldor skill-size baseline` (the baseline is recorded in Task 4).

- [ ] **Step 5: Catalog it.** In `docs/noldor/script-catalog.md`, insert after the `pnpm noldor indirection` table row:

  ```markdown
  | `pnpm noldor skill-size`                 | [`src/checks/skill-size.ts`](../../src/checks/skill-size.ts) | `skill-size <check\|baseline>` per-file word-count ratchet over `.claude/skills/**/*.md`; pre-push in this repo only (root `lefthook.yml`). |
  ```

  Then mirror the twin: `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`.

- [ ] **Step 6: Regenerate the capability index.**

  Run: `pnpm noldor docs capability-index --write`

  Expected: `AGENTS.md` and `templates/AGENTS.md` each gain a `skill-size` line in the generated `## Capability index` list.

- [ ] **Step 7: Verify the wiring.**

  Run: `pnpm noldor validate script-catalog && pnpm noldor docs capability-index && pnpm noldor checks template-sync docs/noldor/script-catalog.md AGENTS.md && pnpm typecheck`

  Expected: all exit 0.

- [ ] **Step 8: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(features:gate-skill-loads-only-the-branch-a-session-takes): add the noldor skill-size check and baseline commands

  Registers the skill-size verb group, catalogs it, and regenerates the capability index in AGENTS.md and its template twin.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
  git commit -F "$msg"
  ```

  Expected: the commit lands. Without the `Noldor-Sibling-Scope` line, `validate noldor-scope` refuses it for touching `docs/noldor/` under a `features:` scope.

---

## Task 4: Refuse a push that grows a skill file, and let a micro-chore carry the re-record

**Files:**
- Modify: `src/core/allowlist.ts`, `lefthook.yml`
- Test: `src/core/__tests__/allowlist.test.ts`
- Create: `.noldor/skill-size-baseline.json`

- [ ] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file src/core/allowlist.ts --file src/core/__tests__/allowlist.test.ts --file lefthook.yml --stage code`

- [ ] **Step 2: Write the failing test.** In `src/core/__tests__/allowlist.test.ts`, add after the `accepts lefthook.yml mixed with .claude/**` case:

  ```ts
  it('accepts a skill edit with its re-recorded skill-size baseline', () => {
    expect(
      isMicroChoreAllowed([
        '.claude/skills/noldor-gate/SKILL.md',
        'templates/.claude/skills/noldor-gate/SKILL.md',
        '.noldor/skill-size-baseline.json',
      ]),
    ).toBe(true);
  });
  ```

- [ ] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/core/__tests__/allowlist.test.ts`

  Expected: FAIL on the new case — `expected false to be true`.

- [ ] **Step 4: Implement.** In `src/core/allowlist.ts`, insert into `MICRO_CHORE_GLOBS` directly after `'.noldor/retired-entry-ids.json',`:

  ```ts
  // The skill-size ratchet's baseline. A micro-chore is the one lane that edits a
  // skill without an override, and it is single-commit, so a skill edit that grows
  // a file has to carry its re-recorded baseline in that same commit.
  '.noldor/skill-size-baseline.json',
  ```

- [ ] **Step 5: Run to verify PASS.**

  Run: `pnpm vitest run src/core/__tests__/allowlist.test.ts`

  Expected: all cases pass.

- [ ] **Step 6: Wire the self-host pre-push job.** Append to `lefthook.yml` (the root file, never `lefthook/noldor.yml`):

  ```yaml

  # Self-host only: the skill-size ratchet guards the skills this repo ships. A
  # consumer's skill files are framework copies that change on every
  # `init --update`, so the job lives here rather than in lefthook/noldor.yml.
  pre-push:
    jobs:
      - name: skill-size
        run: pnpm noldor skill-size check
  ```

- [ ] **Step 7: Record the first baseline.**

  Run: `pnpm noldor skill-size baseline && pnpm noldor skill-size check`

  Expected: `skill-size: recorded 15 skill files to .noldor/skill-size-baseline.json` with one `new` line per skill, then `skill-size: 15 skill files within their baseline` (exit 0). Part 3 re-records after the split.

- [ ] **Step 8: Verify lefthook runs the job and consumers do not.**

  Run: `pnpm exec lefthook dump | grep -A2 "name: skill-size"` then `grep -c skill-size lefthook/noldor.yml`

  Expected: the dump shows the `skill-size` job under `pre-push`; the grep over `lefthook/noldor.yml` prints `0`.

- [ ] **Step 9: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(features:gate-skill-loads-only-the-branch-a-session-takes): refuse a push that grows a skill file past its baseline

  Runs skill-size check at pre-push from the root lefthook.yml, so only this repo's pushes are held; records the first baseline; and puts the baseline on the micro-chore lane, the one-commit lane that edits skills, so a deliberate growth can be re-recorded in the same commit.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/allowlist.ts src/core/__tests__/allowlist.test.ts lefthook.yml .noldor/skill-size-baseline.json
  git commit -F "$msg"
  ```

  Expected: the commit lands.
