# Scope Sibling Trailer for Doc-Sync Commits Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** One atomic commit for "feat in code + sibling `docs/noldor/<page>.md` sync". A new `Noldor-Sibling-Scope: <scope-list>` trailer lets `validateScope` (`src/core/validate-noldor-scope.ts`) accept staged noldor pages under a code-scoped subject — honored only on mixed diffs, with every token slug-validated against `knownSlugs`. The mixed-diff failure message teaches the exact trailer line to add, and page-changelog derivation (`src/core/changelog.ts`) learns the trailer so sibling-committed pages keep their history. No change to `src/hooks/noldor-validate-trailer.ts` (verified: `detectDroppedTrailers` matches any `Noldor-*` key and the hook has no strict key whitelist — unknown `Noldor-*` trailers pass through; a test pins this).

**Architecture:** Spec Units U1–U5, implemented faithfully: (U1) a module-level `applySiblingTrailer(input, trailerValue, noldorFiles)` helper in `validate-noldor-scope.ts` returning `null` (trailer absent → caller falls through to its existing error) or a terminal result; called from exactly the two subject-scope FAILURE branches (`scope === null` and `!scope.startsWith('noldor:')`) — the `noldor` / valid `noldor:<slug>` success branches and the unknown-subject-slug branch never consult it. `parseTrailers` is already called at the top of `validateScope` (the `Noldor-Path` bypasses), so the trailer inherits the stranded-mid-body discipline for free; in the `parseTrailers` catch-fallback (no git binary) the trailer is simply not honored — only the legacy regex bypasses survive there, which is fine because the commit-msg hook always runs under git. (U2) `buildSiblingTrailerValue(noldorFiles)` builds the precise comma-joined `noldor:<slug>` suggestion (never bare `noldor`); the teaching clause is appended to the line-138 error **only when the diff is mixed** — on a doc-only diff the trailer would just bounce off the doc-only guard, so suggesting it there teaches a dead end. (U3) `Commit.siblingScopes?: string[]` (optional so existing hand-built fixtures stay valid; `loadCommits` always fills it), `git log` format extended with `%(trailers:key=Noldor-Sibling-Scope,valueonly,separator=%x2C,unfold)` — `unfold` is one word stronger than the spec's string and is load-bearing: an indent-folded trailer value (legal per `detectDroppedTrailers`, whose error message itself suggests indenting continuations) otherwise emits a literal newline into the log line and the continuation would be mis-parsed as a file path (verified empirically on git 2.43.1). Split-on-comma + trim + filter-empty parses all three shapes uniformly (single value with `, `, multiple trailer lines joined by `%x2C`, empty third field). `filterCommitsForPage` restructured to: file-touch first, then subject-scope qualify, then sibling qualify. (U4) both doc pages + their `templates/docs/noldor/` twins (byte-identical today — edit live pages, `cp` over the twins) + FD `links.code`/`links.docs`. (U5) tests-first inside each task plus a green-first tolerance pin in the hook suite.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100 — run `pnpm fmt` before every commit), vitest (`pnpm vitest run <path>`; fixture repos via `mkdtempSync` + `execSync` git per `src/hooks/__tests__/noldor-validate-trailer.test.ts`; `process.chdir` save/restore for `loadCommits`, `vitest.setup.ts` re-anchors cwd between suites). Lefthook gates: commits staging `docs/noldor/*.md` need a `noldor`/`noldor:<slug>` subject scope (the doc commit here uses plain `noldor` — deliberately NOT dogfooding the new trailer, keep it simple); `templates/docs/noldor/` twins must land in the same commit or `checks/check-template-sync.ts` blocks it; the pre-commit `sync test-links` job auto-adds modified test files to the FD's `links.tests` and stages the FD (`stage_fixed`) — expected, let the FD ride in those commits. Git ≥ 2.22 required for `%(trailers:key=…)` (repo git is 2.43.1; format string verified working).

Spec: [docs/superpowers/specs/2026-07-03-scope-sibling-trailer-for-doc-sync-commits-design.md](../specs/2026-07-03-scope-sibling-trailer-for-doc-sync-commits-design.md) · FD: [docs/features/scope-sibling-trailer-for-doc-sync-commits.md](../../features/scope-sibling-trailer-for-doc-sync-commits.md)

---

## File Structure

- `src/core/validate-noldor-scope.ts` — modify; `applySiblingTrailer` helper + wiring into the no-scope and non-noldor-scope failure branches (U1); `buildSiblingTrailerValue` + mixed-diff-only teaching clause in the retitle-or-split error (U2)
- `src/core/__tests__/validate-noldor-scope.test.ts` — modify (test); sibling-trailer branch matrix (covering/uncovered/unknown-slug/malformed/doc-only-guard/bare-noldor/no-scope-branch/stranded) + teaching-message assertions
- `src/core/changelog.ts` — modify; `Commit.siblingScopes?` field, `loadCommits` trailer-aware format string + token parse, `filterCommitsForPage` sibling qualification (U3)
- `src/core/__tests__/changelog.test.ts` — modify (test); sibling include/exclude filter cases + `loadCommits` fixture-repo integration pinning the real `%(trailers…)` parse
- `src/hooks/__tests__/noldor-validate-trailer.test.ts` — modify (test); green-first pin: `Noldor-Sibling-Scope` + valid `Noldor-Path` passes trailer validation unchanged (spec acceptance)
- `docs/noldor/git-and-commits.md` — modify; `Noldor-Sibling-Scope` line in the Trailer schema block + "Sibling doc-sync commits" subsection under Conventional Commits (U4)
- `templates/docs/noldor/git-and-commits.md` — modify; byte-identical template twin (template-sync)
- `docs/noldor/script-catalog.md` — modify; `validate:noldor-scope` entry documents the trailer acceptance path (U4)
- `templates/docs/noldor/script-catalog.md` — modify; byte-identical template twin
- `docs/features/scope-sibling-trailer-for-doc-sync-commits.md` — modify; `links.code` + `links.docs` hand-filled (links.tests auto-synced by the pre-commit hook in Tasks 1–4)

---

## Task 1: Sibling-trailer validation branch (U1)

**Files:**

- Modify: `src/core/validate-noldor-scope.ts`
- Test: `src/core/__tests__/validate-noldor-scope.test.ts`

- [ ] **Step 1: Write the failing sibling-trailer tests**

In `src/core/__tests__/validate-noldor-scope.test.ts`, replace the first line

```ts
// @tests: noldor
```

with

```ts
// @tests: noldor, scope-sibling-trailer-for-doc-sync-commits
```

and append this new describe block at the end of the file (after the closing `});` of `describe('validateScope', …)`). Note: `validateScope` shells real `git interpret-trailers` via `parseTrailers` — same as the existing `Noldor-Path-Override` tests, no mocking needed:

```ts
describe('validateScope — Noldor-Sibling-Scope trailer', () => {
  it('passes a mixed diff when the trailer covers every staged page', () => {
    const result = validateScope({
      message:
        'feat(prep): add dispatch runner\n\nNoldor-Sibling-Scope: noldor:workflow\nNoldor-Path: fast-track\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes a mixed diff on the no-scope branch too', () => {
    const result = validateScope({
      message: 'feat: add dispatch runner\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes a multi-page mixed diff with a comma-separated token list', () => {
    const result = validateScope({
      message:
        'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:workflow, noldor:lifecycle\n',
      stagedFiles: [
        'src/core/session.ts',
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('bare noldor token accepts any staged page set (subject-scope parity)', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor\n',
      stagedFiles: [
        'src/core/session.ts',
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('fails when the trailer leaves a staged page uncovered', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: [
        'src/core/session.ts',
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/docs\/noldor\/lifecycle\.md/);
    expect(result.error).toMatch(/noldor:lifecycle/);
  });

  it('fails on an unknown slug in the trailer, listing valid slugs', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:nonexistent\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown noldor slug "nonexistent"/);
    expect(result.error).toMatch(/valid slugs: complexity-gating/);
  });

  it('fails on a token that is not noldor-shaped', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: engine\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"engine"/);
  });

  it('rejects the trailer on a doc-only diff with the dedicated guard message', () => {
    const result = validateScope({
      message: 'docs: tidy\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/doc-only/);
    expect(result.error).toMatch(/subject/);
  });

  it('ignores a sibling trailer stranded mid-body (not in the trailer block)', () => {
    const result = validateScope({
      message:
        'feat: add dispatch\n\nNoldor-Sibling-Scope: noldor:workflow\n\nUnrelated body line.\n\nCo-Authored-By: Bot <bot@example.com>\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no scope/);
  });
});
```

- [ ] **Step 2: Run the suite to verify the new tests FAIL**

```bash
pnpm vitest run src/core/__tests__/validate-noldor-scope.test.ts
```

Expected output: `8 failed | 14 passed (22)`. Eight of the nine new tests fail (no trailer logic exists yet). The stranded-mid-body test passes already — it is a deliberate pin that `parseTrailers`' trailer-block discipline (established by the `Noldor-Path-Override` fix) extends to the new key with zero code. The 13 pre-existing tests stay green.

- [ ] **Step 3: Implement `applySiblingTrailer`**

In `src/core/validate-noldor-scope.ts`, insert this helper after the `renderAffected` function (after line 74, before `export function validateScope`):

```ts
/**
 * Apply the `Noldor-Sibling-Scope` trailer branch. Called only from the
 * subject-scope FAILURE branches (no scope, or a non-noldor scope): the
 * trailer lets a mixed code+doc commit keep its real code scope while the
 * staged `docs/noldor/` pages are validated as declared siblings.
 *
 * @param input - The full validation input (staged files + known slugs)
 * @param trailerValue - Raw `Noldor-Sibling-Scope` value from parseTrailers
 * @param noldorFiles - The staged `docs/noldor/*.md` files
 * @returns `null` when the trailer is absent (caller falls through to its
 *   normal error); a terminal {@link ValidateScopeResult} otherwise.
 */
function applySiblingTrailer(
  input: ValidateScopeInput,
  trailerValue: string | undefined,
  noldorFiles: string[],
): ValidateScopeResult | null {
  if (trailerValue === undefined) return null;

  // Mixed-diff guard: the trailer exists solely to preserve a meaningful
  // code scope on a mixed diff. Doc-only commits must carry the scope in
  // the subject — otherwise the trailer becomes a general scope bypass.
  const nonNoldorFiles = input.stagedFiles.filter((f) => !noldorFiles.includes(f));
  if (nonNoldorFiles.length === 0) {
    return {
      success: false,
      error:
        'Noldor-Sibling-Scope on a doc-only commit: put the scope in the subject (e.g. "docs(noldor:<slug>): <subject>"), not in the trailer.',
    };
  }

  const tokens = trailerValue
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return {
      success: false,
      error:
        'empty Noldor-Sibling-Scope trailer; expected "noldor" or a comma-separated list of "noldor:<slug>" tokens.',
    };
  }

  // Validate ALL tokens first (a malformed token fails the commit even when
  // a bare `noldor` is also present), then let bare `noldor` accept any
  // staged page set — parity with the subject-scope semantics.
  let bareNoldor = false;
  const covered = new Set<string>();
  for (const token of tokens) {
    if (token === 'noldor') {
      bareNoldor = true;
      continue;
    }
    if (!token.startsWith('noldor:')) {
      return {
        success: false,
        error: `Noldor-Sibling-Scope token "${token}" is not "noldor" or "noldor:<slug>".`,
      };
    }
    const slug = token.slice('noldor:'.length);
    if (!input.knownSlugs.has(slug)) {
      return {
        success: false,
        error: `unknown noldor slug "${slug}" in Noldor-Sibling-Scope; valid slugs: ${[...input.knownSlugs].toSorted().join(', ')}`,
      };
    }
    covered.add(slug);
  }
  if (bareNoldor) return { success: true };

  const uncovered = noldorFiles.filter((f) => !covered.has(pathToSlug(f)));
  if (uncovered.length > 0) {
    const missing = [...new Set(uncovered.map(pathToSlug))]
      .toSorted()
      .map((s) => `noldor:${s}`)
      .join(', ');
    return {
      success: false,
      error: `Noldor-Sibling-Scope does not cover every staged noldor page. ${renderAffected(uncovered)}. Add: ${missing}`,
    };
  }

  return { success: true };
}
```

- [ ] **Step 4: Wire the helper into the two failure branches**

Still in `src/core/validate-noldor-scope.ts`, replace the no-scope branch

```ts
  const scope = match.groups?.scope ?? null;
  if (scope === null) {
    return {
      success: false,
      error: `commit touches docs/noldor/ but has no scope. ${affected}. Suggested: ${suggestion}: <subject>`,
    };
  }
```

with

```ts
  const scope = match.groups?.scope ?? null;
  if (scope === null) {
    const sibling = applySiblingTrailer(input, trailers['Noldor-Sibling-Scope'], noldorFiles);
    if (sibling) return sibling;
    return {
      success: false,
      error: `commit touches docs/noldor/ but has no scope. ${affected}. Suggested: ${suggestion}: <subject>`,
    };
  }
```

and replace the non-noldor-scope branch

```ts
  if (!scope.startsWith('noldor:')) {
    return {
      success: false,
      error: `commit touches docs/noldor/ but scope is "${scope}". ${affected}. Suggested: ${suggestion}: <subject> (or split: keep "${scope}" on non-doc files, retitle the doc-only commit with the suggestion).`,
    };
  }
```

with

```ts
  if (!scope.startsWith('noldor:')) {
    const sibling = applySiblingTrailer(input, trailers['Noldor-Sibling-Scope'], noldorFiles);
    if (sibling) return sibling;
    return {
      success: false,
      error: `commit touches docs/noldor/ but scope is "${scope}". ${affected}. Suggested: ${suggestion}: <subject> (or split: keep "${scope}" on non-doc files, retitle the doc-only commit with the suggestion).`,
    };
  }
```

(The error text is unchanged here — Task 2 rewrites it with the teaching clause.) The `scope === 'noldor'` success branch, the unknown-subject-slug branch, and the `Noldor-Path` bypasses are untouched.

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/core/__tests__/validate-noldor-scope.test.ts
```

Expected output: `Tests  22 passed (22)`.

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: oxfmt reports formatted/unchanged files; `tsc --noEmit` exits 0 silently.

- [ ] **Step 7: Commit**

```bash
git add src/core/validate-noldor-scope.ts src/core/__tests__/validate-noldor-scope.test.ts
git commit -m "feat(core): accept Noldor-Sibling-Scope trailer in noldor-scope validation" -m "Noldor-FD: scope-sibling-trailer-for-doc-sync-commits"
```

Note: the pre-commit `sync test-links` job (stage_fixed) auto-adds the test file to the FD's `links.tests` and stages `docs/features/scope-sibling-trailer-for-doc-sync-commits.md` — that FD change riding in this commit is expected.

---

## Task 2: Error-message teaching (U2)

**Files:**

- Modify: `src/core/validate-noldor-scope.ts`
- Test: `src/core/__tests__/validate-noldor-scope.test.ts`

- [ ] **Step 1: Write the failing teaching-message tests**

Append this describe block at the end of `src/core/__tests__/validate-noldor-scope.test.ts`:

```ts
describe('validateScope — sibling-trailer teaching in the failure message', () => {
  it('names the exact trailer line for a single-page mixed diff', () => {
    const result = validateScope({
      message: 'feat(sdd): mixed change',
      stagedFiles: ['src/garden/sdd-report.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keep "feat\(sdd\)"/);
    expect(result.error).toMatch(/Noldor-Sibling-Scope: noldor:workflow/);
  });

  it('suggests the precise comma-joined slug list on a multi-page mixed diff, never bare noldor', () => {
    const result = validateScope({
      message: 'feat(sdd): multi-page edit',
      stagedFiles: [
        'src/garden/sdd-report.ts',
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Noldor-Sibling-Scope: noldor:lifecycle, noldor:workflow/);
    expect(result.error).not.toMatch(/Noldor-Sibling-Scope: noldor(?!:)/);
  });

  it('does not suggest the trailer on a doc-only diff (it would bounce off the doc-only guard)', () => {
    const result = validateScope({
      message: 'docs(engine): tidy',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/Noldor-Sibling-Scope/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/core/__tests__/validate-noldor-scope.test.ts
```

Expected output: `2 failed | 23 passed (25)`. The two mixed-diff teaching tests fail (no trailer clause in the error yet); the doc-only test passes already (pin — it locks the conditional in before it exists, and existing tests like "suggests the generic noldor scope when multiple pages staged" use doc-only staged sets so they stay green when the clause lands).

- [ ] **Step 3: Implement the teaching clause**

In `src/core/validate-noldor-scope.ts`, insert this helper directly after the `buildSuggestion` function:

```ts
/**
 * Build the precise `Noldor-Sibling-Scope` value covering the staged noldor
 * pages — always the enumerated `noldor:<slug>` form (comma-joined, sorted),
 * never bare `noldor`, so the error message doesn't teach laziness.
 */
function buildSiblingTrailerValue(noldorFiles: string[]): string {
  return [...new Set(noldorFiles.map(pathToSlug))]
    .toSorted()
    .map((s) => `noldor:${s}`)
    .join(', ');
}
```

Then in the non-noldor-scope branch, replace the return statement

```ts
    return {
      success: false,
      error: `commit touches docs/noldor/ but scope is "${scope}". ${affected}. Suggested: ${suggestion}: <subject> (or split: keep "${scope}" on non-doc files, retitle the doc-only commit with the suggestion).`,
    };
```

with

```ts
    const isMixedDiff = input.stagedFiles.some((f) => !noldorFiles.includes(f));
    const trailerHint = isMixedDiff
      ? `; or keep "${type}(${scope})" and add trailer "Noldor-Sibling-Scope: ${buildSiblingTrailerValue(noldorFiles)}"`
      : '';
    return {
      success: false,
      error: `commit touches docs/noldor/ but scope is "${scope}". ${affected}. Suggested: ${suggestion}: <subject> (or split: keep "${scope}" on non-doc files, retitle the doc-only commit with the suggestion${trailerHint}).`,
    };
```

- [ ] **Step 4: Run to verify PASS, then format and typecheck**

```bash
pnpm vitest run src/core/__tests__/validate-noldor-scope.test.ts && pnpm fmt && pnpm typecheck
```

Expected output: `Tests  25 passed (25)`, then clean fmt + silent tsc.

- [ ] **Step 5: Commit**

```bash
git add src/core/validate-noldor-scope.ts src/core/__tests__/validate-noldor-scope.test.ts
git commit -m "feat(core): teach Noldor-Sibling-Scope in the noldor-scope failure message" -m "Noldor-FD: scope-sibling-trailer-for-doc-sync-commits"
```

---

## Task 3: Changelog derivation learns the trailer (U3)

**Files:**

- Modify: `src/core/changelog.ts`
- Test: `src/core/__tests__/changelog.test.ts`

- [ ] **Step 1: Write the failing changelog tests**

In `src/core/__tests__/changelog.test.ts`, replace the header lines

```ts
// @tests: noldor
import { describe, it, expect } from 'vitest';

import { filterCommitsForPage, parseScope } from '../changelog.js';
```

with

```ts
// @tests: noldor, scope-sibling-trailer-for-doc-sync-commits
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterCommitsForPage, loadCommits, parseScope } from '../changelog.js';
```

and append these describe blocks at the end of the file:

```ts
describe('filterCommitsForPage — Noldor-Sibling-Scope', () => {
  it('includes a sibling-trailer commit that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('includes a bare-noldor sibling commit that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(core): rework markers',
        files: ['src/core/session.ts', 'docs/noldor/workflow.md'],
        siblingScopes: ['noldor'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('excludes a sibling-trailer commit for pages not in the list', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts', 'docs/noldor/lifecycle.md'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'lifecycle')).toHaveLength(0);
  });

  it('excludes a sibling-trailer commit that did not touch the page file', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });
});

describe('loadCommits — sibling-trailer parsing', () => {
  it('parses Noldor-Sibling-Scope values from git history (empty when absent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-changelog-'));
    const prevCwd = process.cwd();
    try {
      execSync('git init -q', { cwd: dir });
      execSync('git config user.email t@t.t', { cwd: dir });
      execSync('git config user.name t', { cwd: dir });
      mkdirSync(join(dir, 'docs', 'noldor'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'noldor', 'workflow.md'), '# Workflow\n');
      execSync('git add docs/noldor/workflow.md', { cwd: dir });
      execSync('git commit -q -m "docs(noldor:workflow): seed page"', { cwd: dir });
      writeFileSync(join(dir, 'src', 'dispatch.ts'), 'export {};\n');
      writeFileSync(join(dir, 'docs', 'noldor', 'workflow.md'), '# Workflow\n\nMore.\n');
      execSync('git add src/dispatch.ts docs/noldor/workflow.md', { cwd: dir });
      execSync(
        'git commit -q -m "feat(prep): add dispatch runner" -m "Noldor-Sibling-Scope: noldor:workflow, noldor:lifecycle"',
        { cwd: dir },
      );
      process.chdir(dir);
      const commits = await loadCommits('docs/noldor/workflow.md');
      expect(commits).toHaveLength(2);
      expect(commits[0].subject).toBe('feat(prep): add dispatch runner');
      expect(commits[0].siblingScopes).toEqual(['noldor:workflow', 'noldor:lifecycle']);
      // `git log --follow -- <path>` filters --name-only to the followed
      // file, so `files` lists only the page (verified on git 2.43.1).
      expect(commits[0].files).toEqual(['docs/noldor/workflow.md']);
      expect(commits[1].siblingScopes).toEqual([]);
      expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(2);
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/core/__tests__/changelog.test.ts
```

Expected output: `3 failed | 10 passed (13)`. The two sibling-inclusion filter tests and the `loadCommits` integration test fail (`siblingScopes` doesn't exist and the filter only reads subject scopes); the two exclusion tests pass already (pins — sibling commits must stay excluded where they are today). The 8 pre-existing tests stay green.

- [ ] **Step 3: Implement the changelog changes**

In `src/core/changelog.ts`, replace the `Commit` interface

```ts
/** A single git commit relevant to a Noldor page. */
export interface Commit {
  hash: string;
  subject: string;
  files: string[];
}
```

with

```ts
/** A single git commit relevant to a Noldor page. */
export interface Commit {
  hash: string;
  subject: string;
  files: string[];
  /**
   * `Noldor-Sibling-Scope` trailer tokens (`noldor` / `noldor:<slug>`),
   * `[]` when the commit carries no such trailer. Optional so hand-built
   * commit lists without the field stay valid; `loadCommits` always fills it.
   */
  siblingScopes?: string[];
}
```

Replace `filterCommitsForPage` (function body + its doc comment)

```ts
/**
 * Filter commits down to those that should appear in a given page's
 * changelog. A commit qualifies when:
 * - its scope is `noldor` (framework-wide) AND it touched the page file
 * - its scope is `noldor:<pageSlug>` AND it touched the page file
 *
 * @param commits - Candidate commits (typically from `loadCommits`)
 * @param pageSlug - Page slug (`workflow`, `lifecycle`, ..., or `index` for README)
 * @returns Filtered list of commits
 */
export function filterCommitsForPage(commits: Commit[], pageSlug: string): Commit[] {
  return commits.filter((c) => {
    const parsed = parseScope(c.subject);
    if (parsed.scope === null) return false;
    const isFrameworkWide = parsed.scope === 'noldor';
    const slugMatches = parsed.slug === pageSlug;
    if (!isFrameworkWide && !slugMatches) return false;

    const pagePath = pageSlug === 'index' ? 'docs/noldor/README.md' : `docs/noldor/${pageSlug}.md`;
    return c.files.includes(pagePath);
  });
}
```

with

```ts
/**
 * Filter commits down to those that should appear in a given page's
 * changelog. A commit qualifies when it touched the page file AND any of:
 * - its subject scope is `noldor` (framework-wide)
 * - its subject scope is `noldor:<pageSlug>`
 * - its `Noldor-Sibling-Scope` trailer lists `noldor` or `noldor:<pageSlug>`
 *   (mixed code+doc commits keep their code scope in the subject)
 *
 * @param commits - Candidate commits (typically from `loadCommits`)
 * @param pageSlug - Page slug (`workflow`, `lifecycle`, ..., or `index` for README)
 * @returns Filtered list of commits
 */
export function filterCommitsForPage(commits: Commit[], pageSlug: string): Commit[] {
  const pagePath = pageSlug === 'index' ? 'docs/noldor/README.md' : `docs/noldor/${pageSlug}.md`;
  return commits.filter((c) => {
    if (!c.files.includes(pagePath)) return false;

    const parsed = parseScope(c.subject);
    if (parsed.scope === 'noldor' || parsed.slug === pageSlug) return true;

    const siblings = c.siblingScopes ?? [];
    return siblings.includes('noldor') || siblings.includes(`noldor:${pageSlug}`);
  });
}
```

In `loadCommits`, replace the format argument

```ts
    '--format=%H%x09%s',
```

with

```ts
    // %(trailers:key=…) needs git >= 2.22. `unfold` joins indent-folded
    // trailer values onto one line so the tab-split line parse stays safe
    // (an indented continuation is legal per detectDroppedTrailers and would
    // otherwise emit a literal newline into the log line).
    '--format=%H%x09%s%x09%(trailers:key=Noldor-Sibling-Scope,valueonly,separator=%x2C,unfold)',
```

and replace the commit-line parse

```ts
      const [hash, subject] = line.split('\t');
      current = { hash, subject, files: [] };
```

with

```ts
      const [hash, subject, siblingRaw] = line.split('\t');
      current = {
        hash,
        subject,
        files: [],
        // Handles all three shapes uniformly: a single trailer value
        // containing ", ", multiple trailer lines joined by the %x2C
        // separator, and the empty third field when the trailer is absent.
        siblingScopes: (siblingRaw ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      };
```

`parseScope`, `COMMIT_LINE_RE` (the hash-prefix guard still anchors on `%H\t`), `main()`, and `src/core/release-markers.ts` are unchanged.

- [ ] **Step 4: Run to verify PASS, then format and typecheck**

```bash
pnpm vitest run src/core/__tests__/changelog.test.ts && pnpm fmt && pnpm typecheck
```

Expected output: `Tests  13 passed (13)`, then clean fmt + silent tsc.

- [ ] **Step 5: Commit**

```bash
git add src/core/changelog.ts src/core/__tests__/changelog.test.ts
git commit -m "feat(core): changelog derivation reads Noldor-Sibling-Scope trailer" -m "Noldor-FD: scope-sibling-trailer-for-doc-sync-commits"
```

---

## Task 4: Pin trailer-hook tolerance (spec acceptance — no hook change)

**Files:**

- Test: `src/hooks/__tests__/noldor-validate-trailer.test.ts`

- [ ] **Step 1: Add the green-first tolerance pin**

In `src/hooks/__tests__/noldor-validate-trailer.test.ts`, replace the first line

```ts
// @tests: noldor
```

with

```ts
// @tests: noldor, scope-sibling-trailer-for-doc-sync-commits
```

and add this test inside the top-level `describe('validateTrailer', …)` block, directly after the `it('fast-track without Noldor-Reviewed is accepted at commit-msg (interim commit)', …)` test:

```ts
  it('tolerates a Noldor-Sibling-Scope trailer alongside a valid Noldor-Path (no key whitelist)', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({
      message:
        'feat(prep): add dispatch runner\n\nNoldor-Sibling-Scope: noldor:workflow\nNoldor-Path: fast-track\n',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
  });
```

- [ ] **Step 2: Run to verify PASS (deliberately green-first)**

```bash
pnpm vitest run src/hooks/__tests__/noldor-validate-trailer.test.ts
```

Expected output: all tests pass, including the new one, with **zero changes** to `src/hooks/noldor-validate-trailer.ts`. This is not a red-green step: the test pins the spec's verified claim that the hook has no strict key whitelist (`detectDroppedTrailers` nets any `Noldor-*` key; unknown parsed keys pass through). If this test FAILS, stop — the spec's "no change needed" claim is wrong and the hook needs a real look before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/__tests__/noldor-validate-trailer.test.ts
git commit -m "test(hooks): pin Noldor-Sibling-Scope tolerance in trailer validation" -m "Noldor-FD: scope-sibling-trailer-for-doc-sync-commits"
```

---

## Task 5: Docs + template twins + FD links (U4)

**Files:**

- Modify: `docs/noldor/git-and-commits.md`
- Modify: `templates/docs/noldor/git-and-commits.md`
- Modify: `docs/noldor/script-catalog.md`
- Modify: `templates/docs/noldor/script-catalog.md`
- Modify: `docs/features/scope-sibling-trailer-for-doc-sync-commits.md`

Both live pages are byte-identical to their `templates/docs/noldor/` twins today (verified). Edit the live pages, then `cp` them over the twins so `checks/check-template-sync.ts` stays green — all in ONE commit.

- [ ] **Step 1: Add the trailer to the schema block in `docs/noldor/git-and-commits.md`**

In the `### Trailer schema` fenced block, replace

```
Noldor-Phase-Revert: 1                   # phase-revert scaffold commits — bypasses the spec-file existence check (attach paths and specs-only-new)
```

with

```
Noldor-Phase-Revert: 1                   # phase-revert scaffold commits — bypasses the spec-file existence check (attach paths and specs-only-new)
Noldor-Sibling-Scope: <noldor scope-list>  # optional; mixed code+doc-sync commits — see "Sibling doc-sync commits"
```

- [ ] **Step 2: Add the subsection under Conventional Commits**

Still in `docs/noldor/git-and-commits.md`, insert this subsection directly after the last bullet of the `## Conventional Commits` section (the line ending `…The \`feature-slug-scope\` commit-msg hook enforces this.`) and before `## Integration — direct-to-main or PR flow`:

````markdown

### Sibling doc-sync commits (`Noldor-Sibling-Scope`)

A commit that changes code **and** syncs `docs/noldor/` pages would otherwise fail the `noldor-scope` commit-msg gate — the subject carries the code scope, not `noldor`. Keep the real scope and declare the doc pages as siblings via a trailer:

```
feat(prep): add dispatch runner

Noldor-Sibling-Scope: noldor:workflow, noldor:script-catalog
Noldor-Path: fast-track
```

- Honored only on **mixed diffs** — at least one staged file outside `docs/noldor/`. On a doc-only commit the trailer is rejected: put the scope in the subject instead.
- Tokens are `noldor` (any page set) or `noldor:<slug>` with `<slug>` an existing page; every staged page must be covered by a token. Prefer the precise slug form.
- Unknown slugs and malformed tokens fail the commit, same as subject scopes.
- Page changelog derivation (`pnpm noldor changelog`) reads the trailer, so sibling pages keep their history.
- Never auto-injected — add it deliberately; the `noldor-scope` failure message prints the exact trailer line to add.
````

- [ ] **Step 3: Document the acceptance path in `docs/noldor/script-catalog.md`**

In the `### \`validate:noldor-scope\`` entry, replace the Outputs line

```markdown
- **Outputs:** exit 0 unless the commit touches `docs/noldor/*.md` without a `noldor` or `noldor:<slug>` scope, where `<slug>` matches an existing page.
```

with

```markdown
- **Outputs:** exit 0 unless the commit touches `docs/noldor/*.md` without a `noldor` or `noldor:<slug>` scope, where `<slug>` matches an existing page. A mixed code+doc commit may instead keep its code scope and declare the pages via a `Noldor-Sibling-Scope: <noldor scope-list>` trailer — honored only when at least one staged file is outside `docs/noldor/`; every staged page must be covered; unknown slugs rejected. See [`git-and-commits.md`](git-and-commits.md) § Sibling doc-sync commits.
```

- [ ] **Step 4: Sync the template twins byte-identically**

```bash
cp docs/noldor/git-and-commits.md templates/docs/noldor/git-and-commits.md
cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
pnpm noldor checks template-sync docs/noldor/git-and-commits.md docs/noldor/script-catalog.md
```

Expected output: template-sync exits 0 (no drift listed).

- [ ] **Step 5: Fill the FD's links.code and links.docs**

In `docs/features/scope-sibling-trailer-for-doc-sync-commits.md` frontmatter, replace

```yaml
links:
  code: []
  docs: []
```

with

```yaml
links:
  code:
    - src/core/validate-noldor-scope.ts
    - src/core/changelog.ts
  docs:
    - docs/noldor/git-and-commits.md
    - docs/noldor/script-catalog.md
```

Leave `links.tests` exactly as the sync hooks populated it in Tasks 1–4 (the three test files), and leave `links.spec` untouched. The pre-commit `fd-resources` job will regenerate the FD's Resources block and re-stage — expected.

- [ ] **Step 6: Full verification sweep**

```bash
pnpm noldor validate features && pnpm verify
```

Expected output: FD validation exits 0; `pnpm verify` (lint, fmt:check, typecheck, full test suite) exits 0.

- [ ] **Step 7: Commit (doc pages use a plain `noldor` subject scope — deliberately NOT dogfooding the new trailer)**

```bash
git add docs/noldor/git-and-commits.md docs/noldor/script-catalog.md templates/docs/noldor/git-and-commits.md templates/docs/noldor/script-catalog.md docs/features/scope-sibling-trailer-for-doc-sync-commits.md
git commit -m "docs(noldor): document Noldor-Sibling-Scope trailer" -m "Noldor-FD: scope-sibling-trailer-for-doc-sync-commits"
```

The multi-page `noldor` subject scope passes `validate:noldor-scope` (framework-wide branch); the templates twins and the FD ride along fine under it (`check-feature-slug-scope` passes `noldor*` scopes through). This is a doc-only-plus-FD commit, so the sibling trailer would be rejected by its own mixed-diff guard — the subject scope is the correct tool here.
