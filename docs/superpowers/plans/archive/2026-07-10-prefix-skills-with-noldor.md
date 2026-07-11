# Prefix Skills with noldor- Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Rename the 9 unprefixed framework skills (`gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`) to `noldor-<name>` across both skill trees, all live cross-references, load-bearing code, and framework docs; ship a consumer migration that renames vendored skills on `noldor upgrade`. Keep `pnpm verify` green and every homonym untouched.
**Architecture:** A pure, idempotent, word-boundary-anchored codemod (`prefix-skills-codemod.ts`) does the bulk text rewrite over a fixed glob set; `git mv` renames the dirs; load-bearing code + user-facing strings are hand-edited; a version-anchored migration (`0.6.0.ts` + `0.5.0` bridge) renames vendored consumer skills.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node fs, vitest, `node:fs/promises` glob. Mirror the existing codemod precedent `src/core/rename-plan-only-tier.ts`.

---

## File Structure

- `src/core/prefix-skills-codemod.ts` — Create — pure `prefixSkills(input)` rewrite + CLI runner over the glob set.
- `src/core/__tests__/prefix-skills-codemod.test.ts` — Create — golden renames, homonym non-match (word-boundary), idempotency.
- `src/autonomous/gate-prompt.ts` — Modify — the two `/gate` slash-string literals → `/noldor-gate`.
- `src/autonomous/__tests__/gate-prompt.test.ts` — Modify — expectations to `/noldor-gate`.
- `src/core/allowlist.ts` — Modify — `RELEASE_SWEEP_GLOBS` skill-dir glob → `noldor-release-sweep`.
- `src/core/__tests__/allowlist.test.ts` — Modify — `.claude/skills/<name>` path fixtures.
- `src/testing/stub-gate.ts` — Modify — emit/parse `/noldor-gate`.
- `src/autonomous/__tests__/drain-source.test.ts`, `build-pool.test.ts`, `escalations.test.ts` — Modify — asserted gate-prompt strings.
- `src/core/__tests__/extract-touches.test.ts`, `src/dashboard/__tests__/dashboard-skills.test.ts`, `src/templates/__tests__/agent-filter.test.ts` — Modify — hardcoded skill paths.
- `src/migrations/0.5.0.ts` — Create — no-op bridge anchor (from 0.4.0).
- `src/migrations/0.6.0.ts` — Create — skill-rename consumer migration.
- `src/migrations/registry.ts` — Modify — register `migration_0_5_0`, `migration_0_6_0`.
- `src/migrations/__tests__/0.6.0.test.ts`, `src/migrations/__tests__/0.5.0.test.ts` — Create — migration behavior + chain contiguity.
- User-facing string edits (Task 6): `src/hooks/noldor-pre-commit.ts`, `noldor-pre-edit-guard.ts`, `noldor-pre-push.ts`, `noldor-validate-trailer.ts`, `src/core/session.ts`, `src/core/pr-flow-cli.ts`, `src/core/pr-flow.ts`, `src/cli/commands/init.ts`, `src/prep/prep-promote.ts`, `src/garden/garden-receipt.ts`, `src/dashboard/views.ts`, `src/cli/manifest.ts`.
- `.claude/skills/noldor-<name>/` ×9 + `templates/.claude/skills/noldor-<name>/` ×9 — Renamed via `git mv` (Task 2).
- `docs/noldor/*.md` (+twins), `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/noldor/skill-catalog.md` (+twin) — Rewritten by the codemod (Task 3).

---

## Task 1: Pure codemod + CLI

**Files:**
- Create: `src/core/prefix-skills-codemod.ts`
- Test: `src/core/__tests__/prefix-skills-codemod.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/core/__tests__/prefix-skills-codemod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prefixSkills } from '../prefix-skills-codemod.js';

describe('prefixSkills', () => {
  it('rewrites slash invocations with args and at line start', () => {
    expect(prefixSkills('run /gate --drain foo')).toBe('run /noldor-gate --drain foo');
    expect(prefixSkills('/promote <slug>')).toBe('/noldor-promote <slug>');
    expect(prefixSkills('# /gate')).toBe('# /noldor-gate');
    expect(prefixSkills('## /release-sweep')).toBe('## /noldor-release-sweep');
  });

  it('rewrites SKILL.md frontmatter name and dir paths', () => {
    expect(prefixSkills('name: gate\n')).toBe('name: noldor-gate\n');
    expect(prefixSkills('.claude/skills/refactor/SKILL.md')).toBe(
      '.claude/skills/noldor-refactor/SKILL.md',
    );
  });

  it('rewrites backtick skill-context only', () => {
    expect(prefixSkills('the `garden` skill')).toBe('the `noldor-garden` skill');
    expect(prefixSkills('Skill tool, name `promote`')).toBe('Skill tool, name `noldor-promote`');
  });

  it('does NOT touch homonyms', () => {
    expect(prefixSkills("kind: 'gate'")).toBe("kind: 'gate'");
    expect(prefixSkills('- type: refactor')).toBe('- type: refactor');
    expect(prefixSkills("from '../garden/garden-detect.js'")).toBe(
      "from '../garden/garden-detect.js'",
    );
    expect(prefixSkills("import x from './gate.js'")).toBe("import x from './gate.js'");
    expect(prefixSkills('the `/milestones` page')).toBe('the `/milestones` page');
    expect(prefixSkills('docs/milestones/<slug>.md')).toBe('docs/milestones/<slug>.md');
    expect(prefixSkills('/api/roadmap/promote-from-backlog/')).toBe(
      '/api/roadmap/promote-from-backlog/',
    );
    expect(prefixSkills('/milestone-ish')).toBe('/milestone-ish');
    expect(prefixSkills('features/gate-flow-rework.md')).toBe('features/gate-flow-rework.md');
  });

  it('protects FD slugs that embed a renamed word', () => {
    expect(prefixSkills('portable-gate-entrypoint-for-non-claude-runners')).toBe(
      'portable-gate-entrypoint-for-non-claude-runners',
    );
    expect(prefixSkills('slug: prefix-skills-with-noldor')).toBe('slug: prefix-skills-with-noldor');
  });

  it('is idempotent', () => {
    const once = prefixSkills('/gate\nname: gate\n.claude/skills/gate/');
    expect(prefixSkills(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL.**
  `pnpm vitest run src/core/__tests__/prefix-skills-codemod.test.ts`
  Expected: fails to resolve `../prefix-skills-codemod.js` (module missing) — `Error: Failed to load url`.

- [ ] **Step 3: Implement the codemod.** Create `src/core/prefix-skills-codemod.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

/**
 * One-time, idempotent codemod prefixing the 9 bare framework skill names with
 * `noldor-`. Word-boundary-anchored (both sides) so homonyms — CR lane
 * `kind: 'gate'`, commit type `refactor`, module dirs `../garden/`, dashboard
 * routes `/milestones`, `docs/milestones/` paths, `promote-from-backlog` URLs,
 * and FD slugs like `portable-gate-entrypoint` — are never touched (proven by the
 * homonym test). Idempotent: a second run finds no unprefixed anchors. Mirrors
 * `rename-plan-only-tier.ts`, minus its slug-placeholder round-trip — the
 * symmetric boundaries make it unnecessary (no PROTECTED table, no NUL sentinel).
 */
const NAMES = [
  'gate',
  'garden',
  'triage',
  'promote',
  'milestone',
  'new-feature',
  'draft-feature-md',
  'refactor',
  'release-sweep',
] as const;

export function prefixSkills(input: string): string {
  let s = input;
  for (const n of NAMES) {
    // Slash invocation, symmetric word boundary. The left class excludes `.` so a
    // relative module path (`../garden/`, `./gate`) is NOT rewritten — a bare
    // `(?<![\w-])` would pass on the `.` before the slash and corrupt imports.
    // Must match the acceptance grep's `(?<![\w.-])…(?![\w-])` exactly.
    s = s.replace(new RegExp(`(?<![\\w.-])/${n}(?![\\w-])`, 'g'), `/noldor-${n}`);
    // Skill dir path segment.
    s = s.replaceAll(`.claude/skills/${n}/`, `.claude/skills/noldor-${n}/`);
    // SKILL.md frontmatter name (line-anchored; no other file carries `name: <bare-slug>`).
    s = s.replace(new RegExp(`^name: ${n}$`, 'gm'), `name: noldor-${n}`);
    // Backtick skill-context: `n` skill  /  name `n`.
    s = s.replace(new RegExp('`' + n + '`(\\s+skill)', 'g'), '`noldor-' + n + '`$1');
    s = s.replace(new RegExp('(name\\s+)`' + n + '`', 'g'), '$1`noldor-' + n + '`');
  }
  return s;
}

const FILE_GLOBS = [
  '.claude/skills/*/SKILL.md',
  'templates/.claude/skills/*/SKILL.md',
  'docs/noldor/*.md',
  'templates/docs/noldor/*.md',
  'docs/features/*.md',
  'docs/roadmap.md',
  'docs/backlog.md',
];

// Fixed-prefix globs; `*` never crosses `/`, so results are exactly the intended
// skill/doc files — no exclude machinery is reachable, hence none. `glob` from
// node:fs/promises is stable enough for this one-shot dev codemod; it may emit an
// ExperimentalWarning on the Node 22 CI floor — that is NOT a failure.
async function collectFiles(): Promise<string[]> {
  const seen = new Set<string>();
  for (const pattern of FILE_GLOBS) {
    for await (const path of glob(pattern)) {
      seen.add(path.replace(/\\/g, '/'));
    }
  }
  return [...seen].toSorted();
}

async function main(): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const files = await collectFiles();
  let touched = 0;
  for (const path of files) {
    const before = readFileSync(path, 'utf8');
    const after = prefixSkills(before);
    if (after !== before) {
      touched++;
      if (dryRun) console.log(`would-touch ${path}`);
      else {
        writeFileSync(path, after, 'utf8');
        console.log(`touched ${path}`);
      }
    }
  }
  console.log(`\n${dryRun ? 'dry-run' : 'applied'}: ${touched} file(s) touched`);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
```

- [ ] **Step 4: Run the test, verify PASS.**
  `pnpm vitest run src/core/__tests__/prefix-skills-codemod.test.ts`
  Expected: `Test Files 1 passed`, all cases green.

- [ ] **Step 5: Commit.**

```bash
git add src/core/prefix-skills-codemod.ts src/core/__tests__/prefix-skills-codemod.test.ts
git commit -m "feat(core): add prefix-skills-with-noldor codemod" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 2: Load-bearing code — gate-prompt + allowlist (TDD)

**Files:**
- Modify: `src/autonomous/gate-prompt.ts`, `src/autonomous/__tests__/gate-prompt.test.ts`
- Modify: `src/core/allowlist.ts`, `src/core/__tests__/allowlist.test.ts`

- [ ] **Step 1: Update gate-prompt test expectations (failing).** In `src/autonomous/__tests__/gate-prompt.test.ts`, change every `slash-command` expectation from `/gate --drain` / `/gate --resume` to `/noldor-gate --drain` / `/noldor-gate --resume`. Keep the "prose branch has no `/gate` token" assertion but update it to assert no `/noldor-gate` token either (the prose branch stays a pointer to `docs/noldor/drain-mode.md`).

- [ ] **Step 2: Run, verify FAIL.**
  `pnpm vitest run src/autonomous/__tests__/gate-prompt.test.ts`
  Expected: assertion failures — received `/gate --drain …`, expected `/noldor-gate --drain …`.

- [ ] **Step 3: Edit gate-prompt.ts.** In `src/autonomous/gate-prompt.ts`:
  - Line 25: `` return `/gate --drain ${slug}`; `` → `` return `/noldor-gate --drain ${slug}`; ``
  - Line 51: `` `/gate --resume ${slug} --autonomous`, `` → `` `/noldor-gate --resume ${slug} --autonomous`, ``

- [ ] **Step 4: Run, verify PASS.**
  `pnpm vitest run src/autonomous/__tests__/gate-prompt.test.ts`
  Expected: green.

- [ ] **Step 5: Update allowlist test + impl.** In `src/core/allowlist.ts`, change the `RELEASE_SWEEP_GLOBS` entry `'.claude/skills/release-sweep/**'` → `'.claude/skills/noldor-release-sweep/**'`. In `src/core/__tests__/allowlist.test.ts`, change every `.claude/skills/release-sweep/…` and `.claude/skills/gate/…` fixture path to `.claude/skills/noldor-release-sweep/…` / `.claude/skills/noldor-gate/…` respectively (the release-sweep allowlist covers `noldor-release-sweep`; the gate paths are the non-allowlisted control cases).

- [ ] **Step 6: Run, verify PASS.**
  `pnpm vitest run src/core/__tests__/allowlist.test.ts`
  Expected: green.

- [ ] **Step 7: Commit.**

```bash
git add src/autonomous/gate-prompt.ts src/autonomous/__tests__/gate-prompt.test.ts src/core/allowlist.ts src/core/__tests__/allowlist.test.ts
git commit -m "refactor(core): point drain gate-prompt + release-sweep allowlist at noldor- skills" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 3: Rename the 9 skill dirs + run the codemod

**Files:**
- Renamed: `.claude/skills/<name>` → `.claude/skills/noldor-<name>` ×9, and `templates/.claude/skills/<name>` → `templates/.claude/skills/noldor-<name>` ×9
- Renamed (opencode runner shim, only skills that have one — today just `gate`): `templates/.opencode/command/<name>.md` → `templates/.opencode/command/noldor-<name>.md`
- Modified by codemod: all `.claude/skills/*/SKILL.md`, `templates/.claude/skills/*/SKILL.md`, `docs/noldor/*.md` (+twins), `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md`, `docs/noldor/skill-catalog.md` (+twin)

- [ ] **Step 1: `git mv` the skill dirs (both trees) + opencode shims.** Run:

```bash
for n in gate garden triage promote milestone new-feature draft-feature-md refactor release-sweep; do
  git mv ".claude/skills/$n" ".claude/skills/noldor-$n"
  git mv "templates/.claude/skills/$n" "templates/.claude/skills/noldor-$n"
  # Opencode command shim — only some skills have one (today: gate). Skip if absent.
  [ -f "templates/.opencode/command/$n.md" ] && git mv "templates/.opencode/command/$n.md" "templates/.opencode/command/noldor-$n.md" || true
done
```

Expected: no output, exit 0. Verify: `ls .claude/skills | grep -c '^noldor-'` → `12` (9 renamed + spec/plan/research); `ls templates/.opencode/command` → `noldor-gate.md` + `noldor.md` (the bare `gate.md` gone). Opencode `gate.md` body references `pnpm noldor` commands + "Noldor gate" prose, no `/gate` slash — the codemod leaves its content untouched, only the filename (= the command name) changes; no content edit needed.

- [ ] **Step 2: Run the codemod.**
  `pnpm exec tsx src/core/prefix-skills-codemod.ts`
  Expected: prints `touched <path>` for the moved SKILL.md files, the catalog twins, and every `docs/noldor`/`docs/features`/roadmap/backlog page carrying a slash-invocation, then `applied: N file(s) touched` (N in the dozens).

- [ ] **Step 3: Verify catalog + dirs agree.**
  `pnpm noldor validate skill-catalog`
  Expected: exit 0, no output (dirs ↔ `## /noldor-<name>` headings match, no bare-name residue).

- [ ] **Step 4: Verify idempotency (no in-scope residue).**
  `pnpm exec tsx src/core/prefix-skills-codemod.ts`
  Expected: `applied: 0 file(s) touched`.

- [ ] **Step 5: Verify anchored scoped grep is clean.**
  `rg -nP '(?<![\w.-])/(gate|garden|triage|promote|milestone|new-feature|draft-feature-md|refactor|release-sweep)(?![\w-])' .claude/skills docs/noldor templates/.claude/skills templates/docs/noldor docs/features docs/roadmap.md docs/backlog.md`
  Expected: no matches (exit 1 from rg = zero hits). If any hit is a real false-positive (a slug/homonym the boundary should have spared), add a failing case to the homonym test and tighten the codemod's word-boundary (there is no PROTECTED table — the boundaries are the sole guard), then re-run Steps 2/4/5.

- [ ] **Step 6: Sanity — homonyms untouched.**
  `rg -n "kind: 'gate'|^- type: refactor|/milestones|docs/milestones/" src docs/noldor | head`
  Expected: homonym hits still present (unchanged).

- [ ] **Step 7: Commit.**

```bash
git add .claude/skills templates/.claude/skills templates/.opencode docs/noldor templates/docs/noldor docs/features docs/roadmap.md docs/backlog.md
NOLDOR_ALLOW_SHARED=1 git commit -m "refactor(skills): prefix 9 framework skills with noldor- (dirs, catalog, cross-refs, docs)" -m "Noldor-FD: prefix-skills-with-noldor"
```

Note (two repo gotchas):
- **`NOLDOR_ALLOW_SHARED=1` is REQUIRED** — the pre-commit shared-files guard (`src/checks/check-shared-files.ts:9`, blocklist `/^\.claude\/skills\/[^/]+/`) hard-aborts any commit staging `.claude/skills/**` from inside a worktree. Without the env var this commit dies with no in-plan remedy. (Same guard covers `.claude/commands/`; `templates/**` paths are not blocklisted but the env var is harmless there.)
- **Explicit pathspecs, NOT `git add -A`** — `-A` sweeps untracked worktree noise (`.claude/settings.local.json`, scratch files) into the commit, which has previously red-ed the verify lane. The `git mv` renames are captured because both old (deletion) and new (addition) sides live under the listed prefixes.

The pre-commit `validate skill-catalog` + `template-sync` hooks run; both must be green (Step 3 proved catalog; template-sync passes because both trees were renamed+rewritten identically).

---

## Task 4: Fix hardcoded skill paths/strings in remaining tests

> **Expected transient red:** from the Task 2/3 commits until this task lands, `pnpm vitest run src` is red — `drain-source.test.ts` / `build-pool.test.ts` / `escalations.test.ts` still assert `/gate --drain` etc. This is intentional TDD sequencing (per-commit pre-commit hooks run only validators, not the full suite, so the commits succeed). Green is restored here and re-proven by Task 8's `pnpm verify`. Do not treat the interim red as a regression.

**Files:**
- Modify: `src/core/__tests__/extract-touches.test.ts`, `src/dashboard/__tests__/dashboard-skills.test.ts`, `src/templates/__tests__/agent-filter.test.ts`, `src/autonomous/__tests__/drain-source.test.ts`, `src/autonomous/__tests__/build-pool.test.ts`, `src/autonomous/__tests__/escalations.test.ts`

- [ ] **Step 1: Run the suites to see the failures.**
  `pnpm vitest run src/core/__tests__/extract-touches.test.ts src/dashboard/__tests__/dashboard-skills.test.ts src/templates/__tests__/agent-filter.test.ts src/autonomous/__tests__/drain-source.test.ts src/autonomous/__tests__/build-pool.test.ts src/autonomous/__tests__/escalations.test.ts`
  Expected: failures where fixtures hardcode `.claude/skills/gate|promote|release-sweep/…` or the gate-prompt strings `/gate --drain`/`/gate --resume`.

- [ ] **Step 2: Update fixtures.** In each failing test, replace hardcoded skill paths `.claude/skills/<name>/…` → `.claude/skills/noldor-<name>/…` and gate-prompt string expectations `/gate --drain`→`/noldor-gate --drain`, `/gate --resume`→`/noldor-gate --resume` (for the 9 renamed names only; leave homonyms and `noldor-spec/plan/research` untouched).

- [ ] **Step 3: Run, verify PASS.**
  (same command as Step 1)
  Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add src/core/__tests__/extract-touches.test.ts src/dashboard/__tests__/dashboard-skills.test.ts src/templates/__tests__/agent-filter.test.ts src/autonomous/__tests__/drain-source.test.ts src/autonomous/__tests__/build-pool.test.ts src/autonomous/__tests__/escalations.test.ts
git commit -m "test: update hardcoded skill paths/prompts to noldor- names" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 5: stub-gate emit/parse

**Files:**
- Modify: `src/testing/stub-gate.ts`

- [ ] **Step 1: Update stub-gate.** In `src/testing/stub-gate.ts`: change only the default `argv[2] ?? '/gate'` → `argv[2] ?? '/noldor-gate'` and the `/gate` mention in the doc comment. The slug parse (`/--resume\s+(\S+)/`, ~line 81) is token-agnostic and needs NO change. Clean break — no back-compat.

- [ ] **Step 2: Run the stub-gate + drain consumers.**
  `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts src/testing`
  Expected: green (drain-source already updated in Task 4; stub now emits/parses the new token).

- [ ] **Step 3: Commit.**

```bash
git add src/testing/stub-gate.ts
git commit -m "test(stub-gate): emit/parse /noldor-gate" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 6: User-facing invocation strings across src

**Files:**
- Modify: any `src/**/*.ts` whose runtime STRING output invokes a renamed skill. Known set (spec Unit 4 + plan-CR B2): `src/hooks/noldor-pre-commit.ts`, `noldor-pre-edit-guard.ts`, `noldor-pre-push.ts`, `noldor-validate-trailer.ts`, `src/core/session.ts`, `src/core/pr-flow-cli.ts`, `src/core/pr-flow.ts`, `src/cli/commands/init.ts`, `src/prep/prep-promote.ts`, `src/garden/garden-receipt.ts`, `src/dashboard/views.ts`, `src/cli/manifest.ts`, `src/core/next-priority.ts` (deprecation warning `:266`), `src/autonomous/drain-source.ts` (escalation reason `:101`) — plus any others Step 1 surfaces.

**Policy (spec Unit 4):** rewrite skill-invocation tokens that reach a human/agent at RUNTIME — error/warning/escalation messages, `--help`/`desc:` text, PR-body strings. LEAVE code comments (JSDoc, `//`) and `@fd:` tags AS-IS: cosmetic, out-of-scope for this PR (a later cosmetic sweep may address them). Never touch homonyms (`kind: 'gate'`, session `Path` value `'release-sweep'`, `../garden/` imports).

- [ ] **Step 1: Enumerate ALL src hits (not a hand-picked list — plan-CR B2 flagged the 12-file scope as a false-clean).**
  `rg -nP "(?<![\w.-])/(gate|garden|milestone|triage|promote|new-feature|draft-feature-md|refactor|release-sweep)(?![\w-])" src`
  Expected: ~116 lines across strings AND comments (the anchored rg over all `src` returns ~116 today — most are comments/JSDoc). Classify each: runtime string → rewrite (Step 2); comment / `@fd:` / JSDoc → leave per policy.

- [ ] **Step 2: Rewrite runtime-string hits** `/<name>` → `/noldor-<name>`. Walk every Step-1 hit; open each file, decide string-vs-comment, rewrite strings only.

- [ ] **Step 3: Typecheck + run the suite.**
  `pnpm exec tsc --noEmit`
  Expected: no errors.
  `pnpm vitest run src`
  Expected: green (fix any snapshot/string assertion that captured old message text).

- [ ] **Step 4: Verify no runtime-string residue.**
  Re-run Step 1's rg over `src`. Expected: every remaining hit is EXCLUSIVELY inside a code comment / `@fd:` tag (confirm each by eye) — zero inside a string literal.

- [ ] **Step 5: Commit.**

```bash
git add src
git commit -m "refactor: update user-facing skill-invocation strings to noldor- names" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 7: Consumer migration — 0.5.0 bridge + 0.6.0 rename (TDD)

**Files:**
- Create: `src/migrations/0.5.0.ts`, `src/migrations/0.6.0.ts`
- Modify: `src/migrations/registry.ts`
- Test: `src/migrations/__tests__/0.5.0.test.ts`, `src/migrations/__tests__/0.6.0.test.ts`

- [ ] **Step 1: Write the 0.5.0 bridge test (failing).** Create `src/migrations/__tests__/0.5.0.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migration_0_5_0 } from '../0.5.0.js';
import { resolveChain } from '../chain.js';
import { migration_0_4_0 } from '../0.4.0.js';
import { migration_0_6_0 } from '../0.6.0.js';

describe('migration_0_5_0 bridge', () => {
  it('is a no-op anchor from 0.4.0', () => {
    expect(migration_0_5_0.from).toBe('0.4.0');
    expect(migration_0_5_0.to).toBe('0.5.0');
    expect(migration_0_5_0.migrate(process.cwd(), {} as never)).toEqual([]);
  });
  it('keeps the chain contiguous 0.4.0 -> 0.6.0', () => {
    const chain = resolveChain(
      [migration_0_4_0, migration_0_5_0, migration_0_6_0],
      '0.4.0',
      '0.6.0',
    );
    expect(chain.map((m) => m.to)).toEqual(['0.5.0', '0.6.0']);
  });
});
```

- [ ] **Step 2: Write the 0.6.0 migration test (failing).** Create `src/migrations/__tests__/0.6.0.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migration_0_6_0 } from '../0.6.0.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-mig-'));
  // Simulate a consumer at 0.5.0 with old vendored skill dirs.
  mkdirSync(join(dir, '.claude/skills/gate'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/gate/SKILL.md'), 'name: gate\n# /gate\n');
  mkdirSync(join(dir, '.claude/skills/refactor'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/refactor/SKILL.md'), 'name: refactor\n');
  // Opencode command shim for gate (B2).
  mkdirSync(join(dir, '.opencode/command'), { recursive: true });
  writeFileSync(join(dir, '.opencode/command/gate.md'), '---\ndescription: gate\n---\n');
  // Consumer-AUTHORED homonym at a renamed path — frontmatter name is NOT the bare
  // slug, so the guard must leave it untouched (B3).
  mkdirSync(join(dir, '.claude/skills/promote'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/promote/SKILL.md'), 'name: my-custom-promote\n');
  mkdirSync(join(dir, 'docs/features'), { recursive: true });
  writeFileSync(join(dir, 'docs/features/mine.md'), 'consumer-owned\n'); // must survive
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migration_0_6_0', () => {
  it('renames only the skills the consumer vendored (true-rename)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/skills/gate'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/refactor'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/noldor-gate/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/noldor-refactor/SKILL.md'))).toBe(true);
    // `garden` was never vendored ⇒ no noldor-garden installed (agent/subset scoping).
    expect(existsSync(join(dir, '.claude/skills/noldor-garden'))).toBe(false);
  });
  it('renames the opencode command shim (B2)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.opencode/command/gate.md'))).toBe(false);
    expect(existsSync(join(dir, '.opencode/command/noldor-gate.md'))).toBe(true);
  });
  it('leaves a consumer-authored homonym skill untouched (B3 data-loss guard)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/skills/promote/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/noldor-promote'))).toBe(false);
  });
  it('leaves consumer-owned docs untouched', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, 'docs/features/mine.md'))).toBe(true);
  });
  it('dryRun reports steps without writing', () => {
    const steps = migration_0_6_0.dryRun(dir, {} as never);
    expect(steps.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.claude/skills/gate'))).toBe(true); // not removed
    expect(existsSync(join(dir, '.claude/skills/noldor-gate'))).toBe(false); // not added
  });
  it('is idempotent on a second apply', () => {
    migration_0_6_0.migrate(dir, {} as never);
    const second = migration_0_6_0.migrate(dir, {} as never);
    expect(second.filter((s) => s.after === '').length).toBe(0); // nothing left to remove
  });
});
```

- [ ] **Step 3: Run both tests, verify FAIL.**
  `pnpm vitest run src/migrations/__tests__/0.5.0.test.ts src/migrations/__tests__/0.6.0.test.ts`
  Expected: cannot resolve `../0.5.0.js` / `../0.6.0.js`.

- [ ] **Step 4: Implement the bridge.** Create `src/migrations/0.5.0.ts`:

```ts
import type { Migration } from './types.js';

/** No-op bridge anchor: keeps the chain contiguous for consumers still at 0.4.0
 * when the 0.6.0 skill-rename migration lands. No schema transform at 0.5.0. */
export const migration_0_5_0: Migration = {
  from: '0.4.0',
  to: '0.5.0',
  description: 'bridge anchor — no schema transform',
  dryRun: () => [],
  migrate: () => [],
};
```

- [ ] **Step 5: Implement the 0.6.0 migration.** Create `src/migrations/0.6.0.ts`:

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_ROOT, templateFiles } from '../templates/manifest.js';
import { copyTemplate } from '../templates/copy.js';
import type { Migration, MigrationStep } from './types.js';

// Intentionally independent of `prefix-skills-codemod.ts`'s NAMES: that codemod is
// a one-shot dev tool (may be deleted after this rename lands), whereas this
// migration ships forever — coupling a permanent migration to a throwaway module's
// export would be worse than duplicating a fixed 9-item list.
const OLD_SKILL_DIRS = [
  'gate',
  'garden',
  'triage',
  'promote',
  'milestone',
  'new-feature',
  'draft-feature-md',
  'refactor',
  'release-sweep',
];

/** Template files under a given repo-relative dir prefix. */
function templatesUnder(prefix: string): string[] {
  return templateFiles().filter((p) => p.startsWith(prefix));
}

/**
 * Record adds/updates for `rel` against the consumer. When `apply`, copy from
 * templates (update:true — a framework twin the consumer never edits); otherwise
 * classify by byte-compare without writing. Unchanged files are omitted.
 */
function syncFiles(cwd: string, rel: string[], apply: boolean, steps: MigrationStep[]): void {
  if (apply) {
    for (const e of copyTemplate(TEMPLATES_ROOT, cwd, rel, { update: true })) {
      if (e.status === 'unchanged') continue;
      steps.push({ path: e.path, before: e.status === 'added' ? '' : '(prior)', after: '(template)' });
    }
  } else {
    for (const p of rel) {
      const dest = join(cwd, p);
      if (!existsSync(dest)) steps.push({ path: p, before: '', after: '(template)' });
      else if (!readFileSync(join(TEMPLATES_ROOT, p)).equals(readFileSync(dest)))
        steps.push({ path: p, before: '(prior)', after: '(template)' });
    }
  }
}

/**
 * True iff the consumer's old `.claude/skills/<name>` is noldor's vendored twin:
 * a `SKILL.md` whose frontmatter `name:` is the bare skill name (noldor's
 * pre-rename convention). Guards against silently deleting a consumer-authored
 * homonymous or hand-customized skill that happens to sit at the same path — the
 * very collision this FD exists to surface (B3).
 */
function isNoldorVendoredSkill(cwd: string, name: string): boolean {
  const md = join(cwd, '.claude/skills', name, 'SKILL.md');
  if (!existsSync(md)) return false;
  return new RegExp(`^name: ${name}$`, 'm').test(readFileSync(md, 'utf8'));
}

/**
 * True-rename semantics: for EACH of the 9 skills the consumer ACTUALLY vendored,
 * install its `noldor-` counterpart from templates and remove the old — for BOTH
 * runner surfaces: the Claude skill dir `.claude/skills/<name>/` (guarded by
 * isNoldorVendoredSkill) and the opencode command shim `.opencode/command/<name>.md`
 * (only some skills have one, e.g. `gate`; scoped by template-counterpart presence).
 * A consumer that never had a surface for a skill — e.g. a codex-only repo, or an
 * opencode repo without a given command — gets nothing for it: no old ⇒ no new, so
 * agent/subset scoping is respected without reading config. docs/noldor twins
 * (agent-agnostic framework docs) are refreshed unconditionally so vendored pages
 * stop instructing bare `/gate`; unchanged pages sha-match and are skipped.
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const name of OLD_SKILL_DIRS) {
    // Claude skill dir — guarded rename.
    const oldDir = join(cwd, '.claude/skills', name);
    if (existsSync(oldDir)) {
      if (isNoldorVendoredSkill(cwd, name)) {
        syncFiles(cwd, templatesUnder(`.claude/skills/noldor-${name}/`), apply, steps);
        steps.push({ path: `.claude/skills/${name}/`, before: '(dir)', after: '' });
        if (apply) rmSync(oldDir, { recursive: true, force: true });
      } else {
        // Consumer-owned homonym: leave untouched, surface in the report.
        steps.push({
          path: `.claude/skills/${name}/`,
          before: '(consumer-owned, left as-is)',
          after: '(consumer-owned, left as-is)',
        });
      }
    }
    // Opencode command shim — scoped by whether a template counterpart exists.
    const oldCmd = join(cwd, '.opencode/command', `${name}.md`);
    const tplCmd = templatesUnder(`.opencode/command/noldor-${name}.md`);
    if (existsSync(oldCmd) && tplCmd.length > 0) {
      syncFiles(cwd, tplCmd, apply, steps);
      steps.push({ path: `.opencode/command/${name}.md`, before: '(file)', after: '' });
      if (apply) rmSync(oldCmd, { force: true });
    }
  }
  syncFiles(cwd, templatesUnder('docs/noldor/'), apply, steps);
  return steps;
}

/** Rename each vendored framework skill to `noldor-*` in a consumer tree. */
export const migration_0_6_0: Migration = {
  from: '0.5.0',
  to: '0.6.0',
  description:
    'rename vendored framework skills to noldor-* (per-skill install prefixed + remove old, only for skills the consumer had) + refresh docs/noldor twins',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
```

- [ ] **Step 6: Register in `src/migrations/registry.ts`.** Replace the file body with:

```ts
import type { Migration } from './types.js';
import { migration_0_4_0 } from './0.4.0.js';
import { migration_0_5_0 } from './0.5.0.js';
import { migration_0_6_0 } from './0.6.0.js';

/**
 * Every shipped migration, in any order (the engine sorts by `to`). Each new
 * consumer-facing schema change adds an entry here in the same PR.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration_0_4_0,
  migration_0_5_0,
  migration_0_6_0,
];
```

- [ ] **Step 7: Run both migration tests, verify PASS.**
  `pnpm vitest run src/migrations/__tests__/0.5.0.test.ts src/migrations/__tests__/0.6.0.test.ts`
  Expected: green. (The 0.6.0 test relies on `TEMPLATES_ROOT` resolving to this repo's `templates/` — which now holds the renamed `noldor-*` skill dirs after Task 3, so `templateRelPaths()` returns them.)

- [ ] **Step 8: Commit.**

```bash
git add src/migrations/0.5.0.ts src/migrations/0.6.0.ts src/migrations/registry.ts src/migrations/__tests__/0.5.0.test.ts src/migrations/__tests__/0.6.0.test.ts
git commit -m "feat(migrations): 0.6.0 renames vendored skills to noldor- (0.5.0 bridge)" -m "Noldor-FD: prefix-skills-with-noldor"
```

---

## Task 8: Full verify + FD link wiring

**Files:**
- Modify: `docs/features/prefix-skills-with-noldor.md` (frontmatter `links.code` / `links.tests`)

- [ ] **Step 1: Full verify.**
  `pnpm verify`
  Expected: typecheck + all suites + validators green. Fix any straggler: a test or doc validator still referencing a bare skill name, or a `dist`-vs-`src` skew (`pnpm build` if the CLI shim complains).

- [ ] **Step 2: Wire FD links.** Set `links.code` to the primary new/changed source and `links.tests` to the new tests in `docs/features/prefix-skills-with-noldor.md` frontmatter:

```yaml
links:
  code:
    - src/core/prefix-skills-codemod.ts
    - src/migrations/0.6.0.ts
    - src/migrations/0.5.0.ts
    - src/autonomous/gate-prompt.ts
    - src/core/allowlist.ts
  tests:
    - src/core/__tests__/prefix-skills-codemod.test.ts
    - src/migrations/__tests__/0.6.0.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-10-prefix-skills-with-noldor-design.md
```

- [ ] **Step 3: Validate + commit.**
  `pnpm noldor validate features`
  Expected: `all OK`.

```bash
git add docs/features/prefix-skills-with-noldor.md
git commit -m "docs(features:prefix-skills-with-noldor): wire links.code/tests" -m "Noldor-FD: prefix-skills-with-noldor"
```

- [ ] **Step 4: Final acceptance sweep.** Confirm all spec acceptance criteria:
  - `pnpm noldor validate skill-catalog` → exit 0.
  - `pnpm exec tsx src/core/prefix-skills-codemod.ts` → `applied: 0 file(s) touched`.
  - Anchored scoped grep (Task 3 Step 5) → zero hits.
  - `pnpm exec tsx -e "import {buildDrainGatePrompt} from './src/autonomous/gate-prompt.ts'; console.log(buildDrainGatePrompt('x','slash-command'))"` → `/noldor-gate --drain x`.
  - `pnpm verify` → green.
