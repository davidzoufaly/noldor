# Root README Content Validator Implementation Plan — Part 1: Doc-Surface Reachability

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm noldor checks readme` exists and reports every documentation surface under `docs/` that no link from the root `README.md` reaches.

**Architecture:** A pure evaluator module, `src/docs/readme-content.ts`, holding surface enumeration, the transitive link walk, the surface verdict, and a `checkReadme` façade shaped to the existing `docSurfaceRow` contract. A thin CLI shell in `src/checks/check-readme.ts` turns the report into stdout and an exit code.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, node:fs/promises, `extractLinks` from `src/docs/docs-check.ts`.

**Ships:** a working, registered, tested `checks readme` that catches an unnavigable documentation surface — on this repo, `docs/adr` and `docs/architecture`. Part 2 adds command resolution to the same command; Part 3 wires the call sites.

---

## File Structure

- `src/docs/readme-content.ts` — **Create.** Surface enumeration, reachability walk, surface verdict, and the `checkReadme` façade.
- `src/docs/__tests__/readme-content.test.ts` — **Create.** Unit tests over temp-dir fixture repos.
- `src/checks/check-readme.ts` — **Create.** CLI shell: `main(cwd)` → exit code, `runIfDirect` tail. No evaluation logic.
- `src/checks/__tests__/check-readme.test.ts` — **Create.** Exit-code and rendering tests.
- `src/cli/manifest.ts` — **Modify.** Register `checks readme`.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — **Modify.** The `check:readme` entry. Lands here rather than in Part 3 because the pre-commit `script-catalog` job globs `src/cli/manifest.ts`.

---

## Task 1: Surface enumeration and verdict

**Files:**
- Create: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Write the failing test for `enumerateDocSurfaces` and `unreachableSurfaces`.**

Create `src/docs/__tests__/readme-content.test.ts`:

```ts
// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { enumerateDocSurfaces, unreachableSurfaces } from '../readme-content.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'readme-'));
  roots.push(root);
  return root;
}

async function write(root: string, rel: string, body: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

describe('enumerateDocSurfaces', () => {
  it('returns depth-1 docs dirs holding markdown, sorted', async () => {
    const root = await makeRepo();
    await write(root, 'docs/adr/0001-x.md', '# x');
    await write(root, 'docs/architecture/context.md', '# c');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/adr', 'docs/architecture']);
  });

  it('finds markdown nested any depth down', async () => {
    const root = await makeRepo();
    await write(root, 'docs/user/how-to/index.md', '# h');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/user']);
  });

  it('excludes the artifact dirs and dirs with no markdown', async () => {
    const root = await makeRepo();
    await write(root, 'docs/features/a.md', '# a');
    await write(root, 'docs/design/specs/b.md', '# b');
    await write(root, 'docs/assets/logo.png', 'binary');
    await write(root, 'docs/noldor/README.md', '# n');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/noldor']);
  });

  it('returns empty when docs/ is absent', async () => {
    expect(await enumerateDocSurfaces(await makeRepo())).toEqual([]);
  });
});

describe('unreachableSurfaces', () => {
  const empty = { files: new Set<string>(), dirs: new Set<string>(), notes: [] };

  it('reports a surface nothing reaches', () => {
    expect(unreachableSurfaces(['docs/adr'], empty)).toEqual(['docs/adr']);
  });

  it('a directory-target link satisfies the surface', () => {
    const reached = { ...empty, dirs: new Set(['docs/adr']) };
    expect(unreachableSurfaces(['docs/adr'], reached)).toEqual([]);
  });

  it('a markdown file at any depth beneath satisfies the surface', () => {
    const reached = { ...empty, files: new Set(['docs/user/how-to/index.md']) };
    expect(unreachableSurfaces(['docs/user'], reached)).toEqual([]);
  });

  it('a sibling prefix match does not satisfy the surface', () => {
    const reached = { ...empty, files: new Set(['docs/adr-notes/x.md']) };
    expect(unreachableSurfaces(['docs/adr'], reached)).toEqual(['docs/adr']);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: the run fails to collect the file, reporting that `../readme-content.js` cannot be resolved (the module does not exist yet).

- [ ] **Step 3: Create `src/docs/readme-content.ts` with the two units.**

```ts
// @fd: root-readme-content-validator
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Directories one level under `docs/` that hold per-change workflow artifacts —
 * one file per feature, spec or plan — rather than pages a reader navigates.
 *
 * An explicit constant, deliberately NOT derived from `loadDocRoots()`: that
 * accessor also names `adr`, `architecture` and `milestones`, so deriving from
 * it would exclude the very surfaces this check exists to catch. `docs/assets`
 * needs no entry — it holds no markdown, so the predicate below drops it.
 */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set(['features', 'design']);

/** True when `dir` holds at least one `.md` at any depth. */
async function hasMarkdown(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (await hasMarkdown(join(dir, entry.name))) return true;
    } else if (entry.name.endsWith('.md')) {
      return true;
    }
  }
  return false;
}

/**
 * Every documentation surface: a directory one level under `docs/` that holds
 * markdown and is not an artifact directory. Auto-enrolling by construction —
 * a new surface needs no registration to be checked.
 *
 * @param cwd - Repository root
 * @returns Repo-relative POSIX dirs, sorted
 */
export async function enumerateDocSurfaces(cwd: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(join(cwd, 'docs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (ARTIFACT_DIRS.has(entry.name)) continue;
    if (await hasMarkdown(join(cwd, 'docs', entry.name))) out.push(`docs/${entry.name}`);
  }
  return out.toSorted();
}

/** What the README link graph reaches. */
export interface ReachSet {
  /**
   * Repo-relative POSIX paths of every reached **markdown** file. Non-markdown
   * targets are never recorded: they cannot satisfy a documentation surface and
   * are not traversed, so keeping them would let an image link mark a surface
   * reachable.
   */
  readonly files: ReadonlySet<string>;
  /** Dirs reached directly by a directory-target link. */
  readonly dirs: ReadonlySet<string>;
  /** Operational degradations encountered during the walk. Never findings. */
  readonly notes: readonly string[];
}

/**
 * Surfaces no README link reaches. A surface is satisfied by a direct
 * directory link, or by any reached markdown file at or beneath it.
 *
 * @param surfaces - From {@link enumerateDocSurfaces}
 * @param reached - From `reachableTargets`
 * @returns The unreachable subset, input order preserved
 */
export function unreachableSurfaces(
  surfaces: readonly string[],
  reached: ReachSet,
): readonly string[] {
  return surfaces.filter((surface) => {
    if (reached.dirs.has(surface)) return false;
    for (const file of reached.files) {
      if (file === surface || file.startsWith(`${surface}/`)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: `Test Files  1 passed (1)` with 8 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): add doc-surface enumeration and reachability verdict" -m "Noldor-FD: root-readme-content-validator"
```

---

## Task 2: Reachability walk

**Files:**
- Modify: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Append the failing tests for `reachableTargets`.**

Add to `src/docs/__tests__/readme-content.test.ts` — extend the import to `import { enumerateDocSurfaces, reachableTargets, unreachableSurfaces } from '../readme-content.js';` and append:

```ts
describe('reachableTargets', () => {
  it('follows a multi-hop route and terminates on a cycle', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[hub](docs/noldor/README.md)');
    await write(root, 'docs/noldor/README.md', '[t](triage.md) [back](../../README.md)');
    await write(root, 'docs/noldor/triage.md', '[h](../user/how-to/index.md)');
    await write(root, 'docs/user/how-to/index.md', '# how-to');
    const reached = await reachableTargets(root);
    expect(reached.files.has('docs/user/how-to/index.md')).toBe(true);
    expect(reached.notes).toEqual([]);
  });

  it('records a directory target in dirs and does not descend', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[adrs](docs/adr/)');
    await write(root, 'docs/adr/0001-x.md', '# x');
    const reached = await reachableTargets(root);
    expect([...reached.dirs]).toEqual(['docs/adr']);
    expect(reached.files.has('docs/adr/0001-x.md')).toBe(false);
  });

  it('ignores prose backticks, and strips fragments and queries', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', 'see `docs/adr/` then [a](docs/architecture/context.md#top)');
    await write(root, 'docs/architecture/context.md', '# c');
    const reached = await reachableTargets(root);
    expect(reached.dirs.size).toBe(0);
    expect(reached.files.has('docs/architecture/context.md')).toBe(true);
  });

  it('does not record a non-markdown target', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '![logo](docs/assets/logo.png)');
    await write(root, 'docs/assets/logo.png', 'binary');
    const reached = await reachableTargets(root);
    expect(reached.files.size).toBe(0);
    expect(reached.dirs.size).toBe(0);
  });

  it('notes a malformed percent-escape instead of throwing', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[bad](docs/a%zz.md)');
    const reached = await reachableTargets(root);
    expect(reached.notes).toHaveLength(1);
    expect(reached.notes[0]).toContain('malformed percent-escape');
  });

  it('is silent on a broken link and drops a repo-escaping target', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[gone](docs/nope.md) [out](../escape.md)');
    const reached = await reachableTargets(root);
    expect(reached.files.size).toBe(0);
    expect(reached.notes).toEqual([]);
  });

  it('returns an empty set when README.md is absent', async () => {
    const reached = await reachableTargets(await makeRepo());
    expect(reached.files.size).toBe(0);
    expect(reached.notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: the file fails to collect with `reachableTargets is not exported by ../readme-content.js` (or an equivalent import error); the eight Task 1 tests do not run.

- [ ] **Step 3: Add `reachableTargets` to `src/docs/readme-content.ts`.**

Add the imports this unit needs — `lstat` and `readFile` from `node:fs/promises`, `dirname` and `resolve` from `node:path`, `import { toPosixRelative } from '../core/repo-paths.js';` and `import { extractLinks } from './docs-check.js';`. `toPosixRelative` is the shared helper both sibling doc-surface modules already use (`src/docs/docs-adr.ts:7`, `src/docs/docs-architecture.ts:6`); its own docstring records that it was hoisted when the reviewer flagged the per-module copies, so re-inlining one would re-trip the clone ratchet. Then append:

```ts
/**
 * Every markdown file and directory the README link graph reaches, to a
 * fixpoint over a visited set so link cycles terminate.
 *
 * Eligibility is whatever {@link extractLinks} yields — it already strips code
 * regions and drops external and root-absolute hrefs, so this check's notion of
 * "a link" is identical to the one `docs check` enforces. That matters: the
 * surfaces this check exists to catch are named in the rule pages only inside
 * prose backticks, and counting those would make the check green while the
 * reader still has no route.
 *
 * Every failure is contained: a broken link is `docs check`'s finding and is
 * skipped silently, and every other error becomes a note. Nothing throws.
 *
 * @param cwd - Repository root
 * @returns Reached markdown files, directly-linked dirs, and any degradations
 */
export async function reachableTargets(cwd: string): Promise<ReachSet> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const notes: string[] = [];

  let seed: string;
  try {
    seed = await readFile(join(cwd, 'README.md'), 'utf8');
  } catch {
    return { files, dirs, notes };
  }

  const bodies = new Map<string, string>([['README.md', seed]]);
  const visited = new Set<string>(['README.md']);
  const queue: string[] = ['README.md'];

  while (queue.length > 0) {
    const from = queue.shift() as string;
    const body = bodies.get(from);
    if (body === undefined) continue;

    for (const link of extractLinks(body)) {
      const withoutFragment = link.href.split('#')[0] ?? '';
      const bare = withoutFragment.split('?')[0] ?? '';
      if (bare === '') continue;

      let decoded: string;
      try {
        decoded = decodeURIComponent(bare);
      } catch {
        // URIError, not a filesystem error — it would otherwise escape the
        // handling below and crash the walk this contract exists to protect.
        notes.push(`${from}:${link.line}: malformed percent-escape in ${bare} — link skipped`);
        continue;
      }

      const abs = resolve(join(cwd, dirname(from)), decoded);
      const target = toPosixRelative(cwd, abs);
      if (target === '' || target.startsWith('..')) continue; // escapes the repo root

      let stats;
      try {
        stats = await lstat(abs);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // ENOENT is a broken link — `docs check`'s finding, not this one's.
        if (code !== 'ENOENT') {
          notes.push(`${from}:${link.line}: cannot stat ${target}: ${code ?? 'unknown'}`);
        }
        continue;
      }

      if (stats.isSymbolicLink()) continue; // not followed
      if (stats.isDirectory()) {
        dirs.add(target);
        continue;
      }
      if (!target.endsWith('.md')) continue; // cannot satisfy a surface

      files.add(target);
      if (visited.has(target)) continue;
      visited.add(target);
      try {
        bodies.set(target, await readFile(abs, 'utf8'));
        queue.push(target);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        notes.push(`${from}:${link.line}: cannot read ${target}: ${code ?? 'unknown'}`);
      }
    }
  }

  return { files, dirs, notes };
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: `Test Files  1 passed (1)` with 15 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): add the README reachability walk" -m "Noldor-FD: root-readme-content-validator"
```

---

---

## Task 3: The `checkReadme` façade (surface half)

**Files:**
- Modify: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Append the failing tests for `checkReadme`.**

Extend the import to include `checkReadme` and append:

```ts
describe('checkReadme', () => {
  it('is absent when there is no README', async () => {
    const report = await checkReadme(await makeRepo());
    expect(report.status).toBe('absent');
    expect(report.findings).toEqual([]);
  });

  it('is ok when every surface is reached', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[a](docs/adr/)');
    await write(root, 'docs/adr/0001-x.md', '# x');
    const report = await checkReadme(root);
    expect(report.status).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('reports an unreached surface', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', 'nothing linked');
    await write(root, 'docs/architecture/context.md', '# c');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('docs/architecture');
  });

  it('surfaces walk notes without changing status', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[bad](docs/a%zz.md)');
    const report = await checkReadme(root);
    expect(report.notes).toHaveLength(1);
    expect(report.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: collection fails on the missing `checkReadme` export.

- [ ] **Step 3: Add the façade to `src/docs/readme-content.ts`.**

Append:

```ts
export type ReadmeStatus = 'absent' | 'ok' | 'findings';

/** One thing the README claims, or fails to say, that does not hold. */
export interface Finding {
  readonly message: string;
}

/** What `checks readme` found, shaped for both the CLI and `docSurfaceRow`. */
export interface ReadmeReport {
  readonly status: ReadmeStatus;
  readonly findings: readonly Finding[];
  /** Degradations: what could not be checked, and why. Never findings. */
  readonly notes: readonly string[];
}

/**
 * Run the README checks over `cwd`.
 *
 * Never rejects for an EXPECTED failure — I/O errors, parse errors and
 * malformed input each degrade to a note and the rest of the check continues.
 * Programmer errors are deliberately not caught: swallowing one would hide a
 * defect behind a green release row. `notes` never affect `status`, so a
 * degraded run reports its degradation rather than masquerading as a failure.
 *
 * @param cwd - Repository root
 * @returns The report; `absent` when there is no readable README
 */
export async function checkReadme(cwd: string = process.cwd()): Promise<ReadmeReport> {
  try {
    await readFile(join(cwd, 'README.md'), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      status: 'absent',
      findings: [],
      notes: code === 'ENOENT' ? [] : [`cannot read README.md: ${code ?? 'unknown'}`],
    };
  }

  const reached = await reachableTargets(cwd);
  const findings = unreachableSurfaces(await enumerateDocSurfaces(cwd), reached).map(
    (surface) => ({
      message: `${surface}/ holds documentation but no link from README.md reaches it`,
    }),
  );

  return {
    status: findings.length > 0 ? 'findings' : 'ok',
    findings,
    notes: [...reached.notes],
  };
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: `Test Files  1 passed (1)` with 19 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): compose checkReadme over the surface reachability half" -m "Noldor-FD: root-readme-content-validator"
```

---

## Task 4: CLI shell and manifest registration

**Files:**
- Create: `src/checks/check-readme.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/checks/__tests__/check-readme.test.ts`

- [ ] **Step 1: Write the failing test for the shell.**

Create `src/checks/__tests__/check-readme.test.ts`:

```ts
// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../check-readme.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'check-readme-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('main', () => {
  it('exits 0 and says skipped when there is no README', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(await repo({}))).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('skipped');
  });

  it('exits 0 on a clean repo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': '[a](docs/adr/)', 'docs/adr/0001-x.md': '# x' });
    expect(await main(root)).toBe(0);
  });

  it('exits 1 and prints each finding', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': 'no links', 'docs/architecture/context.md': '# c' });
    expect(await main(root)).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('docs/architecture');
  });

  it('prints notes prefixed and keeps exit 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': '[bad](docs/a%zz.md)' });
    expect(await main(root)).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('note:');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/checks/__tests__/check-readme.test.ts
```

Expected output: collection fails — `../check-readme.js` cannot be resolved.

- [ ] **Step 3: Create `src/checks/check-readme.ts`.**

```ts
// @fd: root-readme-content-validator
// CLI wrapper for the README content checks. Advisory or blocking is the
// CALLER's choice: the pre-push job neutralizes the exit code with `|| true`,
// and release preflight renders the row at `warn`. This binary only reports.

import { runIfDirect } from '../core/cli-entry.js';
import { checkReadme } from '../docs/readme-content.js';

export async function main(cwd: string = process.cwd()): Promise<number> {
  const report = await checkReadme(cwd);
  if (report.status === 'absent') {
    console.log('readme: skipped (no readable README.md)');
    for (const note of report.notes) console.log(`note: ${note}`);
    return 0;
  }
  for (const finding of report.findings) console.log(finding.message);
  for (const note of report.notes) console.log(`note: ${note}`);
  console.log(`readme: ${report.findings.length} finding(s)`);
  return report.findings.length > 0 ? 1 : 0;
}

runIfDirect('check-readme', 'checks readme', async () => main());
```

- [ ] **Step 4: Register the subcommand in `src/cli/manifest.ts`.**

In the `checks` group's `subs`, after the `'ui-design-freshness'` entry, add:

```ts
      readme: {
        src: 'checks/check-readme.ts',
        desc: 'README command + doc-surface link checks; exit 1 on findings — callers choose whether that blocks',
      },
```

- [ ] **Step 5: Document the new entrypoint in `docs/noldor/script-catalog.md`, and mirror the twin.**

This cannot wait for Part 3: the pre-commit `script-catalog` job globs `src/cli/manifest.ts` (`lefthook/noldor.yml:86-88`), so the Step 4 registration makes Step 8's commit fail until the catalog cites the new source. After the `### \`check:ui-design-freshness\`` block, insert:

```markdown
### `check:readme`

- **Trigger:** `pnpm noldor checks readme`. Run advisorily by the `pre-push` hook (`|| true`) and by release preflight (`warn`, never blocking).
- **Inputs:** root `README.md`, the CLI manifest via `flattenManifest()`, root `package.json` `scripts`, and every directory one level under `docs/` holding markdown.
- **Outputs:** one line per unresolved command (`pnpm noldor <group> <sub>` against the manifest, `pnpm run <name>` and `pnpm <script>` against root scripts) and one per documentation surface no README link reaches. Operational degradations print as `note:` lines and never change the exit code. Exit 0 clean or when there is no readable README, 1 on findings — callers choose whether that blocks.
- **When to use:** after adding a CLI subcommand quoted in the README, or after adding a `docs/<dir>/` surface. Repair by editing `README.md`.
- **Source:** [`src/checks/check-readme.ts`](../../src/checks/check-readme.ts)
```

Then mirror it:

```bash
cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
diff docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md && echo IDENTICAL
```

Expected output: `IDENTICAL`.

- [ ] **Step 6: Verify the catalog and template gates.**

```bash
node bin/noldor.mjs validate script-catalog && node bin/noldor.mjs checks template-sync
```

Expected output: both exit 0.

- [ ] **Step 7: Run the test to verify it PASSES.**

```bash
npx vitest run src/checks/__tests__/check-readme.test.ts && npx tsc --noEmit
```

Expected output: `Test Files  1 passed (1)` with 4 passing tests, then `tsc` prints nothing.

- [ ] **Step 8: Run the check against this repository to see the real findings.**

```bash
node bin/noldor.mjs checks readme
```

Expected output: exit 1, with a line naming `docs/adr` and a line naming `docs/architecture` (Task 9 repairs both).

- [ ] **Step 9: Commit.**

```bash
git add src/checks/check-readme.ts src/checks/__tests__/check-readme.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
git commit -m "feat(checks): add the checks readme CLI surface" -m "Noldor-FD: root-readme-content-validator"
```

---
