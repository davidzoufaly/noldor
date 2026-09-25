# pen.dev Architecture Design Phase Implementation Plan — Part 3: the release row and this repo's baseline

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** release preflight blocks on an architecture baseline that disagrees with the code. The block goes through a new `arch-baseline` row, which is skipped in a repo with no baseline and can be overridden with `RELEASE_SKIP_ARCH_BASELINE=1`. This repo also carries its own baseline, green against the code.

**Architecture:** two pieces.
- The row reuses `docSurfaceRow`, the helper behind the `architecture` row. It reads the override first, then maps `absent` → `skipped`, `ok` → `ok`, and anything else → `blocking`, using the first finding as the detail.
- The baseline is `docs/design/architecture/baseline.pen`. A one-off script emits it as plain `.pen` JSON from the four `docs/architecture/*.md` pages, and `checks arch-baseline` must report it green.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest, Node (the one-off generator), pencil MCP (an advisory look only).

**Parts:** 3 of 9. Parts 1–2 shipped `checks arch-baseline`. Part 4 teaches `design verdict` about architecture designs.

---

## File Structure

- `src/release/preflight-types.ts` — **Modify.** Adds `'arch-baseline'` to the `PreflightRowId` union.
- `src/release/preflight-probes.ts` — **Modify.** Adds the row id to `ALL_ROW_IDS` and its probe to `PROBES`.
- `src/release/__tests__/preflight-probes.test.ts` — **Modify.** Updates the row count and the id coverage list, and adds the new row's cases.
- `docs/noldor/versioning.md` + `templates/docs/noldor/versioning.md` — **Modify.** Lists the row among the preflight checks.
- `docs/design/architecture/baseline.pen` — **Create.** This repo's architecture baseline.
- `docs/features/architecture-design-phase.md` — **Modify.** `links.code` for Parts 1–3.

---

## Task 1: The release row

**Files:**

- Modify: `src/release/preflight-types.ts`
- Modify: `src/release/preflight-probes.ts`
- Modify: `docs/noldor/versioning.md`, `templates/docs/noldor/versioning.md`
- Test: `src/release/__tests__/preflight-probes.test.ts`

The row reuses `docSurfaceRow`, the helper the `architecture` row uses:
- it reads the override first (`RELEASE_SKIP_ARCH_BASELINE=1` → `skipped`, carried on the row as `override` so the release path audit-logs it);
- then maps `absent` → `skipped`, `ok` → `ok`, anything else → `blocking` with the first finding as the detail.

- [ ] **Step 1: Write the failing tests.**

  In `src/release/__tests__/preflight-probes.test.ts`:

  1. In `describe('ALL_ROW_IDS')`, change `expect(ALL_ROW_IDS.length).toBe(17);` to `expect(ALL_ROW_IDS.length).toBe(18);`.
  2. In `describe('probe id coverage')`, add `'arch-baseline',` to the `ids` array directly after `'architecture',`.
  2a. In `src/release/__tests__/preflight.test.ts`, in `it('returns exactly one row per registered check, ids unique', …)`, change both `17`s to `18` — that test counts the rows a full `run(cwd)` returns.
  3. Append this block at the end of the file:

  ```ts
  describe('arch-baseline row', () => {
    it('skips a repo with no baseline, and blocks on one that cannot be read', async () => {
      const cwd = repo();
      try {
        expect((await runProbe('arch-baseline', ctx(cwd))).status).toBe('skipped');
        mkdirSync(join(cwd, 'docs', 'design', 'architecture'), { recursive: true });
        writeFileSync(join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'), '{ nope', 'utf8');
        const row = await runProbe('arch-baseline', ctx(cwd));
        expect(row.status).toBe('blocking');
        expect(row.fix).toContain('checks arch-baseline');
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('is forced to skipped under the audited override', async () => {
      const cwd = repo();
      process.env.RELEASE_SKIP_ARCH_BASELINE = '1';
      try {
        const row = await runProbe('arch-baseline', ctx(cwd));
        expect(row.status).toBe('skipped');
        expect(row.override).toBe('RELEASE_SKIP_ARCH_BASELINE=1');
      } finally {
        delete process.env.RELEASE_SKIP_ARCH_BASELINE;
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm vitest run src/release/__tests__/preflight-probes.test.ts src/release/__tests__/preflight.test.ts`
  Expected: FAIL. The length assertion reports `expected 17 to be 18`, and the new row cases fail because `runProbe('arch-baseline', …)` finds no probe.

- [ ] **Step 3: Add the row id.**

  In `src/release/preflight-types.ts`, in the `PreflightRowId` union, add `| 'arch-baseline'` directly after `| 'architecture'`.

- [ ] **Step 4: Add the probe.**

  In `src/release/preflight-probes.ts`:

  1. Add the imports beside the other design and docs imports:

  ```ts
  import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
  import { checkArchBaseline } from '../design/arch-baseline.js';
  ```

  2. In `ALL_ROW_IDS`, add `'arch-baseline',` directly after `'architecture',`.
  3. In `PROBES`, directly after the `architecture:` probe, add:

  ```ts
    /**
     * The architecture baseline must match the code before a release — but only
     * in a repo that drew one. `checkArchBaseline` reports `absent` when the file
     * does not exist, so a consumer that never opted in is never blocked. Advisory
     * `undrawn-edge` rows never reach `findings`, so they never block either.
     */
    'arch-baseline': (ctx) =>
      docSurfaceRow('arch-baseline', 'RELEASE_SKIP_ARCH_BASELINE', () => checkArchBaseline(ctx.cwd), {
        absent: `no ${ARCH_BASELINE_PATH}`,
        ok: 'architecture baseline matches the code',
        blocking: 'architecture baseline disagrees with the code',
        fix: 'Run `pnpm noldor checks arch-baseline` and redraw each reported box or arrow in the baseline (the gate Step 4 write-back path).',
      }),
  ```

- [ ] **Step 5: Run the tests and the typecheck to verify they pass.**

  Run: `pnpm vitest run src/release/__tests__/preflight-probes.test.ts src/release/__tests__/preflight.test.ts`
  Expected: PASS — no failures.

  Run: `pnpm typecheck`
  Expected: exit 0, no output.

- [ ] **Step 6: List the row in the versioning doc (both twins).**

  In `docs/noldor/versioning.md`, directly after the `checkArchitecture(repo)` bullet (the one ending ``pnpm release` is the logged break-glass hatch.``), insert:

  ```markdown
     - `checkArchBaseline(repo)` — the architecture baseline
       (`docs/design/architecture/baseline.pen`) must cover every module once
       and draw no arrow the imports do not back. Skipped for a repo with no
       baseline file; `undrawn-edge` advisories never block. See
       `checks arch-baseline` in [`script-catalog.md`](script-catalog.md).
       `RELEASE_SKIP_ARCH_BASELINE=1 pnpm release` is the logged break-glass
       hatch.
  ```

  Then mirror it:

  Run: `cp docs/noldor/versioning.md templates/docs/noldor/versioning.md`

- [ ] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(release): an arch-baseline preflight row blocks on a baseline that disagrees with the code

  Skipped when the repo has no baseline, blocking otherwise on the first
  finding, and forced to skipped (and audit-logged) under
  RELEASE_SKIP_ARCH_BASELINE=1 — the same docSurfaceRow contract the
  architecture row uses.

  Noldor-Sibling-Scope: noldor:versioning
  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/release/preflight-types.ts src/release/preflight-probes.ts \
    src/release/__tests__/preflight-probes.test.ts src/release/__tests__/preflight.test.ts \
    docs/noldor/versioning.md templates/docs/noldor/versioning.md
  git commit -F "$msg"
  ```

---



## Task 2: This repo's baseline

**Files:**

- Create: `docs/design/architecture/baseline.pen`
- Modify: `docs/features/architecture-design-phase.md`

This repo draws its own baseline, and this part ships only once `checks arch-baseline` is green on it (AC 12). The content comes from the four `docs/architecture/*.md` pages. On `modules`, every directory `listModuleDirs` reports gets a box: the 31 the page names, plus `src/indirection`, which `modules.md` never names, placed in *Quality gates*. The arrows are `modules.md`'s own. So the first check run also audits the mermaid page: an arrow it reports as `phantom-edge` is one the page claims and the code does not have.

The file is emitted as plain JSON by a one-off script, not drawn through pencil MCP. Two reasons:
- The check reads the file on disk, and an MCP-drawn page reaches the disk only when someone saves it in VS Code.
- Consumers' UI baselines are already emitted this way; charuy's capture harness writes its `.pen` from Node.

Every box sits at explicit coordinates, and each arrow is computed from the same numbers. The layout is a starting point for the operator to tidy on the canvas. Moving boxes later is what `design arch-route` (Part 6) is for.

- [ ] **Step 1: Read the installed schema version.**

  Run: `grep -oE 'version: "[0-9.]+"' ~/.vscode/extensions/highagency.pencildev-*/out/skills/pen-dev/pen-schema.md | head -1`
  Expected: `version: "2.17"`. If it prints another version, use that value for `VERSION` in Step 2.

- [ ] **Step 2: Write the generator and emit the baseline.**

  Create the one-off script outside the repo and run it from the worktree root:

  ```bash
  gen=$(mktemp -t arch-baseline-XXXX).mjs
  cat > "$gen" <<'EOF'
  import { mkdirSync, writeFileSync } from 'node:fs';

  const VERSION = '2.17';
  const C = { page: '#FFFFFF', group: '#F4F6F8', groupStroke: '#C9D1D9', box: '#FFFFFF', boxStroke: '#57606A', text: '#1F2328', arrow: '#57606A' };
  const BOX_H = 34, GAP = 12, PAD = 16, TITLE = 28;
  let seq = 0;
  const id = (p) => `${p}${++seq}`;
  const f = (n) => Math.round(n * 10) / 10;

  function edgePoint(r, t) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = t.x + t.w / 2 - cx, dy = t.y + t.h / 2 - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
    return { x: cx + dx * s, y: cy + dy * s };
  }

  function arrow(name, a, b) {
    const p1 = edgePoint(a, b), p2 = edgePoint(b, a), ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 9, W = 0.45;
    const h1 = { x: p2.x - L * Math.cos(ang - W), y: p2.y - L * Math.sin(ang - W) };
    const h2 = { x: p2.x - L * Math.cos(ang + W), y: p2.y - L * Math.sin(ang + W) };
    const xs = [p1.x, p2.x, h1.x, h2.x], ys = [p1.y, p2.y, h1.y, h2.y];
    const x = f(Math.min(...xs) - 2), y = f(Math.min(...ys) - 2), w = f(Math.max(...xs) + 2 - x), h = f(Math.max(...ys) + 2 - y);
    return {
      id: id('a'), type: 'path', name, x, y, width: w, height: h, viewBox: [x, y, w, h],
      geometry: `M ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} M ${f(h1.x)} ${f(h1.y)} L ${f(p2.x)} ${f(p2.y)} L ${f(h2.x)} ${f(h2.y)}`,
      stroke: C.arrow, strokeWidth: 1.5,
    };
  }

  function view(name, originX, boxW, font, groups, arrows) {
    const gw = (g) => PAD * 2 + g.cols * boxW + (g.cols - 1) * GAP;
    const gh = (g) => TITLE + PAD + Math.ceil(g.boxes.length / g.cols) * (BOX_H + GAP);
    const width = Math.max(...groups.map((g) => g.x + gw(g))) + 40;
    const height = Math.max(...groups.map((g) => g.y + gh(g))) + 40;
    const rects = {};
    const children = groups.map((g) => {
      rects[`group: ${g.title}`] = { x: g.x, y: g.y, w: gw(g), h: gh(g) };
      const boxes = g.boxes.map((label, i) => {
        const bx = PAD + (i % g.cols) * (boxW + GAP), by = TITLE + Math.floor(i / g.cols) * (BOX_H + GAP);
        rects[label] = { x: g.x + bx, y: g.y + by, w: boxW, h: BOX_H };
        return {
          id: id('b'), type: 'frame', name: label, layout: 'none', x: bx, y: by, width: boxW, height: BOX_H,
          fill: C.box, stroke: C.boxStroke, strokeWidth: 1, cornerRadius: 4,
          children: [{ id: id('t'), type: 'text', name: 'Label', content: label, x: 10, y: 9, fontFamily: font, fontSize: 12, fill: C.text }],
        };
      });
      return {
        id: id('g'), type: 'frame', name: `group: ${g.title}`, layout: 'none', x: g.x, y: g.y, width: gw(g), height: gh(g),
        fill: C.group, stroke: C.groupStroke, strokeWidth: 1, cornerRadius: 8,
        children: [{ id: id('t'), type: 'text', name: 'Title', content: g.title, x: PAD, y: 8, fontFamily: 'Inter', fontSize: 13, fontWeight: '600', fill: C.text }, ...boxes],
      };
    });
    for (const [from, to] of arrows) {
      if (rects[from] === undefined || rects[to] === undefined) throw new Error(`${name}: ${from} -> ${to} names a missing box`);
      children.push(arrow(`${from} -> ${to}`, rects[from], rects[to]));
    }
    return { page: { id: id('p'), type: 'frame', name, layout: 'none', x: originX, y: 0, width, height, fill: C.page, clip: true, children }, width };
  }

  const views = [
    ['context', 240, 'Inter', [
      { title: 'Actors', x: 40, y: 40, cols: 1, boxes: ['Human operator', 'Agent runtime'] },
      { title: 'System', x: 372, y: 40, cols: 1, boxes: ['noldor CLI'] },
      { title: 'Externals', x: 704, y: 40, cols: 1, boxes: ['The governed repository', 'git', 'gh — pull requests', 'graphify — code graph', 'Review runtimes — claude · codex'] },
    ], [
      ['Human operator', 'noldor CLI'], ['Agent runtime', 'noldor CLI'],
      ['noldor CLI', 'The governed repository'], ['noldor CLI', 'git'], ['noldor CLI', 'gh — pull requests'],
      ['noldor CLI', 'graphify — code graph'], ['noldor CLI', 'Review runtimes — claude · codex'],
      ['git', 'The governed repository'],
    ]],
    ['containers', 260, 'Inter', [
      { title: 'Runnable units', x: 40, y: 40, cols: 1, boxes: ['noldor CLI', 'lefthook jobs', 'Dev dashboard'] },
      { title: 'Durable state', x: 432, y: 40, cols: 1, boxes: ['.noldor/session.json', '.noldor/cr lane sinks', '.noldor/id-counter.json', '.noldor/clones-baseline.json', '.noldor/rules', 'docs'] },
    ], [
      ['lefthook jobs', 'noldor CLI'], ['Dev dashboard', 'docs'],
      ['noldor CLI', '.noldor/session.json'], ['noldor CLI', '.noldor/cr lane sinks'], ['noldor CLI', '.noldor/id-counter.json'],
      ['noldor CLI', '.noldor/clones-baseline.json'], ['noldor CLI', '.noldor/rules'], ['noldor CLI', 'docs'],
    ]],
    ['modules', 150, 'JetBrains Mono', [
      { title: 'Entry', x: 616, y: 40, cols: 2, boxes: ['src/cli', 'src/hooks'] },
      { title: 'Workflow', x: 40, y: 180, cols: 2, boxes: ['src/cr', 'src/prep', 'src/design', 'src/features', 'src/triage', 'src/autonomous', 'src/worktrees', 'src/research'] },
      { title: 'Quality gates', x: 424, y: 180, cols: 2, boxes: ['src/checks', 'src/invariants', 'src/indirection', 'src/clones', 'src/rules', 'src/validate', 'src/verify', 'src/garden'] },
      { title: 'Projection and reporting', x: 808, y: 180, cols: 2, boxes: ['src/sync', 'src/docs', 'src/metrics', 'src/dashboard', 'src/graphify', 'src/milestones'] },
      { title: 'Shipping', x: 1192, y: 180, cols: 1, boxes: ['src/release', 'src/migrations', 'src/templates'] },
      { title: 'Shared', x: 376, y: 460, cols: 5, boxes: ['src/core', 'src/utils', 'src/lib', 'src/testing', 'src/fixtures'] },
    ], [
      ['src/cli', 'group: Workflow'], ['src/cli', 'group: Quality gates'], ['src/cli', 'group: Projection and reporting'], ['src/cli', 'group: Shipping'],
      ['src/hooks', 'group: Quality gates'], ['src/hooks', 'src/core'],
      ['group: Workflow', 'src/core'], ['group: Quality gates', 'src/core'], ['group: Projection and reporting', 'src/core'], ['group: Shipping', 'src/core'],
      ['src/core', 'src/utils'], ['src/garden', 'src/docs'], ['src/release', 'src/garden'], ['src/autonomous', 'src/cr'],
    ]],
    ['flows', 200, 'Inter', [
      { title: 'The gate flow', x: 40, y: 40, cols: 2, boxes: ['Operator · gate', 'noldor gate', 'git hooks', 'cr orchestrate', 'gh'] },
      { title: 'The release flow', x: 524, y: 40, cols: 2, boxes: ['Operator · release', 'noldor release', 'preflight probes', 'repository state', 'npm registry'] },
    ], [
      ['Operator · gate', 'noldor gate'], ['noldor gate', 'git hooks'], ['noldor gate', 'cr orchestrate'], ['cr orchestrate', 'noldor gate'], ['noldor gate', 'gh'], ['gh', 'Operator · gate'],
      ['Operator · release', 'noldor release'], ['noldor release', 'preflight probes'], ['preflight probes', 'repository state'], ['noldor release', 'repository state'], ['noldor release', 'npm registry'], ['noldor release', 'Operator · release'],
    ]],
  ];

  const pages = [];
  let x = 0;
  for (const [name, boxW, font, groups, arrows] of views) {
    const { page, width } = view(name, x, boxW, font, groups, arrows);
    pages.push(page);
    x += width + 120;
  }
  mkdirSync('docs/design/architecture', { recursive: true });
  writeFileSync('docs/design/architecture/baseline.pen', `${JSON.stringify({ version: VERSION, children: pages }, null, 2)}\n`);
  console.log(`wrote ${pages.length} views: ${pages.map((p) => p.name).join(', ')}`);
  EOF
  node "$gen"
  ```

  Expected: `wrote 4 views: context, containers, modules, flows`, and `docs/design/architecture/baseline.pen` exists. Keep `$gen` for Step 3.

- [ ] **Step 3: Run the check and correct the data until it is green.**

  Run: `pnpm noldor checks arch-baseline`
  Expected: either `arch-baseline: ok …` with exit 0, or findings. Correct each finding in the generator's data (`$gen`), then re-run `node "$gen"` and the check:
  - `phantom-edge` means `modules.md` claims an import the code does not have. Delete that pair from the `modules` arrow list, and note it for the commit body.
  - `missing-module` means a directory was added since this plan was written. Add its path to the closest group's `boxes`.

  Repeat until the check exits 0. Advisory `undrawn-edge` rows are expected and do not block.

- [ ] **Step 4: Look at it on the canvas (advisory).**

  Run: `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen`
  Then call pencil `get_app_state`. When it reports this worktree's `docs/design/architecture/baseline.pen` as the open document, call pencil `execute` with `filePath` set to that file's absolute path and this `input`:

  ```js
  const modules = Get(document, { depth: 1 }).children.find((c) => c.name === 'modules');
  Get((n, c) => c.problems && Print(n.name, '|', c.parentCtx?.node.name, '|', c.problems));
  TakeScreenshot([modules.id]);
  ```

  Expected: no `problems` rows print, and the screenshot shows six groups, 32 module boxes and the arrows. This step reads only and writes nothing. If pencil MCP is unavailable (a headless session, or no VS Code window), skip the step and say so in the commit body. The check in Step 3 is the acceptance criterion; the render is a courtesy.

- [ ] **Step 5: Fill the FD's code links.**

  Run: `pnpm noldor sync code-links --slug architecture-design-phase`
  Expected: `docs/features/architecture-design-phase.md` `links.code` lists `src/design/arch-pen.ts`, `src/design/arch-check.ts`, `src/design/arch-baseline.ts`, `src/indirection/module-pairs.ts` and `src/checks/check-arch-baseline.ts` (every file tagged `// @fd: architecture-design-phase`), and the FD is staged.

- [ ] **Step 6: Preflight the push gates.**

  Run: `pnpm noldor checks push-gates`
  Expected: exit 0. On exit 1 fix what it names (usually a clones baseline moved by the new files, or a template twin) and commit the fix before continuing.

- [ ] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(design): add this repo's architecture baseline, green against the code

  The four views from docs/architecture/, emitted as .pen JSON, with
  src/indirection added to the modules view (modules.md never named it) and
  every modules.md arrow kept unless the check found no import behind it.
  List any arrow removed for that reason here, one line each, before
  committing.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add docs/design/architecture/baseline.pen docs/features/architecture-design-phase.md
  git commit -F "$msg"
  ```

  Expected: the commit lands. Part 5 has not made the `.pen` guard architecture-aware yet, so the baseline commits from this worktree without an override. From Part 5 onward, a baseline edit from a worktree needs `NOLDOR_ALLOW_PEN_WRITE=1`.

  Run: `pnpm noldor checks arch-baseline`
  Expected: exit 0 — `arch-baseline: ok — docs/design/architecture/baseline.pen matches the code`.
