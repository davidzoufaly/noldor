# Template-Sync Gate — Design

**Date:** 2026-06-01
**Status:** Approved (pending implementation plan)

## Problem

This repo self-hosts the Noldor framework: it is both the package (source-of-truth
under `templates/`) and a consumer (the generated copies at repo-relative paths).
`noldor doctor` diffs each templated file against its consumer copy by sha256, and
`noldor init --update` regenerates consumer copies from `templates/`.

Editing a consumer copy of a templated file **without** making the same change to
its `templates/` copy is a silent trap: the next `init --update` (or any sync)
reverts the consumer edit. This already bit the Rules Cascade work — the
`rules validate` pre-commit job was added to `lefthook/noldor.yml` (the consumer
copy) but not to `templates/lefthook/noldor.yml`, so a re-sync dropped it. The
failure was invisible until manually diffed.

## Goal

Hard-block any commit or push in which a templated file's consumer copy and its
`templates/` copy are not byte-identical. Make the silent revert impossible to
introduce unnoticed.

## Non-Goals

- CI-side enforcement (a `--no-verify` backstop). Flagged for later; out of scope.
- Changing the drift model (it stays pure sha256 byte-equality).
- A "scaffold / seed-once / allowed-to-diverge" file class. None exists today
  (`computeDrift` treats every templated file as exact-match), and none is added.
- Global doctor-clean enforcement (would block commits on pre-existing unrelated
  drift). The gate is scoped to files a given commit/push touches.

## Background (existing machinery reused)

- `src/templates/manifest.ts` — `TEMPLATES_ROOT` (package-asset path) and
  `templateFiles()` → every path under `templates/`, relative to it.
- `src/templates/diff.ts` — `computeDrift(templateRoot, consumerRoot, relPaths)`
  → `DriftEntry[]` with status `unchanged` (sha match) | `drifted` (both exist,
  differ) | `missing` (consumer absent).
- `src/cli/manifest.ts` — the `checks` group (`invariants`, `shared-files`,
  `feature-slug-scope`). Entrypoints follow the manifest-dispatch pattern:
  the router reshapes `process.argv` to `[node, modPath, ...args]` then dynamic-
  imports, so the `import.meta.url === \`file://${process.argv[1]}\`` guard fires.
- `lefthook/noldor.yml` (+ its template `templates/lefthook/noldor.yml`) — the
  `pre-commit` `validate` parallel-jobs group and the `pre-push` jobs list.

## Architecture

Two units: a pure core (testable in isolation) and a thin argv entrypoint that
resolves the changed-file list per hook context.

### 1. Pure core — `src/checks/check-template-sync.ts`

```ts
export interface TemplateSyncResult {
  ok: boolean;
  offenders: DriftEntry[]; // status 'drifted' | 'missing'
}

export function checkTemplateSync(opts: {
  cwd: string;
  changedFiles: readonly string[];
  templatesRoot?: string;   // defaults to TEMPLATES_ROOT; injectable for tests
}): TemplateSyncResult;
```

Logic:
1. Build the templated rel-path set for this run:
   - a changed path `templates/<rel>` → `<rel>`;
   - a changed path that is itself a member of `templateFiles(templatesRoot)` →
     that path;
   - any other changed path → dropped (no-op).
   Deduplicate.
2. `computeDrift(templatesRoot, cwd, relSet)`.
3. `offenders` = entries whose status ≠ `unchanged`. `ok = offenders.length === 0`.

This is bidirectional for free: editing either the consumer or the template side
surfaces drift on the shared rel-path. It no-ops entirely when no templated file
is touched.

### 2. Entrypoint — `src/checks/template-sync.ts`

- Resolves `changedFiles`:
  - **pre-commit:** from argv (lefthook passes `{staged_files}`).
  - **pre-push:** if argv is empty, compute the range via git —
    `git diff --name-only @{upstream}..HEAD`, falling back to
    `origin/main..HEAD` when no upstream is configured.
- Calls `checkTemplateSync({ cwd: process.cwd(), changedFiles })`.
- On failure: print one line per offender naming the rel-path and its status,
  plus the fix hint:
  > `<rel>` (drifted): consumer copy differs from `templates/<rel>`. Edit the
  > template too, or run `noldor init --update` to regenerate the consumer copy.

  (for `missing`: consumer copy absent; run `noldor init --update`.)
  Then `process.exitCode = 1; return;`.
- On success: print a terse `template-sync OK` line (matching sibling check
  style); exit 0.
- Guarded by `if (import.meta.url === \`file://${process.argv[1]}\`) main();`.

### 3. Manifest + hook wiring

- `src/cli/manifest.ts` — add to the `checks` group:
  ```ts
  'template-sync': {
    src: 'checks/template-sync.ts',
    desc: 'Block templated files drifting from their templates/ copy',
  },
  ```
- `lefthook/noldor.yml` **and** `templates/lefthook/noldor.yml` (both, to avoid
  the very trap this gate addresses):
  - **pre-commit** `validate` group, new parallel job:
    ```yaml
    - name: template-sync
      run: pnpm noldor checks template-sync {staged_files}
    ```
    No `glob`: the core filters to templated paths; the sha check over only the
    staged-touched set is cheap.
  - **pre-push** jobs list, new job:
    ```yaml
    - name: template-sync
      run: pnpm noldor checks template-sync
    ```
    (no args → entrypoint computes the pushed range from git.)

## Testing

Pure-core tests (`src/checks/__tests__/check-template-sync.test.ts`) with tmpdir
template + consumer roots, injecting `templatesRoot`:
- in-sync templated file changed → `ok: true`, no offenders.
- consumer-only edit (consumer differs from template) → flagged `drifted`.
- template-only edit (changed path under `templates/`) → flagged `drifted` on the
  shared rel-path.
- non-templated file changed → ignored, `ok: true`.
- missing consumer copy → flagged `missing`.
- mixed changed list (one synced templated file + one drifted + one unrelated) →
  only the drifted one is an offender.

Entrypoint smoke (optional, light): `pnpm noldor checks template-sync` runs and
exits 0 on a clean tree.

## Known Limitations (documented, not fixed in v1)

- **Working-tree semantics.** `computeDrift` reads on-disk (working-tree) content,
  matching `doctor`. Partial staging (`git add -p`) where the working tree differs
  from staged content can diverge from what is actually committed. Accepted for v1.
- **Both-sides-deleted.** If both `templates/<rel>` and the consumer `<rel>` are
  deleted in the same commit, `<rel>` is no longer in `templateFiles()` and is not
  flagged. Edge case; not handled.
- **`--no-verify` bypass.** Both hooks are skippable with `--no-verify`. The real
  backstop is CI, which is out of scope here and flagged for later.

## File Summary

- Create: `src/checks/check-template-sync.ts` (pure core)
- Create: `src/checks/template-sync.ts` (entrypoint)
- Create: `src/checks/__tests__/check-template-sync.test.ts`
- Modify: `src/cli/manifest.ts` (add `checks template-sync`)
- Modify: `lefthook/noldor.yml` (pre-commit + pre-push jobs)
- Modify: `templates/lefthook/noldor.yml` (same jobs — keep in sync)
