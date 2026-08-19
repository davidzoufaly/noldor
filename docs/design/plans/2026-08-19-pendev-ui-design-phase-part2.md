# pen.dev UI Design Phase (Part 2: Artifact Lifecycle + Prose Integration) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Land the artifact lifecycle around Part 1's engine: `.pen` naming + `designUi` doc root, `links.design` on the FD with archive-time repointing, the `.pen` extension of the archive seam, the `design ui-sync` report-and-validate CLI, and the skill-prose integration (design step in `noldor-spec`, write-back + advisory freshness in `/noldor-gate` Step 4) with template twins. Requires Part 1 merged (imports `ui-predicate`, `ui-design-freshness`).

**Architecture:** Spec [2026-08-19-pendev-ui-design-phase-design.md](../specs/2026-08-19-pendev-ui-design-phase-design.md) units U3, U4 (prose), U5 (prose), U6, plus the `links.design` halves of U3. Code follows existing seams: `design-artifact-names.ts` grows a pen parser, `archive-resolve.ts`/`archive-cli.ts` grow a third artifact kind, `sync-fd-resources.ts` grows the repoint rule, new `src/design/ui-sync-cli.ts`.

**Tech Stack:** TypeScript (ESM, strict), zod, vitest, gray-matter (FD frontmatter edits), git via execFile.

---

## File Structure

- `src/core/design-artifact-names.ts` — add `PEN_FILE_RE`, `penSlugFromFilename`, `penFileName(date, key)` (modify)
- `src/core/doc-roots.ts` — add `designUi` root (modify; follow the existing root-resolution + transition-alias pattern in the file)
- `src/features/…frontmatter schema…` — add optional `links.design: string` (modify; same schema located in Part 1 Task 3)
- `src/sync/sync-fd-resources.ts` — repoint `links.design` to `archive/` on archived artifacts, like `links.spec` (modify)
- `src/design/archive-resolve.ts` — resolve the session's `.pen` as a third `ArchiveMove` kind (modify)
- `src/design/archive-cli.ts` — stage the `.pen` move + rewrite the FD's `links.design` in the same staged change (modify)
- `src/design/ui-sync-cli.ts` — `design ui-sync` report-and-validate CLI (create)
- `src/design/__tests__/ui-sync.test.ts` — verdict rendering + validation rules (create)
- `src/design/__tests__/archive-resolve.test.ts` — `.pen` resolution rows (modify)
- `src/cli/manifest.ts` — register `design ui-sync` (modify)
- `.claude/skills/noldor-spec/SKILL.md` + `templates/.claude/skills/noldor-spec/SKILL.md` — design step (modify, keep twins in sync)
- `.claude/skills/noldor-gate/SKILL.md` + `templates/.claude/skills/noldor-gate/SKILL.md` — Step 4 write-back + advisory freshness bullets (modify, twins)
- `docs/features/pendev-ui-design-phase.md` — `links.code`/`links.tests` fill at ship time (modify)

---

## Task 1: `.pen` naming + `designUi` doc root

**Files:**
- Modify: `src/core/design-artifact-names.ts`, `src/core/doc-roots.ts`
- Test: `src/core/__tests__/design-artifact-names.test.ts` (extend; create if absent — check first), doc-roots' existing test file

- [ ] **Step 1: Write the failing name-parser tests** (mirror the file's existing spec/plan test style):

```ts
describe('pen artifact names', () => {
  it('parses the key from a feature pen filename', () => {
    expect(penSlugFromFilename('2026-08-19-pendev-ui-design-phase.pen')).toBe(
      'pendev-ui-design-phase',
    );
  });
  it('returns null for non-pen and undated names', () => {
    expect(penSlugFromFilename('baseline.pen')).toBeNull();
    expect(penSlugFromFilename('2026-08-19-foo.md')).toBeNull();
  });
  it('builds the canonical feature pen filename', () => {
    expect(penFileName('2026-08-19', 'parent-enh')).toBe('2026-08-19-parent-enh.pen');
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/design-artifact-names.test.ts
```

Expected output: `penSlugFromFilename` is not exported → failure.

- [ ] **Step 3: Implement** in `src/core/design-artifact-names.ts`:

```ts
const PEN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)\.pen$/;

/**
 * Derive the dialogue key from a feature UI-design filename
 * (`2026-08-19-<key>.pen`). Baseline files (`baseline/<surface>.pen`) are
 * undated and deliberately do not match — they are never archived.
 */
export function penSlugFromFilename(filename: string): string | null {
  const match = PEN_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

/** Canonical feature UI-design filename for a dialogue key. */
export function penFileName(date: string, key: string): string {
  return `${date}-${key}.pen`;
}
```

- [ ] **Step 4: Add the `designUi` root.** Read `src/core/doc-roots.ts`; add a `designUi` member resolving to `docs/design/ui` exactly the way the existing design roots resolve (including the 1.0.0 transition alias branch, so a not-yet-migrated consumer resolves `docs/superpowers/design/ui`). Extend the doc-roots test with one row asserting `loadDocRoots(cwd).designUi` ends with `docs/design/ui` on a modern tree.

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/design-artifact-names.test.ts src/core/__tests__/doc-roots.test.ts
```

Expected output: all pass.

- [ ] **Step 6: Commit.**

```bash
git add src/core/design-artifact-names.ts src/core/doc-roots.ts src/core/__tests__/
git commit -m "feat(core): pen artifact naming + designUi doc root" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 2: `links.design` frontmatter + archive repointing rule

**Files:**
- Modify: the features frontmatter schema (Part 1 Task 3 located it), `src/sync/sync-fd-resources.ts`
- Test: `src/features/__tests__/validate-features.test.ts`, `src/sync/__tests__/sync-fd-resources.test.ts`

- [ ] **Step 1: Failing schema test** — beside Part 1's `design:` field tests:

```ts
it('accepts links.design as a repo-relative pen path', () => {
  expect(() =>
    FeatureFrontmatterSchema.parse({
      ...validFrontmatterFixture,
      links: { ...validFrontmatterFixture.links, design: 'docs/design/ui/2026-08-19-x.pen' },
    }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Failing repoint test** — in `src/sync/__tests__/sync-fd-resources.test.ts`, mirror the existing `links.spec` archive-repoint case with a `links.design` row: an FD whose `links.design` names `docs/design/ui/<date>-<key>.pen` while the file now lives at `docs/design/ui/archive/<same basename>` gets repointed to the archive path.

- [ ] **Step 3: Run to verify FAIL.**

```bash
pnpm vitest run src/features/__tests__/validate-features.test.ts src/sync/__tests__/sync-fd-resources.test.ts
```

Expected output: schema rejects unknown `links.design` key; repoint case fails.

- [ ] **Step 4: Implement.** (a) Add `design: z.string().min(1).optional()` inside the frontmatter `links` object schema. (b) In `src/sync/sync-fd-resources.ts`, find where `links.spec` is repointed into `ARCHIVE_DIR` and add the identical branch for `links.design` with root `loadDocRoots(cwd).designUi` (read the spec/plan branch first and clone its exact fallback behavior — missing file, already-archived, absent field are all no-ops).

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/features/__tests__/validate-features.test.ts src/sync/__tests__/sync-fd-resources.test.ts
```

Expected output: all pass.

- [ ] **Step 6: Commit.**

```bash
git add src/features/ src/sync/
git commit -m "feat(sync): links.design relation with archive repointing" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 3: Archive seam — `.pen` as a third artifact kind

**Files:**
- Modify: `src/design/archive-resolve.ts`, `src/design/archive-cli.ts`
- Test: `src/design/__tests__/archive-resolve.test.ts`

- [ ] **Step 1: Failing resolve tests** — extend the existing resolve matrix with pen rows (mirror the file's fixture style: injected `readdir`, `branchAdded` set):

```ts
it('resolves the session pen artifact into archive', async () => {
  const plan = await resolveArchivePlan({
    repo: '/repo',
    key: 'my-feature',
    branchAdded: ['docs/design/ui/2026-08-19-my-feature.pen'],
    readdir: fakeReaddir({
      'docs/design/ui': ['2026-08-19-my-feature.pen', 'baseline'],
    }),
  });
  expect(plan.moves).toContainEqual({
    kind: 'pen',
    from: 'docs/design/ui/2026-08-19-my-feature.pen',
    to: 'docs/design/ui/archive/2026-08-19-my-feature.pen',
  });
});

it('never touches baseline pens or foreign keys or non-branch-added files', async () => {
  const plan = await resolveArchivePlan({
    repo: '/repo',
    key: 'my-feature',
    branchAdded: [],
    readdir: fakeReaddir({
      'docs/design/ui': ['2026-08-19-my-feature.pen', '2026-08-01-other-feature.pen'],
    }),
  });
  expect(plan.moves.filter((m) => m.kind === 'pen')).toEqual([]);
});
```

Adapt helper names to the file's actual harness (read it first; `collect` is the internal worker — tests drive the exported resolver).

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/design/__tests__/archive-resolve.test.ts
```

Expected output: pen rows fail — `kind: 'pen'` not produced.

- [ ] **Step 3: Implement resolve.** In `src/design/archive-resolve.ts`: widen `ArchiveMove['kind']` to `'spec' | 'plan' | 'pen'`; in the resolver, call the existing `collect` a third time with the pen adapter — directory `loadDocRoots(repo).designUi`, filename parser `penSlugFromFilename` — reusing the same key match, branch-added ownership gate, and archive-collision skip logic (thread the parser in the same way spec/plan differ today; if `collect` hard-codes the two parsers, lift the parser to a parameter now).

- [ ] **Step 4: Implement the CLI side.** In `src/design/archive-cli.ts`: the existing loop `git mv`s every `ArchivePlan` move and leaves them staged — pen moves ride it unchanged. Add after the moves: when a pen move happened and the session FD (`docs/features/<slug>.md` for `*-new`; parent FD on `*-attach`) has `links.design` naming the moved `from` path, rewrite it to the `to` path via gray-matter and `git add` the FD — same staged-never-committed posture. Print the rewrite in the CLI's existing move report.

- [ ] **Step 5: Run to verify PASS + archive dry-run.**

```bash
pnpm vitest run src/design/__tests__/
pnpm noldor design archive --dry-run
```

Expected output: tests pass; dry-run on this repo prints its usual output with no pen moves (no pen artifacts exist here).

- [ ] **Step 6: Commit.**

```bash
git add src/design/
git commit -m "feat(design): archive seam resolves feature pen artifacts + rewrites links.design" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 4: `design ui-sync` CLI

**Files:**
- Create: `src/design/ui-sync-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/design/__tests__/ui-sync.test.ts`

- [ ] **Step 1: Failing tests** at `src/design/__tests__/ui-sync.test.ts` for the pure pieces:

```ts
import { describe, expect, it } from 'vitest';

import { renderSurfaceReport, validateBaselineFile } from '../ui-sync-cli.js';

describe('renderSurfaceReport', () => {
  it('prints verdict, commits and the edit instruction per surface', () => {
    const out = renderSurfaceReport({
      surface: 'dashboard',
      status: 'stale',
      uiCommit: 'a'.repeat(40),
      baselineCommit: 'b'.repeat(40),
      detail: 'UI newer than baseline',
    });
    expect(out).toContain('dashboard');
    expect(out).toContain('stale');
    expect(out).toContain('edit docs/design/ui/baseline/dashboard.pen');
  });
  it('uninitialized instructs bootstrap-create', () => {
    const out = renderSurfaceReport({ surface: 'app', status: 'uninitialized', detail: 'no baseline' });
    expect(out).toContain('create docs/design/ui/baseline/app.pen');
  });
});

describe('validateBaselineFile', () => {
  it('fails on missing file', () => {
    expect(validateBaselineFile('/nope/app.pen', { staged: true }).ok).toBe(false);
  });
  it('fails on empty file and on unstaged change', () => {
    // temp file harness: write 0 bytes → { ok: false, reason: 'empty' }
    // write bytes but staged: false → { ok: false, reason: 'not staged' }
  });
  it('passes on non-empty staged file with the completes-at-commit notice', () => {
    // { ok: true, notice: /completes .* commit/ }
  });
});
```

Fill the temp-file harness bodies with the same tmp-dir helpers the design tests already use (read a sibling test for the idiom).

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/design/__tests__/ui-sync.test.ts
```

Expected output: module resolution error.

- [ ] **Step 3: Implement** `src/design/ui-sync-cli.ts`:

```ts
// @tests: pendev-ui-design-phase
// `noldor design ui-sync [--surface <name>]` — the report-and-validate half of
// baseline remediation (spec U6). This CLI cannot read .pen content (pencil MCP
// is the only reader); it reports U7 verdicts with edit instructions, validates
// what a Node process can see (exists, non-empty, staged), stages nothing
// itself beyond `git add` of the named baseline file, and never commits.
// Remediation completes only when the staged change is COMMITTED — U7 reads
// committed history.

import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { runIfDirect } from '../core/cli-entry.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import {
  BASELINE_DIR,
  evaluateUiDesignFreshness,
  type UiSurfaceFreshness,
} from '../release/ui-design-freshness.js';

export function renderSurfaceReport(s: UiSurfaceFreshness): string {
  const file = `${BASELINE_DIR}/${s.surface}.pen`;
  const action =
    s.status === 'uninitialized'
      ? `create ${file} in a pencil-capable session (bootstrap)`
      : s.status === 'stale'
        ? `edit ${file} in a pencil-capable session to match the code at ${s.uiCommit?.slice(0, 8) ?? 'HEAD'}`
        : 'no action';
  return `${s.surface}: ${s.status}\n  ${s.detail}\n  → ${action}`;
}

export interface BaselineValidation {
  ok: boolean;
  reason?: 'missing' | 'empty' | 'not staged';
  notice?: string;
}

export function validateBaselineFile(
  absPath: string,
  git: { staged: boolean },
): BaselineValidation {
  if (!existsSync(absPath)) return { ok: false, reason: 'missing' };
  if (statSync(absPath).size === 0) return { ok: false, reason: 'empty' };
  if (!git.staged) return { ok: false, reason: 'not staged' };
  return {
    ok: true,
    notice: 'validation passed — remediation completes when the staged change is committed',
  };
}

export function isStaged(cwd: string, repoRelPath: string): boolean {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--', repoRelPath], {
    cwd,
    encoding: 'utf8',
  });
  return out.trim().length > 0;
}

export async function main(argv: string[], cwd: string = process.cwd()): Promise<number> {
  const surfaceFlag = argv.includes('--surface') ? argv[argv.indexOf('--surface') + 1] : undefined;
  const config = loadConsumerConfig(cwd);
  const verdict = await evaluateUiDesignFreshness(cwd, {
    uiPaths: config.uiPaths,
    uiSurfaces: config.uiSurfaces,
  });
  const rows = verdict.surfaces.filter((s) => surfaceFlag === undefined || s.surface === surfaceFlag);
  if (rows.length === 0) {
    console.log(surfaceFlag ? `no surface named '${surfaceFlag}'` : 'ui-sync: nothing to do (no uiPaths configured)');
    return surfaceFlag ? 1 : 0;
  }
  let pending = 0;
  for (const s of rows) {
    console.log(renderSurfaceReport(s));
    if (s.status === 'stale' || s.status === 'uninitialized') {
      pending += 1;
      const rel = `${BASELINE_DIR}/${s.surface}.pen`;
      execFileSync('git', ['add', '--intent-to-add', '--', rel], { cwd, stdio: 'ignore' });
      const v = validateBaselineFile(`${cwd}/${rel}`, { staged: isStaged(cwd, rel) });
      console.log(v.ok ? `  ✓ ${v.notice}` : `  ✗ not remediated yet: ${v.reason}`);
    }
  }
  console.log(
    pending === 0
      ? 'all surfaces fresh'
      : 'edit the files above via pencil MCP, re-run ui-sync to validate, then COMMIT the staged baseline — U7 greens only after the commit lands',
  );
  return 0;
}

runIfDirect(import.meta.url, async () => process.exit(await main(process.argv.slice(2))));
```

Adjust `git add --intent-to-add` handling: on a missing file it exits non-zero — wrap in try/catch and ignore (uninitialized surfaces have nothing to stage until the session creates the file). Match `runIfDirect`'s real signature.

- [ ] **Step 4: Register in the manifest** under the existing `design` group beside `archive`:

```ts
      'ui-sync': {
        src: 'design/ui-sync-cli.ts',
        desc: 'Report + validate UI baseline sync per surface; staged-never-committed',
      },
```

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/design/__tests__/ui-sync.test.ts
pnpm noldor design ui-sync
```

Expected output: tests pass; CLI prints `ui-sync: nothing to do (no uiPaths configured)` on this repo, exit 0.

- [ ] **Step 6: Commit.**

```bash
git add src/design/ src/cli/manifest.ts
git commit -m "feat(design): ui-sync report-and-validate CLI" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 5: `noldor-spec` design step (prose + twin)

**Files:**
- Modify: `.claude/skills/noldor-spec/SKILL.md`, `templates/.claude/skills/noldor-spec/SKILL.md`

- [ ] **Step 1: Insert the design step** into the skill's Flow between step 1 (Ground) and step 2 (Scope check), renumbering nothing (use "1.5"), identical text in both twins:

```markdown
1.5. **UI design step (predicate-gated).** Compute the UI verdict: candidate paths = the roadmap entry's `Touches:` values ∪ the FD's `links.code` (glob values expanded per `src/core/ui-predicate.ts` semantics), config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override absolute both ways. Write the verdict to the session marker (`uiVerdict`, `uiVerdictPaths`). On `skip`: add one line to the spec ("UI verdict: skip — <reason>") and continue to step 2 — nothing else. On `required`:
   - **Zero affected surfaces ⇒ do not proceed:** prompt the operator to extend `uiPaths`/`uiSurfaces` (config edit rides the branch) or accept the implicit `app` surface; the step refuses to conclude with an empty surface set.
   - **Seed:** create `docs/design/ui/<date>-<dialogue-key>.pen`; for each affected surface, copy its pages from `docs/design/ui/baseline/<surface>.pen` via pencil MCP, naming them `BASE:<surface>: <name>`. Empty/missing baseline ⇒ start blank and say so.
   - **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; converge with the operator; mark exactly one winner `FINAL:<surface>: <name>` per affected surface (page-name check happens here, in-session — the CLI cannot read `.pen`).
   - **Record:** name the chosen variant + considered alternatives in the spec's Design section; link the `.pen` path in the spec; set FD `links.design`.
   - **Editor unavailable:** stop for an explicit operator waiver — record it in the session marker (`uiWaiver: { reason, at }`) and in spec prose; never write the FD `design:` field. A waived session produces no `.pen` and no `links.design`.
   The `.pen` commits WITH the spec at gate Step 2.5 (same commit). The approved artifact is never edited afterwards; as-built drift lands in the baseline at gate Step 4.
```

- [ ] **Step 2: Verify twins.**

```bash
pnpm noldor checks template-sync
```

Expected output: `template-sync OK`.

- [ ] **Step 3: Commit.**

```bash
git add .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md
git commit -m "docs(skills): noldor-spec UI design step (predicate-gated, waiver semantics)" -m "Noldor-FD: pendev-ui-design-phase" -m "Noldor-Sibling-Scope: skills"
```

(Adjust the trailer per the repo's shared-file commit rules — `NOLDOR_ALLOW_SHARED=1` env on the commit if the pre-commit shared-files check requires it for `.claude/**` + `templates/**` pairs; the check's own error message names the requirement.)

## Task 6: `/noldor-gate` Step 4 write-back + advisory freshness (prose + twin)

**Files:**
- Modify: `.claude/skills/noldor-gate/SKILL.md`, `templates/.claude/skills/noldor-gate/SKILL.md`

- [ ] **Step 1: Insert the write-back bullet** in Step 4, immediately BEFORE the "Archive this session's design artifacts" bullet, identical in both twins:

```markdown
- **UI baseline write-back (UI-bearing sessions only).** Recompute the UI verdict from the real diff: candidate paths = `git diff --name-only origin/main...HEAD`, config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override still absolute. On `skip`: continue (a spec-time `required` with no UI diff no-ops here; the feature `.pen` still archives below). On `required`: for every affected surface, update `docs/design/ui/baseline/<surface>.pen` via pencil MCP to the as-built UI — start from the feature `.pen`'s `FINAL:<surface>:` pages, adjust for implementation drift; never edit the feature `.pen` itself. Stage the baseline files; they ride the flip commit with the archive moves. Spec-time `skip` that turned ship-time `required` (UI emerged during implementation): same write-back via the `ui-sync` flow — no retroactive design artifact is required. Pencil MCP unavailable: skip LOUDLY — print the debt + `pnpm noldor design ui-sync`; the freshness check stays red until repaid; do NOT block the ship on it.
```

- [ ] **Step 2: Insert the advisory freshness bullet** immediately AFTER the flip-commit bullet (the one running `phase-flip-done` + commit), before "Wait for in-flight standalone":

```markdown
- **UI freshness (advisory).** Run `pnpm noldor checks ui-design-freshness` — AFTER the flip commit (the check reads committed history; staged edits are invisible to it). Print its per-surface rows. Advisory at this seam: never block `pr-flow` on its exit code — the blocking enforcement point is release preflight. A red here means baseline debt: surface it plus the `ui-sync` remediation and continue.
```

- [ ] **Step 3: Verify twins.**

```bash
pnpm noldor checks template-sync
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md
git commit -m "docs(skills): gate Step 4 UI baseline write-back + advisory freshness" -m "Noldor-FD: pendev-ui-design-phase" -m "Noldor-Sibling-Scope: skills"
```

(Same shared-file trailer/env note as Task 5.)

## Task 7: FD links fill + full verification

**Files:**
- Modify: `docs/features/pendev-ui-design-phase.md`

- [ ] **Step 1: Fill `links.code` + `links.tests`** in the FD frontmatter with the files this feature landed (both parts):

```yaml
links:
  code:
    - src/core/ui-predicate.ts
    - src/core/consumer-config.ts
    - src/core/design-artifact-names.ts
    - src/release/ui-design-freshness.ts
    - src/checks/check-ui-design-freshness.ts
    - src/design/ui-sync-cli.ts
    - src/design/archive-resolve.ts
    - src/sync/sync-fd-resources.ts
  spec: docs/design/specs/2026-08-19-pendev-ui-design-phase-design.md
  design: []
  tests:
    - src/core/__tests__/ui-predicate.test.ts
    - src/release/__tests__/ui-design-freshness.test.ts
    - src/design/__tests__/ui-sync.test.ts
```

(`links.design` stays unset — this feature itself is not UI-bearing; drop the empty placeholder line if the schema rejects `[]` for a string field — it will, so omit the key entirely.)

- [ ] **Step 2: Full verification.**

```bash
pnpm typecheck && pnpm test
pnpm noldor validate features
pnpm noldor checks template-sync
```

Expected output: all green.

- [ ] **Step 3: Commit.**

```bash
git add docs/features/pendev-ui-design-phase.md
git commit -m "docs(features:pendev-ui-design-phase): fill links.code + links.tests" -m "Noldor-FD: pendev-ui-design-phase"
```
