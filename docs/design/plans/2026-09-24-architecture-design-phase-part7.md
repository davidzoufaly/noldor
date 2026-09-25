# pen.dev Architecture Design Phase Implementation Plan — Part 7: the spec and gate steps

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** the iteration loop runs inside the workflow.

- **`/noldor-spec` step 1.6** asks whether the change is architectural. On `required` it:
  - seeds `docs/design/architecture/<date>-<key>.pen` from the baseline;
  - iterates with the operator;
  - ends with one `FINAL:<view>:` page per changed view, approved at step 7.5.
- **Gate Step 2.5** runs the design-drift check on that `.pen`.
- **Gate Step 4** runs `checks arch-baseline` on every path and writes the change back into the baseline.
- **`docs/noldor/gotchas.md`** records the canvas traps.

**Architecture:** all prose. The steps reuse the commands Parts 1–6 shipped, and every hazard the UI step already documents (step 1.5) is referenced rather than restated.
- **Step number.** The new step is 1.6, sitting between 1.5 and 1.7. So step 1.5's three hand-offs to "step 1.7" now point at 1.6, and 1.6 hands on to 1.7.
- **Twins.** Each file edited here has a byte-identical `templates/` twin that `check-template-sync` holds.
- **Commit override.** Skill files are shared files that `checks shared-files` refuses from a worktree, so the commit carries `NOLDOR_ALLOW_SHARED=1` — the Q-0201 (PR #511) precedent.

**Tech Stack:** Markdown (skill prose), the `noldor` CLI.

**Parts:** 7 of 9. Parts 8–9 add milestone targets, and with them the milestone signal in step 1.6.

---

## File Structure

- `.claude/skills/noldor-spec/SKILL.md` + `templates/.claude/skills/noldor-spec/SKILL.md` — **Modify.** Adds step 1.6, the architecture half of step 7.5, and the three 1.5 hand-offs.
- `.claude/skills/noldor-gate/SKILL.md` + `templates/.claude/skills/noldor-gate/SKILL.md` — **Modify.** Adds the Step 2.5 drift sentence and the Step 4 architecture write-back bullet.
- `docs/noldor/gotchas.md` + `templates/docs/noldor/gotchas.md` — **Modify.** Adds three architecture-canvas bullets to *Pencil / UI design*.

---

## Task 1: The spec step

**Files:**

- Modify: `.claude/skills/noldor-spec/SKILL.md`
- Modify: `templates/.claude/skills/noldor-spec/SKILL.md`

- [ ] **Step 1: Point step 1.5's hand-offs at step 1.6.**

  In `.claude/skills/noldor-spec/SKILL.md`, make three exact replacements inside step 1.5:

  1. `and continue to **step 1.7** — nothing else UI-related.` → `and continue to **step 1.6** — nothing else UI-related.`
  2. `and still continues to step 1.7.` → `and still continues to step 1.6.`
  3. `Then continue to step 1.7 — the verdict itself waits for step 7.5.` → `Then continue to step 1.6 — the verdict itself waits for step 7.5.`

  Leave `(Never skip past 1.7: …)` alone. It is still true: every path through 1.6 continues to 1.7.

  Run: `grep -c "step 1.6" .claude/skills/noldor-spec/SKILL.md`
  Expected: `3`

- [ ] **Step 2: Insert step 1.6.**

  Directly above the line that begins `1.7. **Structural-read step (path-gated).**`, insert this block (followed by a blank line):

  ```markdown
  1.6. **Architecture design step (baseline-gated).** Skip entirely unless the session marker's `path` is `specs-only-*` or `full-*` **and** `docs/design/architecture/baseline.pen` exists — a repo that never drew a baseline pays nothing. Otherwise the step runs step 1.5's lifecycle on the architecture canvas, and every hazard bullet of 1.5 applies verbatim with `docs/design/architecture/` for `docs/design/ui/` and `archWaiver` for `uiWaiver`: assert the write target before every pencil write, wake the bridge before concluding the editor is unavailable, verify a new node in a follow-up `execute`, waive only after a wake attempt, and keep a seeded `.pen` and its link on a waiver after Seed.

     - **Verdict — asked, never inferred.** Recommend `required` or `skip` and ask once, naming the signals behind the recommendation: a new directory under a scan root in the entry's `Touches:` or in the design, a new package or runnable unit, a new external the system talks to, a new cross-module import the design introduces. Write the answer to the session marker as `archVerdict`. On `skip`, add one line to the spec ("Architecture verdict: skip — <reason>") and continue to step 1.7. The ship-time check is the backstop: gate Step 4 runs `pnpm noldor checks arch-baseline` on every path, so a module-level change this verdict missed still surfaces before the PR.
     - **Seed.** `cp docs/design/architecture/baseline.pen docs/design/architecture/<date>-<dialogue-key>.pen`, open the copy with `pnpm noldor design pen-bridge --pen <that path>`, confirm it with `get_app_state`, and rename its four pages to `BASE:<view>: as-built` with `Update(<pageId>, {name})` — `Print(Get(document, {depth: 1}).children.map(c => [c.id, c.name]))` lists them.
     - **Iterate.** Draw each variant as a page named `<view>: <variant>`, starting from a `Copy` of the `BASE:` page. Keep the layer-name contract `checks arch-baseline` reads: a module box is named by its path (`src/cr`, or `src/a + src/b` for a box that covers two), a group frame `group: <Name>`, an arrow `<from> -> <to>`; a module the design proposes is a box named by the path it will have. After boxes move, save the `.pen`, run `pnpm -s noldor design arch-route --pen <that path> --view <view>` and pass its stdout as `execute`'s `input`. Converge with the operator on one winner per changed view and rename it `FINAL:<view>: <name>`; a view the change leaves alone keeps only its `BASE:` page.
     - **Record.** Name the chosen variant and the alternatives in the spec's `## Design`, link the `.pen`, and set FD `links.arch`.
     - **Verdict at step 7.5.** Taken exactly like step 1.5's (a)–(g), each `FINAL:` view a surface: `pnpm noldor design verdict --pen <the architecture .pen> --approve --surface <view> [--surface <view>...] --spec <this spec> --editor-page "<name>" [--editor-page "<name>"...]`. A waiver after Seed runs `pnpm noldor design verdict --pen <the architecture .pen> --waive --reason "<why>"` and keeps the `.pen` and `links.arch`.

     The architecture `.pen` and its record commit with the spec at gate Step 2.5, beside any UI `.pen`. Then continue to step 1.7.
  ```

- [ ] **Step 3: Extend step 7.5.**

  At the end of the step-7.5 paragraph (after `costs the operator a `--reconfirm`.`), append:

  ```markdown
   When `archVerdict` is `required` and no `archWaiver` is recorded, take the architecture verdict the same way, as step 1.6 describes — one verdict per `.pen`; a session with both a UI and an architecture design asks for two, never one merged approval.
  ```

- [ ] **Step 4: Mirror the twin and check it.**

  Run:

  ```bash
  cp .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md
  pnpm noldor checks skill-portability
  pnpm noldor validate skill-catalog
  ```

  Expected: both checks exit 0.

---

## Task 2: The gate steps and the gotchas

**Files:**

- Modify: `.claude/skills/noldor-gate/SKILL.md`, `templates/.claude/skills/noldor-gate/SKILL.md`
- Modify: `docs/noldor/gotchas.md`, `templates/docs/noldor/gotchas.md`

- [ ] **Step 1: Add the architecture drift check to gate Step 2.5.**

  In `.claude/skills/noldor-gate/SKILL.md`, at the end of the paragraph that begins `**Design-approval drift (UI-bearing sessions).**` (after `refuses it as `design-approval-spec-stale`.`), append:

  ```markdown
   The same check runs on the architecture `.pen` when the marker carries `archVerdict: required` and no `archWaiver`: `pnpm noldor design verdict --check --pen <the session's architecture .pen>`, with the same three exit branches.
  ```

- [ ] **Step 2: Add the architecture write-back to gate Step 4.**

  Directly after the bullet that begins `- **UI baseline write-back (UI-bearing sessions only).**` (it ends `do NOT block the ship on it.`), insert this bullet, separated by blank lines:

  ```markdown
  - **Architecture baseline write-back (every path, when `docs/design/architecture/baseline.pen` exists).** Runs after the UI write-back and before the flip commit. Run `pnpm noldor checks arch-baseline`, then:
    - **The session approved an architecture `.pen`** (`archVerdict: required`, no `archWaiver`; the archive seam just moved it into `docs/design/architecture/archive/`): for each `FINAL:<view>:` page, apply the change it makes against its `BASE:<view>:` page onto the **current** baseline view through pencil MCP — never copy the page over, because another feature may have written that view back since Seed. Open the baseline with `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen` and assert it with `get_app_state` before the first write. Save, re-route each changed view (`pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen --view <view>`, stdout as `execute`'s `input`), and re-run the check until it is green.
    - **The check is red on a session with no architecture design** — a module added, removed or rewired without one: write the baseline back the same way from the code, adding, renaming or removing exactly the boxes and arrows the findings name.
    - Stage `docs/design/architecture/baseline.pen` so it rides the flip commit, and make that commit with `NOLDOR_ALLOW_PEN_WRITE=1` — the guard's `pen-baseline` rule refuses a baseline staged from a worktree otherwise. On `fast-track`, which has no flip commit, commit it on its own (same variable) before the push-gate preflight. A `micro-chore` cannot change code, so a red check there is inherited debt: skip the write-back and print the debt.
    - Advisory at this seam: the check's exit code never blocks `pr-flow`. Pencil MCP unavailable (a headless drain, a session without the bridge): skip LOUDLY — print the check's rows as the debt — and let release preflight's `arch-baseline` row hold the line.
  ```

- [ ] **Step 3: Record the canvas traps.**

  In `docs/noldor/gotchas.md`, at the end of the `## Pencil / UI design` section (directly above `## Release & publish`, after the bullet ending `(charuy Q-0278)`), insert:

  ```markdown
  - **An architecture arrow is a loose path, not a connector.** pen.dev has no
    sticky arrows, so dragging a box leaves its arrows where they were — and
    `checks arch-baseline` stays green, because it reads layer names, not
    geometry. After moving boxes run `pnpm -s noldor design arch-route --pen
    <path> --view <view>` and pass its stdout to pencil `execute`. Save first
    when you drew a new arrow: the matching reads the file on disk.
    (architecture-design-phase)
  - **On an architecture canvas the layer name is the contract, not the label.**
    A module box means its layer name (`src/cr`), an arrow its `<from> -> <to>`
    name; the text inside a box is decoration. Renaming the label without the
    layer changes nothing the check sees, a typo in the layer name surfaces as
    `unknown-module` or `dangling-edge`, and a duplicated box keeps its
    original's name — `duplicate-module` until the copy is renamed.
    (architecture-design-phase)
  - **Pasted mermaid SVG is not an architecture baseline.** pen.dev turns pasted
    SVG into editable nodes but drops arrow tips (`<marker>`) and HTML labels
    (`foreignObject`), and every pasted box arrives unnamed, so the check sees
    none of it. Emit the `.pen` from data with the names set as each node is
    created, as this repo's baseline was. (architecture-design-phase)
  ```

- [ ] **Step 4: Mirror the twins and check them.**

  Run:

  ```bash
  cp .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md
  cp docs/noldor/gotchas.md templates/docs/noldor/gotchas.md
  pnpm noldor checks skill-portability
  pnpm noldor validate noldor
  pnpm noldor checks template-sync
  ```

  Expected: all three exit 0.

- [ ] **Step 5: Commit both tasks.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(noldor): the spec and gate steps design, approve and write back the architecture canvas

  /noldor-spec step 1.6 asks the architecture verdict once a baseline exists,
  seeds and iterates the canvas with arrow re-route, and takes the verdict at
  7.5; gate Step 2.5 drift-checks the architecture .pen and Step 4 runs
  checks arch-baseline on every path, writing the change back into the
  baseline. The gotchas page records the loose-arrow, layer-name and
  pasted-SVG traps.

  Noldor-FD: architecture-design-phase
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md \
    .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md \
    docs/noldor/gotchas.md templates/docs/noldor/gotchas.md
  NOLDOR_ALLOW_SHARED=1 git commit -F "$msg"
  ```

  Expected: the commit lands. Without `NOLDOR_ALLOW_SHARED=1`, `checks shared-files` refuses the two skill files with `shared-root`.
