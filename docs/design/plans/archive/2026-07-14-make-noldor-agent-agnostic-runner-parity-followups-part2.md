# Interactive Runner Parity — opencode Shims + codex Prose + Dogfood Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Close the interactive-surface asymmetry honestly: author opencode command shims for the 9 CLI-verb-backed skills, give codex the same coverage as `AGENTS.md` prose, flip this repo's `agents.targets` to dogfood all three runtimes (materializing root twins), rewrite the "first-class peers" claim to the truth, and pin it with a drift guard that fails when the stated counts drift. Part 2 of 3; depends on nothing in Part 1 (independently shippable) but ships after it by convention.
**Architecture:** Shims are thin Markdown pointers under `templates/.opencode/command/`, auto-discovered by `templateFiles()`; `agent-filter.ts` gates them to opencode targets by prefix (no init.ts change). codex coverage is prose in `templates/AGENTS.md`. Flipping `.noldor/config.json` `agents.targets` makes `check-template-sync`/`doctor` require byte-identical root twins, materialized by `noldor init --update`. The drift guard asserts both the shim set and the counts stated in `agent-runtimes.md`.
**Tech Stack:** Markdown shims, JSON config, TypeScript/vitest for the guard, the `noldor` CLI (`init`, `doctor`).

---

## File Structure

- `templates/.opencode/command/{noldor-spec,noldor-plan,noldor-triage,noldor-promote,noldor-new-feature,noldor-milestone,noldor-draft-feature-md,noldor-garden,noldor-research}.md` — new; 9 thin-pointer opencode command shims.
- `templates/AGENTS.md` — modify; add a Skills subsection covering the same skill set as codex-facing prose.
- `.noldor/config.json` — modify; add top-level `agents.targets: ["claude","codex","opencode"]` to dogfood.
- root `.opencode/command/*.md`, `AGENTS.md`, `opencode.json` — materialized by `noldor init --update` (twins of `templates/`).
- `docs/noldor/agent-runtimes.md` + `templates/docs/noldor/agent-runtimes.md` — modify; rewrite the intro "first-class peers" claim to the honest headless-vs-interactive split with stated counts.
- `src/templates/__tests__/shim-inventory.test.ts` — new; drift guard on the shim set + the doc's stated counts.

---

## Task 1: Author the 9 opencode command shims

**Files:**
- Create: `templates/.opencode/command/noldor-spec.md` (+ 8 more below)

- [ ] **Step 1: Write the exemplar shim.** Create `templates/.opencode/command/noldor-spec.md` following the existing `noldor-gate.md` skeleton (thin `description:` frontmatter + prose pointing at the CLI verb + docs):

```markdown
---
description: Noldor spec — dialogue an idea into an approved design spec
---

Run the Noldor spec flow for this repo. Read `docs/noldor/workflow.md` and the
feature doc at `docs/features/<slug>.md` when one exists, then:

1. Ground in the real code/docs/tests the idea touches — cite actual paths.
2. Clarify one question at a time; present 2-3 approaches, lead with a recommendation.
3. Write the spec per `pnpm noldor prep format spec` to
   `docs/design/specs/YYYY-MM-DD-<slug>-design.md`.
4. Stop after the spec — the gate owns review (`pnpm noldor cr orchestrate --kind spec`).

Commit messages need a `Noldor-FD: <slug>` trailer.
```

- [ ] **Step 2: Write the remaining 8 shims** with the identical skeleton — only the `description:` line and the verb/steps prose change. Create each `templates/.opencode/command/<file>` with `description:` and a body pointing at the listed CLI verb + docs:

| File | `description:` | Primary CLI verb / docs pointer |
| --- | --- | --- |
| `noldor-plan.md` | `Noldor plan — decompose an approved spec into a bite-size TDD plan` | `pnpm noldor prep format plan`; read the spec + `docs/noldor/workflow.md` |
| `noldor-triage.md` | `Noldor triage — bulk-triage ideas.md into roadmap/backlog` | `pnpm noldor triage merge-candidates`; read `docs/vision.md` + `docs/noldor/triage.md` |
| `noldor-promote.md` | `Noldor promote — promote a roadmap/backlog entry to a feature MD` | `pnpm noldor roadmap`/`features`; read `docs/noldor/workflow.md` |
| `noldor-new-feature.md` | `Noldor new-feature — scaffold a blank feature MD` | `pnpm noldor features` scaffold; read `docs/noldor/feature-md-schema.md` |
| `noldor-milestone.md` | `Noldor milestone — draft/activate/edit/list milestones` | `pnpm noldor milestone`; read `docs/noldor/milestones.md` |
| `noldor-draft-feature-md.md` | `Noldor draft-feature-md — draft a feature MD's User Story/Usage from spec/code` | `pnpm noldor` draft flow (`--from-spec`/`--refresh`); read `docs/noldor/workflow.md` |
| `noldor-garden.md` | `Noldor garden — doc gardening pass (stale plans, rule contradictions, SDD gaps)` | `pnpm noldor garden-detect` + regen chain; read `docs/noldor/garden-and-drift.md` |
| `noldor-research.md` | `Noldor research — fan out parallel read-only research agents` | `pnpm noldor research fanout`; read `docs/noldor/research-fanout.md` |

Each body is 4-8 lines; end each with the `Noldor-FD:` trailer reminder. Keep them thin pointers — the logic lives in the CLI + docs, per the fat-CLI/thin-shim doctrine.

- [ ] **Step 3: Verify all 9 exist + are non-empty.**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/runner-parity-followups
for s in spec plan triage promote new-feature milestone draft-feature-md garden research; do test -s "templates/.opencode/command/noldor-$s.md" || echo "MISSING noldor-$s.md"; done; echo "done"
```

Expected output: `done` with no `MISSING` lines.

- [ ] **Step 4: Commit.**

```bash
git add templates/.opencode/command/
git commit -m "feat(templates): add opencode command shims for 9 CLI-verb-backed skills" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 2: codex coverage via `templates/AGENTS.md` prose

**Files:**
- Modify: `templates/AGENTS.md`

- [ ] **Step 1: Read the current file** to find the command-catalog section:

```bash
cat templates/AGENTS.md
```

Expected output: ~27 lines — Hard rules + a "Command catalog" section pointing at `pnpm noldor <group> <cmd>`.

- [ ] **Step 2: Append a Skills subsection** after the existing command catalog. Add this block (codex reads AGENTS.md natively; this is codex's equivalent of the opencode command shims):

```markdown

## Skills (codex/opencode)

The framework's interactive flows are CLI-backed. Invoke via the matching
`pnpm noldor` verb + the named doc; opencode users also have thin
`.opencode/command/<name>` shims:

- **gate** — `docs/noldor/workflow.md`; start every change here.
- **spec** — `pnpm noldor prep format spec`; `docs/noldor/workflow.md`.
- **plan** — `pnpm noldor prep format plan`.
- **triage** — `pnpm noldor triage merge-candidates`; `docs/noldor/triage.md`.
- **promote / new-feature** — `docs/noldor/feature-md-schema.md`.
- **milestone** — `pnpm noldor milestone`; `docs/noldor/milestones.md`.
- **garden** — `pnpm noldor garden-detect`; `docs/noldor/garden-and-drift.md`.
- **research** — `pnpm noldor research fanout`; `docs/noldor/research-fanout.md`.

`noldor-refactor` / `noldor-release-sweep` are Claude-agent orchestrations (no
thin-shim equivalent); `noldor-verify` is a discipline rule — see the Hard rules
above. Deep interactive behavior of any skill is Claude-primary.
```

- [ ] **Step 3: Commit.**

```bash
git add templates/AGENTS.md
git commit -m "docs(templates:AGENTS): cover the interactive skill set as codex-facing prose" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 3: honest `agent-runtimes.md` intro + counts (doc twin)

**Files:**
- Modify: `docs/noldor/agent-runtimes.md`
- Modify: `templates/docs/noldor/agent-runtimes.md`

- [ ] **Step 1: Rewrite the intro paragraph.** In `docs/noldor/agent-runtimes.md`, replace the opening paragraph (the "simultaneous first-class peers" sentence) with — the numbers here are load-bearing; the Task 4 guard asserts them:

```markdown
Noldor's three runtimes — **Claude Code, Codex, opencode** — are first-class
peers **for headless roles**: every framework spawn (drain, CR, research, prep)
resolves through the runner registry (`src/core/agent-runner/registry.ts`), a
call site declares a *role*, the consumer's `agents:` config maps roles to
runners, and the registry builds the runner-specific argv. Absent config ≡
claude everywhere.

The **interactive** skill surface is Claude-primary and honestly asymmetric:
**14 Claude skills** (`.claude/skills/`), **10 opencode command shims**
(`.opencode/command/`, thin pointers into the CLI — the 11th file, `noldor.md`,
is a catalog pointer, not a skill), and **0 codex command files** (codex reads
`AGENTS.md` prose). `noldor-refactor`/`noldor-release-sweep` (Claude-agent
orchestration) and `noldor-verify` (a discipline rule) have no shim by design.
```

- [ ] **Step 2: Sync the template twin + verify identical.**

```bash
cp docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
diff docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md && echo IDENTICAL
```

Expected output: `IDENTICAL`.

- [ ] **Step 3: Commit.**

```bash
git add docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
git commit -m "docs(agent-runtimes): state the honest headless-vs-interactive parity with counts" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 4: shim-inventory + count drift guard (TDD)

**Files:**
- Create: `src/templates/__tests__/shim-inventory.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/templates/__tests__/shim-inventory.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const skills = () => readdirSync(join(ROOT, '.claude', 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
const opencodeCmds = () => readdirSync(join(ROOT, 'templates', '.opencode', 'command'))
  .filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const docNum = (label: RegExp) => {
  const doc = readFileSync(join(ROOT, 'docs', 'noldor', 'agent-runtimes.md'), 'utf8');
  const m = doc.match(label);
  return m ? Number(m[1]) : NaN;
};

const CATALOG_POINTER = 'noldor'; // .opencode/command/noldor.md maps to no skill

describe('interactive shim inventory (drift guard)', () => {
  it('every opencode command shim (except the catalog pointer) names a real skill', () => {
    const skillSet = new Set(skills());
    for (const cmd of opencodeCmds()) {
      if (cmd === CATALOG_POINTER) continue;
      expect(skillSet.has(cmd), `shim ${cmd}.md has no matching .claude/skills/${cmd}`).toBe(true);
    }
  });

  it('agent-runtimes.md Claude-skill count matches .claude/skills/', () => {
    expect(docNum(/\*\*(\d+) Claude skills\*\*/)).toBe(skills().length);
  });

  it('agent-runtimes.md opencode-shim count matches skill-mapped command files', () => {
    const mapped = opencodeCmds().filter((c) => c !== CATALOG_POINTER).length;
    expect(docNum(/\*\*(\d+) opencode command shims\*\*/)).toBe(mapped);
  });

  it('agent-runtimes.md states 0 codex command files (none exist)', () => {
    expect(docNum(/\*\*(\d+) codex command files\*\*/)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify PASS** (the doc + shims from Tasks 1-3 should already satisfy it — this guard *locks in* that state):

```bash
pnpm vitest run src/templates/__tests__/shim-inventory.test.ts
```

Expected output: all 4 tests pass. If the Claude count is not 14 or the opencode count not 10, fix the number in `agent-runtimes.md` (Task 3) + re-sync the twin — that is the guard doing its job. Then re-run.

- [ ] **Step 3: Commit.**

```bash
git add src/templates/__tests__/shim-inventory.test.ts
git commit -m "test(templates): drift-guard the interactive shim set + agent-runtimes counts" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 5: dogfood — flip `agents.targets` + materialize root twins

**Files:**
- Modify: `.noldor/config.json`
- Materialize (via CLI): root `.opencode/command/*.md`, `AGENTS.md`, `opencode.json`

- [ ] **Step 1: Add the `agents` block** to this repo's `.noldor/config.json` (top-level, deterministic merge preserving other keys):

```bash
node -e "const f='.noldor/config.json';const c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.agents={...(c.agents||{}),targets:['claude','codex','opencode']};require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n');"
```

- [ ] **Step 2: Verify the block landed.**

```bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('.noldor/config.json','utf8')).agents))"
```

Expected output: `{"targets":["claude","codex","opencode"]}`.

- [ ] **Step 3: Materialize the root twins from templates.**

```bash
node bin/noldor.mjs init --update
```

Expected output: reports writing `.opencode/command/*` (11 files incl. the 9 new), `AGENTS.md`, `opencode.json`, and other targeted templates; exits 0.

- [ ] **Step 4: Verify template-sync is clean** (root twins now byte-identical to `templates/`):

```bash
node bin/noldor.mjs doctor 2>&1 | tail -20
```

Expected output: doctor reports opencode + codex present and above floor (opencode 1.17.20, codex 0.133.0), no template drift, exit 0. (If `check-template-sync` flags drift, the root twin diverged from `templates/` — re-run `init --update`.)

- [ ] **Step 5: Full verify.**

```bash
pnpm verify
```

Expected output: typecheck + tests + lint all pass. The shim-inventory guard, template-sync, and doctor are all green.

- [ ] **Step 6: Commit.** (Root twins are shared files; from a `.worktrees/` tree the `.claude/**` guard could fire, but `.opencode/**`, `AGENTS.md`, `opencode.json` are not in its BLOCK_LIST — no override needed.)

```bash
git add .noldor/config.json .opencode AGENTS.md opencode.json
git commit -m "chore(noldor): dogfood targets=[claude,codex,opencode] + materialize root runner twins" -m "Noldor-FD: make-noldor-agent-agnostic"
```
