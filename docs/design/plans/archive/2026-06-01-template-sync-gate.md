# Template-Sync Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-block any commit or push where a templated file's consumer copy and its `templates/` copy are not byte-identical, so consumer edits can't silently revert on the next `init --update` sync.

**Architecture:** One pure function `checkTemplateSync` maps a commit's changed files to their template rel-paths and runs the existing `computeDrift` (sha256) over them; a `main()` driver in the same file resolves the changed-file list per hook context (pre-commit `{staged_files}` argv, or a git range at pre-push) and exits non-zero on any drift. Wired into both the `pre-commit` `validate` group and the `pre-push` jobs in `lefthook/noldor.yml` **and** its `templates/` copy.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `vitest`, `tsx` runtime via `bin/noldor.mjs`. Reuses `src/templates/diff.ts` (`computeDrift`) and `src/templates/manifest.ts` (`templateFiles`, `TEMPLATES_ROOT`).

**Spec:** `docs/design/specs/2026-06-01-template-sync-gate-design.md`

**Deviation from spec (intentional):** The spec listed two files (`check-template-sync.ts` core + `template-sync.ts` entrypoint). This plan consolidates them into ONE file `src/checks/check-template-sync.ts` holding the pure core + a `main()` driver + the invocation guard — matching the established sibling pattern (`src/checks/check-shared-files.ts`). The manifest `src` points at this single file.

---

## File Structure

- Create `src/checks/check-template-sync.ts` — pure `checkTemplateSync()` core + `main()` driver + argv guard.
- Create `src/checks/__tests__/check-template-sync.test.ts` — pure-core tests over tmpdir template/consumer roots.
- Modify `src/cli/manifest.ts` — add `template-sync` sub to the `checks` group.
- Modify `lefthook/noldor.yml` — add a `template-sync` job to the `pre-commit` `validate` group and to the `pre-push` jobs list.
- Modify `templates/lefthook/noldor.yml` — the same two job additions (kept byte-identical to the consumer copy — this gate would otherwise flag it).

---

### Task 1: Pure core `checkTemplateSync`

**Files:**
- Create: `src/checks/check-template-sync.ts`
- Test: `src/checks/__tests__/check-template-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/checks/__tests__/check-template-sync.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkTemplateSync } from '../check-template-sync.js';

/** Build a templates root + consumer root with the given file contents. */
function makeRoots(
  tpl: Record<string, string>,
  consumer: Record<string, string>,
): { templatesRoot: string; cwd: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'noldor-tsync-'));
  const templatesRoot = join(base, 'templates');
  const cwd = join(base, 'consumer');
  for (const [rel, content] of Object.entries(tpl)) {
    const p = join(templatesRoot, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  for (const [rel, content] of Object.entries(consumer)) {
    const p = join(cwd, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  // ensure both roots exist even when empty
  mkdirSync(templatesRoot, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { templatesRoot, cwd, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe('checkTemplateSync', () => {
  it('passes when a touched templated file is byte-identical to its template', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['lefthook/noldor.yml'] });
      expect(res).toEqual({ ok: true, offenders: [] });
    } finally {
      cleanup();
    }
  });

  it('flags a consumer-only edit as drifted', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 2\n' },
    );
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['lefthook/noldor.yml'] });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'lefthook/noldor.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });

  it('flags a template-only edit (changed path under templates/) on the shared rel-path', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 2\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['templates/lefthook/noldor.yml'],
      });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'lefthook/noldor.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });

  it('ignores changed files that are not templated', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['src/rules/resolve.ts', 'README.md'],
      });
      expect(res).toEqual({ ok: true, offenders: [] });
    } finally {
      cleanup();
    }
  });

  it('flags a missing consumer copy', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots({ 'skills/x.md': 'hi\n' }, {});
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['skills/x.md'] });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'skills/x.md', status: 'missing' }]);
    } finally {
      cleanup();
    }
  });

  it('reports only the drifted entry from a mixed changed-file list', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'a.yml': 'x\n', 'b.yml': 'y\n' },
      { 'a.yml': 'x\n', 'b.yml': 'CHANGED\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['a.yml', 'b.yml', 'src/unrelated.ts'],
      });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'b.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/checks/__tests__/check-template-sync.test.ts`
Expected: FAIL — cannot find module `../check-template-sync.js`.

- [ ] **Step 3: Write minimal implementation** (core only — the driver/guard are added in Task 2)

```typescript
// src/checks/check-template-sync.ts
import { computeDrift, type DriftEntry } from '../templates/diff.js';
import { templateFiles, TEMPLATES_ROOT } from '../templates/manifest.js';

const TEMPLATES_PREFIX = 'templates/';

/** Result of a template-sync check. */
export interface TemplateSyncResult {
  readonly ok: boolean;
  readonly offenders: DriftEntry[]; // status 'drifted' | 'missing'
}

/**
 * Given the files a commit/push touched, verify every templated file among them
 * is byte-identical to its `templates/` copy.
 *
 * A changed path is "templated" if it is `templates/<rel>` (→ `<rel>`) or is
 * itself a member of `templateFiles()`. Non-templated changes are ignored.
 *
 * @param opts.cwd - Consumer root (repo root).
 * @param opts.changedFiles - Repo-relative POSIX paths touched by the commit/push.
 * @param opts.templatesRoot - Template root; defaults to the package `TEMPLATES_ROOT`.
 */
export function checkTemplateSync(opts: {
  cwd: string;
  changedFiles: readonly string[];
  templatesRoot?: string;
}): TemplateSyncResult {
  const root = opts.templatesRoot ?? TEMPLATES_ROOT;
  const known = new Set(templateFiles(root));
  const rels = new Set<string>();
  for (const f of opts.changedFiles) {
    if (f.startsWith(TEMPLATES_PREFIX)) rels.add(f.slice(TEMPLATES_PREFIX.length));
    else if (known.has(f)) rels.add(f);
  }
  const offenders = computeDrift(root, opts.cwd, [...rels]).filter((e) => e.status !== 'unchanged');
  return { ok: offenders.length === 0, offenders };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/checks/__tests__/check-template-sync.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/checks/check-template-sync.ts src/checks/__tests__/check-template-sync.test.ts
git commit -m "feat(rules): add template-sync drift core"
```

---

### Task 2: `main()` driver + manifest wiring

**Files:**
- Modify: `src/checks/check-template-sync.ts` (append driver + guard)
- Modify: `src/cli/manifest.ts` (add `template-sync` to the `checks` group)

- [ ] **Step 1: Append the driver + guard to `src/checks/check-template-sync.ts`**

Add these imports at the TOP of the file (alongside the existing imports):

```typescript
import { execFileSync } from 'node:child_process';
```

Append to the END of the file:

```typescript
/**
 * Resolve the changed-file list for the current hook context.
 * - pre-commit: lefthook passes `{staged_files}` as argv → use them verbatim.
 * - pre-push: no argv → diff the range being pushed (`@{upstream}..HEAD`,
 *   falling back to `origin/main..HEAD` when no upstream is configured).
 */
function resolveChangedFiles(args: readonly string[]): string[] {
  if (args.length > 0) return [...args];
  let range = 'origin/main..HEAD';
  try {
    execFileSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    range = '@{upstream}..HEAD';
  } catch {
    // no upstream — keep origin/main fallback
  }
  try {
    return execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Driver: resolve changed files, check template sync, exit 0 (OK) or 1 (drift).
 *
 * @returns Exit code — `0` may proceed, `1` is blocked.
 */
export function main(): number {
  const changedFiles = resolveChangedFiles(process.argv.slice(2));
  const { ok, offenders } = checkTemplateSync({ cwd: process.cwd(), changedFiles });
  if (ok) {
    process.stdout.write('template-sync OK\n');
    return 0;
  }
  process.stderr.write('template-sync: templated file(s) out of sync with templates/:\n');
  for (const o of offenders) {
    const hint =
      o.status === 'missing'
        ? `consumer copy absent — run 'noldor init --update'`
        : `differs from templates/${o.path} — edit the template too, or run 'noldor init --update'`;
    process.stderr.write(`  ${o.path} (${o.status}): ${hint}\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
```

- [ ] **Step 2: Add the manifest entry**

In `src/cli/manifest.ts`, inside the `checks` group's `subs` object (which currently has `invariants`, `shared-files`, `feature-slug-scope`), add:

```typescript
      'template-sync': {
        src: 'checks/check-template-sync.ts',
        desc: 'Block templated files drifting from their templates/ copy',
      },
```

- [ ] **Step 3: Typecheck + CLI smoke**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm noldor checks template-sync`
Expected: `template-sync OK` (current tree is in sync per `noldor doctor`), exit 0.

Verify it actually catches drift — temporarily edit a consumer templated file, confirm a non-zero exit, then revert:

```bash
printf '\n# drift probe\n' >> lefthook/noldor.yml
pnpm noldor checks template-sync lefthook/noldor.yml; echo "exit=$?"
git checkout -- lefthook/noldor.yml
```
Expected: prints `lefthook/noldor.yml (drifted): ...` and `exit=1`. After `git checkout`, the file is restored.

- [ ] **Step 4: Re-confirm the existing test still passes**

Run: `pnpm vitest run src/checks/__tests__/check-template-sync.test.ts`
Expected: PASS (6 tests) — the driver addition didn't break the core.

- [ ] **Step 5: Commit**

```bash
git add src/checks/check-template-sync.ts src/cli/manifest.ts
git commit -m "feat(rules): add template-sync CLI driver + manifest entry"
```

---

### Task 3: Wire the gate into lefthook (consumer + template, kept identical)

**Files:**
- Modify: `lefthook/noldor.yml`
- Modify: `templates/lefthook/noldor.yml`

Note: these two files must stay byte-identical (the new gate itself enforces this). Make the SAME edits to both. Read both files first to match exact indentation.

- [ ] **Step 1: Add the pre-commit job to BOTH files**

In each of `lefthook/noldor.yml` and `templates/lefthook/noldor.yml`, find the `pre-commit:` → `- name: validate` → `group:` → `jobs:` parallel list (the entries `features`, `invariants`, `lint`, `fmt`, `shared-files`, `noldor`, `skill-catalog`, `triage`, `milestones`, and — if present — `rules`). Append a new job at the end of that `jobs:` list, matching the exact indentation of the sibling `- name:` entries:

```yaml
          - name: template-sync
            run: pnpm noldor checks template-sync {staged_files}
```

(No `glob`: the core filters to templated paths; the sha check over only the staged-touched set is cheap.)

- [ ] **Step 2: Add the pre-push job to BOTH files**

In each file, find the `pre-push:` block's `jobs:` list (contains `noldor-enforce-review-receipt` and `noldor-pre-push`). Append:

```yaml
    - name: template-sync
      run: pnpm noldor checks template-sync
```

(No args → the driver computes the pushed range from git. Match the indentation of the sibling pre-push `- name:` entries — note pre-push jobs sit at a shallower indent than the nested pre-commit `validate` group jobs; copy the exact leading spaces from `- name: noldor-pre-push`.)

- [ ] **Step 3: Verify the two files are byte-identical and the gate is self-consistent**

Run: `diff lefthook/noldor.yml templates/lefthook/noldor.yml; echo "diff-exit=$?"`
Expected: no output, `diff-exit=0`.

Run: `pnpm noldor doctor`
Expected: `OK — <N> template files in sync` (lefthook no longer drifts).

Run: `pnpm noldor checks template-sync lefthook/noldor.yml templates/lefthook/noldor.yml`
Expected: `template-sync OK`, exit 0 (both sides identical).

- [ ] **Step 4: Confirm the staged lefthook edit passes its own gate**

```bash
git add lefthook/noldor.yml templates/lefthook/noldor.yml
pnpm noldor checks template-sync $(git diff --cached --name-only); echo "exit=$?"
```
Expected: `template-sync OK`, `exit=0` (both copies staged and identical).

- [ ] **Step 5: Commit**

```bash
git add lefthook/noldor.yml templates/lefthook/noldor.yml
git commit -m "feat(rules): gate template-sync in pre-commit + pre-push"
```

(If oxfmt's `fmt` step blocks because the commit's only formattable targets are `.yml` — it should not, `.yml` is in the fmt glob — proceed normally. Only use `--no-verify` if a genuinely unrelated hook error appears, and report it.)

---

### Task 4: Full-suite regression + typecheck

**Files:** none (verification task)

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Lint + format check**

Run: `pnpm lint && pnpm fmt:check`
Expected: clean. If `fmt:check` flags the new TS file, run `pnpm fmt`, then `git add` the changed file by explicit path and amend is NOT allowed — make a follow-up commit `chore(rules): fmt template-sync` instead.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: PASS — the new `check-template-sync` suite plus the existing suite green. If a pre-existing unrelated failure appears (e.g. a parallel-run `doctor`-drift flake in `src/cli/__tests__/cli.test.ts`), classify it as pre-existing and confirm it passes when run in isolation: `pnpm vitest run src/cli/__tests__/cli.test.ts`.

- [ ] **Step 4: Commit any fmt fixes (only if Step 2 changed files)**

```bash
git add src/checks/check-template-sync.ts
git commit -m "chore(rules): fmt template-sync"
```
(Skip if nothing changed.)

---

## Self-Review

**Spec coverage:**
- Pure core `checkTemplateSync` (rel-path mapping, `computeDrift`, offenders) → Task 1. ✓
- Bidirectional (template-side or consumer-side edit) → Task 1 tests 2 + 3. ✓
- No-op on non-templated files → Task 1 test 4. ✓
- `missing` handling → Task 1 test 5. ✓
- Driver resolving pre-commit `{staged_files}` vs pre-push git range → Task 2 `resolveChangedFiles`. ✓
- Manifest `checks template-sync` → Task 2 Step 2. ✓
- pre-commit wiring → Task 3 Step 1. ✓
- pre-push wiring → Task 3 Step 2. ✓
- Both lefthook copies kept identical (dogfood) → Task 3 (all steps edit both; Step 3 diff-checks). ✓
- Known limits (working-tree semantics, both-sides-deleted, `--no-verify`) → inherent to the design; no task needed, documented in spec. ✓

**Placeholder scan:** All code steps contain complete code. The lefthook YAML additions are exact; the only "read the file first" instruction is to match indentation, with the surrounding job names enumerated so the location is unambiguous.

**Type consistency:** `TemplateSyncResult` / `checkTemplateSync` signature defined in Task 1, driver in Task 2 destructures `{ ok, offenders }` consistently. `DriftEntry` imported from `../templates/diff.js` (status `unchanged` | `drifted` | `missing`) — offenders filtered to `!== 'unchanged'`, matching the `'drifted' | 'missing'` comment. Manifest `src` path `checks/check-template-sync.ts` matches the single created file.

**Deviation note:** Spec's two-file split consolidated to one file per the `check-shared-files.ts` sibling pattern; manifest + plan reflect the single file consistently.
