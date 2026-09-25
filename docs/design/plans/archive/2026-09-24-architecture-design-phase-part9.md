# pen.dev Architecture Design Phase Implementation Plan — Part 9: milestone progress and the milestone skill

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:**
- **Progress command.** `pnpm noldor design arch-progress --milestone <slug>` reports how far the as-built baseline still is from a milestone's target. Per view the target covers, it lists what is `to-build`, what is `to-remove`, and how much is `done`.
- **Milestone skill.** `/noldor-milestone draft` and `edit` offer to sketch the target, and `activate` prints the progress of the milestone being shipped.
- **Spec step.** `/noldor-spec` step 1.6 names the milestone target as a verdict signal.

**Architecture:**
- **What `compareToTarget` compares.** It holds the target's `FINAL:<view>:` pages against the baseline's pages for the same views, **by name**:
  - modules by path;
  - other boxes by layer name;
  - arrows by their canonical `<from> -> <to>`, with group ends normalised.
- **Views with no change.** A view with no `FINAL:` page means "no change planned" and is not reported.
- **Advisory only.** The command is a report: exit 0 with it, 1 when a file cannot be read. Milestones are optional and never block (spec D11).

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest, Markdown (skill prose).

**Parts:** 9 of 9. It builds on Part 8's milestone targets and Part 1's reader.

---

## File Structure

- `src/design/arch-progress.ts` — **Create.** `compareToTarget(target, baseline)` returns `ViewProgress[]`. It also holds the `design arch-progress` CLI (`main`).
- `src/design/__tests__/arch-progress.test.ts` — **Create.** Covers the comparison and the CLI's exit codes.
- `src/cli/manifest.ts` — **Modify.** Registers `design arch-progress`.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** Adds the `design:arch-progress` entry.
- `AGENTS.md` + `templates/AGENTS.md` — **Modify (generated).** The capability index's `design` line.
- `.claude/skills/noldor-milestone/SKILL.md` + `templates/.claude/skills/noldor-milestone/SKILL.md` — **Modify.** Adds the target step to `draft` / `edit`, and the progress print to `activate`.
- `.claude/skills/noldor-spec/SKILL.md` + `templates/.claude/skills/noldor-spec/SKILL.md` — **Modify.** Adds the milestone signal to step 1.6's verdict bullet.

---

## Task 1: `design arch-progress`

**Files:**

- Create: `src/design/arch-progress.ts`
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Modify (generated): `AGENTS.md`, `templates/AGENTS.md`
- Test: `src/design/__tests__/arch-progress.test.ts`

- [x] **Step 1: Write the failing test file.**

  Create `src/design/__tests__/arch-progress.test.ts`:

  ```ts
  // @tests: architecture-design-phase
  import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { afterEach, describe, expect, it, vi } from 'vitest';

  import { readArchPen, type ArchDoc } from '../arch-pen.js';
  import { compareToTarget, main } from '../arch-progress.js';

  interface Node {
    id: string;
    type: string;
    name: string;
    children?: Node[];
  }
  let seq = 0;
  const node = (type: string, name: string, children: Node[] = []): Node => ({ id: `n${++seq}`, type, name, children });
  const text = (...pages: Node[]): string => JSON.stringify({ version: '2.17', children: pages });
  function doc(...pages: Node[]): ArchDoc {
    const read = readArchPen(text(...pages));
    if (!read.ok) throw new Error(read.error);
    return read.doc;
  }

  const BASELINE = [
    node('frame', 'context', [node('frame', 'noldor CLI')]),
    node('frame', 'containers'),
    node('frame', 'modules', [
      node('frame', 'src/a'),
      node('frame', 'src/b'),
      node('frame', 'src/old'),
      node('path', 'src/b -> src/a'),
    ]),
    node('frame', 'flows'),
  ];
  const TARGET = [
    node('frame', 'BASE:modules: as-built'),
    node('frame', 'FINAL:modules: add a queue', [
      node('frame', 'src/a'),
      node('frame', 'src/b'),
      node('frame', 'src/queue'),
      node('path', 'src/queue->src/a'),
    ]),
  ];

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  describe('design arch-progress', () => {
    it('lists what the target adds, what it removes and what is done, per view it covers', () => {
      expect(compareToTarget(doc(...TARGET), doc(...BASELINE))).toEqual([
        {
          view: 'modules',
          toBuild: ['arrow: src/queue -> src/a', 'box: src/queue'],
          toRemove: ['arrow: src/b -> src/a', 'box: src/old'],
          done: ['box: src/a', 'box: src/b'],
        },
      ]);
    });

    it('exits 0 with the report, 1 when the target is missing, 2 on a bad slug', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arch-progress-'));
      dirs.push(cwd);
      mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'milestones'), { recursive: true });
      writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'), text(...BASELINE));
      writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'milestones', 'm1.pen'), text(...TARGET));
      const out: string[] = [];
      const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
        out.push(a.join(' '));
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(await main(['--milestone', 'm1'], cwd)).toBe(0);
        expect(out.join('\n')).toMatch(/modules\s+to-build\s+box: src\/queue/);
        expect(await main(['--milestone', 'm2'], cwd)).toBe(1);
        expect(await main(['--milestone', 'Not A Slug'], cwd)).toBe(2);
        expect(await main([], cwd)).toBe(2);
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    });
  });
  ```

- [x] **Step 2: Run the test to verify it fails.**

  Run: `pnpm vitest run src/design/__tests__/arch-progress.test.ts`
  Expected: FAIL — `Failed to resolve import "../arch-progress.js"`.

- [x] **Step 3: Write the comparison and the CLI.**

  Create `src/design/arch-progress.ts`:

  ```ts
  // @fd: architecture-design-phase
  // `noldor design arch-progress --milestone <slug>` — how far the as-built
  // baseline still is from a milestone's target architecture (spec: "Milestone
  // target"). The target's FINAL:<view>: pages are held against the baseline's
  // pages for the same views, by name: modules by path, other boxes by layer
  // name, arrows by canonical `<from> -> <to>`. A view with no FINAL: page is
  // "no change planned" and reports nothing. Advisory by design: milestones are
  // optional and never block, so the report always exits 0 once it can read.

  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';

  import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
  import { ARCH_BASELINE_PATH, milestonePenPath } from '../core/design-artifact-names.js';
  import { errMessage } from '../core/err-message.js';
  import { isSlug } from '../core/slug.js';
  import type { ArchitecturePageId } from '../docs/architecture-schema.js';
  import { ARCH_VIEWS, arrowEndsOf, pairKey, readArchPen, type ArchDoc, type ArchPage } from './arch-pen.js';

  export interface ViewProgress {
    readonly view: ArchitecturePageId;
    /** In the target, not yet in the baseline. */
    readonly toBuild: readonly string[];
    /** In the baseline, gone from the target's page for this view. */
    readonly toRemove: readonly string[];
    readonly done: readonly string[];
  }

  /** An arrow end in canonical spelling, so `group:Work` and `group: Work` compare equal. */
  function canonicalEnd(end: string): string {
    return end.startsWith('group:') ? `group: ${end.slice('group:'.length).trim()}` : end;
  }

  /** What a page is made of, as comparable labels: `box: <module or name>` and `arrow: <from> -> <to>`. */
  function itemsOf(page: ArchPage): string[] {
    const items: string[] = [];
    for (const box of page.boxes) {
      const names = page.view === 'modules' && box.refs.length > 0 ? box.refs : [box.name];
      for (const name of names) items.push(`box: ${name}`);
    }
    for (const arrow of page.arrows) {
      const ends = arrowEndsOf(arrow.name);
      if (ends !== null) items.push(`arrow: ${pairKey(canonicalEnd(ends.from), canonicalEnd(ends.to))}`);
    }
    return items;
  }

  /** The target's covered views against the baseline, in registry view order. */
  export function compareToTarget(target: ArchDoc, baseline: ArchDoc): ViewProgress[] {
    const progress: ViewProgress[] = [];
    for (const view of ARCH_VIEWS) {
      const finals = target.pages.filter((page) => page.role === 'final' && page.view === view);
      if (finals.length === 0) continue;
      const want = new Set(finals.flatMap(itemsOf));
      const have = new Set(baseline.pages.filter((page) => page.role === 'baseline' && page.view === view).flatMap(itemsOf));
      progress.push({
        view,
        toBuild: [...want].filter((item) => !have.has(item)).sort(),
        toRemove: [...have].filter((item) => !want.has(item)).sort(),
        done: [...want].filter((item) => have.has(item)).sort(),
      });
    }
    return progress;
  }

  function readDoc(cwd: string, rel: string): { ok: true; doc: ArchDoc } | { ok: false; error: string } {
    let text: string;
    try {
      text = readFileSync(join(cwd, rel), 'utf8');
    } catch (err) {
      return { ok: false, error: `${rel}: ${errMessage(err)}` };
    }
    const read = readArchPen(text);
    return read.ok ? read : { ok: false, error: `${rel}: ${read.error}` };
  }

  /** Exit 0 = report printed, 1 = the target or the baseline cannot be read, 2 = bad arguments. */
  export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
    const label = 'design arch-progress';
    const flag = optionalFlag(argv, '--milestone', label);
    if (!flag.ok) {
      console.error(flag.error);
      return 2;
    }
    const slug = flag.value;
    if (slug === undefined || !isSlug(slug)) {
      console.error(`${label}: --milestone <slug> is required, and must be a milestone slug`);
      return 2;
    }
    const target = readDoc(cwd, milestonePenPath(slug));
    if (!target.ok) {
      console.error(`${label}: no readable target — ${target.error}`);
      return 1;
    }
    const baseline = readDoc(cwd, ARCH_BASELINE_PATH);
    if (!baseline.ok) {
      console.error(`${label}: no readable baseline — ${baseline.error}`);
      return 1;
    }
    const progress = compareToTarget(target.doc, baseline.doc);
    if (progress.length === 0) {
      console.log(`arch-progress: milestone ${slug} — no view has a FINAL: page, nothing planned`);
      return 0;
    }
    const count = (key: 'toBuild' | 'toRemove' | 'done'): number => progress.reduce((n, v) => n + v[key].length, 0);
    console.log(`arch-progress: milestone ${slug} — ${count('toBuild')} to build, ${count('toRemove')} to remove, ${count('done')} done`);
    for (const view of progress) {
      for (const item of view.toBuild) console.log(`  ${view.view.padEnd(11)} to-build   ${item}`);
      for (const item of view.toRemove) console.log(`  ${view.view.padEnd(11)} to-remove  ${item}`);
      console.log(`  ${view.view.padEnd(11)} done       ${view.done.length} item(s)`);
    }
    return 0;
  }

  runIfDirect('arch-progress', 'design arch-progress', async (argv) => main(argv));
  ```

- [x] **Step 4: Run the test and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/design/__tests__/arch-progress.test.ts`
  Expected: PASS — `Tests  2 passed (2)`.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [x] **Step 5: Register and document the command.**

  In `src/cli/manifest.ts`, inside `design.subs`, directly after the `'arch-route'` entry, add:

  ```ts
        'arch-progress': {
          src: 'design/arch-progress.ts',
          desc: "How far the architecture baseline is from a milestone's target: to-build / to-remove / done per view; advisory",
        },
  ```

  In `docs/noldor/script-catalog.md`, directly after the `### \`design:arch-route\`` entry (after its `- **Source:**` line), insert:

  ```markdown
  ### `design:arch-progress`

  - **Trigger:** `pnpm noldor design arch-progress --milestone <slug>`. It runs in three places:
    - `/noldor-spec` step 1.6, for an FD whose `milestone:` has a target;
    - `/noldor-milestone activate`, for the milestone being shipped;
    - by hand, whenever you want the gap.
  - **Inputs:**
    - the milestone's target, `docs/design/architecture/milestones/<slug>.pen` — its `FINAL:<view>:` pages;
    - the baseline, `docs/design/architecture/baseline.pen`.
  - **Outputs:** a summary line, then, for each view the target covers:
    - one `to-build` row per item in the target but not the baseline;
    - one `to-remove` row per item in the baseline that the target's page dropped;
    - a `done` count.

    Items compare by name: modules by path, other boxes by layer name, arrows by canonical `<from> -> <to>`. A view with no `FINAL:` page is no change planned and is not reported.

    Exit codes: 0 = report printed (it never fails on the gap itself), 1 = the target or the baseline cannot be read, 2 = a missing or malformed `--milestone`.
  - **When to use:**
    - while a milestone is active, to see which features still owe the target;
    - at `activate`, to see what the shipped milestone left undone.

    It is advisory: milestones never block.
  - **Source:** [`src/design/arch-progress.ts`](../../src/design/arch-progress.ts)
  ```

  Then run:

  ```bash
  cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
  pnpm noldor docs capability-index --write
  pnpm noldor validate script-catalog
  ```

  Expected:
  - `capability-index --write` exits 0, and the `design` line in `AGENTS.md` and `templates/AGENTS.md` now lists `arch-progress`.
  - `validate script-catalog` exits 0.

- [x] **Step 6: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(design): design arch-progress reports how far the baseline is from a milestone's target

  The target's FINAL pages are held against the baseline's matching views by
  name — modules by path, boxes by layer name, arrows by canonical endpoint
  pair — and listed as to-build, to-remove and done; a view with no FINAL
  page is no change planned. Advisory: it exits 0 whatever the gap.

  Noldor-Sibling-Scope: noldor:script-catalog
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/design/arch-progress.ts src/design/__tests__/arch-progress.test.ts src/cli/manifest.ts \
    docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
  git commit -F "$msg"
  ```

---

## Task 2: The milestone skill and the spec signal

**Files:**

- Modify: `.claude/skills/noldor-milestone/SKILL.md`, `templates/.claude/skills/noldor-milestone/SKILL.md`
- Modify: `.claude/skills/noldor-spec/SKILL.md`, `templates/.claude/skills/noldor-spec/SKILL.md`

The record binds the milestone file's blob, so the verdict is always the last edit. It comes after the body sections are filled and after the `## Architecture target` section is added. `activate` rewrites `status:` in two milestone files, so it reconfirms both targets' records afterwards. The skill still never commits: the operator's micro-chore commit carries the milestone file, the target and its record, which Part 8 put on the lane.

- [x] **Step 1: Add the target step to `draft` and `edit`.**

  In `.claude/skills/noldor-milestone/SKILL.md`, in `### /noldor-milestone draft [<slug>]`, directly after step `4. Tell the operator: … Edit it to fill in ## Gate, ## Success Criteria, ## Out of Scope.`, insert:

  ```markdown
  4.5. **Target architecture (optional, when `docs/design/architecture/baseline.pen` exists).** Ask whether to sketch the milestone's target architecture. Take this step only once the operator has filled `## Gate`, `## Success Criteria` and `## Out of Scope` — the verdict binds the milestone file's text, so it must come last — and otherwise offer it again from `/noldor-milestone edit`. On yes:
     1. `cp docs/design/architecture/baseline.pen docs/design/architecture/milestones/<slug>.pen`, open it with `pnpm noldor design pen-bridge --pen docs/design/architecture/milestones/<slug>.pen`, and confirm with `get_app_state` that it is the open document before any write.
     2. Rename the four pages `BASE:<view>: as-built`, draw the target on a `Copy` of each view it changes, and rename each such copy `FINAL:<view>: <name>`. Keep the layer-name contract (module boxes named by path, groups `group: <Name>`, arrows `<from> -> <to>`), and after moving boxes save and run `pnpm -s noldor design arch-route --pen docs/design/architecture/milestones/<slug>.pen --view <view>`, passing its stdout to `execute`.
     3. Add an `## Architecture target` section to `docs/milestones/<slug>.md` linking `../design/architecture/milestones/<slug>.pen` — before the verdict, for the same reason.
     4. Take the verdict: `pnpm noldor design verdict --pen docs/design/architecture/milestones/<slug>.pen --approve --surface <view> [--surface <view>...] --milestone <slug> --editor-page "<name>" [--editor-page "<name>"...]` (one `--editor-page` per page the editor lists).
     The operator's micro-chore commit carries the milestone file, the target `.pen` and `.noldor/design-approval/architecture/milestones/<slug>.json` together.
  ```

  In `### /noldor-milestone edit <slug>`, directly after step `4. Run pnpm noldor validate milestones after edits.`, insert:

  ```markdown
  4.5. When the milestone has a target (`docs/design/architecture/milestones/<slug>.pen`): a target sketched now follows `draft` step 4.5, and a revised target is an edit to the `.pen` plus a fresh verdict (step 4.5's step 4 — it overwrites the record); an edit to the milestone file alone shows as drift in `pnpm noldor design verdict --pen docs/design/architecture/milestones/<slug>.pen --check` — re-take the verdict, or `--reconfirm` when the target still stands.
  ```

- [x] **Step 2: Reconfirm and report at `activate`.**

  In `### /noldor-milestone activate <slug>`, directly before step `1. Run tsx src/milestones/cli.ts activate <slug> from the repo root.`, insert:

  ```markdown
  0. Read `current-milestone:` from `docs/vision.md`'s frontmatter — the milestone this activation will flip to `shipped`, if any. The CLI names only the one it activates.
  ```

  and directly after step `2. On success, surface: …`, insert:

  ```markdown
  2.5. The CLI rewrote `status:` in both milestone files, which drifts any target record bound to them. For the milestone just activated, and for the one step 0 read, whenever `docs/design/architecture/milestones/<that slug>.pen` has a record: run `pnpm noldor design verdict --pen docs/design/architecture/milestones/<that slug>.pen --reconfirm`. The design is unchanged, so reconfirming rebinds it to the flipped file; stage the rewritten records with the activation.
  2.6. When the milestone step 0 read has a target, run `pnpm noldor design arch-progress --milestone <that slug>` and surface its report. Advisory — it never blocks the activation; `to-build` rows are what the shipped milestone left undone.
  ```

- [x] **Step 3: Name the milestone signal in spec step 1.6.**

  In `.claude/skills/noldor-spec/SKILL.md`, inside step 1.6's `**Verdict — asked, never inferred.**` bullet, replace `a new cross-module import the design introduces.` with:

  ```markdown
  a new cross-module import the design introduces, or the FD's `milestone:` having a target at `docs/design/architecture/milestones/<milestone>.pen` — then show `pnpm noldor design arch-progress --milestone <milestone>` so the design moves the baseline toward it.
  ```

- [x] **Step 4: Mirror the twins, check and commit.**

  Run:

  ```bash
  cp .claude/skills/noldor-milestone/SKILL.md templates/.claude/skills/noldor-milestone/SKILL.md
  cp .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md
  pnpm noldor checks skill-portability
  pnpm noldor validate skill-catalog
  pnpm noldor checks template-sync
  ```

  Expected: all three exit 0.

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(skills): the milestone skill sketches, approves and tracks a target architecture

  /noldor-milestone draft and edit offer the target canvas once a baseline
  exists, writing the milestone's Architecture target section before the
  verdict that binds it; activate prints arch-progress for the milestone it
  ships. /noldor-spec step 1.6 names the FD's milestone target as a verdict
  signal.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add .claude/skills/noldor-milestone/SKILL.md templates/.claude/skills/noldor-milestone/SKILL.md \
    .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md
  NOLDOR_ALLOW_SHARED=1 git commit -F "$msg"
  ```

- [x] **Step 5: Close the plan.**

  Run: `pnpm noldor sync code-links --slug architecture-design-phase`
  Expected: `docs/features/architecture-design-phase.md` `links.code` also lists `src/design/arch-route.ts` and `src/design/arch-progress.ts`, and the FD is staged. Commit it with a `docs(features:architecture-design-phase): fill links.code` subject and the usual trailer paragraph.

  Run: `pnpm noldor checks push-gates`
  Expected: exit 0. The branch is ready for gate Step 4.
