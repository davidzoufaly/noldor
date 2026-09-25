# pen.dev Architecture Design Phase Implementation Plan — Part 5: the guard, archive and bridge

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** the rest of the UI design machinery learns about architecture designs.
- **The pre-commit guard** refuses:
  - a new architecture design `.pen` that has no matching record (`pen-unapproved`);
  - a commit that drops or degrades such a record while the `.pen` stays;
  - `docs/design/architecture/baseline.pen` staged from a worktree without `NOLDOR_ALLOW_PEN_WRITE=1` (`pen-baseline`).
- **`design archive`** moves a session's architecture `.pen` into `archive/` and repoints `links.arch`.
- **`design pen-bridge`** ranks architecture designs alongside UI ones.

**Architecture:** this part is the second half of the design-kind seam from ADR 0007.
- `penCandidatesForRecord` in `src/design/design-approval.ts` inverts `approvalRelPath`, so the guard's record-tamper rule resolves a record to the design of its own kind.
- `stagedAwarePenLookup` now takes a record path, not a bare stem. This is the reviewer's carry-over from the spec review: a bare stem cannot tell the kinds apart.
- `loadDocRoots()` gains `designArch`. `archive-resolve` collects from it under a new `arch-pen` move kind, whose FD link key is `arch`.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest, git.

**Parts:** 5 of 9. Part 4 made `design verdict` kind-aware. Part 6 adds `design arch-route`.

---

## File Structure

- `src/design/design-approval.ts` — **Modify.** Adds `penCandidatesForRecord(recordRelPath)`.
- `src/checks/check-shared-files.ts` — **Modify.** Adds `FEATURE_PEN_PREFIXES` for both kinds and an `isBaselinePen` that covers `ARCH_BASELINE_PATH`. The record-keyed `PenBlobLookup` and `stagedAwarePenLookup` change to match, and the `pen-baseline` remediation now names both kinds.
- `src/checks/__tests__/check-shared-files.test.ts` — **Modify.** Moves the lookup and tamper cases onto record paths, and adds architecture-design cases.
- `src/core/doc-roots.ts` — **Modify.** Adds `designArch` to `DocRoots` and `loadDocRoots`.
- `src/design/archive-resolve.ts` — **Modify.** Adds the `arch-pen` move kind, collected from `designArch`.
- `src/design/archive-cli.ts` — **Modify.** Maps `LINK_KEY_BY_KIND['arch-pen']` to `'arch'`.
- `src/sync/sync-fd-resources.ts` — **Modify.** `links.arch` follows its `.pen` into `archive/`, as `links.design` already does.
- `src/design/__tests__/archive-resolve.test.ts`, `src/design/__tests__/archive-cli.test.ts`, `src/sync/__tests__/sync-fd-resources.test.ts` — **Modify.** The architecture move and repoint cases.
- `src/design/pen-bridge.ts` — **Modify.** `rankPenCandidates` knows both kinds' designs and baselines.
- `src/design/__tests__/pen-bridge.test.ts` — **Modify.** The ranking case.

---

## Task 1: The guard knows architecture designs

**Files:**

- Modify: `src/design/design-approval.ts`
- Modify: `src/checks/check-shared-files.ts`
- Test: `src/checks/__tests__/check-shared-files.test.ts`

Three rules need the kind.

1. **The add rule.** It already requires a record for a new design. It now finds that record at the design's own kind's path.
2. **The record-tamper rule.** It resolved every record against `docs/design/ui/`. That meant two failures:
   - a dropped architecture record was never caught;
   - an architecture record whose stem matched a UI `.pen` was compared against the wrong blob.

   It now asks `penCandidatesForRecord`.
3. **The baseline rule.** It now covers the one architecture baseline file. The baseline is also left out of the feature-design set, so its first commit is not refused as an unkeyable design. That refusal would sit before the override and could not be waived.

- [ ] **Step 1: Move the existing lookup and tamper tests onto record paths.**

  In `src/checks/__tests__/check-shared-files.test.ts`:

  1. In `describe('check-shared-files / stagedAwarePenLookup', …)`, add directly after `const ARCHIVED = …;`:

  ```ts
    const RECORD = `.noldor/design-approval/${PEN_STEM}.json`;
  ```

  and change every `(PEN_STEM)` lookup call in that block to `(RECORD)` — all four `stagedAwarePenLookup(…)(PEN_STEM)` / `lookup(PEN_STEM)` calls.

  2. In `describe('check-shared-files / evaluate — record-tamper rule (amend bypass)', …)`, replace the `penInHead` line with:

  ```ts
    const penInHead: PenBlobLookup = (record) => (record === RECORD ? OID_A : null);
  ```

- [ ] **Step 2: Add the failing architecture cases.**

  1. In the `stagedAwarePenLookup` block, append:

  ```ts
    it('looks an architecture record up among the architecture designs, never the UI one with its stem', () => {
      const arch = `docs/design/architecture/${PEN_STEM}.pen`;
      const lookup = stagedAwarePenLookup([], (rel) => (rel === FEATURE ? OID_A : rel === arch ? OID_B : null));
      expect(lookup(`.noldor/design-approval/architecture/${PEN_STEM}.json`)).toBe(OID_B);
      expect(lookup(RECORD)).toBe(OID_A);
    });

    it('returns null for a path that is not a record', () => {
      expect(stagedAwarePenLookup([], () => OID_A)('.noldor/design-approval/notes.txt')).toBeNull();
    });
  ```

  2. In the record-tamper block, append:

  ```ts
    it('refuses a staged delete of an architecture record whose design survives', () => {
      const ARCH_RECORD = `.noldor/design-approval/architecture/${PEN_STEM}.json`;
      const staged: StagedChange[] = [{ path: ARCH_RECORD, change: 'delete', blob: ZERO }];
      const lookup = stagedAwareRecordLookup(staged, () => approvedRecord(OID_A));
      const archInHead: PenBlobLookup = (record) => (record === ARCH_RECORD ? OID_A : null);
      expect(evaluate(staged, MAIN, {}, lookup, archInHead)).toEqual([{ path: ARCH_RECORD, reason: 'pen-unapproved' }]);
    });
  ```

  3. At the end of the file, append:

  ```ts
  describe('check-shared-files / evaluate — architecture designs', () => {
    const ARCH_PEN = 'docs/design/architecture/2026-08-30-my-feature.pen';
    const ARCH_RECORD = '.noldor/design-approval/architecture/2026-08-30-my-feature.json';
    const BASELINE = 'docs/design/architecture/baseline.pen';
    const addArch: StagedChange = { path: ARCH_PEN, change: 'add', blob: OID_A };

    it('refuses an architecture design added with no record, asking for the architecture record path', () => {
      const asked: string[] = [];
      const lookup: RecordLookup = (p) => {
        asked.push(p);
        return null;
      };
      expect(evaluate([addArch], MAIN, {}, lookup)).toEqual([{ path: ARCH_PEN, reason: 'pen-unapproved' }]);
      expect(asked).toEqual([ARCH_RECORD]);
    });

    it('accepts an architecture design whose record matches', () => {
      const lookup: RecordLookup = (p) => (p === ARCH_RECORD ? approvedRecord(OID_A) : null);
      expect(evaluate([addArch], MAIN, {}, lookup)).toEqual([]);
    });

    it('treats the architecture baseline as a baseline: never a design, and refused from a worktree unless overridden', () => {
      expect(evaluate([{ path: BASELINE, change: 'add', blob: OID_A }], MAIN, {}, NO_RECORDS)).toEqual([]);
      expect(evaluate(mod(BASELINE), WORKTREE, {}, NO_RECORDS)).toEqual([{ path: BASELINE, reason: 'pen-baseline' }]);
      expect(evaluate(mod(BASELINE), WORKTREE, { NOLDOR_ALLOW_PEN_WRITE: '1' }, NO_RECORDS)).toEqual([]);
    });
  });
  ```

- [ ] **Step 3: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/checks/__tests__/check-shared-files.test.ts`
  Expected: FAIL. The moved lookup cases fail, because the lookup still expects a stem and returns `null` for a record path. The architecture cases fail because the guard ignores `docs/design/architecture/`: the unrecorded design passes, and the worktree baseline edit is not refused.

- [ ] **Step 4: Invert the record path.**

  In `src/design/design-approval.ts`:

  1. Change the design-artifact-names import to:

  ```ts
  import {
    ARCH_DESIGN_DIR,
    ARCHIVE_DIR,
    designKindOfPath,
    specSlugFromFilename,
    UI_DESIGN_DIR,
  } from '../core/design-artifact-names.js';
  ```

  2. Directly after `approvalRelPath`, add:

  ```ts
  /**
   * The `.pen` paths a record path can stand for — the design and its `archive/`
   * twin, in the record's own design kind — or `[]` for a path that is not a
   * record. The inverse of {@link approvalRelPath}; the guard's record-tamper
   * rule uses it to find the design a staged record belongs to.
   */
  export function penCandidatesForRecord(recordRelPath: string): string[] {
    const root = `${APPROVAL_DIR_SEGMENTS.join('/')}/`;
    if (!recordRelPath.startsWith(root) || !recordRelPath.endsWith('.json')) return [];
    const rest = recordRelPath.slice(root.length, -'.json'.length);
    const archPrefix = 'architecture/';
    const [dir, stem] = rest.startsWith(archPrefix)
      ? [ARCH_DESIGN_DIR, rest.slice(archPrefix.length)]
      : [UI_DESIGN_DIR, rest];
    if (stem === '' || stem.includes('/')) return [];
    return [`${dir}/${stem}.pen`, `${dir}/${ARCHIVE_DIR}/${stem}.pen`];
  }
  ```

- [ ] **Step 5: Make the guard kind-aware.**

  In `src/checks/check-shared-files.ts`:

  1. Replace the three consecutive imports at the top (from `../core/design-artifact-names.js`, `../core/slug.js` and `../design/design-approval.js`) with:

  ```ts
  import {
    ARCH_BASELINE_PATH,
    ARCH_DESIGN_DIR,
    ARCHIVE_DIR,
    penSlugFromFilename,
    UI_BASELINE_DIR,
    UI_DESIGN_DIR,
  } from '../core/design-artifact-names.js';
  import { isSlug } from '../core/slug.js';
  import {
    APPROVAL_DIR_SEGMENTS,
    approvalRelPath,
    parseApprovalBytes,
    penCandidatesForRecord,
  } from '../design/design-approval.js';
  ```

  2. Replace `const FEATURE_PEN_PREFIX = `${UI_DESIGN_DIR}/`;` and the whole `isFeaturePen` function, its doc comment included, with:

  ```ts
  /** Every design kind's directory (ADR 0007): a `.pen` under one is a design, unless it is that kind's baseline. */
  const FEATURE_PEN_PREFIXES = [`${UI_DESIGN_DIR}/`, `${ARCH_DESIGN_DIR}/`] as const;

  /** A baseline `.pen` of either kind: under the UI baseline directory, or the one architecture baseline file. */
  function isBaselinePen(path: string): boolean {
    return path.startsWith(BASELINE_PREFIX) || path === ARCH_BASELINE_PATH;
  }

  /**
   * A FEATURE `.pen`: under a design kind's directory, `archive/` included — an
   * add into `archive/` is usually `design archive`'s sanctioned move of a file
   * whose record (keyed by the unchanged stem, bound to the unchanged blob) is
   * already committed, and that satisfies the approval rules for free; a `.pen`
   * added DIRECTLY into `archive/` with no record would otherwise be the guard's
   * bypass. Baseline pens are excluded: undated (unkeyable by design), covered by
   * their own rule, and never verdict targets.
   */
  function isFeaturePen(path: string): boolean {
    return isPen(path) && FEATURE_PEN_PREFIXES.some((prefix) => path.startsWith(prefix)) && !isBaselinePen(path);
  }
  ```

  3. Replace the `PenBlobLookup` doc comment and type with:

  ```ts
  /**
   * The blob the resulting tree will hold for the design a record path stands
   * for (see `penCandidatesForRecord`), or `null` when neither the design nor its
   * `archive/` twin survives the commit. Injected for the record-tamper rule
   * below; {@link stagedAwarePenLookup} is the production shape.
   */
  export type PenBlobLookup = (recordRelPath: string) => string | null;
  ```

  4. Replace the whole `stagedAwarePenLookup` function, its doc comment included, with:

  ```ts
  /**
   * Production {@link PenBlobLookup}: staged entry first (a staged delete or a
   * zero oid means that path does not survive), `HEAD` for a path the commit
   * does not touch. Checks the design path, then its `archive/` twin — both in
   * the record's own design kind, so an architecture record is never compared
   * against a UI design that happens to share its stem.
   */
  export function stagedAwarePenLookup(
    staged: readonly StagedChange[],
    headBlob: (relPath: string) => string | null,
  ): PenBlobLookup {
    return (recordRelPath) => {
      for (const rel of penCandidatesForRecord(recordRelPath)) {
        const entry = staged.findLast((s) => s.path === rel);
        if (entry !== undefined) {
          if (entry.change === 'delete' || ZERO_OID_RE.test(entry.blob)) continue;
          return entry.blob;
        }
        const head = headBlob(rel);
        if (head !== null) return head;
      }
      return null;
    };
  }
  ```

  5. In `evaluate`'s add rule, change `const record = records(approvalRelPath(base));` to `const record = records(approvalRelPath(entry.path));`.
  6. In the record-tamper rule, replace the two lines

  ```ts
        const stem = (entry.path.split('/').at(-1) ?? '').slice(0, -'.json'.length);
        const penBlob = penBlobs(stem);
  ```

  with:

  ```ts
        const penBlob = penBlobs(entry.path);
  ```

  7. Change `if (inWorktree && entry.path.startsWith(BASELINE_PREFIX)) {` to `if (inWorktree && isBaselinePen(entry.path)) {`.
  8. In `REMEDIATION['pen-baseline']`, change `'UI baseline .pen edited from a feature worktree.\n'` to `'Baseline .pen (UI or architecture) edited from a feature worktree.\n'`.

- [ ] **Step 6: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/checks/__tests__/check-shared-files.test.ts src/design/__tests__/design-approval.test.ts`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(checks): the pre-commit .pen guard knows architecture designs

  A .pen under docs/design/architecture/ is a design the add rule holds to
  its record, the one architecture baseline file is a baseline the worktree
  rule holds to NOLDOR_ALLOW_PEN_WRITE, and the record-tamper rule resolves a
  record to the design of its own kind — stagedAwarePenLookup takes the record
  path now, so a dropped architecture record is caught and never compared
  against a UI design that shares its stem.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/design-approval.ts src/checks/check-shared-files.ts src/checks/__tests__/check-shared-files.test.ts
  git commit -F "$msg"
  ```

---

## Task 2: `design archive` knows architecture designs

**Files:**

- Modify: `src/core/doc-roots.ts`
- Modify: `src/design/archive-resolve.ts`
- Modify: `src/design/archive-cli.ts`
- Modify: `src/sync/sync-fd-resources.ts`
- Test: `src/design/__tests__/archive-resolve.test.ts`, `src/design/__tests__/archive-cli.test.ts`, `src/sync/__tests__/sync-fd-resources.test.ts`

The move reuses the pen collector unchanged: dialogue-key match, the branch-added ownership gate, collision skip. It gets its own move kind, `arch-pen`, because the FD pointer it repoints is `links.arch`, not `links.design`. The baseline file is undated, so the filename parser never matches it and it is never archived.

- [ ] **Step 1: Write the failing tests.**

  1. In `src/design/__tests__/archive-resolve.test.ts`, inside `describe('pen artifact resolution', …)`, append:

  ```ts
    it('resolves the session architecture design into its own archive, never the baseline', async () => {
      const ARCH = '/repo/docs/design/architecture';
      const plan = await resolveArchivePlan({
        repo: REPO,
        key: 'my-feature',
        branchAdded: ['docs/design/architecture/2026-08-19-my-feature.pen', 'docs/design/architecture/baseline.pen'],
        readdir: fakeReaddir({
          [SPECS]: [],
          [PLANS]: [],
          [ARCH]: ['2026-08-19-my-feature.pen', 'baseline.pen', 'milestones'],
        }),
      });
      expect(plan.moves).toEqual([
        {
          kind: 'arch-pen',
          from: 'docs/design/architecture/2026-08-19-my-feature.pen',
          to: 'docs/design/architecture/archive/2026-08-19-my-feature.pen',
        },
      ]);
    });
  ```

  2. In `src/design/__tests__/archive-cli.test.ts`, append at the end of the file:

  ```ts
  describe('design archive / architecture designs', () => {
    it('moves the session architecture .pen into archive/ and repoints links.arch', () => {
      const dir = repo({ session: { path: 'full-new', slug: KEY, startedAt: '2026-08-04T00:00:00.000Z' } });
      const pen = `docs/design/architecture/2026-08-04-${KEY}.pen`;
      const archived = `docs/design/architecture/archive/2026-08-04-${KEY}.pen`;
      mkdirSync(join(dir, 'docs/design/architecture'), { recursive: true });
      writeFileSync(join(dir, pen), '{"children":[]}\n');
      mkdirSync(join(dir, 'docs/features'), { recursive: true });
      writeFileSync(join(dir, 'docs/features', `${KEY}.md`), ['---', 'name: Seeded', 'links:', `  arch: ${pen}`, '---', '', 'body', ''].join('\n'));
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-qm', 'add architecture design']);
      const r = run(dir);
      expect(r.status).toBe(0);
      expect(staged(dir)).toContain(`R100\t${pen}\t${archived}`);
      const fm = matter(readFileSync(join(dir, 'docs/features', `${KEY}.md`), 'utf8')).data as { links: { arch: string } };
      expect(fm.links.arch).toBe(archived);
    });
  });
  ```

  3. In `src/sync/__tests__/sync-fd-resources.test.ts`, inside `describe('links.design archive repoint (syncFile)', …)`, append:

  ```ts
    it('repoints links.arch to archive/ when the file moved there', async () => {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(tmpDir, 'docs/design/architecture/archive'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs/design/architecture/archive/2026-09-24-x.pen'), 'pen', 'utf8');
      const mdPath = join(tmpDir, 'fd.md');
      writeFileSync(mdPath, '---\nname: Fake\nlinks:\n  arch: docs/design/architecture/2026-09-24-x.pen\n  code: []\n---\n\n## Summary\n\nBody.\n', 'utf8');
      await syncFile(mdPath);
      expect(readFileSync(mdPath, 'utf8')).toContain('arch: docs/design/architecture/archive/2026-09-24-x.pen');
    });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/archive-resolve.test.ts src/design/__tests__/archive-cli.test.ts src/sync/__tests__/sync-fd-resources.test.ts`
  Expected: FAIL.
  - The resolver case: no `arch-pen` move is planned.
  - The CLI case: `nothing to do` for the `.pen`, and `links.arch` is unchanged.
  - The sync case: `links.arch` still names the pre-archive path.

- [ ] **Step 3: Add the architecture design root.**

  In `src/core/doc-roots.ts`:
  - In `interface DocRoots`, directly after `designUi: string;`, add:

  ```ts
    /** Architecture-design artifacts: `baseline.pen`, dated session `.pen` files + `archive/`, `milestones/`. */
    designArch: string;
  ```

  - In `loadDocRoots`'s returned object, directly after the `designUi:` line, add:

  ```ts
      designArch: resolveDesignSubdir(cwd, 'architecture'),
  ```

- [ ] **Step 4: Collect architecture designs.**

  In `src/design/archive-resolve.ts`:
  1. In `interface ArchiveMove`, change `readonly kind: 'spec' | 'plan' | 'pen';` to `readonly kind: 'spec' | 'plan' | 'pen' | 'arch-pen';`.
  2. In `collect`, change `const ext = kind === 'pen' ? '.pen' : '.md';` to:

  ```ts
    const ext = kind === 'pen' || kind === 'arch-pen' ? '.pen' : '.md';
  ```

  (the `slugOf` chain already falls through to `penSlugFromFilename` for any kind that is not `spec` or `plan`).
  3. In `resolveArchivePlan`, replace the `const pens = …` line and the `return` with:

  ```ts
    const pens = await collect('pen', roots.designUi, repo, key, added, readdir);
    const archPens = await collect('arch-pen', roots.designArch, repo, key, added, readdir);

    return {
      key,
      moves: [...specs.moves, ...plans.moves, ...pens.moves, ...archPens.moves],
      skipped: [...specs.skipped, ...plans.skipped, ...pens.skipped, ...archPens.skipped],
    };
  ```

- [ ] **Step 5: Repoint `links.arch`.**

  1. In `src/design/archive-cli.ts`, replace the `LINK_KEY_BY_KIND` declaration with:

  ```ts
  const LINK_KEY_BY_KIND: Record<ArchiveMove['kind'], 'arch' | 'design' | 'plan' | 'spec'> = {
    'arch-pen': 'arch',
    pen: 'design',
    plan: 'plan',
    spec: 'spec',
  };
  ```

  and in `rewriteArtifactLinks`'s doc comment change `a pen move `links.design`.` to `a pen move `links.design`, an architecture pen move `links.arch`.`

  2. In `src/sync/sync-fd-resources.ts`:
  - in `interface FdFrontmatter`'s `links`, add `arch?: string;` as its first member;
  - in `syncFile`, replace the block from `const spec = resolveArchivedPath(fm.links.spec, existsSync);` through the closing `}` of its `if (…)` with:

  ```ts
      const spec = resolveArchivedPath(fm.links.spec, existsSync);
      const plan = resolveArchivedPathList(fm.links.plan, existsSync);
      const design = resolveArchivedPath(fm.links.design, existsSync);
      const arch = resolveArchivedPath(fm.links.arch, existsSync);
      if (spec !== null || plan !== null || design !== null || arch !== null) {
        data.links = {
          ...fm.links,
          ...(spec !== null ? { spec } : {}),
          ...(plan !== null ? { plan } : {}),
          ...(design !== null ? { design } : {}),
          ...(arch !== null ? { arch } : {}),
        };
        frontmatterChanged = true;
      }
  ```

- [ ] **Step 6: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/archive-resolve.test.ts src/design/__tests__/archive-cli.test.ts src/sync/__tests__/sync-fd-resources.test.ts`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: exit 0, no output. `LINK_KEY_BY_KIND` is a `Record` over the move-kind union, so omitting `'arch-pen'` would have been a type error.

- [ ] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): design archive moves a session's architecture design and repoints links.arch

  loadDocRoots gains designArch; archive-resolve collects dated .pen files
  from it as an arch-pen move under the same dialogue-key and branch-added
  ownership gate, the baseline never matching the dated scheme; the move
  repoints links.arch, and sync fd-resources follows it into archive/.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/doc-roots.ts src/design/archive-resolve.ts src/design/archive-cli.ts src/sync/sync-fd-resources.ts \
    src/design/__tests__/archive-resolve.test.ts src/design/__tests__/archive-cli.test.ts \
    src/sync/__tests__/sync-fd-resources.test.ts
  git commit -F "$msg"
  ```

---

## Task 3: `design pen-bridge` ranks architecture designs

**Files:**

- Modify: `src/design/pen-bridge.ts`
- Test: `src/design/__tests__/pen-bridge.test.ts`

A bare `design pen-bridge` wakes the editor with the best-ranked tracked `.pen`. Until now an architecture design ranked with "anything else", behind a UI baseline. After this task, designs of either kind rank first, and baselines of either kind rank second.

- [ ] **Step 1: Write the failing test.**

  In `src/design/__tests__/pen-bridge.test.ts`, inside `describe('rankPenCandidates', …)`, append:

  ```ts
    it('ranks architecture designs with UI designs, and the architecture baseline with baselines', () => {
      expect(
        rankPenCandidates([
          'vendor/misc.pen',
          'docs/design/architecture/baseline.pen',
          'docs/design/ui/baseline/app.pen',
          'docs/design/architecture/2026-09-24-bar.pen',
          'docs/design/ui/2026-08-25-foo.pen',
        ]),
      ).toEqual([
        'docs/design/architecture/2026-09-24-bar.pen',
        'docs/design/ui/2026-08-25-foo.pen',
        'docs/design/architecture/baseline.pen',
        'docs/design/ui/baseline/app.pen',
        'vendor/misc.pen',
      ]);
    });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm vitest run src/design/__tests__/pen-bridge.test.ts -t "architecture designs"`
  Expected: FAIL. The architecture design and baseline sort last, among "anything else".

- [ ] **Step 3: Rank both kinds.**

  In `src/design/pen-bridge.ts`:

  1. Replace the design-artifact-names import with:

  ```ts
  import {
    ARCH_BASELINE_PATH,
    ARCH_DESIGN_DIR,
    PENCIL_EXTENSION_ID,
    PENCIL_VIEW_TYPE,
    UI_BASELINE_DIR,
    UI_DESIGN_DIR,
  } from '../core/design-artifact-names.js';
  ```

  2. In `rankPenCandidates`, replace the `rank` arrow function with:

  ```ts
    const rank = (p: string): number => {
      if (p.startsWith(`${UI_BASELINE_DIR}/`) || p === ARCH_BASELINE_PATH) return 1;
      if (p.startsWith(`${UI_DESIGN_DIR}/`) || p.startsWith(`${ARCH_DESIGN_DIR}/`)) return 0;
      return 2;
    };
  ```

  3. In its doc comment, change `Feature designs first` to `Feature designs of either kind first` and `then baselines,` to `then either kind's baseline,`.

- [ ] **Step 4: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/pen-bridge.test.ts`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): design pen-bridge ranks architecture designs beside UI ones

  A bare pen-bridge now prefers a design of either kind, then either kind's
  baseline, then anything else — an architecture design no longer ranks
  behind a UI baseline.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/pen-bridge.ts src/design/__tests__/pen-bridge.test.ts
  git commit -F "$msg"
  ```

  Run: `pnpm noldor checks push-gates`
  Expected: exit 0. On exit 1, fix what it names — usually a clones baseline or a template twin — and commit the fix before Part 6.
