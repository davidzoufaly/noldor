# De-Superpowers: Vendor Spec, Plan and Worktree Flows Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Remove every load-bearing reference to the third-party `superpowers` Claude Code plugin from the framework's spec, plan, and worktree flows by vendoring them as noldor-owned skills and CLI commands.

**Architecture:** Single-source the spec/plan format contracts as exported consts in `src/prep/formats.ts`, printable anywhere via a new `noldor prep format <kind>` CLI command; vendor the brainstorming and writing-plans dialog disciplines as two new thin skills (`noldor-spec`, `noldor-plan`) that reference the printed contracts; replace the worktree-creation skill with a `noldor worktrees create <slug>` command that absorbs the known lefthook-postinstall failure; then sweep all 56 colon-form `superpowers:` references across skills, twins, and `docs/noldor/`.

**Tech Stack:** TypeScript (node:child_process, node:fs), vitest, existing `src/cli/manifest.ts` router, lefthook pre-commit validators (skill-catalog, template-sync, shared-files).

**Spec delta (mechanical):** `worktrees create` gains an optional `--branch <name>` flag (default `feat/<slug>`) — the gate's `fast-track` path names branches `fast/<short-desc>`, which the spec's fixed `feat/` naming could not serve.

---

## File Structure

- `src/prep/formats.ts` — NEW: `SPEC_FORMAT` + `PLAN_FORMAT` exported consts (single source).
- `src/prep/draft.ts` — MODIFY: delete local consts, import from `formats.js`.
- `src/prep/print-format.ts` — NEW: `noldor prep format <spec|plan>` entrypoint.
- `src/prep/__tests__/formats.test.ts` — NEW: const content + no-superpowers regression + draft-prompt propagation.
- `src/prep/__tests__/print-format.test.ts` — NEW: kind dispatch + exit codes.
- `src/worktrees/create-worktree.ts` — NEW: `noldor worktrees create` entrypoint + `createWorktree()` (DI install runner).
- `src/worktrees/__tests__/create-worktree.test.ts` — NEW: fixture-repo tests.
- `src/cli/manifest.ts` — MODIFY: register `prep format` + `worktrees create`.
- `.claude/skills/noldor-spec/SKILL.md` + `templates/.claude/skills/noldor-spec/SKILL.md` — NEW: vendored spec dialog.
- `.claude/skills/noldor-plan/SKILL.md` + `templates/.claude/skills/noldor-plan/SKILL.md` — NEW: vendored plan discipline.
- `docs/noldor/skill-catalog.md` + `templates/docs/noldor/skill-catalog.md` — MODIFY: +2 entries, count 9→11, line-38 swap.
- `.claude/skills/gate/SKILL.md` + twin — MODIFY: 11 colon-form lines swapped.
- `.claude/skills/draft-feature-md/SKILL.md` + twin — MODIFY: 2 swaps.
- `.claude/engineering-rules.md` + twin — MODIFY: 1 swap.
- `docs/noldor/{complexity-gating,workflow,lifecycle,pr-flow,worktree-discipline}.md` + twins — MODIFY: prose sweep + new command row + lefthook claim fix.

---

### Task 1: Format contract single source (`formats.ts`)

**Files:**
- Create: `src/prep/formats.ts`
- Create: `src/prep/__tests__/formats.test.ts`
- Modify: `src/prep/draft.ts:1-24`

- [x] **Step 1: Write the failing test**

Create `src/prep/__tests__/formats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildDraftPrompt } from '../draft.js';
import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';

import type { PrepEntry } from '../types.js';

const entry: PrepEntry = {
  slug: 'foo-bar',
  name: 'Foo Bar',
  size: 'L',
  tier: 'full',
  area: 'tooling',
  parent: null,
  deps: [],
  body: 'Does a thing.',
};

describe('SPEC_FORMAT', () => {
  it('carries the required section contract', () => {
    expect(SPEC_FORMAT).toContain('# <Human Name> — Design');
    expect(SPEC_FORMAT).toContain('## Problem / ## Goals / ## Non-goals');
    expect(SPEC_FORMAT).toContain('## Open questions (resolved)');
    expect(SPEC_FORMAT).toContain('## User Story (REQUIRED');
  });
});

describe('PLAN_FORMAT', () => {
  it('carries the inline-execution header and TDD contract', () => {
    expect(PLAN_FORMAT).toContain('Execute this plan task-by-task inline');
    expect(PLAN_FORMAT).toContain('Do not delegate execution to a sub-skill or separate executor');
    expect(PLAN_FORMAT).toContain('TDD order per task');
    expect(PLAN_FORMAT).not.toContain('REQUIRED SUB-SKILL');
  });
});

describe('no plugin coupling', () => {
  it('formats carry no superpowers token', () => {
    expect(SPEC_FORMAT + PLAN_FORMAT).not.toMatch(/superpowers/);
  });

  it('built draft prompt carries the new blockquote, no plugin token', () => {
    const prompt = buildDraftPrompt(entry, '2026-06-11', '/tmp/batch');
    expect(prompt).toContain('Execute this plan task-by-task inline');
    expect(prompt).not.toMatch(/superpowers:/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/prep/__tests__/formats.test.ts`
Expected: FAIL — `Cannot find module '../formats.js'`

- [x] **Step 3: Create `src/prep/formats.ts`**

```ts
/**
 * Canonical spec/plan format contracts — the single source consumed by the
 * prep drafting prompts (`draft.ts` imports the consts), the vendored
 * `noldor-spec` / `noldor-plan` skills, and any agent in any repo via
 * `pnpm noldor prep format <spec|plan>` (see `print-format.ts`).
 */

export const SPEC_FORMAT = [
  'SPEC FORMAT (mirror the modern Noldor convention):',
  '- H1: "# <Human Name> — Design"',
  '- metadata block (bold lines) after H1: **Slug:**, **FD:** docs/features/<slug>.md, **Date:** <today>, **Tier:** <tier>, **Deps:** if any',
  '- ## Problem / ## Goals / ## Non-goals',
  '- ## Design (named units; reference the REAL files/functions you read — no hand-waving)',
  '- ## Acceptance criteria (testable bullets) / ## Risks / trade-offs',
  '- ## User Story (REQUIRED — "As a <user/agent>, I want <action>, so that <outcome>." The promote step lifts this verbatim into the FD.)',
  '- ## Usage (REQUIRED — CLI steps / agent API / keyboard surface. Lifted into the FD too.)',
  '- ## Open questions (resolved) (REQUIRED — numbered; for EACH open question state it in italics, then "-> <your recommended answer>" + a one-line rationale (D1),(D2)... You ANSWER your own questions so the operator ratifies, not originates.)',
].join('\n');

export const PLAN_FORMAT = [
  'PLAN FORMAT (full tier only):',
  '- H1: "# <Feature Name> Implementation Plan"',
  '- blockquote: "> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task\'s Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor."',
  '- **Goal:** / **Architecture:** / **Tech Stack:** lines, then a --- rule',
  '- ## File Structure (one bullet per touched file: path — responsibility), then --- ',
  '- ## Task N: <name> blocks; each: **Files:** (Create:/Modify:/Test: exact paths) then "- [ ] **Step N: <imperative>**".',
  '- TDD order per task: failing test -> run-to-verify-FAIL -> implement -> run-to-verify-PASS -> Commit (fenced bash: git add <paths> ; git commit -m "<conventional-commit>" -m "Noldor-FD: <slug>").',
  '- Each step = ONE 2-5 min action; code steps show COMPLETE real code; command steps show the exact command + Expected output. NO placeholders.',
].join('\n');
```

- [x] **Step 4: Refit `src/prep/draft.ts`**

Replace lines 1-24 (the import + both local consts) with:

```ts
import { PLAN_FORMAT, SPEC_FORMAT } from './formats.js';

import type { PrepEntry } from './types.js';
```

The rest of the file (from `/** Instruction for one drafting child ... */`) is unchanged — `buildDraftPrompt` already references `SPEC_FORMAT` / `PLAN_FORMAT` by name.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/prep/__tests__/formats.test.ts src/prep/__tests__/scaffold.test.ts`
Expected: PASS (formats new, scaffold untouched)

- [x] **Step 6: Commit**

```bash
git add src/prep/formats.ts src/prep/draft.ts src/prep/__tests__/formats.test.ts
git commit -m "feat(prep): single-source spec/plan format contracts, drop superpowers executor blockquote" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 2: `noldor prep format` print command

**Files:**
- Create: `src/prep/print-format.ts`
- Create: `src/prep/__tests__/print-format.test.ts`
- Modify: `src/cli/manifest.ts:36-45`

- [x] **Step 1: Write the failing test**

Create `src/prep/__tests__/print-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';
import { formatForKind } from '../print-format.js';

describe('formatForKind', () => {
  it('returns SPEC_FORMAT for spec', () => {
    expect(formatForKind('spec')).toBe(SPEC_FORMAT);
  });

  it('returns PLAN_FORMAT for plan', () => {
    expect(formatForKind('plan')).toBe(PLAN_FORMAT);
  });

  it('returns null for unknown kinds', () => {
    expect(formatForKind('bogus')).toBeNull();
    expect(formatForKind('')).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/prep/__tests__/print-format.test.ts`
Expected: FAIL — `Cannot find module '../print-format.js'`

- [x] **Step 3: Create `src/prep/print-format.ts`**

```ts
// noldor prep format <spec|plan> — print the canonical artifact format
// contract. The package-shipped twin of importing `formats.ts`: skills and
// agents in consumer repos (no noldor src/ checkout) read the contract here.

import { PLAN_FORMAT, SPEC_FORMAT } from './formats.js';

/**
 * Resolve a CLI kind argument to its format const.
 *
 * @param kind - Artifact kind from argv (`spec` or `plan`).
 * @returns The format string, or `null` when the kind is unknown.
 */
export function formatForKind(kind: string): string | null {
  if (kind === 'spec') return SPEC_FORMAT;
  if (kind === 'plan') return PLAN_FORMAT;
  return null;
}

function main(): number {
  const kind = process.argv[2];
  const out = kind === undefined ? null : formatForKind(kind);
  if (out === null) {
    process.stderr.write('usage: noldor prep format <spec|plan>\n');
    return 2;
  }
  process.stdout.write(`${out}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
```

- [x] **Step 4: Register in `src/cli/manifest.ts`**

In the `prep` group's `subs` (after the `promote` entry), add:

```ts
      format: {
        src: 'prep/print-format.ts',
        desc: 'Print the canonical spec|plan format contract',
      },
```

- [x] **Step 5: Run test to verify it passes + smoke the CLI**

Run: `pnpm vitest run src/prep/__tests__/print-format.test.ts`
Expected: PASS

Run: `pnpm noldor prep format spec | head -2`
Expected:
```
SPEC FORMAT (mirror the modern Noldor convention):
- H1: "# <Human Name> — Design"
```

Run: `pnpm noldor prep format bogus; echo "exit:$?"`
Expected: `usage: noldor prep format <spec|plan>` then `exit:2` (pnpm may add ELIFECYCLE noise around it)

- [x] **Step 6: Commit**

```bash
git add src/prep/print-format.ts src/prep/__tests__/print-format.test.ts src/cli/manifest.ts
git commit -m "feat(prep): add noldor prep format print command" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 3: `noldor worktrees create` command

**Files:**
- Create: `src/worktrees/create-worktree.ts`
- Create: `src/worktrees/__tests__/create-worktree.test.ts`
- Modify: `src/cli/manifest.ts:202-212`

- [x] **Step 1: Write the failing tests**

Create `src/worktrees/__tests__/create-worktree.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree } from '../create-worktree.js';

import type { InstallRunner } from '../create-worktree.js';

let root: string;

const okInstall: InstallRunner = vi.fn(async () => ({ code: 0, output: '' }));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cwt-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  git(['commit', '--allow-empty', '-m', 'init'], root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createWorktree', () => {
  it('creates .worktrees/<slug> on feat/<slug> and stamps a port', async () => {
    const res = await createWorktree({ slug: 'my-feature', cwd: root, installRunner: okInstall });
    expect(res.path).toBe(join(root, '.worktrees', 'my-feature'));
    expect(res.branch).toBe('feat/my-feature');
    expect(existsSync(res.path)).toBe(true);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('feat/my-feature');
    const env = await readFile(join(res.path, '.env.local'), 'utf-8');
    expect(env).toMatch(/^PORT=\d+$/m);
    expect(res.installWarning).toBeNull();
  });

  it('honors --branch override', async () => {
    const res = await createWorktree({
      slug: 'quick-fix',
      branch: 'fast/quick-fix',
      cwd: root,
      installRunner: okInstall,
    });
    expect(res.branch).toBe('fast/quick-fix');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('fast/quick-fix');
  });

  it('rejects a non-kebab slug', async () => {
    await expect(createWorktree({ slug: 'Bad_Slug', cwd: root, installRunner: okInstall })).rejects.toThrow(
      /kebab-case/,
    );
  });

  it('rejects an existing worktree dir', async () => {
    await createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall });
    await expect(createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall })).rejects.toThrow(
      /already exists/,
    );
  });

  it('rejects an existing branch', async () => {
    git(['branch', 'feat/taken'], root);
    await expect(createWorktree({ slug: 'taken', cwd: root, installRunner: okInstall })).rejects.toThrow(
      /branch already exists/,
    );
  });

  it('refuses to run from inside a worktree', async () => {
    const first = await createWorktree({ slug: 'outer', cwd: root, installRunner: okInstall });
    await expect(createWorktree({ slug: 'inner', cwd: first.path, installRunner: okInstall })).rejects.toThrow(
      /main workspace/,
    );
  });

  it('tolerates the lefthook hooksPath postinstall failure when node_modules landed', async () => {
    const lefthookFail: InstallRunner = async (cwd) => {
      await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
      return { code: 1, output: "│  core.hooksPath is set locally to '/x/.git/hooks'" };
    };
    const res = await createWorktree({ slug: 'tolerated', cwd: root, installRunner: lefthookFail });
    expect(res.installWarning).toMatch(/lefthook postinstall failed/);
  });

  it('hard-fails any other install failure', async () => {
    const otherFail: InstallRunner = async () => ({ code: 1, output: 'ERR_PNPM_NO_MATCHING_VERSION' });
    await expect(createWorktree({ slug: 'broken', cwd: root, installRunner: otherFail })).rejects.toThrow(
      /pnpm install failed/,
    );
  });

  it('skips install when install: false', async () => {
    const spy = vi.fn(okInstall);
    const res = await createWorktree({ slug: 'restore', cwd: root, install: false, installRunner: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(res.installWarning).toBeNull();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/worktrees/__tests__/create-worktree.test.ts`
Expected: FAIL — `Cannot find module '../create-worktree.js'`

- [x] **Step 3: Create `src/worktrees/create-worktree.ts`**

```ts
// noldor worktrees create <slug> [--branch <name>] [--no-install]
//
// Vendored worktree mechanics from docs/noldor/worktree-discipline.md:
// .worktrees/<slug> on feat/<slug> (or --branch), pnpm install with the
// lefthook-postinstall tolerance, port stamped into .env.local.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { allocatePorts, parseWorktreeList, readPort } from './worktree-status.js';

const execFileP = promisify(execFile);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Signature of the tolerated install failure: lefthook's postinstall refuses
 * to run because `core.hooksPath` already points at the shared `.git/hooks`
 * (set by the main checkout's install). Hooks remain active for the worktree
 * because the configured path is absolute, so the failure is cosmetic.
 */
const LEFTHOOK_HOOKSPATH_RE = /core\.hooksPath is set locally/;

/** Combined exit code + stdout/stderr of one `pnpm install` run. */
export interface InstallResult {
  code: number;
  output: string;
}

/** Injectable install step — tests stub this instead of running pnpm. */
export type InstallRunner = (cwd: string) => Promise<InstallResult>;

/** Options for {@link createWorktree}. */
export interface CreateOptions {
  /** Kebab-case worktree name; directory is `.worktrees/<slug>`. */
  slug: string;
  /** Branch name; defaults to `feat/<slug>` (gate fast-track passes `fast/<desc>`). */
  branch?: string;
  /** Main-workspace root; defaults to `process.cwd()`. */
  cwd?: string;
  /** Run `pnpm install` in the new tree (default true). */
  install?: boolean;
  installRunner?: InstallRunner;
  log?: (line: string) => void;
}

/** Result of {@link createWorktree}. */
export interface CreateResult {
  path: string;
  branch: string;
  port: number | null;
  installWarning: string | null;
}

const defaultInstall: InstallRunner = async (cwd) => {
  try {
    const { stdout, stderr } = await execFileP('pnpm', ['install'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, output: `${e.stdout ?? ''}\n${e.stderr ?? String(err)}` };
  }
};

/**
 * Create `.worktrees/<slug>` on a fresh branch from the main workspace's HEAD,
 * install dependencies (tolerating the known lefthook hooksPath failure), and
 * stamp a dev-server port into the tree's `.env.local`.
 *
 * @param opts - See {@link CreateOptions}.
 * @returns Path, branch, assigned port, and any tolerated-install warning.
 */
export async function createWorktree(opts: CreateOptions): Promise<CreateResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const log = opts.log ?? (() => {});

  if (!SLUG_RE.test(opts.slug)) {
    throw new Error(`invalid slug '${opts.slug}': expected kebab-case ([a-z0-9-])`);
  }
  const branch = opts.branch ?? `feat/${opts.slug}`;

  const gitDir = (await execFileP('git', ['rev-parse', '--git-dir'], { cwd })).stdout.trim();
  const commonDir = (await execFileP('git', ['rev-parse', '--git-common-dir'], { cwd })).stdout.trim();
  if (resolve(cwd, gitDir) !== resolve(cwd, commonDir)) {
    throw new Error('worktrees create must run from the main workspace, not inside a worktree');
  }

  const path = join(cwd, '.worktrees', opts.slug);
  if (existsSync(path)) {
    throw new Error(`worktree already exists: .worktrees/${opts.slug}`);
  }
  const branchExists = await execFileP('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd,
  }).then(
    () => true,
    () => false,
  );
  if (branchExists) {
    throw new Error(`branch already exists: ${branch}`);
  }

  await execFileP('git', ['worktree', 'add', path, '-b', branch], { cwd });
  log(`worktree created: .worktrees/${opts.slug} on ${branch}`);

  let installWarning: string | null = null;
  if (opts.install !== false) {
    const run = opts.installRunner ?? defaultInstall;
    const res = await run(path);
    if (res.code !== 0) {
      const binPopulated = existsSync(join(path, 'node_modules', '.bin'));
      if (binPopulated && LEFTHOOK_HOOKSPATH_RE.test(res.output)) {
        installWarning =
          'lefthook postinstall failed (core.hooksPath already targets the shared .git/hooks) — hooks remain active; continuing';
        log(`warning: ${installWarning}`);
      } else {
        throw new Error(`pnpm install failed in ${path}:\n${res.output}`);
      }
    } else {
      log('dependencies installed');
    }
  }

  const porcelain = (await execFileP('git', ['worktree', 'list', '--porcelain'], { cwd })).stdout;
  const trees = parseWorktreeList(porcelain).filter((t) => resolve(t.path) !== cwd);
  const inputs = await Promise.all(
    trees.map(async (t) => ({ path: t.path, currentPort: await readPort(t.path) })),
  );
  const alloc = await allocatePorts(inputs);
  if (alloc.exhausted) {
    log('warning: port range 5174-5179 exhausted — no PORT stamped');
  }
  const port = await readPort(path);

  return { path, branch, port, installWarning };
}

function parseArgs(argv: string[]): { slug: string | null; branch?: string; install: boolean } {
  let slug: string | null = null;
  let branch: string | undefined;
  let install = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-install') install = false;
    else if (a === '--branch') branch = argv[++i];
    else if (!a.startsWith('-') && slug === null) slug = a;
  }
  return { slug, branch, install };
}

async function main(): Promise<number> {
  const { slug, branch, install } = parseArgs(process.argv.slice(2));
  if (!slug) {
    process.stderr.write('usage: noldor worktrees create <slug> [--branch <name>] [--no-install]\n');
    return 2;
  }
  try {
    const res = await createWorktree({
      slug,
      branch,
      install,
      log: (l) => process.stdout.write(`${l}\n`),
    });
    process.stdout.write(`\nWorktree ready at ${res.path}\n`);
    process.stdout.write(`Branch: ${res.branch}${res.port ? `  Port: ${res.port}` : ''}\n`);
    process.stdout.write('Next: run the baseline test suite from inside the tree.\n');
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
```

- [x] **Step 4: Register in `src/cli/manifest.ts`**

In the `worktrees` group's `subs` (before `status`), add:

```ts
      create: {
        src: 'worktrees/create-worktree.ts',
        desc: 'Create .worktrees/<slug> on feat/<slug> (--branch overrides), install deps, stamp port',
      },
```

Also update the group `desc` from `'Worktree status + launch'` to `'Worktree create + status + launch'`.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/worktrees/__tests__/create-worktree.test.ts`
Expected: PASS (9 tests)

- [x] **Step 6: Run the full worktrees test dir (no regression)**

Run: `pnpm vitest run src/worktrees`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/worktrees/create-worktree.ts src/worktrees/__tests__/create-worktree.test.ts src/cli/manifest.ts
git commit -m "feat(worktrees): add noldor worktrees create with lefthook postinstall tolerance" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 4: `noldor-spec` skill + twin + catalog entry

**Files:**
- Create: `.claude/skills/noldor-spec/SKILL.md`
- Create: `templates/.claude/skills/noldor-spec/SKILL.md` (identical copy)
- Modify: `docs/noldor/skill-catalog.md` (+ entry; count line)
- Modify: `templates/docs/noldor/skill-catalog.md` (same edits)

- [x] **Step 1: Create `.claude/skills/noldor-spec/SKILL.md`**

```markdown
---
name: noldor-spec
description: Dialogue an idea into an approved design spec. Use at the gate's spec stage (specs-only-* and full-* paths) or standalone when exploring a feature idea. Question-first loop; writes the spec per `pnpm noldor prep format spec`.
user_invocable: true
---

# /noldor-spec

Turn an idea into a reviewed design document through collaborative dialogue. No implementation action — no code edits, no scaffolding, no skill chaining — before the operator approves the design. "Simple" tasks get the same treatment; the design may be three sentences, but it gets presented and approved.

## Flow

1. **Ground yourself.** Read `docs/vision.md`, the FD at `docs/features/<slug>.md` when one exists, and the real code, docs, and tests the idea touches. Cite actual file paths and symbols in the design — a spec that references no real code is a failure.
2. **Scope check.** If the request spans multiple independent subsystems, say so before refining details and help decompose; spec the first sub-project only.
3. **Clarify.** Ask questions ONE per message, multiple-choice preferred. Stop when purpose, constraints, and success criteria are clear. Don't re-ask what the roadmap entry or FD body already answers — confirm it instead.
4. **Approaches.** Present 2-3 approaches with trade-offs. Lead with your recommendation and why.
5. **Design in sections.** Present the validated design in sections sized to their complexity; after each section ask whether it looks right before continuing. Cover architecture, units (one purpose each, clear interfaces, independently testable), data flow, error handling, testing. YAGNI ruthlessly.
6. **Write the spec.** Run `pnpm noldor prep format spec` and structure the document exactly per the printed contract. Save to `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` (attach paths: `YYYY-MM-DD-<parent>-<enhancement>-design.md`).
7. **Self-review, fix inline:** placeholder scan (TBD/TODO/vague requirements), internal contradictions, scope (single implementation plan's worth?), ambiguity (a requirement readable two ways → pick one, state it).
8. **Report the artifact path and stop.** The gate owns what happens next (Step 2.5: lint → commit → CR lanes → continue dialog). Do not chain into planning or implementation.

## Rules

- One question per message — never a wall of questions.
- In existing code, follow existing patterns; include targeted improvements only where existing problems affect the work.
- Open questions section: answer your own questions with a recommendation and a one-line rationale; the operator ratifies rather than originates.
- The operator's explicit instructions always override this skill.
```

- [x] **Step 2: Copy to the template twin**

Run: `mkdir -p templates/.claude/skills/noldor-spec && cp .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md`
Expected: silent success

- [x] **Step 3: Add the catalog entry**

In `docs/noldor/skill-catalog.md`: change the intro line `Noldor ships 9 user-invocable skills` → `Noldor ships 10 user-invocable skills` (Task 5 bumps it to 11). After the `## /new-feature` section, insert:

```markdown
## /noldor-spec

- **Trigger:** `/noldor-spec <slug>`, or the gate's spec stage on every `specs-only-*` / `full-*` path.
- **Inputs:** kebab-case slug; roadmap entry / FD body for grounding; `docs/vision.md`; the real code the idea touches; the format contract via `pnpm noldor prep format spec`.
- **Outputs:** self-reviewed spec at `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` (attach naming: `<parent>-<enhancement>`); reports the path and stops — `/gate` Step 2.5 owns commit + CR. Never commits.
- **When to use:** the spec stage of any gated feature, or standalone design exploration. Vendored replacement for the third-party brainstorming flow — no plugin required.
```

Apply the same two edits to `templates/docs/noldor/skill-catalog.md`.

- [x] **Step 4: Validate**

Run: `pnpm noldor validate skill-catalog`
Expected: exit 0, no missing-slug complaints

- [x] **Step 5: Commit (shared-files override — skills + catalog are shared roots)**

```bash
git add .claude/skills/noldor-spec templates/.claude/skills/noldor-spec docs/noldor/skill-catalog.md templates/docs/noldor/skill-catalog.md
NOLDOR_ALLOW_SHARED=1 git commit -m "feat(skills): vendor noldor-spec dialog skill" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 5: `noldor-plan` skill + twin + catalog entry

**Files:**
- Create: `.claude/skills/noldor-plan/SKILL.md`
- Create: `templates/.claude/skills/noldor-plan/SKILL.md` (identical copy)
- Modify: `docs/noldor/skill-catalog.md` (+ entry; count line 10→11; line-38 swap)
- Modify: `templates/docs/noldor/skill-catalog.md` (same edits)

- [x] **Step 1: Create `.claude/skills/noldor-plan/SKILL.md`**

```markdown
---
name: noldor-plan
description: Decompose an approved spec into a bite-size TDD implementation plan. Use at the gate's plan stage (full-* paths) or standalone for any multi-step work with a written spec. Writes the plan per `pnpm noldor prep format plan`.
user_invocable: true
---

# /noldor-plan

Write an implementation plan for an engineer with zero context for this codebase and questionable taste: every file to touch, complete code, exact commands, expected output. Assume a skilled developer who knows almost nothing about this toolset or problem domain. DRY. YAGNI. TDD. Frequent commits.

## Flow

1. **Read the spec** (latest `docs/superpowers/specs/*-<slug>-design.md`) and every file it names. If the spec spans multiple independent subsystems, flag it — one plan per subsystem, each producing working testable software on its own.
2. **File structure first.** Before tasks, map which files are created/modified and each one's single responsibility — this locks decomposition. Follow the codebase's existing patterns; prefer small focused files.
3. **Format contract.** Run `pnpm noldor prep format plan` and structure the document exactly per the printed contract, header blockquote included verbatim.
4. **Tasks.** Each task: a **Files:** block (Create:/Modify:/Test: exact paths), then checkbox steps. One step = one 2-5 minute action. TDD order: write the failing test → run to verify FAIL (exact command + expected output) → implement → run to verify PASS → commit (fenced bash with a conventional-commit subject and the `Noldor-FD: <slug>` trailer).
5. **Self-review against the spec, fix inline:** every spec requirement maps to a task (add tasks for gaps); zero placeholders; types, signatures, and names consistent across tasks.
6. **Save** to `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`, report the path, and stop. The gate owns sequencing (Step 2.5 `--kind plan`: lint → commit → CR lanes).

## Plan failures — never write these

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" without the actual test code
- "Similar to Task N" — repeat the code; tasks are read out of order
- A code step without the complete code
- References to types, functions, or methods no task defines

## Rules

- Exact file paths always; exact commands with expected output in every run step.
- The operator's explicit instructions always override this skill.
```

- [x] **Step 2: Copy to the template twin**

Run: `mkdir -p templates/.claude/skills/noldor-plan && cp .claude/skills/noldor-plan/SKILL.md templates/.claude/skills/noldor-plan/SKILL.md`
Expected: silent success

- [x] **Step 3: Catalog entry + count + line-38 swap**

In `docs/noldor/skill-catalog.md`:

a. `Noldor ships 10 user-invocable skills` → `Noldor ships 11 user-invocable skills`
b. After the `## /noldor-spec` section, insert:

```markdown
## /noldor-plan

- **Trigger:** `/noldor-plan <slug>`, or the gate's plan stage on `full-*` paths after spec approval.
- **Inputs:** approved spec at `docs/superpowers/specs/*-<slug>-design.md`; every file the spec names; the format contract via `pnpm noldor prep format plan`.
- **Outputs:** bite-size TDD plan at `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` — complete code, exact commands, expected output per step; reports the path and stops — `/gate` Step 2.5 (`--kind plan`) owns commit + CR. Never commits.
- **When to use:** the plan stage of `full-*` paths, or any multi-step work with a written spec. Vendored replacement for the third-party writing-plans flow — no plugin required.
```

c. Line 38 (in `## /draft-feature-md` → When to use): `before invoking `superpowers:writing-plans`` → `before invoking `noldor-plan``

Apply the same three edits to `templates/docs/noldor/skill-catalog.md`.

- [x] **Step 4: Validate**

Run: `pnpm noldor validate skill-catalog && grep -c "superpowers:" docs/noldor/skill-catalog.md; echo ok`
Expected: validator exit 0; grep prints `0` (grep itself exits 1 on zero matches — the trailing `echo ok` confirms the shell continued)

- [x] **Step 5: Commit**

```bash
git add .claude/skills/noldor-plan templates/.claude/skills/noldor-plan docs/noldor/skill-catalog.md templates/docs/noldor/skill-catalog.md
NOLDOR_ALLOW_SHARED=1 git commit -m "feat(skills): vendor noldor-plan TDD-plan skill" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 6: Gate SKILL.md sweep (11 lines) + twin

**Files:**
- Modify: `.claude/skills/gate/SKILL.md` (lines 62, 63, 64, 65, 66, 121, 151, 235, 237, 281, 292)
- Modify: `templates/.claude/skills/gate/SKILL.md` (identical line set)

- [x] **Step 1: Apply the 11 line edits to `.claude/skills/gate/SKILL.md`**

Per-line replacements (old token → new text; the rest of each line stays):

1. L62 (`fast-track`): `Invoke \`superpowers:using-git-worktrees\`.` → `Create the worktree via \`pnpm noldor worktrees create <short-desc> --branch fast/<short-desc>\`.`
2. L63 (`specs-only-new`): `**Create the worktree first** via \`superpowers:using-git-worktrees\` (\`.worktrees/<slug>\`, branch \`feat/<slug>\`); run \`pnpm install\` inside the new worktree per \`docs/noldor/worktree-discipline.md\`.` → `**Create the worktree first** via \`pnpm noldor worktrees create <slug>\` (creates \`.worktrees/<slug>\` on \`feat/<slug>\` and runs the install; see \`docs/noldor/worktree-discipline.md\`).` AND `Then \`superpowers:brainstorming\` to produce the spec` → `Then the \`noldor-spec\` skill to produce the spec`
3. L64 (`specs-only-attach`): `\`superpowers:brainstorming\` writing spec named` → `\`noldor-spec\` writing spec named`
4. L65 (`full-new`): same worktree swap as L63; `Then \`superpowers:brainstorming\` to produce the spec.` → `Then the \`noldor-spec\` skill to produce the spec.`; `Then \`superpowers:writing-plans\`.` → `Then the \`noldor-plan\` skill.`
5. L66 (`full-attach`): `\`superpowers:brainstorming\` writing spec named` → `\`noldor-spec\` writing spec named`; `continue: \`superpowers:writing-plans\`.` → `continue: the \`noldor-plan\` skill.`
6. L121 (lane list): `\`subagent\` — \`superpowers:code-reviewer\` subagent over the artifact diff` → `\`subagent\` — senior-reviewer subagent over the artifact diff (self-contained \`claude -p\` prompt, \`src/cr/lanes/subagent-dispatch.ts\`)`
7. L151: `+ \`superpowers:writing-plans\` +` → `+ the \`noldor-plan\` skill +`
8. L235: `Earlier revisions of this step invoked \`superpowers:requesting-code-review\` directly` → `Earlier revisions of this step invoked an interactive review skill directly`
9. L237: `(do NOT call \`superpowers:finishing-a-development-branch\` — it's interactive and this flow is autonomous by design)` → `(no interactive finishing skill — the cleanup below is scripted and autonomous by design)`
10. L281: `Do **NOT** invoke \`superpowers:brainstorming\` or \`superpowers:writing-plans\`` → `Do **NOT** invoke \`noldor-spec\` or \`noldor-plan\``
11. L292: `Do not invoke \`superpowers:subagent-driven-development\` or \`superpowers:executing-plans\` — both have between-task / between-batch checkpoint prompts that bypass autonomous mode.` → `Do not delegate execution to a plan-executor skill — checkpoint prompts between tasks/batches would bypass autonomous mode.`

- [x] **Step 2: Mirror all 11 edits into `templates/.claude/skills/gate/SKILL.md`**

The twin's line numbers may differ slightly; locate each by the same old-token grep. After editing:

Run: `diff <(grep -c "superpowers:" .claude/skills/gate/SKILL.md || true) <(grep -c "superpowers:" templates/.claude/skills/gate/SKILL.md || true)`
Expected: no diff output (both 0)

- [x] **Step 3: Verify zero + template sync**

Run: `grep -n "superpowers:" .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md; echo "exit:$?"`
Expected: `exit:1` (no matches)

Run: `pnpm noldor checks template-sync`
Expected: exit 0

- [x] **Step 4: Commit**

```bash
git add .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(gate): swap superpowers flow references to noldor-owned skills and CLI" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 7: Remaining prose sweep + worktree-discipline corrections

**Files:**
- Modify: `.claude/skills/draft-feature-md/SKILL.md:24,97` + twin
- Modify: `.claude/engineering-rules.md:169` + twin
- Modify: `docs/noldor/complexity-gating.md:21,83,113,117` + twin
- Modify: `docs/noldor/workflow.md:38` + twin
- Modify: `docs/noldor/lifecycle.md:29,38,44,70` + twin
- Modify: `docs/noldor/pr-flow.md:14` + twin
- Modify: `docs/noldor/worktree-discipline.md:49,51` + command table + twin

- [x] **Step 1: draft-feature-md (both copies)**

- L24: `Author one via \`superpowers:brainstorming\`,` → `Author one via the \`noldor-spec\` skill,`
- L97: `**After a spec is approved** in \`superpowers:brainstorming\`, before invoking \`writing-plans\`.` → `**After a spec is approved** via \`noldor-spec\`, before invoking \`noldor-plan\`.`

- [x] **Step 2: engineering-rules (both copies)**

- L169: `When dispatching an implementer subagent to execute a plan task (e.g. \`superpowers:subagent-driven-development\`), append` → `When dispatching an implementer subagent to execute a plan task, append`

- [x] **Step 3: complexity-gating (both copies)**

- L21: `produced by \`superpowers:brainstorming\`` → `produced by the \`noldor-spec\` skill`; `whether \`superpowers:writing-plans\` runs after the spec` → `whether \`noldor-plan\` runs after the spec`
- L83: `once after \`superpowers:brainstorming\` (spec, \`kind=spec\`) and again after \`superpowers:writing-plans\` (plan, \`kind=plan\`)` → `once after \`noldor-spec\` (spec, \`kind=spec\`) and again after \`noldor-plan\` (plan, \`kind=plan\`)`
- L113: `creates a worktree, and launches \`superpowers:brainstorming\`` → `creates a worktree (\`pnpm noldor worktrees create\`), and launches \`noldor-spec\``
- L117: same swap as L113, plus `then \`superpowers:writing-plans\` builds the plan` → `then \`noldor-plan\` builds the plan`

- [x] **Step 4: workflow (both copies)**

- L38: `After a spec is approved (via \`superpowers:brainstorming\`)` → `After a spec is approved (via \`noldor-spec\`)`; later in the same bullet `before invoking writing-plans` → `before invoking noldor-plan`
- L56: `**Before executing a superpowers spec, check its length.**` → `**Before executing a spec, check its length.**`

- [x] **Step 5: lifecycle (both copies)**

- L29: `(superpowers:brainstorming)` → `(noldor-spec)`
- L38: `(superpowers:writing-plans)` → `(noldor-plan)`
- L44: `(superpowers:requesting-code-review)` → `(noldor cr orchestrate --kind code)`
- L70: `After \`superpowers:finishing-a-development-branch\` returns (\`/gate\` Step 4 complete),` → `After \`/gate\` Step 4's scripted cleanup completes,`
- L81 (lifecycle-stages table, Spec row): `superpowers brainstorming skill (skipped when complexity verdict = \`skip-brainstorm\`)` → `\`noldor-spec\` skill (skipped when complexity verdict = \`skip-brainstorm\`)`
- L82 (Plan row): `superpowers writing-plans skill` → `\`noldor-plan\` skill`

- [x] **Step 6: pr-flow (both copies)**

- L14: `├─ Claude review (superpowers:requesting-code-review) — address inline, no retry cap` → `├─ Claude review (noldor cr orchestrate --kind code, subagent lane) — address inline, no retry cap`

- [x] **Step 7: worktree-discipline (both copies)**

a. Command table (after the `git worktree add` row) — insert:

```markdown
| `pnpm noldor worktrees create <name>`               | Vendored creation: `.worktrees/<name>` on `feat/<name>` (`--branch` overrides, `--no-install` skips deps), install with lefthook tolerance, port stamped. |
```

b. L49: `populates its own \`node_modules\` and re-installs lefthook hooks via \`postinstall\`.` → `populates its own \`node_modules\`; the lefthook \`postinstall\` step exits non-zero in a worktree (\`core.hooksPath\` already targets the shared \`.git/hooks\`) — hooks remain active anyway, and \`pnpm noldor worktrees create\` runs the install tolerating exactly that failure.` AND `[\`/gate\`](../../.claude/skills/gate/SKILL.md) and the \`superpowers:using-git-worktrees\` skill it invokes already run the install as part of Step 3 (Project Setup)` → `[\`/gate\`](../../.claude/skills/gate/SKILL.md) runs \`pnpm noldor worktrees create\`, which performs the install`

c. L51: `\`superpowers:subagent-driven-development\` is for _executing_ an already-written plan with independent tasks inside one tree, not for the upstream design phases` → `plan execution is inline work for the controlling session (per the plan header), not for the upstream design phases`

d. L51 (same bullet, earlier clause): `The template tells each fresh session to read its feature MD and run \`/brainstorm <slug>\`.` → `The template tells each fresh session to read its feature MD and run \`/noldor-spec <slug>\`.` (Note: `.claude/launch-prompt.md` itself is not git-tracked — pre-existing condition, out of scope.)

e. `src/core/__tests__/allowlist.test.ts:95` test title: `it('admits superpowers plans + specs', () => {` → `it('admits design plans + specs under docs/superpowers/', () => {` (path-prose stays valid; the bare space-form word leaves the audit pattern). Then run: `pnpm vitest run src/core/__tests__/allowlist.test.ts` — Expected: PASS.

- [x] **Step 8: Verify zero across the whole acceptance scope (one catch-all audit)**

Run: `grep -rniE "superpowers:|superpowers [a-z-]+|/brainstorm\b" .claude/skills templates/.claude templates/docs src docs/noldor .claude/engineering-rules.md; echo "exit:$?"`
Expected: `exit:1` (zero hits — colon-form invocations, space-form names like "superpowers spec", and the `/brainstorm` slash command; `docs/superpowers/` path tokens match none of the three alternations, so they stay legal with no exclusion filter)

Run: `pnpm noldor checks template-sync && pnpm noldor validate skill-catalog`
Expected: both exit 0

- [x] **Step 9: Commit**

```bash
git add .claude/skills/draft-feature-md .claude/engineering-rules.md templates/.claude docs/noldor templates/docs/noldor src/core/__tests__/allowlist.test.ts
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor): sweep remaining superpowers references, correct worktree install claim" -m "Noldor-FD: de-superpowers-vendor-spec-plan-and-worktree-flows"
```

### Task 8: Acceptance verification (no commit unless drift)

**Files:** none (verification only)

- [x] **Step 1: Acceptance grep (catch-all audit)**

Run: `grep -rniE "superpowers:|superpowers [a-z-]+|/brainstorm\b" .claude/skills templates/.claude templates/docs src docs/noldor .claude/engineering-rules.md; echo "exit:$?"`
Expected: `exit:1`

- [x] **Step 2: CLI smokes**

Run: `pnpm noldor prep format spec >/dev/null && pnpm noldor prep format plan >/dev/null && echo ok`
Expected: `ok`

- [x] **Step 3: Full test suite**

Run: `pnpm test`
Expected: all files pass (baseline 171 files / 1825 tests + 3 new files)

- [x] **Step 4: Validator chain**

Run: `pnpm noldor validate features && pnpm noldor validate skill-catalog && pnpm noldor checks template-sync && pnpm noldor checks invariants`
Expected: all exit 0

- [x] **Step 5: Tick all plan checkboxes** (this file) and proceed to gate Step 4 (FD refresh, phase flip, code-stage CR, PR flow).
