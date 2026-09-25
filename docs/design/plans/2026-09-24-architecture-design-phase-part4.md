# pen.dev Architecture Design Phase Implementation Plan — Part 4: `design verdict` for architecture designs

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor design verdict --pen docs/design/architecture/<date>-<key>.pen --approve --surface <view> …` approves an architecture design, exactly as it approves a UI one.
- The record lands at `.noldor/design-approval/architecture/<stem>.json`, so it never overwrites a UI record with the same stem.
- Every `--surface` must be one of the four views.
- `--check` still finds the record after the `.pen` moves into `archive/`.
- The session marker carries `archVerdict` / `archWaiver`, and the FD carries `links.arch`.

**Architecture:** the design-kind seam from ADR 0007, first half.
- `src/core/design-artifact-names.ts` gains `DesignKind` and `designKindOfPath`.
- `src/design/design-approval.ts` derives a record's directory from the `.pen`'s path: `architecture/` for an architecture design, the UI root for everything else, a bare basename included. That keeps every existing UI caller and the `ui-reviewer` lane byte-for-byte unchanged.
- `design verdict` (`src/design/design-approval-cli.ts`) takes the kind from `--pen` and contains it in that kind's directory.

**Tech Stack:** TypeScript (ESM, Node >= 24), zod, vitest.

**Parts:** 4 of 9. Part 5 teaches the pre-commit guard, `design archive` and `design pen-bridge` the same kinds.

---

## File Structure

- `src/core/design-artifact-names.ts` — **Modify.** Adds `DesignKind` and `designKindOfPath`.
- `src/design/design-approval.ts` — **Modify.** Adds `approvalDirSegments`. `approvalRelPath`, `readApproval` and `writeApproval` now take a `.pen` path or basename.
- `src/design/__tests__/design-approval.test.ts` — **Modify.** New cases: record paths by kind, a UI and an architecture record with one stem, and the CLI on an architecture design.
- `src/design/design-approval-cli.ts` — **Modify.** `resolveFeaturePen` becomes kind-aware and returns the kind. `--surface` must be a view for an architecture design, and records are addressed by the `.pen`'s repo path.
- `src/core/session.ts` — **Modify.** Adds `archVerdict` and `archWaiver` to the strict marker schema.
- `src/core/__tests__/session.test.ts` — **Modify.** Cases for the two fields.
- `src/core/feature-schema.ts` — **Modify.** Adds `links.arch`, a `.pen` path sharing one `penLink` refinement with `links.design`.
- `src/core/__tests__/feature-schema.test.ts` — **Modify.** Cases for `links.arch`.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** The `design:verdict` entry names the architecture directory, the view rule, and the record path.

---

## Task 1: Approval records by design kind

**Files:**

- Modify: `src/core/design-artifact-names.ts`
- Modify: `src/design/design-approval.ts`
- Test: `src/design/__tests__/design-approval.test.ts`

Records are keyed by the `.pen` stem, so a UI design and an architecture design dated the same day with the same key would share one record. The directory now comes from the path. `archive/` is transparent: the record for `docs/design/architecture/archive/<stem>.pen` is the one the file had before the move. A bare basename still means the UI root. The `ui-reviewer` lane (`src/cr/lanes/ui-design-resolve.ts`) and every existing test pass basenames, so none of them changes.

- [x] **Step 1: Write the failing tests.**

  In `src/design/__tests__/design-approval.test.ts`, directly after the `describe('design-approval / record round-trip', …)` block, add:

  ```ts
  describe('design-approval / records by design kind', () => {
    const ARCH = 'docs/design/architecture/2026-08-30-my-feature.pen';
    const ARCH_APPROVED: DesignApprovalRecord = {
      outcome: 'approved',
      at: '2026-08-30T00:00:00.000Z',
      penBlob: 'e'.repeat(40),
      surfaces: ['modules'],
    };

    it('records an architecture design under architecture/, archived or not, and leaves UI paths alone', () => {
      expect(approvalRelPath(ARCH)).toBe('.noldor/design-approval/architecture/2026-08-30-my-feature.json');
      expect(approvalRelPath('docs/design/architecture/archive/2026-08-30-my-feature.pen')).toBe(
        '.noldor/design-approval/architecture/2026-08-30-my-feature.json',
      );
      expect(approvalRelPath(`docs/design/ui/${PEN}`)).toBe('.noldor/design-approval/2026-08-30-my-feature.json');
      expect(approvalRelPath(PEN)).toBe('.noldor/design-approval/2026-08-30-my-feature.json');
    });

    it('keeps a UI record and an architecture record with the same stem apart', () => {
      const cwd = tempRepo();
      expect(writeApproval(cwd, `docs/design/ui/${PEN}`, APPROVED).ok).toBe(true);
      expect(writeApproval(cwd, ARCH, ARCH_APPROVED).ok).toBe(true);
      expect(readBack(cwd, `docs/design/ui/${PEN}`)).toEqual(APPROVED);
      expect(readBack(cwd, ARCH)).toEqual(ARCH_APPROVED);
    });
  });
  ```

- [x] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts -t "records by design kind"`
  Expected: FAIL. `approvalRelPath(ARCH)` returns `.noldor/design-approval/2026-08-30-my-feature.json`, and the round-trip case reads the UI record back for both paths.

- [x] **Step 3: Add the kind.**

  In `src/core/design-artifact-names.ts`, directly after the `ARCH_BASELINE_PATH` export, add:

  ```ts
  /**
   * The design-artifact kinds. Each has its own design directory and baseline;
   * every other piece of the lifecycle — approval record, `.pen` guard, archive,
   * bridge — is shared and takes the kind from the path (ADR 0007).
   */
  export type DesignKind = 'ui' | 'architecture';

  /** A design `.pen`'s kind from its repo-relative POSIX path, or `null` for a path under neither design directory. */
  export function designKindOfPath(path: string): DesignKind | null {
    if (path.startsWith(`${ARCH_DESIGN_DIR}/`)) return 'architecture';
    if (path.startsWith(`${UI_DESIGN_DIR}/`)) return 'ui';
    return null;
  }
  ```

- [x] **Step 4: Derive the record directory from the path.**

  In `src/design/design-approval.ts`:

  1. In the header comment, change `one file per design artifact at` / `` `.noldor/design-approval/<pen-stem>.json` `` to read `` `.noldor/design-approval/[architecture/]<pen-stem>.json` ``.
  2. Change the design-artifact-names import to:

  ```ts
  import { designKindOfPath, specSlugFromFilename } from '../core/design-artifact-names.js';
  ```

  3. Replace the `approvalRelPath` function with:

  ```ts
  /**
   * The record directory for a design `.pen`, as repo-relative segments. A path
   * under `docs/design/architecture/` records under `architecture/`; anything
   * else — a UI path, or a bare basename (the ui-reviewer lane, older callers) —
   * keeps the UI root. `archive/` never enters the path: `design archive` moves
   * the `.pen` and the record stays where it is.
   */
  export function approvalDirSegments(pen: string): readonly string[] {
    return designKindOfPath(pen) === 'architecture' ? [...APPROVAL_DIR_SEGMENTS, 'architecture'] : APPROVAL_DIR_SEGMENTS;
  }

  /** Record path relative to the repo root, for git pathspecs and staged-set lookups. */
  export function approvalRelPath(pen: string): string {
    return `${approvalDirSegments(pen).join('/')}/${basename(pen, '.pen')}.json`;
  }
  ```

  4. In `readApproval`, rename the parameter `penBasename` to `pen` (both uses). The body is otherwise unchanged; it already calls `approvalRelPath`.
  5. Replace the `writeApproval` function with:

  ```ts
  /**
   * Write a design's record (atomic, slug-contained; see the receipt store —
   * the stem comes from a caller-supplied `--pen` argument, Q-0097 discipline).
   * `pen` is the `.pen`'s repo path or basename; the kind it implies picks the
   * directory (see {@link approvalDirSegments}). An existing record for the same
   * stem is OVERWRITTEN: re-taking the verdict on a revised design is the normal
   * remedy for a stale record, and refuse-if-exists would make that state
   * unrecoverable.
   */
  export function writeApproval(
    repoRoot: string,
    pen: string,
    record: DesignApprovalRecord,
  ): { ok: true; path: string } | { ok: false; message: string } {
    return writeReceiptFile(repoRoot, approvalDirSegments(pen), basename(pen, '.pen'), record);
  }
  ```

- [x] **Step 5: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts`
  Expected: PASS — every case, the two new ones included.

  Run: `pnpm vitest run src/checks/__tests__/check-shared-files.test.ts src/cr/__tests__/lanes/ui-review.test.ts`
  Expected: PASS. Both callers pass basenames, and a basename still maps to the UI root. The second file covers `ui-design-resolve.ts`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [x] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): a design-approval record's directory follows its .pen's design kind

  Records are keyed by stem, so a UI and an architecture design with the same
  date and key would have shared one. An architecture .pen now records under
  .noldor/design-approval/architecture/; a UI path or a bare basename keeps the
  UI root, so every existing caller is unchanged, and archive/ never enters the
  path, so an archived design keeps its record.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/design-artifact-names.ts src/design/design-approval.ts src/design/__tests__/design-approval.test.ts
  git commit -F "$msg"
  ```

---

## Task 2: `design verdict` accepts architecture designs

**Files:**

- Modify: `src/design/design-approval-cli.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/design/__tests__/design-approval.test.ts`

The kind is read from the lexical `--pen` path, which `path.resolve` has already normalised. The file must then realpath-resolve inside that kind's directory and must not be that kind's baseline. For an architecture design a "surface" is a view, so `--surface` must name one of `ARCH_VIEWS`. The `FINAL:<surface>:` coverage rule is reused unchanged.

- [ ] **Step 1: Write the failing tests.**

  In `src/design/__tests__/design-approval.test.ts`, directly after the `describe('design verdict CLI / end to end', …)` block, add:

  ```ts
  describe('design verdict CLI / architecture designs', () => {
    const archRel = `docs/design/architecture/${PEN}`;
    const ARCH_PAGES = ['BASE:modules: as-built', 'FINAL:modules: split cr'];

    function archRepo(): string {
      const cwd = gitRepo();
      mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'archive'), { recursive: true });
      writeFileSync(join(cwd, 'docs', 'design', 'architecture', PEN), penJson(ARCH_PAGES));
      return cwd;
    }
    const archArgv = (surfaces: readonly string[] = ['modules']): string[] => [
      '--pen',
      archRel,
      '--approve',
      ...surfaces.flatMap((s) => ['--surface', s]),
      '--spec',
      specRel,
      ...ARCH_PAGES.flatMap((p) => ['--editor-page', p]),
    ];

    it('writes the record under architecture/, beside a UI record of the same stem', async () => {
      const cwd = archRepo();
      expect((await run(cwd, approveArgv())).code).toBe(0);
      expect((await run(cwd, archArgv())).code).toBe(0);
      expect(readBack(cwd, archRel)).toMatchObject({ outcome: 'approved', surfaces: ['modules'], penBlob: blobOf(cwd, archRel) });
      expect(readBack(cwd, penRel)).toMatchObject({ outcome: 'approved', surfaces: ['app'] });
    });

    it('refuses a surface that is not an architecture view, writing nothing', async () => {
      const cwd = archRepo();
      const r = await run(cwd, archArgv(['app']));
      expect(r.code).toBe(2);
      expect(r.err).toContain('not an architecture view');
      expect(readBack(cwd, archRel)).toBeNull();
    });

    it('refuses the architecture baseline', () => {
      const cwd = archRepo();
      writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'), penJson(['modules']));
      expect(resolveFeaturePen(cwd, 'docs/design/architecture/baseline.pen').ok).toBe(false);
    });

    it('still finds the record after the design moves into archive/', async () => {
      const cwd = archRepo();
      expect((await run(cwd, archArgv())).code).toBe(0);
      renameSync(join(cwd, archRel), join(cwd, 'docs', 'design', 'architecture', 'archive', PEN));
      const r = await run(cwd, ['--pen', `docs/design/architecture/archive/${PEN}`, '--check']);
      expect(r.code).toBe(0);
      expect(r.out).toContain('current');
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts -t "architecture designs"`
  Expected: FAIL. `--pen` is refused with `--pen must resolve inside docs/design/ui/`, so the verdict exits 2 where 0 is expected.

- [ ] **Step 3: Make `design verdict` kind-aware.**

  In `src/design/design-approval-cli.ts`:

  1. Replace the design-artifact-names import with:

  ```ts
  import {
    ARCH_BASELINE_PATH,
    ARCH_DESIGN_DIR,
    ARCHIVE_DIR,
    designKindOfPath,
    penSlugFromFilename,
    specSlugFromFilename,
    UI_BASELINE_DIR,
    UI_DESIGN_DIR,
    type DesignKind,
  } from '../core/design-artifact-names.js';
  ```

  and add, after the `./design-approval.js` import:

  ```ts
  import { ARCH_VIEWS } from './arch-pen.js';
  ```

  2. In `USAGE`, directly after its second line (the `--editor-page … [--reservation <text>]` line), add:

  ```ts
    '                      (a docs/design/architecture/ .pen takes views as surfaces: context | containers | modules | flows)\n' +
  ```

  3. Replace the whole `resolveFeaturePen` function, its doc comment included, with:

  ```ts
  /**
   * Containment for `--pen`: the path must realpath-resolve inside one design
   * kind's directory — `docs/design/ui/` or `docs/design/architecture/`, the kind
   * read off the lexical path — and must not be that kind's baseline. Symlinks,
   * traversal and absolute paths all resolve BEFORE the test. `archive/` is
   * deliberately inside: gate Step 4 archives the `.pen` in the flip commit
   * before the code-stage lane runs, so a re-verdict on an archived design is a
   * legitimate call, not an error.
   */
  export function resolveFeaturePen(
    repoRoot: string,
    penArg: string,
  ): { ok: true; abs: string; base: string; kind: DesignKind } | Refusal {
    const lexical = relative(repoRoot, resolve(repoRoot, penArg)).split(sep).join('/');
    const kind = designKindOfPath(lexical) ?? 'ui';
    const designDir = kind === 'architecture' ? ARCH_DESIGN_DIR : UI_DESIGN_DIR;
    const found = resolveUnder(repoRoot, '--pen', penArg, join(repoRoot, designDir));
    if (!found.ok) return found;
    const { abs, root: designRoot } = found;
    const rel = relative(designRoot, abs);
    if (rel.startsWith('..') || rel === '') {
      return { ok: false, error: `--pen must resolve inside ${UI_DESIGN_DIR}/ or ${ARCH_DESIGN_DIR}/` };
    }
    // Baseline exclusion, resolved. Either baseline may not exist yet (a repo
    // before its first capture or bootstrap), which excludes nothing.
    const resolvedOrNull = (path: string): string | null => {
      try {
        return realpathSync(join(repoRoot, path));
      } catch {
        return null;
      }
    };
    if (kind === 'ui') {
      const baselineRoot = resolvedOrNull(UI_BASELINE_DIR);
      if (baselineRoot !== null && abs.startsWith(baselineRoot + sep)) {
        return { ok: false, error: '--pen must not name a baseline .pen' };
      }
    } else if (abs === resolvedOrNull(ARCH_BASELINE_PATH)) {
      return { ok: false, error: '--pen must not name a baseline .pen' };
    }
    if (!abs.endsWith('.pen')) return { ok: false, error: '--pen must name a .pen file' };
    return { ok: true, abs, base: basename(abs), kind };
  }
  ```

  4. In `interface VerdictCtx`, change the `pen` member to:

  ```ts
    pen: { abs: string; base: string; rel: string; key: string; kind: DesignKind };
  ```

  5. In `writeValidated`, change `writeApproval(ctx.cwd, ctx.pen.base, parsed.data)` to `writeApproval(ctx.cwd, ctx.pen.rel, parsed.data)`.
  6. In `approve`, directly above `const coverage = surfaceCoverageError(mode.surfaces, read.pages);`, add:

  ```ts
    if (ctx.pen.kind === 'architecture') {
      const views: readonly string[] = ARCH_VIEWS;
      const stray = mode.surfaces.filter((surface) => !views.includes(surface));
      if (stray.length > 0) {
        return fail(`--surface ${stray.join(', ')} is not an architecture view (${views.join(' | ')})`, 2);
      }
    }
  ```

  7. In `loadApproval`, change `readApproval(ctx.cwd, ctx.pen.base)` to `readApproval(ctx.cwd, ctx.pen.rel)`.
  8. In `main`, change the `ctx` construction's `pen:` value to:

  ```ts
      pen: {
        abs: pen.abs,
        base: pen.base,
        rel: relative(cwd, pen.abs).split(sep).join('/'),
        key,
        kind: pen.kind,
      },
  ```

- [ ] **Step 4: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts`
  Expected: PASS — every case, the four new ones included.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 5: Update the catalog entry (both twins).**

  In `docs/noldor/script-catalog.md`, in the `### \`design:verdict\`` entry, make three replacements:

  1. In the `- **Inputs:**` bullet, replace `` `--pen` must realpath-resolve inside `docs/design/ui/` (its `archive/` included, `baseline/` excluded) `` with:

     `` `--pen` must realpath-resolve inside `docs/design/ui/` or `docs/design/architecture/` (each one's `archive/` included; `docs/design/ui/baseline/` and `docs/design/architecture/baseline.pen` excluded) ``

  2. In the same bullet, replace `and every `FINAL:` page must name one)` with:

     `and every `FINAL:` page must name one; for an architecture design each must also be a view — `context`, `containers`, `modules` or `flows`)`

  3. In the `- **Outputs:**` bullet, replace the opening `` `.noldor/design-approval/<pen-stem>.json` — `` with:

     `` `.noldor/design-approval/<pen-stem>.json` for a UI design, `.noldor/design-approval/architecture/<pen-stem>.json` for an architecture design (an archived `.pen` keeps its record path) — ``

  Run: `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`

- [ ] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): design verdict approves an architecture design

  --pen may now name a .pen under docs/design/architecture/ (archive/
  included, the baseline excluded), contained by the kind its path implies;
  for such a design every --surface must be a view, and the record is
  addressed by the .pen's repo path so it lands under architecture/.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/design-approval-cli.ts src/design/__tests__/design-approval.test.ts \
    docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  git commit -F "$msg"
  ```

---

## Task 3: The session marker and the FD carry the architecture design

**Files:**

- Modify: `src/core/session.ts`
- Modify: `src/core/feature-schema.ts`
- Test: `src/core/__tests__/session.test.ts`, `src/core/__tests__/feature-schema.test.ts`

The session marker is `.strict()`, so the spec step (Part 7) cannot record its verdict until the schema declares it. `links.arch` takes the same refinement as `links.design`. It is hoisted into one `penLink` helper rather than copied, because two copies would trip the clones ratchet and could drift apart.

- [ ] **Step 1: Write the failing tests.**

  Append to `src/core/__tests__/session.test.ts`:

  ```ts
  describe('architecture-design fields', () => {
    const base = { path: 'full-new', slug: 's', startedAt: '2026-09-24T00:00:00Z' };

    it('accepts archVerdict and archWaiver, and both stay optional', () => {
      expect(() =>
        SessionMarkerSchema.parse({
          ...base,
          archVerdict: 'required',
          archWaiver: { reason: 'no VS Code window', at: '2026-09-24T10:00:00Z' },
        }),
      ).not.toThrow();
      expect(() => SessionMarkerSchema.parse(base)).not.toThrow();
    });

    it('rejects an unknown archVerdict value', () => {
      expect(() => SessionMarkerSchema.parse({ ...base, archVerdict: 'maybe' })).toThrow();
    });
  });
  ```

  Append to `src/core/__tests__/feature-schema.test.ts`:

  ```ts
  describe('links.arch', () => {
    const withArch = (arch: string): boolean =>
      FeatureFrontmatterSchema.safeParse({ ...base, links: { ...base.links, arch } }).success;

    it('accepts a repo-relative .pen path and refuses anything else', () => {
      expect(withArch('docs/design/architecture/2026-09-24-x.pen')).toBe(true);
      for (const arch of ['docs/design/architecture/x.md', '/abs/x.pen', 'docs/../x.pen', 'https://x.test/x.pen']) {
        expect(withArch(arch)).toBe(false);
      }
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/core/__tests__/session.test.ts src/core/__tests__/feature-schema.test.ts`
  Expected: FAIL.
  - The session case throws `Unrecognized key(s) in object: 'archVerdict', 'archWaiver'`, because the schema is strict.
  - The `links.arch` case reports the valid path as `false`, because `LinksSchema` is strict too.

- [ ] **Step 3: Declare the session fields.**

  In `src/core/session.ts`, inside `SessionMarkerSchema`'s object, directly after the `uiWaiver` field, add:

  ```ts
      /** Spec-time architecture-design verdict, written by /noldor-spec step 1.6 (spec: "Spec step"). */
      archVerdict: z.enum(['required', 'skip']).optional(),
      /** Operator waiver for a required architecture design with no editor — the same shape as `uiWaiver`. */
      archWaiver: z
        .object({ reason: z.string().min(1), at: z.string().min(1) })
        .strict()
        .optional(),
  ```

- [ ] **Step 4: Declare `links.arch`.**

  In `src/core/feature-schema.ts`, directly above `const LinksSchema = z`, add:

  ```ts
  /** A repo-relative POSIX `.pen` path — the one shape both design links take. */
  function penLink(key: 'arch' | 'design') {
    return z
      .string()
      .min(1)
      .refine(
        (p) =>
          p.endsWith('.pen') &&
          !p.startsWith('/') &&
          !p.includes('\\') &&
          !p.split('/').includes('..') &&
          !/^[a-z][a-z0-9+.-]*:/i.test(p),
        { message: `links.${key} must be a repo-relative POSIX .pen path` },
      );
  }
  ```

  Then, inside `LinksSchema`'s object:
  - Add as its first member:

  ```ts
      /** Repo-relative path of the feature's architecture-design `.pen` (spec: "Design-kind seam"). */
      arch: penLink('arch').optional(),
  ```

  - Replace the whole `design:` member (from `design: z` through its `.optional(),`) with:

  ```ts
      design: penLink('design').optional(),
  ```

  Keep the `/** Repo-relative path of the feature's UI-design `.pen` artifact (spec U3). */` comment above `design:`.

- [ ] **Step 5: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/core/__tests__/session.test.ts src/core/__tests__/feature-schema.test.ts`
  Expected: PASS.

  Run: `pnpm noldor validate features`
  Expected: `Validated 94 feature MD(s) — all OK.` The count may be higher if features landed on `main` since.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(core): the session marker and the FD carry an architecture design

  The strict session marker gains archVerdict and archWaiver, the fields the
  spec step's architecture verdict writes; the FD gains links.arch, sharing
  one penLink refinement with links.design instead of a copy.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/session.ts src/core/feature-schema.ts \
    src/core/__tests__/session.test.ts src/core/__tests__/feature-schema.test.ts
  git commit -F "$msg"
  ```
