# pen.dev Architecture Design Phase Implementation Plan — Part 8: approving and committing a milestone target

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** a milestone can carry a target architecture at `docs/design/architecture/milestones/<slug>.pen`.
- **Approving:** `pnpm noldor design verdict --pen <that file> --approve --surface <view> --milestone <slug> --editor-page …` approves it against `docs/milestones/<slug>.md` and writes `.noldor/design-approval/architecture/milestones/<slug>.json`. `--check` exits 1 once the milestone file changes.
- **Committing:** a micro-chore commit may carry the milestone file, its target and the record. The pre-commit guard still refuses the target without a record.

**Architecture:**
- **Names.** `src/core/design-artifact-names.ts` names the milestone directory and maps a slug to its target and back.
- **Record.** The record gains an optional `milestone: { slug, blob }` beside `spec`. The approved member stays a plain object, because zod's discriminated union takes no refinement. So `design verdict` enforces the exclusivity: it never writes both, and `--spec` / `--milestone` are refused together.
- **Record path.** The target is undated, so the guard keys it by slug rather than through `penSlugFromFilename`, and its record path mirrors its place.

**Tech Stack:** TypeScript (ESM, Node >= 24), zod, vitest, git.

**Parts:** part 8 of 9. Part 9 adds `design arch-progress` and the milestone skill's target step.

---

## File Structure

- `src/core/design-artifact-names.ts` — **Modify.** Adds `ARCH_MILESTONES_DIR`, `milestonePenPath` and `milestoneSlugFromPenPath`.
- `src/design/design-approval.ts` — **Modify.**
  - Adds the `milestone` record field.
  - Sends a milestone target's records to `architecture/milestones/`, in both `approvalDirSegments` and `penCandidatesForRecord`.
- `src/design/design-approval-cli.ts` — **Modify.**
  - Adds `--milestone <slug>` and the `ApprovalBinding` type.
  - `resolveFeaturePen` reports the milestone, and a milestone target is keyed by its slug.
  - `resolveBinding` and `boundFile` bind and read either a spec or a milestone file.
- `src/design/__tests__/design-approval.test.ts` — **Modify.** Adds milestone record paths and the `--milestone` verdict cases.
- `src/checks/check-shared-files.ts` — **Modify.** The add rule keys a milestone target by its slug.
- `src/checks/__tests__/check-shared-files.test.ts` — **Modify.** Adds milestone-target cases.
- `src/core/allowlist.ts` — **Modify.** `MICRO_CHORE_GLOBS` admits milestone targets and their records.
- `src/core/__tests__/allowlist.test.ts` — **Modify.** Adds the lane cases.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** Documents `--milestone` in the `design:verdict` entry.

---

## Task 1: The record binds a milestone

**Files:**

- Modify: `src/core/design-artifact-names.ts`
- Modify: `src/design/design-approval.ts`
- Test: `src/design/__tests__/design-approval.test.ts`

- [x] **Step 1: Write the failing tests.**

  In `src/design/__tests__/design-approval.test.ts`, inside `describe('design-approval / records by design kind', …)`, append:

  ```ts
    it('records a milestone target under architecture/milestones/, keyed by the milestone slug', () => {
      expect(approvalRelPath('docs/design/architecture/milestones/m1.pen')).toBe(
        '.noldor/design-approval/architecture/milestones/m1.json',
      );
    });

    it('parses a record bound to a milestone, and refuses a malformed binding', () => {
      const bound = { ...ARCH_APPROVED, milestone: { slug: 'm1', blob: 'f'.repeat(40) } };
      expect(parseApprovalBytes(JSON.stringify(bound))).toEqual(bound);
      expect(parseApprovalBytes(JSON.stringify({ ...ARCH_APPROVED, milestone: { slug: 'M 1', blob: 'f'.repeat(40) } }))).toBeNull();
    });
  ```

- [x] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts -t "records by design kind"`
  Expected: FAIL. The milestone path maps to `.noldor/design-approval/architecture/m1.json`, and the bound record is refused because the strict schema has no `milestone` key.

- [x] **Step 3: Name the milestone targets.**

  In `src/core/design-artifact-names.ts`, directly after `designKindOfPath`, add:

  ```ts
  /** Directory holding milestone target-architecture `.pen` files, one per milestone: `<slug>.pen`. */
  export const ARCH_MILESTONES_DIR = `${ARCH_DESIGN_DIR}/milestones`;

  /** A milestone's target-architecture `.pen`. */
  export function milestonePenPath(slug: string): string {
    return `${ARCH_MILESTONES_DIR}/${slug}.pen`;
  }

  /** The milestone a repo-relative `.pen` path is the target of, or `null` for any other path. */
  export function milestoneSlugFromPenPath(path: string): string | null {
    const prefix = `${ARCH_MILESTONES_DIR}/`;
    if (!path.startsWith(prefix) || !path.endsWith('.pen')) return null;
    const slug = path.slice(prefix.length, -'.pen'.length);
    return slug === '' || slug.includes('/') ? null : slug;
  }
  ```

- [x] **Step 4: Bind the record to a milestone and place it.**

  In `src/design/design-approval.ts`:

  1. Change the design-artifact-names import to:

  ```ts
  import {
    ARCH_DESIGN_DIR,
    ARCHIVE_DIR,
    designKindOfPath,
    milestonePenPath,
    milestoneSlugFromPenPath,
    specSlugFromFilename,
    UI_DESIGN_DIR,
  } from '../core/design-artifact-names.js';
  ```

  and add `import { isSlug } from '../core/slug.js';` directly after it.

  2. In `designApprovalRecordSchema`'s `approved` member, directly after the `spec:` line, add:

  ```ts
        milestone: z
          .object({ slug: z.string().refine((s) => isSlug(s), 'must be a milestone slug'), blob: gitOid })
          .strict()
          .optional(),
  ```

  and in the schema's doc comment, append:

  ```ts
   * `milestone` binds a milestone target to its milestone file where a feature
   * design binds its spec; `design verdict` never writes both, because a
   * discriminated-union member cannot carry the refinement that would refuse it.
  ```

  3. Replace `approvalDirSegments` with:

  ```ts
  export function approvalDirSegments(pen: string): readonly string[] {
    if (designKindOfPath(pen) !== 'architecture') return APPROVAL_DIR_SEGMENTS;
    return milestoneSlugFromPenPath(pen) === null
      ? [...APPROVAL_DIR_SEGMENTS, 'architecture']
      : [...APPROVAL_DIR_SEGMENTS, 'architecture', 'milestones'];
  }
  ```

  4. In `penCandidatesForRecord`, directly after the line `const rest = recordRelPath.slice(root.length, -'.json'.length);`, add:

  ```ts
    const milestonesPrefix = 'architecture/milestones/';
    if (rest.startsWith(milestonesPrefix)) {
      const slug = rest.slice(milestonesPrefix.length);
      return slug === '' || slug.includes('/') ? [] : [milestonePenPath(slug)];
    }
  ```

- [x] **Step 5: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts src/checks/__tests__/check-shared-files.test.ts`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [x] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): a design-approval record can bind a milestone target to its milestone file

  Milestone targets live at docs/design/architecture/milestones/<slug>.pen,
  undated and keyed by slug; their records sit under
  .noldor/design-approval/architecture/milestones/, and an approved record
  may carry milestone: { slug, blob } where a feature design carries its spec.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/core/design-artifact-names.ts src/design/design-approval.ts src/design/__tests__/design-approval.test.ts
  git commit -F "$msg"
  ```

---

## Task 2: `design verdict --milestone`

**Files:**

- Modify: `src/design/design-approval-cli.ts`
- Modify: `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/design/__tests__/design-approval.test.ts`

The binding rules, each refused with exit 2:
- `--milestone` and `--spec` exclude each other.
- A milestone target takes `--milestone` only, and only its own slug.
- A feature design takes `--spec` only.
- `docs/milestones/<slug>.md` must exist.

`--check` and `--reconfirm` read whichever file the record binds.

- [x] **Step 1: Write the failing tests.**

  In `src/design/__tests__/design-approval.test.ts`, directly after `describe('design verdict CLI / architecture designs', …)`, add:

  ```ts
  describe('design verdict CLI / milestone targets', () => {
    const target = 'docs/design/architecture/milestones/m1.pen';
    const PAGES_M = ['BASE:modules: as-built', 'FINAL:modules: split cr'];

    function milestoneRepo(): string {
      const cwd = gitRepo();
      mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'milestones'), { recursive: true });
      mkdirSync(join(cwd, 'docs', 'milestones'), { recursive: true });
      writeFileSync(join(cwd, target), penJson(PAGES_M));
      writeFileSync(join(cwd, 'docs', 'milestones', 'm1.md'), '---\nname: m1\nstatus: draft\n---\n\n## Gate\n\nShip it.\n');
      return cwd;
    }
    const argv = (bind: string[]): string[] => [
      '--pen',
      target,
      '--approve',
      '--surface',
      'modules',
      ...bind,
      ...PAGES_M.flatMap((p) => ['--editor-page', p]),
    ];

    it('approves a milestone target against its milestone file', async () => {
      const cwd = milestoneRepo();
      expect((await run(cwd, argv(['--milestone', 'm1']))).code).toBe(0);
      expect(readBack(cwd, target)).toMatchObject({
        outcome: 'approved',
        surfaces: ['modules'],
        milestone: { slug: 'm1', blob: blobOf(cwd, 'docs/milestones/m1.md') },
      });
    });

    it('refuses the wrong binding, a foreign slug, a feature design, a missing milestone file, and both flags', async () => {
      const cwd = milestoneRepo();
      const wrong = await run(cwd, argv(['--spec', specRel]));
      expect([wrong.code, wrong.err]).toEqual([2, expect.stringContaining('is a milestone target')]);
      writeFileSync(join(cwd, 'docs', 'milestones', 'm2.md'), '---\nname: m2\nstatus: draft\n---\n');
      const foreign = await run(cwd, argv(['--milestone', 'm2']));
      expect([foreign.code, foreign.err]).toEqual([2, expect.stringContaining('does not own')]);
      const featureArgv = approveArgv().filter((a, i, all) => a !== '--spec' && all[i - 1] !== '--spec');
      const feature = await run(cwd, [...featureArgv, '--milestone', 'm1']);
      expect([feature.code, feature.err]).toEqual([2, expect.stringContaining('does not own')]);
      rmSync(join(cwd, 'docs', 'milestones', 'm1.md'));
      const missing = await run(cwd, argv(['--milestone', 'm1']));
      expect([missing.code, missing.err]).toEqual([2, expect.stringContaining('no docs/milestones/m1.md')]);
      expect(parseVerdictArgs(argv(['--milestone', 'm1', '--spec', specRel])).ok).toBe(false);
    });

    it('reports drift once the milestone file changes', async () => {
      const cwd = milestoneRepo();
      await run(cwd, argv(['--milestone', 'm1']));
      expect((await run(cwd, ['--pen', target, '--check'])).code).toBe(0);
      appendFileSync(join(cwd, 'docs', 'milestones', 'm1.md'), 'A later gate.\n');
      const drift = await run(cwd, ['--pen', target, '--check']);
      expect(drift.code).toBe(1);
      expect(drift.out).toContain('docs/milestones/m1.md');
    });
  });
  ```

- [x] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts -t "milestone targets"`
  Expected: FAIL. `--milestone` is an `unknown argument`, and an undated target is refused as unkeyable.

- [x] **Step 3: Parse `--milestone`.**

  In `src/design/design-approval-cli.ts`:

  1. Add `milestonePenPath` and `milestoneSlugFromPenPath` to the design-artifact-names import.
  2. In `USAGE`, change the first line's `--spec <path>` to `(--spec <path> | --milestone <slug>)`.
  3. Replace `type ApproveMode = { … };` with:

  ```ts
  /** What an approval binds: a feature design's spec, or a milestone target's milestone file. */
  type ApprovalBinding = { kind: 'spec'; spec: string } | { kind: 'milestone'; slug: string };

  type ApproveMode = {
    verb: 'approve';
    surfaces: string[];
    reservation?: string;
    /** Every top-level page name the editor shows, duplicates kept. */
    editorPages: string[];
    against: ApprovalBinding;
  };
  ```

  4. In `parseVerdictArgs`:
     - add `let milestone: string | undefined;` beside `let spec`;
     - add `['--milestone', (v) => (milestone = v)],` to `valueFlags`;
     - add `['--milestone', milestone !== undefined],` to `approveOnly`.

     Then replace the approve branch's tail, from `if (spec === undefined) return { ok: false, error: '--approve requires --spec' };` through that branch's `return { … };`, with:

  ```ts
      if (spec !== undefined && milestone !== undefined) {
        return { ok: false, error: '--spec and --milestone exclude each other' };
      }
      if (spec === undefined && milestone === undefined) {
        return { ok: false, error: '--approve requires --spec (or --milestone <slug> for a milestone target)' };
      }
      const against: ApprovalBinding =
        spec !== undefined ? { kind: 'spec', spec } : { kind: 'milestone', slug: milestone as string };
      return {
        ok: true,
        pen,
        mode: {
          verb: 'approve',
          surfaces: [...new Set(surfaces)],
          editorPages,
          against,
          ...(reservation === undefined ? {} : { reservation }),
        },
      };
  ```

- [x] **Step 4: Key a milestone target by its slug.**

  1. In `resolveFeaturePen`, change the return type to `{ ok: true; abs: string; base: string; kind: DesignKind; milestone: string | null } | Refusal`. Change its final `return` to:

  ```ts
    // `lexical` (the top of this function) equals the real path here: a symlinked --pen is refused above.
    const milestone = kind === 'architecture' ? milestoneSlugFromPenPath(lexical) : null;
    return { ok: true, abs, base: basename(abs), kind, milestone };
  ```

  2. In `interface VerdictCtx`, change the `pen` member to:

  ```ts
    pen: { abs: string; base: string; rel: string; key: string; kind: DesignKind; milestone: string | null };
  ```

  3. In `main`, change `const key = penSlugFromFilename(pen.base);` to `const key = pen.milestone ?? penSlugFromFilename(pen.base);`, and add `milestone: pen.milestone,` to the `ctx.pen` object after `kind: pen.kind,`.

- [x] **Step 5: Bind and read either file.**

  1. Directly above `function approve(`, add:

  ```ts
  /** Resolve what an approval binds: the design's spec, or — for a milestone target, and only there — its milestone file. */
  function resolveBinding(
    ctx: VerdictCtx,
    against: ApprovalBinding,
  ): { ok: true; kind: 'spec' | 'milestone'; name: string; rel: string } | Refusal {
    if (against.kind === 'spec') {
      if (ctx.pen.milestone !== null) {
        return {
          ok: false,
          error: `${ctx.pen.rel} is a milestone target — approve it against its milestone file with --milestone ${ctx.pen.milestone}`,
        };
      }
      const spec = resolveFeatureSpec(ctx.cwd, against.spec, ctx.pen.key);
      return spec.ok ? { ok: true, kind: 'spec', name: spec.name, rel: spec.rel } : spec;
    }
    if (ctx.pen.milestone !== against.slug) {
      return {
        ok: false,
        error: `--milestone ${against.slug} does not own ${ctx.pen.rel} — its target is ${milestonePenPath(against.slug)}`,
      };
    }
    const abs = join(loadDocRoots(ctx.cwd).milestones, `${against.slug}.md`);
    const rel = relative(ctx.cwd, abs).split(sep).join('/');
    if (!existsSync(abs) || !lstatSync(abs).isFile()) return { ok: false, error: `--milestone ${against.slug}: no ${rel}` };
    return { ok: true, kind: 'milestone', name: against.slug, rel };
  }
  ```

  2. In `approve`, replace the block from `const spec = resolveFeatureSpec(ctx.cwd, mode.spec, ctx.pen.key);` through the `writeValidated(ctx, { … });` call with:

  ```ts
    const bound = resolveBinding(ctx, mode.against);
    if (!bound.ok) return fail(bound.error, 2);

    const penBlob = blobIdOfBytes(ctx.cwd, ctx.pen.rel, bytes);
    if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
    const boundBlob = blobIdOfWorktreeFile(ctx.cwd, bound.rel, { write: true });
    if (boundBlob === null) return fail(`git could not store ${bound.rel}`, 2);

    const written = writeValidated(ctx, {
      outcome: 'approved',
      at: ctx.now(),
      penBlob,
      surfaces: mode.surfaces,
      ...(mode.reservation === undefined ? {} : { reservation: mode.reservation }),
      pages: read.pages,
      ...(bound.kind === 'spec'
        ? { spec: { name: bound.name, blob: boundBlob } }
        : { milestone: { slug: bound.name, blob: boundBlob } }),
    });
  ```

  and change the later `console.log(`against spec ${spec.rel} @ ${specBlob.slice(0, 12)}`);` to `console.log(`against ${bound.kind} ${bound.rel} @ ${boundBlob.slice(0, 12)}`);`.

  3. Rename `boundSpec` to `boundFile` (its one call is in `loadApproval`). Add `kind: 'spec' | 'milestone';` to its `ok: true` return type, and insert at the top of its body:

  ```ts
    if (record.milestone !== undefined) {
      const abs = join(loadDocRoots(cwd).milestones, `${record.milestone.slug}.md`);
      const rel = relative(cwd, abs).split(sep).join('/');
      if (!existsSync(abs) || !lstatSync(abs).isFile()) {
        return { ok: false, error: `the milestone file the approval names (${rel}) is gone — take the verdict again with --milestone` };
      }
      return { ok: true, kind: 'milestone', name: `${record.milestone.slug}.md`, blob: record.milestone.blob, rel, abs };
    }
  ```

  Then change its final spec return to `return { ok: true, kind: 'spec', ...spec, abs, rel: relative(cwd, abs).split(sep).join('/') };`. In `loadApproval`, the `spec:` member of the `bound` result type gains `kind: 'spec' | 'milestone';`.

  4. In `check`, in the template literal that begins `if the design still depicts the spec:`, change `the spec:` to `the ${spec.kind}:` — the hint then names whichever file the record binds.
  5. In `reconfirm`, replace `spec: { name: spec.name, blob: specBlob },` inside the `writeValidated(ctx, { …record, … })` call with:

  ```ts
      ...(spec.kind === 'spec'
        ? { spec: { name: spec.name, blob: specBlob } }
        : { milestone: { slug: spec.name.slice(0, -'.md'.length), blob: specBlob } }),
  ```

- [x] **Step 6: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/design-approval.test.ts`
  Expected: PASS — every case, the milestone ones included, and the spec-binding cases unchanged.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [x] **Step 7: Document `--milestone` (both twins).**

  In `docs/noldor/script-catalog.md`, in the `### \`design:verdict\`` entry:

  1. In the `- **Trigger:**` bullet, change `--spec <path>` in the `--approve` form to `(--spec <path> | --milestone <slug>)`.
  2. In the `- **Inputs:**` bullet, directly after `for the same dialogue key as the `.pen`)`, insert:

     `; a milestone target (`docs/design/architecture/milestones/<slug>.pen`) takes `--milestone <slug>` instead, bound to `docs/milestones/<slug>.md` — the two flags exclude each other, and each belongs to its own kind of design`

  3. In the `- **Outputs:**` bullet, directly after `for an architecture design`, insert:

     ` (`.noldor/design-approval/architecture/milestones/<slug>.json` for a milestone target, whose record carries `milestone: { slug, blob }` in place of `spec`)`

  Run: `cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md`

- [x] **Step 8: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): design verdict approves a milestone target against its milestone file

  A milestone target is keyed by its slug; --milestone binds it to
  docs/milestones/<slug>.md and excludes --spec, each flag belonging to its
  own kind of design. --check and --reconfirm read whichever file the record
  binds, so a changed milestone file surfaces as drift.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/design-approval-cli.ts src/design/__tests__/design-approval.test.ts \
    docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  git commit -F "$msg"
  ```

---

## Task 3: Committing a milestone target

**Files:**

- Modify: `src/checks/check-shared-files.ts`
- Modify: `src/core/allowlist.ts`
- Test: `src/checks/__tests__/check-shared-files.test.ts`, `src/core/__tests__/allowlist.test.ts`

Drafting a milestone is a micro-chore. The micro-chore lane must admit two paths so the target lands in the same commit as the milestone file: the target `.pen`, and its record. The guard's approval rule still applies to the target, now keyed by its slug. Before this task it refused every target as unkeyable.

- [ ] **Step 1: Write the failing tests.**

  1. Append to `src/checks/__tests__/check-shared-files.test.ts`:

  ```ts
  describe('check-shared-files / evaluate — milestone targets', () => {
    const TARGET = 'docs/design/architecture/milestones/m1.pen';
    const RECORD = '.noldor/design-approval/architecture/milestones/m1.json';
    const addTarget: StagedChange = { path: TARGET, change: 'add', blob: OID_A };

    it('keys a milestone target by its slug: refused with no record, accepted with a matching one', () => {
      expect(evaluate([addTarget], MAIN, {}, NO_RECORDS)).toEqual([{ path: TARGET, reason: 'pen-unapproved' }]);
      const lookup: RecordLookup = (p) => (p === RECORD ? approvedRecord(OID_A) : null);
      expect(evaluate([addTarget], MAIN, {}, lookup)).toEqual([]);
    });

    it('refuses dropping the record of a target that stays', () => {
      const staged: StagedChange[] = [{ path: RECORD, change: 'delete', blob: ZERO }];
      const lookup = stagedAwareRecordLookup(staged, () => approvedRecord(OID_A));
      const targetInHead = stagedAwarePenLookup([], (rel) => (rel === TARGET ? OID_A : null));
      expect(evaluate(staged, MAIN, {}, lookup, targetInHead)).toEqual([{ path: RECORD, reason: 'pen-unapproved' }]);
    });
  });
  ```

  2. In `src/core/__tests__/allowlist.test.ts`, inside `describe('micro-chore allowlist', …)`, append:

  ```ts
    it('accepts a milestone file with its target design and approval record', () => {
      expect(
        isMicroChoreAllowed([
          'docs/milestones/m1.md',
          'docs/design/architecture/milestones/m1.pen',
          '.noldor/design-approval/architecture/milestones/m1.json',
        ]),
      ).toBe(true);
    });
    it('still rejects a feature architecture design and its record', () => {
      expect(isMicroChoreAllowed(['docs/design/architecture/2026-09-24-x.pen'])).toBe(false);
      expect(isMicroChoreAllowed(['.noldor/design-approval/architecture/2026-09-24-x.json'])).toBe(false);
    });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/checks/__tests__/check-shared-files.test.ts src/core/__tests__/allowlist.test.ts`
  Expected: FAIL.
  - The matching-record case is still refused, because the undated target is unkeyable.
  - The lane case is `false`.

- [ ] **Step 3: Key the target in the guard.**

  In `src/checks/check-shared-files.ts`:
  1. Add `milestoneSlugFromPenPath` to the design-artifact-names import.
  2. In `evaluate`'s add rule, change `const key = penSlugFromFilename(base);` to:

  ```ts
      const key = milestoneSlugFromPenPath(entry.path) ?? penSlugFromFilename(base);
  ```

- [ ] **Step 4: Admit the target on the micro-chore lane.**

  In `src/core/allowlist.ts`, inside `MICRO_CHORE_GLOBS`, directly after `'.noldor/retired-entry-ids.json',`, add:

  ```ts
    // A milestone's target architecture and its approval record: drafting a
    // milestone is a micro-chore, and the target lands in the same commit as the
    // milestone file. The `.pen` guard still demands the record, so the lane
    // widens what may land, never what may land unapproved.
    'docs/design/architecture/milestones/*.pen',
    '.noldor/design-approval/architecture/milestones/*.json',
  ```

- [ ] **Step 5: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/checks/__tests__/check-shared-files.test.ts src/core/__tests__/allowlist.test.ts`
  Expected: PASS.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(core): a milestone's target architecture commits with the milestone through micro-chore

  The micro-chore lane admits docs/design/architecture/milestones/*.pen and
  its approval records, and the .pen guard keys an undated target by its
  milestone slug, so the approval rule still applies instead of refusing
  every target as unkeyable.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/check-shared-files.ts src/checks/__tests__/check-shared-files.test.ts \
    src/core/allowlist.ts src/core/__tests__/allowlist.test.ts
  git commit -F "$msg"
  ```
