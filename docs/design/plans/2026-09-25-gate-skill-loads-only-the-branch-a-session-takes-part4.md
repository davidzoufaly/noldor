# Gate Skill Loads Only the Branch a Session Takes Implementation Plan — Part 4: router integrity

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor checks skill-portability` refuses a shipped skill whose `**Read now:**` link names a missing file, or whose folder holds a markdown file no read-now chain from `SKILL.md` reaches; and tests show `checks template-sync`, the skill-code-drift detector and `checks skill-portability` each covering a branch file.

**Architecture:**
- **One new file.** `src/checks/skill-router.ts` walks each shipped skill folder (one with a `templates/` twin, the same scope rule the portability check already uses), follows read-now links breadth-first from `SKILL.md`, and reports `missing-branch-file` and `unreachable-branch-file`. It reuses the drift detector's `collectSkillMd` and its `MD_LINK_RE`, exported here, instead of a second walk and a second copy of the regex.
- **The blocking check calls it.** `check-skill-portability.ts` reports router findings beside non-portable scripts; its lefthook job already fires on every `.claude/skills/**` change. Plain links stay the drift detector's advisory job.
- **Coverage, pinned.** `templateFiles()` and `collectSkillMd` already recurse with no name filter, so the three coverage tests pass on their first run; they exist so a future name filter cannot quietly drop branch files.
- **Patches.** Every `~~~diff` block applies with `git apply` from the repo root: save it to a file and run `git apply <file>`.

**Tech Stack:** TypeScript, vitest.

**Parts:** 4 of 4.

**Spec:** [`2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md) — § Router integrity; acceptance criteria 8–9 and 13.

---

## File Structure

- `src/garden/detectors/skill-code-drift.ts` — **Modify.** Export `MD_LINK_RE`.
- `src/checks/skill-router.ts` — **Create.** Read-now link and reachability rules for shipped skill folders.
- `src/checks/__tests__/skill-router.test.ts` — **Create.** Finding shapes, both directions of the reachability rule.
- `src/checks/check-skill-portability.ts` — **Modify.** Block on router findings too.
- `src/checks/__tests__/check-skill-portability.test.ts` — **Modify.** Exit codes for routers and a branch file's command block.
- `src/checks/__tests__/check-template-sync.test.ts`, `src/garden/detectors/__tests__/skill-code-drift.test.ts` — **Modify.** Branch-file coverage.

---

## Task 10: Refuse a broken router

**Files:**
- Create: `src/checks/skill-router.ts`
- Modify: `src/checks/check-skill-portability.ts`, `src/garden/detectors/skill-code-drift.ts`
- Test: `src/checks/__tests__/skill-router.test.ts`, `src/checks/__tests__/check-skill-portability.test.ts`

- [x] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file src/checks/skill-router.ts --file src/checks/check-skill-portability.ts --file src/checks/__tests__/skill-router.test.ts --stage code`

- [x] **Step 2: Write the failing tests.** Create `src/checks/__tests__/skill-router.test.ts`:

  ```ts
  // @tests: gate-skill-loads-only-the-branch-a-session-takes
  import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { dirname, join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  import { checkSkillRouters } from '../skill-router.js';

  function repoWith(files: Record<string, string>): { dir: string; [Symbol.dispose](): void } {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-skill-router-'));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body, 'utf8');
    }
    return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
  }

  /** A shipped `demo` skill folder: every file written under `.claude/skills/` and as its `templates/` twin. */
  function shippedDemo(
    files: Record<string, string>,
    extra: Record<string, string> = {},
  ): ReturnType<typeof repoWith> {
    const all: Record<string, string> = { ...extra };
    for (const [name, body] of Object.entries(files)) {
      all[`.claude/skills/demo/${name}`] = body;
      all[`templates/.claude/skills/demo/${name}`] = body;
    }
    return repoWith(all);
  }

  describe('checkSkillRouters', () => {
    it('names a read-now link whose file does not exist, with its line', () => {
      using repo = shippedDemo({
        'SKILL.md': '# demo\n\n**Read now:** [`fork.md`](fork.md) — on a fork\n',
      });
      expect(checkSkillRouters(repo.dir)).toEqual([
        {
          skillPath: '.claude/skills/demo/SKILL.md',
          line: 3,
          kind: 'missing-branch-file',
          detail:
            'read-now link `fork.md` resolves to `.claude/skills/demo/fork.md`, which does not exist',
        },
      ]);
    });

    it('names a branch file that no read-now link reaches', () => {
      using repo = shippedDemo({ 'SKILL.md': '# demo\n', 'orphan.md': 'rules nobody reads\n' });
      expect(checkSkillRouters(repo.dir)).toEqual([
        {
          skillPath: '.claude/skills/demo/orphan.md',
          line: 1,
          kind: 'unreachable-branch-file',
          detail:
            'no chain of **Read now:** links from .claude/skills/demo/SKILL.md reaches this file',
        },
      ]);
    });

    it('still reports a branch file that only a plain link reaches', () => {
      using repo = shippedDemo({ 'SKILL.md': 'See [the fork](fork.md).\n', 'fork.md': 'rules\n' });
      expect(checkSkillRouters(repo.dir).map((f) => f.kind)).toEqual(['unreachable-branch-file']);
    });

    it('accepts a chain of read-now links through a second branch file', () => {
      using repo = shippedDemo({
        'SKILL.md': '**Read now:** [`a.md`](a.md)\n',
        'a.md': '**Read now:** [`b.md`](b.md) — on red\n',
        'b.md': 'the end\n',
      });
      expect(checkSkillRouters(repo.dir)).toEqual([]);
    });

    it('accepts a read-now link out of the folder to a repo page that exists', () => {
      using repo = shippedDemo(
        {
          'SKILL.md':
            '**Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md)\n',
        },
        { 'docs/noldor/drain-mode.md': '# Drain Mode\n' },
      );
      expect(checkSkillRouters(repo.dir)).toEqual([]);
    });

    it('ignores a placeholder link that only shows the line shape, and a URL', () => {
      using repo = shippedDemo({
        'SKILL.md':
          'A fork carries **Read now:** [`<file>`](<file>).\n**Read now:** [spec](https://example.com/x.md)\n',
      });
      expect(checkSkillRouters(repo.dir)).toEqual([]);
    });

    it('leaves a consumer skill with no templates/ twin alone', () => {
      using repo = repoWith({
        '.claude/skills/team/SKILL.md': '**Read now:** [`gone.md`](gone.md)\n',
        '.claude/skills/team/orphan.md': 'x\n',
      });
      expect(checkSkillRouters(repo.dir)).toEqual([]);
    });
  });
  ```

  And apply this change to `src/checks/__tests__/check-skill-portability.test.ts`:

~~~diff
diff --git a/src/checks/__tests__/check-skill-portability.test.ts b/src/checks/__tests__/check-skill-portability.test.ts
index ef2960f..2b890a5 100644
--- a/src/checks/__tests__/check-skill-portability.test.ts
+++ b/src/checks/__tests__/check-skill-portability.test.ts
@@ -61,2 +61,51 @@ describe('checks skill-portability', () => {
   });
 });
+
+describe('checks skill-portability — branch files and routers', () => {
+  const FORK = '.claude/skills/demo/fork.md';
+  const ROUTER = '**Read now:** [`fork.md`](fork.md)\n';
+
+  it('refuses a non-portable command block in a branch file beside SKILL.md', async () => {
+    const fork = '```bash\npnpm verify\n```\n';
+    const repo = fixtureRepo(
+      { verify: 'x' },
+      {
+        [SKILL]: ROUTER,
+        [`templates/${SKILL}`]: ROUTER,
+        [FORK]: fork,
+        [`templates/${FORK}`]: fork,
+      },
+    );
+    expect(await main(repo)).toBe(1);
+  });
+
+  it('refuses a shipped router whose read-now link names a missing file', async () => {
+    expect(await main(shippedSkillRepo(ROUTER))).toBe(1);
+  });
+
+  it('refuses a shipped branch file no read-now link reaches', async () => {
+    const repo = fixtureRepo(
+      {},
+      {
+        [SKILL]: '# demo\n',
+        [`templates/${SKILL}`]: '# demo\n',
+        [FORK]: 'x\n',
+        [`templates/${FORK}`]: 'x\n',
+      },
+    );
+    expect(await main(repo)).toBe(1);
+  });
+
+  it('accepts a shipped router whose every read-now link resolves', async () => {
+    const repo = fixtureRepo(
+      {},
+      {
+        [SKILL]: ROUTER,
+        [`templates/${SKILL}`]: ROUTER,
+        [FORK]: 'x\n',
+        [`templates/${FORK}`]: 'x\n',
+      },
+    );
+    expect(await main(repo)).toBe(0);
+  });
+});
~~~

- [x] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/checks/__tests__/skill-router.test.ts src/checks/__tests__/check-skill-portability.test.ts`

  Expected: `skill-router.test.ts` fails to load `../skill-router.js`; in `check-skill-portability.test.ts` the missing-file and unreachable-file cases fail (`expected 0 to be 1`), while the branch-file command block and the all-resolved router already pass.

- [x] **Step 4: Export the detector's link regex.** Apply this change to `src/garden/detectors/skill-code-drift.ts`:

~~~diff
diff --git a/src/garden/detectors/skill-code-drift.ts b/src/garden/detectors/skill-code-drift.ts
index 2e4df8e..d271b34 100644
--- a/src/garden/detectors/skill-code-drift.ts
+++ b/src/garden/detectors/skill-code-drift.ts
@@ -99,3 +99,4 @@ const NOLDOR_CMD_RE = /\bnoldor\s+([a-z-]+)(?:\s+([a-z][a-z0-9:-]*))?/g;
 const INLINE_CODE_RE = /`([^`]+)`/g;
-const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
+/** A markdown link; group 1 is its target. */
+export const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
 
~~~

- [x] **Step 5: Implement the rules.** Create `src/checks/skill-router.ts`:

  ```ts
  // @fd: gate-skill-loads-only-the-branch-a-session-takes
  import { existsSync, readFileSync, readdirSync } from 'node:fs';
  import { dirname, join, relative, resolve, sep } from 'node:path';

  import { MD_LINK_RE, collectSkillMd } from '../garden/detectors/skill-code-drift.js';

  /** The marker a router line carries when it hands the session to a branch file. */
  export const READ_NOW_MARKER = '**Read now:**';

  /** A read-now link that points nowhere, or a branch file no read-now chain reaches. */
  export interface SkillRouterFinding {
    /** Repo-relative path of the skill markdown file the finding is about. */
    readonly skillPath: string;
    /** 1-based line of the read-now link, or 1 for an unreachable file. */
    readonly line: number;
    readonly kind: 'missing-branch-file' | 'unreachable-branch-file';
    readonly detail: string;
  }

  /**
   * Check every shipped skill folder — one whose `SKILL.md` has a `templates/` twin
   * — for a read-now link whose target does not exist, and for a markdown file that
   * no chain of read-now links from `SKILL.md` reaches. A placeholder target
   * (`<file>`) and a URL are not links to check.
   *
   * @param repo - Repository root.
   * @returns Findings sorted by `skillPath`, then `line`.
   */
  export function checkSkillRouters(repo: string): SkillRouterFinding[] {
    const skillsRoot = join(repo, '.claude', 'skills');
    if (!existsSync(skillsRoot)) return [];
    const rel = (abs: string): string => relative(repo, abs).split(sep).join('/');
    const findings: SkillRouterFinding[] = [];
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      const folder = join(skillsRoot, entry.name);
      const router = join(folder, 'SKILL.md');
      const shipped = existsSync(
        join(repo, 'templates', '.claude', 'skills', entry.name, 'SKILL.md'),
      );
      if (!entry.isDirectory() || !existsSync(router) || !shipped) continue;
      const reached = new Set([router]);
      const queue = [router];
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const [i, text] of lines.entries()) {
          if (!text.includes(READ_NOW_MARKER)) continue;
          for (const match of text.matchAll(MD_LINK_RE)) {
            const target = match[1]!.split('#')[0]!;
            if (target === '' || /^<.*>$/.test(target) || /^[a-z]+:/.test(target)) continue;
            const abs = resolve(dirname(file), target);
            if (!existsSync(abs)) {
              findings.push({
                skillPath: rel(file),
                line: i + 1,
                kind: 'missing-branch-file',
                detail: `read-now link \`${target}\` resolves to \`${rel(abs)}\`, which does not exist`,
              });
            } else if (abs.startsWith(folder + sep) && abs.endsWith('.md') && !reached.has(abs)) {
              reached.add(abs);
              queue.push(abs);
            }
          }
        }
      }
      for (const file of collectSkillMd(folder)) {
        if (reached.has(file)) continue;
        findings.push({
          skillPath: rel(file),
          line: 1,
          kind: 'unreachable-branch-file',
          detail: `no chain of ${READ_NOW_MARKER} links from ${rel(router)} reaches this file`,
        });
      }
    }
    return findings.sort((a, b) => a.skillPath.localeCompare(b.skillPath, 'en') || a.line - b.line);
  }
  ```

- [x] **Step 6: Block on them.** Replace `src/checks/check-skill-portability.ts` with:

  ```ts
  // @fd: skill-vs-code-drift-detector
  // Blocking half of the shipped-skill portability rule (Q-0239). The detector in
  // `src/garden/detectors/skill-code-drift.ts` finds the same rows, but garden is
  // advisory by construction — its findings are `action: 'investigate'` and are
  // read at gardening time. That is how four repo-only command blocks survived in
  // `noldor-release-sweep` until an operator hit them mid-release of a consumer.
  // A skill is shipped source: the gate for it belongs on the commit that writes
  // it, not on a pass somebody remembers to run.
  //
  // Two things block. `non-portable-script` is invisible here by definition: it
  // works in every run of every test in this repo. A broken router is the other
  // (`skill-router.ts`): a read-now link to a missing file, or a branch file no
  // read-now chain reaches, silently drops that branch's rules from every session
  // that takes it. The detector's other classes stay advisory — a missing path or
  // a renamed subcommand is rot the author can see from the repo.
  import { detectSkillCodeDrift, NON_PORTABLE_SCRIPT } from '../garden/detectors/skill-code-drift.js';
  import { runIfDirect } from '../core/cli-entry.js';
  import { checkSkillRouters } from './skill-router.js';

  /**
   * Report every shipped-skill command block that names a script this repo
   * defines but the framework does not install, and every shipped-skill router
   * whose read-now links miss a file or leave one unreachable.
   *
   * @param cwd - Repository root.
   * @returns 0 when every command block runs in a consumer and every router is whole, 1 otherwise.
   */
  export async function main(cwd: string = process.cwd()): Promise<number> {
    const scripts = (await detectSkillCodeDrift(cwd)).filter((f) => f.kind === NON_PORTABLE_SCRIPT);
    const routers = checkSkillRouters(cwd);
    if (scripts.length === 0 && routers.length === 0) {
      console.log(
        'skill-portability: every shipped-skill command block runs in a consumer, and every read-now link resolves',
      );
      return 0;
    }
    if (scripts.length > 0) {
      console.error(
        `✗ ${scripts.length} shipped-skill command block(s) name a script a consumer does not have:`,
      );
      for (const f of scripts) console.error(`    ${f.skillPath}:${f.line} — ${f.detail}`);
    }
    if (routers.length > 0) {
      console.error(`✗ ${routers.length} shipped-skill router finding(s):`);
      for (const f of routers) console.error(`    ${f.skillPath}:${f.line} — ${f.kind}: ${f.detail}`);
    }
    return 1;
  }

  runIfDirect('check-skill-portability', 'checks skill-portability', async () => main());
  ```

- [x] **Step 7: Run to verify PASS.**

  Run: `pnpm vitest run src/checks/__tests__/skill-router.test.ts src/checks/__tests__/check-skill-portability.test.ts`

  Expected: `Tests  18 passed (18)`.

- [x] **Step 8: Run the check on the real gate folder.**

  Run: `pnpm noldor checks skill-portability`

  Expected: exit 0, `skill-portability: every shipped-skill command block runs in a consumer, and every read-now link resolves`.

- [x] **Step 9: Typecheck, lint, format, clones.**

  Run: `pnpm typecheck && pnpm exec oxlint src/checks/skill-router.ts src/checks/check-skill-portability.ts src/checks/__tests__/skill-router.test.ts src/checks/__tests__/check-skill-portability.test.ts src/garden/detectors/skill-code-drift.ts && pnpm noldor fmt src/checks/skill-router.ts src/garden/detectors/skill-code-drift.ts src/checks/check-skill-portability.ts src/checks/__tests__/skill-router.test.ts src/checks/__tests__/check-skill-portability.test.ts && git add -N src/checks/skill-router.ts && pnpm noldor clones check`

  Expected: all exit 0; `clones check: no clone group touches this change - green`.

- [x] **Step 10: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  feat(features:gate-skill-loads-only-the-branch-a-session-takes): refuse a read-now link to a missing branch file or an unreachable one

  checks skill-portability now also walks every shipped skill folder from SKILL.md along its **Read now:** links and blocks on a link whose file does not exist or a markdown file no chain reaches, so a broken fork cannot silently drop a branch's rules from every session that takes it.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/skill-router.ts src/checks/check-skill-portability.ts src/checks/__tests__/skill-router.test.ts src/checks/__tests__/check-skill-portability.test.ts src/garden/detectors/skill-code-drift.ts
  git commit -F "$msg"
  ```

  Expected: the commit lands.

---

## Task 11: Pin branch-file coverage and verify the feature

**Files:**
- Test: `src/checks/__tests__/check-template-sync.test.ts`, `src/garden/detectors/__tests__/skill-code-drift.test.ts`, `src/checks/__tests__/gate-skill-drain-contract.test.ts`

- [ ] **Step 1: Add the coverage tests.** Apply both changes:

~~~diff
diff --git a/src/checks/__tests__/check-template-sync.test.ts b/src/checks/__tests__/check-template-sync.test.ts
index 8687f9c..709ac47 100644
--- a/src/checks/__tests__/check-template-sync.test.ts
+++ b/src/checks/__tests__/check-template-sync.test.ts
@@ -140 +140,40 @@ describe('checkTemplateSync', () => {
 });
+
+describe('checkTemplateSync — branch files beside a skill SKILL.md', () => {
+  it('flags a branch file whose templates/ twin differs, and passes it once they match', () => {
+    const fork = '.claude/skills/demo/fork.md';
+    const drifted = makeRoots(
+      { '.claude/skills/demo/SKILL.md': 'a\n', [fork]: 'b\n' },
+      { '.claude/skills/demo/SKILL.md': 'a\n', [fork]: 'c\n' },
+    );
+    const matched = makeRoots(
+      { '.claude/skills/demo/SKILL.md': 'a\n', [fork]: 'b\n' },
+      { '.claude/skills/demo/SKILL.md': 'a\n', [fork]: 'b\n' },
+    );
+    try {
+      expect(
+        checkTemplateSync({
+          cwd: drifted.cwd,
+          templatesRoot: drifted.templatesRoot,
+          changedFiles: [fork],
+        }),
+      ).toEqual({
+        ok: false,
+        offenders: [{ path: fork, status: 'drifted' }],
+      });
+      expect(
+        checkTemplateSync({
+          cwd: matched.cwd,
+          templatesRoot: matched.templatesRoot,
+          changedFiles: [fork],
+        }),
+      ).toEqual({
+        ok: true,
+        offenders: [],
+      });
+    } finally {
+      drifted.cleanup();
+      matched.cleanup();
+    }
+  });
+});
~~~

~~~diff
diff --git a/src/garden/detectors/__tests__/skill-code-drift.test.ts b/src/garden/detectors/__tests__/skill-code-drift.test.ts
index 1e00fc1..079898b 100644
--- a/src/garden/detectors/__tests__/skill-code-drift.test.ts
+++ b/src/garden/detectors/__tests__/skill-code-drift.test.ts
@@ -275 +275,18 @@ describe('detectSkillCodeDrift — real-tree self-scan', () => {
 });
+
+describe('detectSkillCodeDrift — branch files beside SKILL.md', () => {
+  it('scans a branch file in a skill folder the way it scans SKILL.md', async () => {
+    const fork = '.claude/skills/demo/fork.md';
+    const repo = fixtureRepo({
+      files: { [SKILL]: '# demo\n', [fork]: 'Run `pnpm nope-script`.\n' },
+    });
+    const findings = await detectSkillCodeDrift(repo);
+    expect(findings).toHaveLength(1);
+    expect(findings[0]).toMatchObject({
+      kind: 'pnpm-script',
+      token: 'nope-script',
+      skillPath: fork,
+      line: 1,
+    });
+  });
+});
~~~

- [ ] **Step 2: Drop the Part 2 case that Part 3's parity case covers.** `gate-skill-drain-contract.test.ts` hard-codes the three close-out commands that `gate-skill-layout.test.ts` derives from `fd-close.md` and checks on the Resume path, so the stronger case keeps the contract alone. Apply:

~~~diff
diff --git a/src/checks/__tests__/gate-skill-drain-contract.test.ts b/src/checks/__tests__/gate-skill-drain-contract.test.ts
index f2b3df4..143db36 100644
--- a/src/checks/__tests__/gate-skill-drain-contract.test.ts
+++ b/src/checks/__tests__/gate-skill-drain-contract.test.ts
@@ -44,14 +44,3 @@ describe('the drain contract lives on one page', () => {
     );
   });
-
-  it('the Resume path archives, flips and bootstraps the FD', () => {
-    const resume = section(DRAIN_PAGE, 'Resume path');
-    for (const command of [
-      'pnpm noldor design archive',
-      'pnpm noldor features phase-flip-done',
-      'pnpm noldor cr bootstrap',
-    ]) {
-      expect(resume).toContain(command);
-    }
-  });
 });
~~~

- [ ] **Step 3: Run them.**

  Run: `pnpm vitest run src/checks/__tests__/check-template-sync.test.ts src/garden/detectors/__tests__/skill-code-drift.test.ts src/checks/__tests__/gate-skill-drain-contract.test.ts src/checks/__tests__/gate-skill-layout.test.ts`

  Expected: all four files pass on the first run — the new coverage cases pin behavior that already exists (see Architecture), and the layout test's parity case still guards the Resume path. To see them bite, temporarily add `&& entry.name === 'SKILL.md'` to the `.md` test in `collectSkillMd` (`src/garden/detectors/skill-code-drift.ts`), re-run, watch the drift case fail, and revert the edit.

- [ ] **Step 4: Verify everything.**

  Run: `pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test && pnpm noldor skill-size check && pnpm noldor checks skill-portability && pnpm noldor checks template-sync && pnpm noldor checks push-gates`

  Expected: all exit 0 — `checks push-gates` replays the whole pre-push chain, the root `skill-size` job included. `pnpm test` runs `init --update` first, which rewrites `.claude/skills/**` from `templates/` — `git status --short` must still be clean afterwards, proving every twin matches.

- [ ] **Step 5: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  test(features:gate-skill-loads-only-the-branch-a-session-takes): pin branch-file coverage in template-sync and the drift detector

  A branch file beside SKILL.md is drift-checked against its templates/ twin and scanned by the skill-code-drift detector exactly as SKILL.md is; these cases keep a future name filter from dropping it. The drain-contract test drops its Resume-path case, which the layout test's parity case covers.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/__tests__/check-template-sync.test.ts src/garden/detectors/__tests__/skill-code-drift.test.ts src/checks/__tests__/gate-skill-drain-contract.test.ts
  git commit -F "$msg"
  ```

  Expected: the commit lands. Gate Step 4 (end-of-flow) takes over from here.
