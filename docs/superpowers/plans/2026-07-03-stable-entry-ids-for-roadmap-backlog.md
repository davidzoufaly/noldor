# Stable Entry IDs for Roadmap + Backlog Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Every roadmap and backlog entry carries a stable short ID (`- id: Q-0042`, first bullet) minted once at triage and never rewritten — surviving heading renames and roadmap ↔ backlog moves. Ships: an `entry-id` module (`ENTRY_ID_RE` + `mintEntryIds` against `.noldor/id-counter.json`), a `pnpm noldor triage mint-id` CLI, parser support (`BacklogEntry.id`), three validator rules (`missing-entry-id` gated on counter-file existence, `malformed-entry-id`, cross-file `duplicate-entry-id`), slug-or-ID `deps:` resolution (`resolveEntryRef` composed into `resolveIsShipped`), an idempotent `backfill-ids` sweep run against THIS repo in-plan, an optional `entry-id` FD-frontmatter field, minting/carry rules in the `/triage`, `/new-feature`, `/promote` skills, and doc updates (both preambles + `docs/noldor/triage.md` + `docs/noldor/feature-md-schema.md`).

**Architecture:** Spec Units 1–7, implemented faithfully (no redesign): Unit 1 → Tasks 1–2 (`src/triage/entry-id.ts`: regex + counter + mint CLI, registered in `src/cli/manifest.ts` — help output derives from `MANIFEST`, so no `help.ts`/`index.ts` edits despite the spec naming them). Unit 2 → Task 3 (`parse-blocks.ts`: `id` in the `parseBlockBody` bullet alternation + threaded through `parseRoadmap`'s push; `parseEntries`' generic `fieldRe` already captures `id` — just map it). Unit 3 → Task 4 (`validate-triage.ts`: `enforceEntryIds` input computed from `existsSync('.noldor/id-counter.json')` in the CLI `main`, so the pure function stays unit-testable). Unit 6 → Task 5 (`resolveEntryRef` in `entry-id.ts`; `resolveIsShipped` finally uses its reserved `roadmapPath`/`backlogPath`). Unit 5 → Task 6 (`backfill-ids.ts` scan/stamp + live run committed). Unit 4 + D2 → Tasks 7–8 (`entry-id` in `FeatureFrontmatterSchema` — regex inlined, NOT imported from `src/triage/`, to keep the schema module dependency-light under the new module boundaries; skill edits + byte-identical template twins). Unit 7 → Task 9 (preambles, two `docs/noldor/` pages + twins, FD links).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100 — run `pnpm fmt` before every commit that stages ts/json), zod, gray-matter, vitest (`pnpm vitest run <path>`, globals on, mkdtemp fixtures — no shared static fixtures are modified). Lefthook gates to expect: `sync test-links` auto-updates + auto-stages FD `links.tests` whenever a `*.test.ts` file is staged (don't fight it); `triage` validate job fires on any commit touching `docs/roadmap.md`/`docs/backlog.md`; commits staging `docs/noldor/*.md` need a `noldor` or `noldor:<slug>` scope; `.claude/skills/**` commits from a `.worktrees/` checkout need `NOLDOR_ALLOW_SHARED=1`; `template-sync` requires skill/doc twins byte-identical in the same commit. Every commit carries the `Noldor-FD: stable-entry-ids-for-roadmap-backlog` trailer. In worktree sessions use worktree-absolute paths for every edit.

**Drain sequencing (read before Task 7):** This plan executes LAST (fifth) in the 2026-07-03 five-plan drain. An earlier plan in the same drain (`self-boundaries-declaration-and-cycle-break`) moves `src/features/feature-schema.ts` → `src/core/feature-schema.ts`. Task 7 therefore resolves the schema's location by grep at execution time — check `src/core/feature-schema.ts` first, fall back to `src/features/feature-schema.ts` — and edits it wherever it lives. No other file this plan touches is edited by the earlier plans, EXCEPT `docs/roadmap.md`, whose entry count may have shrunk by the time this runs: the backfill (Task 6) is count-agnostic, so every "stamped N entries" output below is illustrative, not contractual. (Spec's "~25 roadmap + ~7 backlog" is stale — the queue held 6 + 5 entries on 2026-07-04.)

Spec: [docs/superpowers/specs/2026-07-03-stable-entry-ids-for-roadmap-backlog-design.md](../specs/2026-07-03-stable-entry-ids-for-roadmap-backlog-design.md) · FD: [docs/features/stable-entry-ids-for-roadmap-backlog.md](../../features/stable-entry-ids-for-roadmap-backlog.md)

---

## File Structure

- `src/triage/entry-id.ts` — create; `ENTRY_ID_RE`, `mintEntryIds` (counter at `.noldor/id-counter.json`), `resolveEntryRef`, `mint-id` CLI main (spec Units 1, 6)
- `src/triage/__tests__/entry-id.test.ts` — create (test); format/mint/CLI/resolveEntryRef suites
- `src/cli/manifest.ts` — modify; `triage mint-id` + `triage backfill-ids` registration (data-only — `help.ts`/`index.ts` derive from `MANIFEST`)
- `src/utils/parse-blocks.ts` — modify; `BacklogEntry.id` + `id` in bullet-field parse for both roadmap and backlog paths (spec Unit 2)
- `src/utils/__tests__/parse-blocks.test.ts` — modify (test); entry-id parse cases
- `src/triage/validate-triage.ts` — modify; `missing-entry-id` / `malformed-entry-id` / `duplicate-entry-id` rules + counter-file gate (spec Unit 3)
- `src/triage/__tests__/validate-triage.test.ts` — modify (test); entry-id rule matrix
- `src/triage/score.ts` — modify; `resolveIsShipped` composes `resolveEntryRef` — `deps:` accepts IDs or slugs (spec Unit 6)
- `src/triage/__tests__/score.test.ts` — modify (test); ID-deps resolution suite (mkdtemp, no shared-fixture edits)
- `src/triage/backfill-ids.ts` — create; `countIdless` + `stampEntryIds` + idempotent sweep CLI (spec Unit 5)
- `src/triage/__tests__/backfill-ids.test.ts` — create (test); stamp/idempotency/fence cases
- `src/core/feature-schema.ts` **or** `src/features/feature-schema.ts` — modify; optional `entry-id` frontmatter field (spec Unit 4/D2; location resolved at execution — see Task 7)
- schema test twin beside the schema (currently `src/features/__tests__/feature-schema.test.ts`) — modify (test)
- `.claude/skills/triage/SKILL.md` + `templates/.claude/skills/triage/SKILL.md` — modify; batch minting + `- id:` first bullet in both block templates (spec Unit 4)
- `.claude/skills/new-feature/SKILL.md` + `templates/.claude/skills/new-feature/SKILL.md` — modify; mint step + `entry-id` frontmatter line
- `.claude/skills/promote/SKILL.md` + `templates/.claude/skills/promote/SKILL.md` — modify; lift `- id:` → `entry-id`
- `docs/roadmap.md`, `docs/backlog.md` — modify; backfill stamps (Task 6) + preamble contract lines (Task 9)
- `.noldor/id-counter.json` — created by the Task 6 live run; committed (verified NOT matched by `.gitignore` — it lists specific `.noldor/` files only, no wildcard)
- `docs/noldor/triage.md` + `templates/docs/noldor/triage.md` — modify; "Stable entry IDs" section (spec Unit 7)
- `docs/noldor/feature-md-schema.md` + `templates/docs/noldor/feature-md-schema.md` — modify; `entry-id` row in the Optional table
- `docs/features/stable-entry-ids-for-roadmap-backlog.md` — modify; `links.code`/`links.docs`/`links.plan` record the touched surfaces

---

## Task 1: Entry-ID module — `ENTRY_ID_RE` + `mintEntryIds`

**Files:**

- Create: `src/triage/entry-id.ts`
- Test: `src/triage/__tests__/entry-id.test.ts`

- [ ] **Step 1: Write the failing format + mint tests**

Create `src/triage/__tests__/entry-id.test.ts`:

```ts
// @tests: stable-entry-ids-for-roadmap-backlog
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENTRY_ID_RE, mintEntryIds } from '../entry-id.js';

describe('ENTRY_ID_RE', () => {
  it.each(['Q-0001', 'Q-0042', 'Q-9999', 'Q-10000'])('accepts %s', (id) => {
    expect(ENTRY_ID_RE.test(id)).toBe(true);
  });

  it.each(['Q-1', 'Q-042', 'R-0042', 'B-0042', 'q-0042', 'Q-0042x', 'slug-like-ref', ''])(
    'rejects %s',
    (id) => {
      expect(ENTRY_ID_RE.test(id)).toBe(false);
    },
  );
});

describe(mintEntryIds, () => {
  let dir: string;
  let counterPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'entry-id-'));
    counterPath = join(dir, '.noldor', 'id-counter.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts at Q-0001 when the counter file is missing and persists the bump', () => {
    expect(mintEntryIds(1, counterPath)).toEqual(['Q-0001']);
    expect(JSON.parse(readFileSync(counterPath, 'utf8'))).toEqual({ next: 2 });
  });

  it('mints count sequential ids from an existing counter', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(counterPath, '{ "next": 33 }\n', 'utf8');
    expect(mintEntryIds(3, counterPath)).toEqual(['Q-0033', 'Q-0034', 'Q-0035']);
    expect(JSON.parse(readFileSync(counterPath, 'utf8'))).toEqual({ next: 36 });
  });

  it('grows width past Q-9999 without a format break', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(counterPath, '{ "next": 9999 }\n', 'utf8');
    const ids = mintEntryIds(2, counterPath);
    expect(ids).toEqual(['Q-9999', 'Q-10000']);
    for (const id of ids) expect(ENTRY_ID_RE.test(id)).toBe(true);
  });

  it('mints nothing and leaves the counter untouched for count <= 0', () => {
    expect(mintEntryIds(0, counterPath)).toEqual([]);
    expect(existsSync(counterPath)).toBe(false);
  });

  it('throws on a malformed counter file instead of minting garbage', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(counterPath, '{ "next": "soon" }\n', 'utf8');
    expect(() => mintEntryIds(1, counterPath)).toThrow(/positive integer/);
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts
```

Expected output: `FAIL` — `Cannot find module '../entry-id.js'` (or equivalent resolve error). Zero tests run.

- [ ] **Step 3: Implement `src/triage/entry-id.ts`**

```ts
// Stable entry IDs for roadmap + backlog entries. An ID (`Q-0042`) is minted
// once at triage time, written as the block's first `- id:` bullet, and never
// rewritten — headings (and therefore slugs) stay renameable. The counter
// persists in `.noldor/id-counter.json`; a parallel-branch mint race surfaces
// as a real git conflict on that file, backstopped by the validator's
// duplicate-entry-id rule.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Stable entry-ID format: single `Q-` namespace (survives roadmap ↔ backlog
 * moves — a per-file prefix would lie after a move), zero-padded to 4 digits,
 * width grows past `Q-9999` without a format break. The feature-frontmatter
 * schema's `entry-id` field mirrors this pattern inline (deliberately not
 * imported — the schema module stays dependency-light).
 */
export const ENTRY_ID_RE = /^Q-\d{4,}$/;

/** Shape of `.noldor/id-counter.json`. */
interface IdCounter {
  next: number;
}

function readCounter(counterPath: string): IdCounter {
  if (!existsSync(counterPath)) return { next: 1 };
  const parsed = JSON.parse(readFileSync(counterPath, 'utf8')) as { next?: unknown };
  if (typeof parsed.next !== 'number' || !Number.isInteger(parsed.next) || parsed.next < 1) {
    throw new Error(`${counterPath}: expected { "next": <positive integer> }`);
  }
  return { next: parsed.next };
}

function formatEntryId(n: number): string {
  return `Q-${String(n).padStart(4, '0')}`;
}

/**
 * Mint `count` sequential entry IDs and persist the bumped counter back to
 * `counterPath` (missing file ⇒ counter starts at 1 — creating the file is a
 * consumer repo's opt-in signal for ID enforcement). Synchronous FS,
 * mirroring `resolveIsShipped`'s style in `score.ts`. `count <= 0` mints
 * nothing and leaves the counter file untouched.
 */
export function mintEntryIds(count: number, counterPath: string): string[] {
  if (count <= 0) return [];
  const counter = readCounter(counterPath);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(formatEntryId(counter.next + i));
  mkdirSync(dirname(counterPath), { recursive: true });
  const bumped = `${JSON.stringify({ next: counter.next + count }, null, 2)}\n`;
  writeFileSync(counterPath, bumped, 'utf8');
  return ids;
}
```

- [ ] **Step 4: Run the test — verify it PASSES**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts
```

Expected output: `Test Files  1 passed` — 17 tests passed (12 format + 5 mint).

- [ ] **Step 5: Commit**

The pre-commit `sync test-links` job will auto-update and auto-stage the FD's `links.tests` because a `*.test.ts` file is staged — expected, let it ride.

```bash
pnpm fmt
git add src/triage/entry-id.ts src/triage/__tests__/entry-id.test.ts
git commit -m "feat(triage): add stable entry-id module (ENTRY_ID_RE + mintEntryIds)" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 2: `noldor triage mint-id` CLI + manifest registration

**IMPORTANT:** never run `pnpm noldor triage mint-id` inside this repo before Task 6's backfill — it would create `.noldor/id-counter.json` early (untracked-file noise for `ensureCleanTree`) and burn IDs. The CLI tests below are hermetic (temp-dir cwd).

**Files:**

- Modify: `src/triage/entry-id.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/triage/__tests__/entry-id.test.ts`

- [ ] **Step 1: Add the failing CLI tests**

In `src/triage/__tests__/entry-id.test.ts`, replace the import block

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENTRY_ID_RE, mintEntryIds } from '../entry-id.js';
```

with

```ts
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENTRY_ID_RE, mintEntryIds } from '../entry-id.js';
```

and append at the end of the file:

```ts
describe('mint-id CLI', () => {
  // src/triage/__tests__/entry-id.test.ts → repo root (four levels up)
  const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');
  const cli = join(repoRoot, 'src', 'triage', 'entry-id.ts');

  it('prints one id per line and writes the counter into cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-cli-'));
    try {
      const out = execSync(`${tsx} ${cli} --count 3`, { cwd: dir, encoding: 'utf8' });
      expect(out).toBe('Q-0001\nQ-0002\nQ-0003\n');
      const counter = JSON.parse(readFileSync(join(dir, '.noldor', 'id-counter.json'), 'utf8'));
      expect(counter).toEqual({ next: 4 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to a single id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-cli-'));
    try {
      expect(execSync(`${tsx} ${cli}`, { cwd: dir, encoding: 'utf8' })).toBe('Q-0001\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 with usage on a non-integer --count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-cli-'));
    let exitCode = 0;
    let stderr = '';
    try {
      execSync(`${tsx} ${cli} --count nope`, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      exitCode = err.status;
      stderr = err.stderr;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/usage/i);
  });
});
```

- [ ] **Step 2: Run the test — verify the CLI suite FAILS**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts
```

Expected output: the 3 `mint-id CLI` tests fail (the module exports nothing executable — stdout is empty), the 17 Task-1 tests still pass.

- [ ] **Step 3: Implement the CLI main in `entry-id.ts`**

Replace the import block

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
```

with

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
```

and append at the end of the file:

```ts
const MINT_USAGE = 'usage: noldor triage mint-id [--count N]\n';

/**
 * CLI: `pnpm noldor triage mint-id [--count N]` (default 1) — print the next
 * N IDs (one per line) and bump `.noldor/id-counter.json` under the current
 * repo. `/triage` and `/new-feature` shell out to this instead of guessing.
 */
function main(argv: readonly string[]): number {
  let count = 1;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const eq = /^--count=(.+)$/.exec(arg);
    if (eq) count = Number(eq[1]);
    else if (arg === '--count') count = Number(args[++i]);
    else {
      process.stderr.write(MINT_USAGE);
      return 2;
    }
  }
  if (!Number.isInteger(count) || count < 1) {
    process.stderr.write(MINT_USAGE);
    return 2;
  }
  const ids = mintEntryIds(count, join(process.cwd(), '.noldor', 'id-counter.json'));
  process.stdout.write(`${ids.join('\n')}\n`);
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  process.exit(main(process.argv));
}
```

- [ ] **Step 4: Register the subcommand in `src/cli/manifest.ts`**

Replace

```ts
      score: { src: 'triage/score.ts', desc: 'Score a backlog entry' },
      'list-untriaged': { src: 'triage/triage-list-untriaged.ts', desc: 'List untriaged ideas' },
      validate: { src: 'triage/validate-triage.ts', desc: 'Validate triage docs' },
```

with

```ts
      score: { src: 'triage/score.ts', desc: 'Score a backlog entry' },
      'list-untriaged': { src: 'triage/triage-list-untriaged.ts', desc: 'List untriaged ideas' },
      'mint-id': {
        src: 'triage/entry-id.ts',
        desc: 'Mint next N stable entry IDs (--count N, default 1); bumps .noldor/id-counter.json',
      },
      validate: { src: 'triage/validate-triage.ts', desc: 'Validate triage docs' },
```

- [ ] **Step 5: Run tests + help — verify PASS**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts
pnpm noldor triage --help
```

Expected output: 20 tests passed; the help listing now shows `mint-id` between `list-untriaged` and `validate` (help derives from `MANIFEST` — no other edit needed). `--help` creates no counter file.

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/triage/entry-id.ts src/triage/__tests__/entry-id.test.ts src/cli/manifest.ts
git commit -m "feat(triage): add noldor triage mint-id subcommand" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 3: Parser support — `id` on `BacklogEntry`

**Files:**

- Modify: `src/utils/parse-blocks.ts`
- Test: `src/utils/__tests__/parse-blocks.test.ts`

- [ ] **Step 1: Add the failing parse tests**

In `src/utils/__tests__/parse-blocks.test.ts`, replace line 1

```ts
// @tests: dashboard-roadmap-drag-drop, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
```

with

```ts
// @tests: dashboard-roadmap-drag-drop, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering, stable-entry-ids-for-roadmap-backlog
```

and append at the end of the file:

```ts
describe('parse-blocks entry ids', () => {
  it('parses the id bullet on a roadmap H4 entry and keeps it out of the description', () => {
    const raw = `### Category

#### Entry

- id: Q-0042
- area: tooling
- type: feat
- since: 2026-07-03
- size: M
- impact: high

Body.
`;
    const [entry] = parseRoadmap(raw);
    expect(entry.id).toBe('Q-0042');
    expect(entry.description).toBe('Body.');
  });

  it('parses the id bullet on a backlog entry and keeps it out of the description', () => {
    const raw = `# Backlog

### Entry

- id: Q-0007
- area: tooling
- type: feat
- since: 2026-07-03

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.id).toBe('Q-0007');
    expect(entry.description).toBe('Body.');
  });

  it('leaves id undefined when the bullet is absent', () => {
    const raw = `### Entry

- area: tooling
- type: feat
- since: 2026-07-03

Body.
`;
    expect(parseBacklog(raw)[0]?.id).toBeUndefined();
    expect(parseRoadmap(raw)[0]?.id).toBeUndefined();
  });

  it('keeps slug as the heading-derived alias, independent of id', () => {
    const raw = `# Backlog

### Cloud Sync

- id: Q-0042
- area: persistence

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.slug).toBe('cloud-sync');
    expect(entry.id).toBe('Q-0042');
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

```bash
pnpm vitest run src/utils/__tests__/parse-blocks.test.ts
```

Expected output: the 4 new tests fail (`entry.id` is `undefined`; roadmap-path `description` still contains `- id: Q-0042` — the alternation doesn't consume it). All pre-existing tests pass.

- [ ] **Step 3: Implement — `BacklogEntry.id` + both parse paths**

In `src/utils/parse-blocks.ts`, make five edits:

(a) In the `BacklogEntry` interface, directly after the `slug: string;` line, insert:

```ts
  /**
   * Stable entry ID from the `- id:` bullet (`Q-0042`) — minted at triage,
   * never rewritten. Survives heading renames and roadmap ↔ backlog moves;
   * `slug` stays the renameable alias. Optional until the backfill sweep
   * (`noldor triage backfill-ids`) has run.
   */
  id?: string;
```

(b) In `parseBlockBody`'s return type, after `area: string;` insert `id?: string;`. In its locals, replace

```ts
  let area = '';
  let type: string | undefined;
```

with

```ts
  let area = '';
  let id: string | undefined;
  let type: string | undefined;
```

(c) Extend the bullet-field alternation — replace

```ts
    const fieldMatch =
      /^-\s+(area|type|since|parent|size|impact|confidence|deps|phase):\s*(.+?)\s*$/.exec(line);
```

with

```ts
    const fieldMatch =
      /^-\s+(id|area|type|since|parent|size|impact|confidence|deps|phase):\s*(.+?)\s*$/.exec(line);
```

and extend the key chain — replace

```ts
      if (key === 'area') area = value;
      else if (key === 'type') type = value;
```

with

```ts
      if (key === 'area') area = value;
      else if (key === 'id') id = value;
      else if (key === 'type') type = value;
```

then add `id,` to `parseBlockBody`'s return object — replace

```ts
    confidence,
    deps,
    impact,
```

with

```ts
    confidence,
    deps,
    id,
    impact,
```

(d) Thread through `parseRoadmap`'s `entries.push` — replace

```ts
      slug: trackSlug(pending.name, `line ${pending.sourceLine}`),
      parent: parsed.parent,
```

with

```ts
      slug: trackSlug(pending.name, `line ${pending.sourceLine}`),
      id: parsed.id,
      parent: parsed.parent,
```

(e) Map it in `parseEntries` (the generic `fieldRe` already captures `id` into `fields` and strips it from `description`) — replace

```ts
      slug: trackSlug(name, `block ${blockIndex}`),
      parent: fields.parent,
```

with

```ts
      slug: trackSlug(name, `block ${blockIndex}`),
      id: fields.id,
      parent: fields.parent,
```

- [ ] **Step 4: Run the test — verify it PASSES**

```bash
pnpm vitest run src/utils/__tests__/parse-blocks.test.ts
```

Expected output: `Test Files  1 passed` — all tests green, including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/utils/parse-blocks.ts src/utils/__tests__/parse-blocks.test.ts
git commit -m "feat(triage): parse stable id bullets on roadmap + backlog entries" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 4: Validator rules — missing / malformed / cross-file duplicate

**Files:**

- Modify: `src/triage/validate-triage.ts`
- Test: `src/triage/__tests__/validate-triage.test.ts`

- [ ] **Step 1: Add the failing rule tests**

In `src/triage/__tests__/validate-triage.test.ts`, replace line 1

```ts
// @tests: replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
```

with

```ts
// @tests: replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering, stable-entry-ids-for-roadmap-backlog
```

and append at the end of the file (self-contained constants — the existing `okRoadmap`/`okBacklog` live in another describe's closure):

```ts
describe('entry-id rules', () => {
  const idlessRoadmap = `### Noldor Framework

#### Entry A

- area: tooling
- type: feat
- since: 2026-07-03
- size: M
- impact: high

Body.
`;
  const idlessBacklog = `# Backlog

### Backlog Entry

- area: tooling
- type: feat
- since: 2026-07-03
- size: S
- impact: med

Body.
`;
  const stampedRoadmap = idlessRoadmap.replace('- area: tooling', '- id: Q-0001\n- area: tooling');
  const stampedBacklog = idlessBacklog.replace('- area: tooling', '- id: Q-0002\n- area: tooling');

  it('stays silent on missing ids while enforceEntryIds is off (adoption-safe default)', () => {
    const result = validateTriageInputs({
      roadmapRaw: idlessRoadmap,
      backlogRaw: idlessBacklog,
      strict: false,
    });
    expect(result.errors).toEqual([]);
  });

  it('errors missing-entry-id on both files when enforceEntryIds is on', () => {
    const result = validateTriageInputs({
      roadmapRaw: idlessRoadmap,
      backlogRaw: idlessBacklog,
      strict: false,
      enforceEntryIds: true,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'docs/roadmap.md', rule: 'missing-entry-id' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'docs/backlog.md', rule: 'missing-entry-id' }),
    );
  });

  it('errors malformed-entry-id even when enforcement is off', () => {
    const result = validateTriageInputs({
      roadmapRaw: stampedRoadmap.replace('Q-0001', 'Q-1'),
      backlogRaw: idlessBacklog,
      strict: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ rule: 'malformed-entry-id', file: 'docs/roadmap.md' }),
    );
  });

  it('errors duplicate-entry-id across roadmap and backlog combined', () => {
    const result = validateTriageInputs({
      roadmapRaw: stampedRoadmap,
      backlogRaw: stampedBacklog.replace('Q-0002', 'Q-0001'),
      strict: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ rule: 'duplicate-entry-id', file: 'docs/backlog.md' }),
    );
  });

  it('passes a fully stamped pair with enforcement on', () => {
    const result = validateTriageInputs({
      roadmapRaw: stampedRoadmap,
      backlogRaw: stampedBacklog,
      strict: false,
      enforceEntryIds: true,
    });
    expect(result.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

```bash
pnpm vitest run src/triage/__tests__/validate-triage.test.ts
```

Expected output: the enforcement/malformed/duplicate tests fail (unknown `enforceEntryIds` input is ignored, no entry-id rules exist yet); pre-existing tests pass.

- [ ] **Step 3: Implement the three rules in `validate-triage.ts`**

(a) Replace the import block

```ts
import { readFile } from 'node:fs/promises';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';
```

with

```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ENTRY_ID_RE } from './entry-id.js';
import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';
```

(b) Extend the `TriageIssue.rule` union — replace

```ts
  rule:
    | 'duplicate-name'
    | 'missing-required-field'
    | 'missing-optional-field'
    | 'unknown-type-value';
```

with

```ts
  rule:
    | 'duplicate-name'
    | 'missing-required-field'
    | 'missing-optional-field'
    | 'unknown-type-value'
    | 'missing-entry-id'
    | 'malformed-entry-id'
    | 'duplicate-entry-id';
```

(c) Extend `ValidateTriageInputs` — replace

```ts
  /** When true, advisory issues (e.g. missing size/impact) are promoted to errors. */
  strict: boolean;
```

with

```ts
  /** When true, advisory issues (e.g. missing size/impact) are promoted to errors. */
  strict: boolean;
  /**
   * When true, a missing `- id:` bullet is an error. The CLI sets this from
   * `.noldor/id-counter.json` existence — creating the counter file (first
   * mint or backfill) is the opt-in signal; repos that never adopted entry
   * IDs are not blocked. Malformed/duplicate IDs error regardless.
   */
  enforceEntryIds?: boolean;
```

(d) In `validateTriageInputs`, after the second `pushIssues(...)` call and before `return { errors, advisories };`, insert:

```ts
  pushEntryIdIssues(roadmap, backlog, input.enforceEntryIds ?? false, errors);
```

(e) After the `pushIssues` function, add:

```ts
/**
 * Entry-ID rules (spec Unit 3). Unlike the per-file `duplicate-name` check,
 * duplicate detection here spans roadmap AND backlog combined — the backstop
 * for parallel-branch mint races (the counter file itself is the primary
 * guard: a real git merge conflict).
 */
function pushEntryIdIssues(
  roadmap: BacklogEntry[],
  backlog: BacklogEntry[],
  enforce: boolean,
  errors: TriageIssue[],
): void {
  const files: Array<[TriageIssue['file'], BacklogEntry[]]> = [
    ['docs/roadmap.md', roadmap],
    ['docs/backlog.md', backlog],
  ];
  const seen = new Map<string, string>();
  for (const [file, entries] of files) {
    for (const entry of entries) {
      if (entry.id === undefined) {
        if (enforce) {
          errors.push({
            entryName: entry.name,
            file,
            message:
              `Entry '${entry.name}' is missing its \`- id:\` bullet ` +
              '(run `pnpm noldor triage backfill-ids`, or `pnpm noldor triage mint-id` for a new entry).',
            rule: 'missing-entry-id',
          });
        }
        continue;
      }
      if (!ENTRY_ID_RE.test(entry.id)) {
        errors.push({
          entryName: entry.name,
          file,
          message: `Entry '${entry.name}' has malformed id \`${entry.id}\` (expected Q-NNNN).`,
          rule: 'malformed-entry-id',
        });
        continue;
      }
      const prior = seen.get(entry.id);
      if (prior !== undefined) {
        errors.push({
          entryName: entry.name,
          file,
          message:
            `Entry '${entry.name}' reuses id \`${entry.id}\` — already held by ${prior}. ` +
            'IDs are never rewritten; mint a fresh one via `pnpm noldor triage mint-id`.',
          rule: 'duplicate-entry-id',
        });
      } else {
        seen.set(entry.id, `'${entry.name}' in ${file}`);
      }
    }
  }
}
```

(f) Wire the counter-file gate into the CLI `main` — replace

```ts
  const result = validateTriageInputs({ roadmapRaw, backlogRaw, strict: opts.strict });
```

with

```ts
  const result = validateTriageInputs({
    roadmapRaw,
    backlogRaw,
    strict: opts.strict,
    enforceEntryIds: existsSync(join(opts.cwd, '.noldor', 'id-counter.json')),
  });
```

- [ ] **Step 4: Run tests + live validator — verify PASS**

```bash
pnpm vitest run src/triage/__tests__/validate-triage.test.ts
pnpm noldor triage validate
```

Expected output: all tests pass. The live run still prints `validate:triage OK (…)` with exit 0 — the counter file does not exist yet, so missing IDs on the real queue stay silent (adoption-safe gate working as designed).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/triage/validate-triage.ts src/triage/__tests__/validate-triage.test.ts
git commit -m "feat(triage): validate entry ids (missing/malformed/cross-file duplicate)" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 5: `resolveEntryRef` + ID-aware `deps:` scoring

**Files:**

- Modify: `src/triage/entry-id.ts`
- Modify: `src/triage/score.ts`
- Test: `src/triage/__tests__/entry-id.test.ts`
- Test: `src/triage/__tests__/score.test.ts`

- [ ] **Step 1: Add the failing `resolveEntryRef` tests**

Append to `src/triage/__tests__/entry-id.test.ts` (also add `resolveEntryRef` to the `../entry-id.js` import line):

```ts
describe(resolveEntryRef, () => {
  const roadmapRaw = `### Category

#### Queue Entry

- id: Q-0010
- area: tooling
- type: feat
- since: 2026-07-03
- size: M
- impact: high

Body.
`;
  const backlogRaw = `# Backlog

### Parked Entry

- id: Q-0011
- area: tooling
- type: feat
- since: 2026-07-03

Body.
`;

  let featuresDir: string;

  beforeEach(() => {
    featuresDir = mkdtempSync(join(tmpdir(), 'entry-ref-features-'));
    writeFileSync(
      join(featuresDir, 'shipped-by-id.md'),
      '---\nname: Shipped By Id\nphase: done\nentry-id: Q-0042\n---\n\nBody.\n',
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(featuresDir, { recursive: true, force: true });
  });

  it('resolves a roadmap id to the entry slug', () => {
    expect(resolveEntryRef('Q-0010', { roadmapRaw, backlogRaw, featuresDir })).toBe('queue-entry');
  });

  it('resolves a backlog id to the entry slug', () => {
    expect(resolveEntryRef('Q-0011', { roadmapRaw, backlogRaw, featuresDir })).toBe('parked-entry');
  });

  it('resolves an FD entry-id to the feature slug (filename stem)', () => {
    expect(resolveEntryRef('Q-0042', { roadmapRaw, backlogRaw, featuresDir })).toBe(
      'shipped-by-id',
    );
  });

  it("returns an unknown id unchanged (downstream treats it like a typo'd slug)", () => {
    expect(resolveEntryRef('Q-9998', { roadmapRaw, backlogRaw, featuresDir })).toBe('Q-9998');
  });

  it('passes non-id refs through untouched', () => {
    const ref = 'first-class-blocked-by';
    expect(resolveEntryRef(ref, { roadmapRaw, backlogRaw, featuresDir })).toBe(ref);
  });
});
```

- [ ] **Step 2: Add the failing score-composition tests**

In `src/triage/__tests__/score.test.ts`, replace line 1

```ts
// @tests: triage-scoring-rubric-effort-impact-confidence-dependency
```

with

```ts
// @tests: triage-scoring-rubric-effort-impact-confidence-dependency, stable-entry-ids-for-roadmap-backlog
```

replace the import block

```ts
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
```

with

```ts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
```

and append at the end of the file:

```ts
describe('resolveIsShipped with entry-id refs', () => {
  let dir: string;
  let paths: { featuresDir: string; roadmapPath: string; backlogPath: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'score-entry-ids-'));
    const featuresDir = join(dir, 'features');
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(
      join(featuresDir, 'shipped-by-id.md'),
      '---\nname: Shipped By Id\nphase: done\nentry-id: Q-0042\n---\n\nBody.\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'roadmap.md'),
      '### Open Entry\n\n- id: Q-0010\n- area: tooling\n- type: feat\n- since: 2026-07-03\n- size: M\n- impact: high\n\nBody.\n',
      'utf8',
    );
    writeFileSync(join(dir, 'backlog.md'), '# Backlog\n', 'utf8');
    paths = {
      featuresDir,
      roadmapPath: join(dir, 'roadmap.md'),
      backlogPath: join(dir, 'backlog.md'),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats an id resolving to a phase-done FD as shipped — same as the slug form', () => {
    const isShipped = resolveIsShipped(paths);
    expect(isShipped('Q-0042')).toBe(true);
    expect(isShipped('shipped-by-id')).toBe(true);
  });

  it('scores id-deps identically to slug-deps', () => {
    const isShipped = resolveIsShipped(paths);
    const byId = scoreEntry({
      size: 'M',
      impact: 'high',
      confidence: 'med',
      deps: ['Q-0042'],
      isShipped,
    });
    const bySlug = scoreEntry({
      size: 'M',
      impact: 'high',
      confidence: 'med',
      deps: ['shipped-by-id'],
      isShipped,
    });
    expect(byId).toBe(150);
    expect(byId).toBe(bySlug);
  });

  it('counts an id still sitting on the roadmap as unshipped', () => {
    expect(resolveIsShipped(paths)('Q-0010')).toBe(false);
  });

  it('counts an unknown id as unshipped', () => {
    expect(resolveIsShipped(paths)('Q-9998')).toBe(false);
  });

  it('tolerates missing roadmap/backlog files (FD entry-id lookup still works)', () => {
    const isShipped = resolveIsShipped({
      featuresDir: paths.featuresDir,
      roadmapPath: join(dir, 'nope.md'),
      backlogPath: join(dir, 'nope2.md'),
    });
    expect(isShipped('Q-0042')).toBe(true);
    expect(isShipped('Q-0010')).toBe(false);
  });
});
```

- [ ] **Step 3: Run both suites — verify the new tests FAIL**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts src/triage/__tests__/score.test.ts
```

Expected output: `resolveEntryRef` tests fail with an import error (`resolveEntryRef` not exported); the score-composition tests fail (`isShipped('Q-0042')` is `false` — IDs aren't resolved yet). Pre-existing tests pass.

- [ ] **Step 4: Implement `resolveEntryRef` in `entry-id.ts`**

Replace the import block

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
```

with

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';

import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
```

and insert after `mintEntryIds` (before `const MINT_USAGE`):

```ts
export interface ResolveEntryRefInputs {
  /** Raw docs/roadmap.md contents (pass '' when the file is absent). */
  roadmapRaw: string;
  /** Raw docs/backlog.md contents (pass '' when the file is absent). */
  backlogRaw: string;
  /** Directory of feature MDs whose frontmatter may carry `entry-id`. */
  featuresDir: string;
}

/**
 * Resolve an entry reference to a slug. IDs (`Q-0042`) are looked up across
 * parsed roadmap + backlog entries (`- id:` bullet) first, then across
 * `<featuresDir>/*.md` frontmatter (`entry-id` — written by /promote and
 * /new-feature), returning the matching entry's slug / FD filename stem.
 * Non-ID refs are already slugs and pass through unchanged. An unknown ID
 * resolves to itself, so downstream treats it exactly like a typo'd slug
 * (unshipped/unknown).
 */
export function resolveEntryRef(ref: string, inputs: ResolveEntryRefInputs): string {
  if (!ENTRY_ID_RE.test(ref)) return ref;
  for (const entry of [...parseRoadmap(inputs.roadmapRaw), ...parseBacklog(inputs.backlogRaw)]) {
    if (entry.id === ref) return entry.slug;
  }
  if (existsSync(inputs.featuresDir)) {
    for (const file of readdirSync(inputs.featuresDir)) {
      if (!file.endsWith('.md')) continue;
      const raw = readFileSync(join(inputs.featuresDir, file), 'utf8');
      const data = matter(raw).data as Record<string, unknown>;
      if (data['entry-id'] === ref) return file.slice(0, -'.md'.length);
    }
  }
  return ref;
}
```

- [ ] **Step 5: Compose it into `resolveIsShipped` in `score.ts`**

(a) Add to the imports (after the `zod` import line):

```ts
import { ENTRY_ID_RE, resolveEntryRef } from './entry-id.js';
```

(b) Replace the `isShipped` field docblock inside `ScoringInputs` —

```ts
  /**
   * Returns true iff the slug names shipped work — concretely, a feature MD at
   * `<featuresDir>/<slug>.md` with frontmatter `phase: done`. Every other state
   * (file missing, file present with `phase != done`, slug only in roadmap or
   * backlog, unknown slug) returns false. See `resolveIsShipped` below for the
   * canonical FS-backed implementation.
   */
  isShipped: (slug: string) => boolean;
```

with

```ts
  /**
   * Returns true iff the ref names shipped work. Accepts a slug OR a stable
   * entry ID (`Q-NNNN`, resolved to a slug first) — concretely, a feature MD
   * at `<featuresDir>/<slug>.md` with frontmatter `phase: done`. Every other
   * state (file missing, `phase != done`, ref only in roadmap or backlog,
   * unknown ref) returns false. See `resolveIsShipped` below for the
   * canonical FS-backed implementation.
   */
  isShipped: (slug: string) => boolean;
```

(c) Replace the `ResolverPaths` interface and `resolveIsShipped` (the reserved paths finally earn their keep) —

```ts
export interface ResolverPaths {
  featuresDir: string;
  /** Unused in the lookup but accepted so the caller can document the full data set. Reserved for future extensions. */
  roadmapPath: string;
  /** Unused in the lookup. Reserved for future extensions. */
  backlogPath: string;
}

/**
 * Build an `isShipped(slug)` function backed by the file system. Returns true
 * iff `<featuresDir>/<slug>.md` exists AND its frontmatter `phase` field reads
 * exactly `done`. Any other state — file absent, frontmatter missing, phase
 * value other than `done` — returns false. The roadmap / backlog paths are
 * deliberately not consulted: an entry's mere presence in those lists never
 * counts as shipped under the v1 rule.
 */
export function resolveIsShipped(paths: ResolverPaths): (slug: string) => boolean {
  return (slug: string): boolean => {
    const fdPath = join(paths.featuresDir, `${slug}.md`);
    if (!existsSync(fdPath)) return false;
    const raw = readFileSync(fdPath, 'utf8');
    const parsed = matter(raw);
    return (parsed.data as { phase?: unknown }).phase === 'done';
  };
}
```

with

```ts
export interface ResolverPaths {
  featuresDir: string;
  /** docs/roadmap.md — read (when present) to resolve entry-ID refs (`- id:` bullets) to slugs. */
  roadmapPath: string;
  /** docs/backlog.md — read (when present) to resolve entry-ID refs to slugs. */
  backlogPath: string;
}

const readRawIfPresent = (path: string): string =>
  existsSync(path) ? readFileSync(path, 'utf8') : '';

/**
 * Build an `isShipped(ref)` function backed by the file system. `ref` may be
 * a slug or a stable entry ID (`Q-NNNN`): IDs are first resolved to a slug
 * via `resolveEntryRef` (roadmap/backlog `- id:` bullets, then feature-MD
 * `entry-id` frontmatter; an unknown ID resolves to itself and therefore
 * counts as unshipped). Returns true iff `<featuresDir>/<slug>.md` exists AND
 * its frontmatter `phase` field reads exactly `done`. Any other state — file
 * absent, frontmatter missing, phase value other than `done` — returns false.
 * An entry's mere presence in roadmap/backlog never counts as shipped (v1
 * rule).
 */
export function resolveIsShipped(paths: ResolverPaths): (ref: string) => boolean {
  return (ref: string): boolean => {
    const slug = ENTRY_ID_RE.test(ref)
      ? resolveEntryRef(ref, {
          roadmapRaw: readRawIfPresent(paths.roadmapPath),
          backlogRaw: readRawIfPresent(paths.backlogPath),
          featuresDir: paths.featuresDir,
        })
      : ref;
    const fdPath = join(paths.featuresDir, `${slug}.md`);
    if (!existsSync(fdPath)) return false;
    const raw = readFileSync(fdPath, 'utf8');
    const parsed = matter(raw);
    return (parsed.data as { phase?: unknown }).phase === 'done';
  };
}
```

- [ ] **Step 6: Run both suites — verify PASS**

```bash
pnpm vitest run src/triage/__tests__/entry-id.test.ts src/triage/__tests__/score.test.ts
```

Expected output: both files green, including the pre-existing `resolveIsShipped` fixture tests (slug refs never touch the resolution branch) and the score CLI tests (its `main` already passes `roadmapPath`/`backlogPath`, so `--deps=Q-NNNN` now works with zero CLI changes).

- [ ] **Step 7: Commit**

```bash
pnpm fmt
git add src/triage/entry-id.ts src/triage/score.ts src/triage/__tests__/entry-id.test.ts src/triage/__tests__/score.test.ts
git commit -m "feat(triage): resolve entry-id refs to slugs in deps scoring" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 6: `backfill-ids` sweep CLI + run it on THIS repo

**Files:**

- Create: `src/triage/backfill-ids.ts`
- Test: `src/triage/__tests__/backfill-ids.test.ts`
- Modify: `src/cli/manifest.ts`
- Modify (by running the CLI): `docs/roadmap.md`, `docs/backlog.md`, `.noldor/id-counter.json`

- [ ] **Step 1: Write the failing stamp/idempotency tests**

Create `src/triage/__tests__/backfill-ids.test.ts`:

```ts
// @tests: stable-entry-ids-for-roadmap-backlog
import { countIdless, stampEntryIds } from '../backfill-ids.js';

const roadmapRaw = `# Roadmap

Preamble prose.

### Category

#### First

- area: tooling
- type: feat

Body.

#### Already Stamped

- id: Q-0009
- area: tooling
- type: feat

Body.

### Direct Entry

- area: web
- type: fix

Body.
`;

describe(countIdless, () => {
  it('counts only entries (blocks with an area bullet) lacking an id', () => {
    expect(countIdless(roadmapRaw)).toBe(2);
  });

  it('ignores category containers and fenced pseudo-headings', () => {
    const raw = `### Container Only

Prose, no bullets.

\`\`\`markdown
#### Looks Like An Entry

- area: nope
\`\`\`

#### Real

- area: tooling

Body.
`;
    expect(countIdless(raw)).toBe(1);
  });
});

describe(stampEntryIds, () => {
  it('inserts the id as the first bullet of each id-less entry, in source order', () => {
    const { newRaw, stamped } = stampEntryIds(roadmapRaw, ['Q-0100', 'Q-0101']);
    expect(stamped).toBe(2);
    expect(newRaw).toContain('#### First\n\n- id: Q-0100\n- area: tooling');
    expect(newRaw).toContain('### Direct Entry\n\n- id: Q-0101\n- area: web');
    expect(newRaw).toContain('#### Already Stamped\n\n- id: Q-0009\n- area: tooling');
  });

  it('is idempotent — a second pass finds nothing to stamp', () => {
    const first = stampEntryIds(roadmapRaw, ['Q-0100', 'Q-0101']);
    expect(countIdless(first.newRaw)).toBe(0);
    const second = stampEntryIds(first.newRaw, []);
    expect(second.stamped).toBe(0);
    expect(second.newRaw).toBe(first.newRaw);
  });

  it('throws when ids run short instead of half-stamping', () => {
    expect(() => stampEntryIds(roadmapRaw, ['Q-0100'])).toThrow(/need 2 ids/);
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

```bash
pnpm vitest run src/triage/__tests__/backfill-ids.test.ts
```

Expected output: `FAIL` — `Cannot find module '../backfill-ids.js'`.

- [ ] **Step 3: Implement `src/triage/backfill-ids.ts`**

```ts
// `noldor triage backfill-ids` — idempotent one-sweep stamp of stable entry
// IDs onto every roadmap + backlog entry lacking one. Roadmap entries are
// stamped first (file order), then backlog — deterministic, so reruns and
// consumer-repo adoption sweeps produce stable numbering. Entries already
// carrying `- id:` are left byte-identical; a second run is a no-op.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintEntryIds } from './entry-id.js';

const HEADING_RE = /^#{3,4}\s+\S/;
const FIELD_BULLET_RE = /^-\s+\w+:\s*\S/;
const AREA_BULLET_RE = /^-\s+area:\s*\S/;
const ID_BULLET_RE = /^-\s+id:\s*\S/;

interface Block {
  /** Line index of the first `- <field>:` bullet after the heading. */
  firstBulletLine: number;
  hasArea: boolean;
  hasId: boolean;
}

/**
 * Scan schema-C blocks (H3/H4 heading + bullet fields), code-fence-aware like
 * `parseRoadmap`. Only blocks with `- area:` count as entries — H3 category
 * containers and prose sections are skipped, mirroring the parser rule.
 */
function scanBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (HEADING_RE.test(line)) {
      if (current) blocks.push(current);
      current = { firstBulletLine: -1, hasArea: false, hasId: false };
      continue;
    }
    if (!current || !FIELD_BULLET_RE.test(line)) continue;
    if (current.firstBulletLine === -1) current.firstBulletLine = i;
    if (AREA_BULLET_RE.test(line)) current.hasArea = true;
    if (ID_BULLET_RE.test(line)) current.hasId = true;
  }
  if (current) blocks.push(current);
  return blocks.filter((b) => b.hasArea);
}

/** Count entries (blocks with `- area:`) that carry no `- id:` bullet yet. */
export function countIdless(raw: string): number {
  return scanBlocks(raw.split('\n')).filter((b) => !b.hasId).length;
}

/**
 * Insert `- id: <next>` as the first bullet of every id-less entry, consuming
 * `ids` front-to-back in source order. Throws when `ids` runs short (never
 * half-stamps). Already-stamped entries stay byte-identical.
 */
export function stampEntryIds(
  raw: string,
  ids: readonly string[],
): { newRaw: string; stamped: number } {
  const lines = raw.split('\n');
  const targets = scanBlocks(lines).filter((b) => !b.hasId);
  if (targets.length > ids.length) {
    throw new Error(`stampEntryIds: need ${targets.length} ids, got ${ids.length}`);
  }
  // Insert bottom-up so earlier insertions don't shift later line indexes.
  for (let t = targets.length - 1; t >= 0; t--) {
    const target = targets[t];
    if (target) lines.splice(target.firstBulletLine, 0, `- id: ${ids[t] ?? ''}`);
  }
  return { newRaw: lines.join('\n'), stamped: targets.length };
}

function main(): void {
  const cwd = process.cwd();
  const roadmapPath = join(cwd, 'docs', 'roadmap.md');
  const backlogPath = join(cwd, 'docs', 'backlog.md');
  const counterPath = join(cwd, '.noldor', 'id-counter.json');
  const roadmapRaw = readFileSync(roadmapPath, 'utf8');
  const backlogRaw = readFileSync(backlogPath, 'utf8');

  const roadmapNeed = countIdless(roadmapRaw);
  const backlogNeed = countIdless(backlogRaw);
  if (roadmapNeed + backlogNeed === 0) {
    process.stdout.write('backfill-ids: every entry already has an id — nothing to do\n');
    return;
  }
  const ids = mintEntryIds(roadmapNeed + backlogNeed, counterPath);
  const roadmap = stampEntryIds(roadmapRaw, ids.slice(0, roadmapNeed));
  const backlog = stampEntryIds(backlogRaw, ids.slice(roadmapNeed));
  if (roadmap.stamped > 0) writeFileSync(roadmapPath, roadmap.newRaw, 'utf8');
  if (backlog.stamped > 0) writeFileSync(backlogPath, backlog.newRaw, 'utf8');
  process.stdout.write(
    `backfill-ids: stamped ${roadmap.stamped} roadmap + ${backlog.stamped} backlog entries\n`,
  );
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) main();
```

- [ ] **Step 4: Register `backfill-ids` in `src/cli/manifest.ts`**

Replace

```ts
      'mint-id': {
        src: 'triage/entry-id.ts',
        desc: 'Mint next N stable entry IDs (--count N, default 1); bumps .noldor/id-counter.json',
      },
```

with

```ts
      'mint-id': {
        src: 'triage/entry-id.ts',
        desc: 'Mint next N stable entry IDs (--count N, default 1); bumps .noldor/id-counter.json',
      },
      'backfill-ids': {
        src: 'triage/backfill-ids.ts',
        desc: 'Idempotent sweep: stamp `- id:` onto every roadmap/backlog entry lacking one',
      },
```

- [ ] **Step 5: Run the test — verify it PASSES**

```bash
pnpm vitest run src/triage/__tests__/backfill-ids.test.ts
```

Expected output: `Test Files  1 passed` — 5 tests passed.

- [ ] **Step 6: Commit the code**

```bash
pnpm fmt
git add src/triage/backfill-ids.ts src/triage/__tests__/backfill-ids.test.ts src/cli/manifest.ts
git commit -m "feat(triage): add backfill-ids idempotent id-stamp sweep" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

- [ ] **Step 7: Run the backfill against THIS repo and verify idempotency**

```bash
pnpm noldor triage backfill-ids
pnpm noldor triage backfill-ids
pnpm noldor triage validate
pnpm noldor triage score --size=M --impact=high --deps=Q-0001
git status --short
```

Expected output, in order: (1) `backfill-ids: stamped 6 roadmap + 5 backlog entries` — exact counts reflect whatever the queue holds at execution time; the sweep is count-agnostic. (2) `backfill-ids: every entry already has an id — nothing to do` and no further diff. (3) `validate:triage OK (…)`, exit 0 — the counter file now exists, so `missing-entry-id` is enforced and every entry passes. (4) `75` — `Q-0001` resolves to the top roadmap entry's slug, which has no `phase: done` FD → unshipped → factor ½ of 150 (proves the end-to-end ID path; if the top entry unexpectedly HAS a done FD, `150` is also acceptable — the point is a clean integer, no error). (5) exactly ` M docs/backlog.md`, ` M docs/roadmap.md`, `?? .noldor/id-counter.json`.

Spot-check one block: `- id: Q-0001` must be the FIRST bullet of the first roadmap entry.

- [ ] **Step 8: Commit the stamped queue + counter**

`.gitignore` does NOT match `.noldor/id-counter.json` (verified: it lists specific `.noldor/` files, no wildcard) — plain `git add` works, no `-f` needed. The pre-commit `triage` job re-validates both files; the `fmt` job checks the JSON (2-space + trailing newline output passes oxfmt).

```bash
git add docs/roadmap.md docs/backlog.md .noldor/id-counter.json
git commit -m "docs: backfill stable entry ids onto every roadmap + backlog entry" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 7: Optional `entry-id` field in the feature-frontmatter schema (defensive location)

**Files:**

- Modify: `src/core/feature-schema.ts` **or** `src/features/feature-schema.ts` (resolve in Step 1)
- Test: the schema test beside it (currently `src/features/__tests__/feature-schema.test.ts`)

- [ ] **Step 1: Locate the schema — it may have moved earlier in this drain**

The `self-boundaries-declaration-and-cycle-break` plan (executed earlier in this same drain) moves `src/features/feature-schema.ts` → `src/core/feature-schema.ts`. Resolve the live location explicitly:

```bash
git grep -ln "export const FeatureFrontmatterSchema" -- src/
git grep -ln "FeatureFrontmatterSchema" -- src/core/__tests__ src/features/__tests__
```

Expected output: exactly ONE schema path — `src/core/feature-schema.ts` if the move landed, else `src/features/feature-schema.ts` — and one test path (`feature-schema.test.ts` under the matching `__tests__/` dir). Use those two paths for every step below; the edits are identical either way. If BOTH schema paths exist, edit the one the second grep's test imports (and flag the duplication in the task report).

- [ ] **Step 2: Add the failing schema tests**

In the resolved `feature-schema.test.ts`, append `, stable-entry-ids-for-roadmap-backlog` to the existing `// @tests:` comma-list line, and append at the end of the file:

```ts
describe('entry-id field', () => {
  it('accepts a valid Q-NNNN entry-id', () => {
    const parsed = FeatureFrontmatterSchema.safeParse({ ...base, 'entry-id': 'Q-0042' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a wide entry-id past Q-9999', () => {
    const parsed = FeatureFrontmatterSchema.safeParse({ ...base, 'entry-id': 'Q-10000' });
    expect(parsed.success).toBe(true);
  });

  it('stays optional — frontmatter without entry-id still parses', () => {
    expect(FeatureFrontmatterSchema.safeParse(base).success).toBe(true);
  });

  it('rejects malformed entry-id values', () => {
    expect(FeatureFrontmatterSchema.safeParse({ ...base, 'entry-id': 'R-42' }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3: Run the test — verify it FAILS**

```bash
pnpm vitest run $(git grep -ln "FeatureFrontmatterSchema" -- src/core/__tests__ src/features/__tests__)
```

Expected output: `accepts a valid Q-NNNN entry-id` and `accepts a wide entry-id` fail — `.strict()` rejects the unknown `entry-id` key. The other two pass (they assert current behavior).

- [ ] **Step 4: Add the field to `FeatureFrontmatterSchema`**

In the resolved schema file, replace

```ts
    'introduces-gate': z.string().min(1).optional(),
  })
```

with

```ts
    'introduces-gate': z.string().min(1).optional(),
    /** Optional stable queue ID (`Q-NNNN`) — lifted from the source block's
     *  `- id:` bullet by /promote, or minted via `noldor triage mint-id` by
     *  /new-feature. Never rewritten; lets ID `deps:` refs resolve to shipped
     *  work (`resolveEntryRef` in src/triage/entry-id.ts). Pattern mirrors
     *  ENTRY_ID_RE there — inlined, not imported, to keep this schema module
     *  dependency-light. */
    'entry-id': z
      .string()
      .regex(/^Q-\d{4,}$/, 'Expected stable entry ID (Q-NNNN)')
      .optional(),
  })
```

- [ ] **Step 5: Run tests + the FD validator — verify PASS**

```bash
pnpm vitest run $(git grep -ln "FeatureFrontmatterSchema" -- src/core/__tests__ src/features/__tests__)
pnpm noldor validate features
```

Expected output: schema suite green (all 4 new tests pass); `validate features` still green across every existing FD (the field is optional — nothing carries it yet).

- [ ] **Step 6: Commit**

Stage the two paths Step 1 resolved (shown here with today's locations — substitute `src/core/...` if the move landed):

```bash
pnpm fmt
git add src/features/feature-schema.ts src/features/__tests__/feature-schema.test.ts
git commit -m "feat(features): accept optional entry-id in feature frontmatter" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 8: Skill edits — `/triage` mints, `/new-feature` mints, `/promote` lifts (+ template twins)

No unit tests here (prose-only surfaces); verification = twin diffs empty + pre-commit `template-sync` / `skill-catalog` jobs green. Do NOT touch any skill frontmatter `description` (keeps `skill-catalog` inert).

**Files:**

- Modify: `.claude/skills/triage/SKILL.md` + `templates/.claude/skills/triage/SKILL.md`
- Modify: `.claude/skills/new-feature/SKILL.md` + `templates/.claude/skills/new-feature/SKILL.md`
- Modify: `.claude/skills/promote/SKILL.md` + `templates/.claude/skills/promote/SKILL.md`

- [ ] **Step 1: Teach `/triage` batch minting (step 6 intro)**

In `.claude/skills/triage/SKILL.md`, replace

```markdown
6. **On confirm**, for each accepted row:
```

with

```markdown
6. **On confirm**: first mint IDs for the batch — count the accepted **new-entry** rows (targets `backlog`, `roadmap`, and `now`; merge rows never mint — the host block keeps its existing `- id:`) and run `pnpm noldor triage mint-id --count <n>` ONCE for the whole batch. Capture the printed IDs (one per line) and assign them to the new-entry rows in confirmation-table order. Minting happens only after confirmation so rejected rows never burn IDs (gaps are permanent and harmless). Then, for each accepted row:
```

- [ ] **Step 2: Stamp `- id:` first in both `/triage` block templates**

Still in `.claude/skills/triage/SKILL.md`: in the **backlog** template, replace

```markdown
   ### <name>

   - area: <area>
```

with

```markdown
   ### <name>

   - id: <minted Q-NNNN>
   - area: <area>
```

and in the **roadmap** template, replace

```markdown
   #### <name>

   - area: <area>
```

with

```markdown
   #### <name>

   - id: <minted Q-NNNN>
   - area: <area>
```

Then update the two parenthetical notes. Replace

```markdown
   (`size` / `impact` / `confidence` / `deps` lines are all silently optional on backlog — emit when the proposal supplied them, omit otherwise. For `deps`, only emit the bullet when the slug list is non-empty.)
```

with

```markdown
   (`id` is required and always the first bullet — machine-minted, never invented. `size` / `impact` / `confidence` / `deps` lines are all silently optional on backlog — emit when the proposal supplied them, omit otherwise. For `deps`, only emit the bullet when the list is non-empty; entries may be slugs or entry IDs — both resolve at scoring time.)
```

and replace

```markdown
   (`size` and `impact` are required on roadmap; `confidence` and `deps` are silently optional — emit `confidence` when the proposal supplied it, omit otherwise. For `deps`, only emit the bullet when the slug list is non-empty.)
```

with

```markdown
   (`id` is required and always the first bullet — machine-minted, never invented. `size` and `impact` are required on roadmap; `confidence` and `deps` are silently optional — emit `confidence` when the proposal supplied it, omit otherwise. For `deps`, only emit the bullet when the list is non-empty; entries may be slugs or entry IDs — both resolve at scoring time.)
```

- [ ] **Step 3: Add the `/triage` authoring rule**

Still in `.claude/skills/triage/SKILL.md`, append to the `## Rules` list (after the final `edit`-at-confirmation bullet):

```markdown
- **Never hand-write or renumber `- id:` bullets.** IDs come only from `pnpm noldor triage mint-id` (sole exception: resolving a `.noldor/id-counter.json` merge conflict). Never reuse an existing ID — `validate:triage` blocks duplicates across roadmap + backlog combined. Renaming a heading is safe: the slug is a renameable alias; the ID is the stable reference.
```

- [ ] **Step 4: Teach `/new-feature` to mint**

In `.claude/skills/new-feature/SKILL.md`, replace

```markdown
2. If file `docs/features/<slug>.md` exists, stop and tell the user.
3. Write the file with this template:
```

with

```markdown
2. If file `docs/features/<slug>.md` exists, stop and tell the user.
2.5. Mint a stable entry ID: run `pnpm noldor triage mint-id` and capture the printed `Q-NNNN` for the template's `entry-id` frontmatter field. Skip the mint (and omit the field — it is optional in the schema) only when `.noldor/id-counter.json` does not exist and the operator declines to adopt entry IDs.
3. Write the file with this template:
```

and in the template frontmatter, replace

```markdown
area: <area>
category: <one of consumer.categories>
deps: []
```

with

```markdown
area: <area>
category: <one of consumer.categories>
deps: []
entry-id: <Q-NNNN from step 2.5 — omit the line when the mint was skipped>
```

- [ ] **Step 5: Teach `/promote` to lift the ID**

In `.claude/skills/promote/SKILL.md`, replace

```markdown
2. Parse the block's bullet fields: `area`, `since?`, `deps?`, `parent?`, `milestone?`. Source roadmap section determines current bucket but is not carried into the feature MD.
```

with

```markdown
2. Parse the block's bullet fields: `area`, `since?`, `deps?`, `parent?`, `milestone?`, `id?`. Source roadmap section determines current bucket but is not carried into the feature MD. The `id` bullet (stable entry ID, `Q-NNNN`) is lifted verbatim into FD frontmatter `entry-id` in step 6 — never re-mint or rewrite it; it is what keeps ID references resolving after the entry leaves the queue.
```

and in the step-6 template frontmatter, replace

```markdown
deps: <deps-or-empty-array>
```

with

```markdown
deps: <deps-or-empty-array>
entry-id: <id-from-source-block — copy the `- id:` value verbatim when present; omit the line otherwise>
```

- [ ] **Step 6: Sync the three template twins byte-identically**

```bash
cp .claude/skills/triage/SKILL.md templates/.claude/skills/triage/SKILL.md
cp .claude/skills/new-feature/SKILL.md templates/.claude/skills/new-feature/SKILL.md
cp .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
diff .claude/skills/triage/SKILL.md templates/.claude/skills/triage/SKILL.md
diff .claude/skills/new-feature/SKILL.md templates/.claude/skills/new-feature/SKILL.md
diff .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
```

Expected output: the three `diff` commands print nothing (exit 0).

- [ ] **Step 7: Commit (skills + twins together, shared-files override)**

`.claude/skills/**` is on the shared-files block list for `.worktrees/` checkouts — the `NOLDOR_ALLOW_SHARED=1` env on the commit clears it (harmless when running on the main checkout).

```bash
git add .claude/skills/triage/SKILL.md .claude/skills/new-feature/SKILL.md .claude/skills/promote/SKILL.md templates/.claude/skills/triage/SKILL.md templates/.claude/skills/new-feature/SKILL.md templates/.claude/skills/promote/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "feat(skills): mint + carry stable entry ids in triage, new-feature, promote" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

---

## Task 9: Docs — preambles, two `docs/noldor/` pages (+ twins), FD links

Two commits: preambles + FD ride a plain `docs:` commit; `docs/noldor/*.md` edits need their own commit with a `noldor` scope (commit-msg hook).

**Files:**

- Modify: `docs/roadmap.md`, `docs/backlog.md`, `docs/features/stable-entry-ids-for-roadmap-backlog.md`
- Modify: `docs/noldor/triage.md` + `templates/docs/noldor/triage.md`
- Modify: `docs/noldor/feature-md-schema.md` + `templates/docs/noldor/feature-md-schema.md`

- [ ] **Step 1: Roadmap preamble line**

In `docs/roadmap.md`, replace the intro line (directly under `# Roadmap`)

```markdown
Flat priority-ordered list (file order = priority); H3 headings group related entries.
```

with

```markdown
Flat priority-ordered list (file order = priority); H3 headings group related entries.

Every entry's first bullet is a stable ID (`- id: Q-NNNN`) — minted at triage via `pnpm noldor triage mint-id`, never rewritten, surviving heading renames and roadmap ↔ backlog moves. The slug stays a renameable alias; `deps:` accepts IDs or slugs. See [Stable entry IDs](noldor/triage.md#stable-entry-ids).
```

(If an earlier plan in the drain reworded that intro line, insert the new paragraph directly after the `# Roadmap` H1 + intro instead — position, not exact anchor, is the contract.)

- [ ] **Step 2: Backlog preamble line**

In `docs/backlog.md`, insert directly after the `# Backlog` H1 line (before the first entry heading):

```markdown

Parking lot. Every entry's first bullet is a stable ID (`- id: Q-NNNN`) — minted at triage, never rewritten; the slug is a renameable alias. See [Stable entry IDs](noldor/triage.md#stable-entry-ids).
```

- [ ] **Step 3: Record the shipped surfaces on the FD**

In `docs/features/stable-entry-ids-for-roadmap-backlog.md` frontmatter: extend `links.code` with the new/touched modules, move the two framework pages into `links.docs`, and point `links.plan` at this plan (skip any line that is already present — the drain may have pre-filled `links.plan`). Do NOT hand-edit `links.tests` (owned by `sync test-links`). Target shape, with the feature-schema line using whichever path Task 7 resolved:

```yaml
links:
  code:
    - docs/roadmap.md
    - docs/backlog.md
    - .claude/skills/triage/SKILL.md
    - .claude/skills/new-feature/SKILL.md
    - .claude/skills/promote/SKILL.md
    - src/triage/entry-id.ts
    - src/triage/backfill-ids.ts
    - src/triage/score.ts
    - src/triage/validate-triage.ts
    - src/utils/parse-blocks.ts
    - src/cli/manifest.ts
    - src/features/feature-schema.ts
  docs:
    - docs/noldor/triage.md
    - docs/noldor/feature-md-schema.md
```

(keep the existing `tests:`/`spec:` values as-is, and add:)

```yaml
  plan:
    - docs/superpowers/plans/2026-07-03-stable-entry-ids-for-roadmap-backlog.md
```

- [ ] **Step 4: Commit preambles + FD**

Pre-commit `triage` validate re-runs (both queue files staged — all entries stamped, green) and the FD-glob jobs (`fd-resources`, `fill-links-code-gaps`) may auto-tweak and re-stage the FD — expected.

```bash
git add docs/roadmap.md docs/backlog.md docs/features/stable-entry-ids-for-roadmap-backlog.md
git commit -m "docs: document stable entry-id bullets in roadmap + backlog preambles" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

- [ ] **Step 5: `docs/noldor/triage.md` — "Stable entry IDs" section**

In `docs/noldor/triage.md`: (a) append a pointer to the validation bullet list — replace

```markdown
- **Backlog advisories (warn, do not block):** missing `size` / `impact`. Promote to errors with `--strict` once backlog backfill completes.
```

with

```markdown
- **Backlog advisories (warn, do not block):** missing `size` / `impact`. Promote to errors with `--strict` once backlog backfill completes.
- **Entry-ID rules (both files):** `malformed-entry-id` and cross-file `duplicate-entry-id` always error; `missing-entry-id` errors once `.noldor/id-counter.json` exists. See [Stable entry IDs](#stable-entry-ids).
```

and (b) insert a new section — replace

```markdown
## Scoring rubric
```

with

```markdown
## Stable entry IDs

Every roadmap and backlog entry carries a stable short ID as its first bullet — `- id: Q-0042`. IDs are minted from a counter persisted in `.noldor/id-counter.json` (`{ "next": <int> }`) and **never rewritten**: they survive heading renames and roadmap ↔ backlog moves. The slug derived from the heading stays a human-readable, renameable alias.

- **Format:** `Q-\d{4,}` (`ENTRY_ID_RE` in `src/triage/entry-id.ts`) — a single `Q-` namespace (no per-file prefix, so cross-file moves never lie), zero-padded to 4 digits, width growing past `Q-9999` without a format break. Gaps from rejected or dropped rows are permanent and harmless; nothing ever renumbers.
- **Minting:** `pnpm noldor triage mint-id [--count N]` prints the next N IDs (one per line) and bumps the counter. `/triage` mints once per confirmed batch — after confirmation, so rejected rows never burn IDs; merge rows never mint. `/new-feature` mints one for fresh FDs. Never hand-write an ID except when resolving a counter merge conflict.
- **Backfill:** `pnpm noldor triage backfill-ids` stamps `- id:` onto every entry lacking one (roadmap file order first, then backlog) and is idempotent — a consumer repo runs it once at adoption time. Creating the counter file is the opt-in signal that turns on enforcement.
- **Validation:** `pnpm noldor validate triage` always errors on `malformed-entry-id` and on `duplicate-entry-id` (the same ID appearing twice across roadmap **and** backlog combined — the backstop for parallel-branch mint races; the counter file itself merge-conflicts first). `missing-entry-id` errors only once `.noldor/id-counter.json` exists, so repos that never opted in are not blocked.
- **ID-or-slug references:** `deps:` bullets accept IDs and slugs interchangeably. `resolveEntryRef` (`src/triage/entry-id.ts`) maps an ID to its entry's slug — roadmap/backlog `- id:` bullets first, then FD frontmatter `entry-id` — so an ID pointing at a `phase: done` FD counts as shipped in scoring. Unknown IDs resolve to themselves and count as unshipped, exactly like a typo'd slug.
- **Promotion:** `/promote` lifts the source block's `- id:` into FD frontmatter `entry-id` (optional field; see [feature-md-schema.md](feature-md-schema.md)), so the ID keeps resolving after the entry leaves the queue. Commit trailers, dashboard URLs, and detectors still address slugs today — they migrate incrementally, starting with `first-class-blocked-by`.

## Scoring rubric
```

- [ ] **Step 6: `docs/noldor/feature-md-schema.md` — `entry-id` row**

In the `### Optional` frontmatter table, append after the `introduces-gate` row:

```markdown
| `entry-id` | `string` matching `^Q-\d{4,}$` | Stable queue ID minted at triage (`pnpm noldor triage mint-id`). Lifted from the source block's `- id:` bullet by `/promote`; minted fresh by `/new-feature`. Never rewritten — keeps ID `deps:` references resolving to shipped work. See [Stable entry IDs](triage.md#stable-entry-ids). |
```

- [ ] **Step 7: Sync the two doc twins byte-identically**

```bash
cp docs/noldor/triage.md templates/docs/noldor/triage.md
cp docs/noldor/feature-md-schema.md templates/docs/noldor/feature-md-schema.md
diff docs/noldor/triage.md templates/docs/noldor/triage.md
diff docs/noldor/feature-md-schema.md templates/docs/noldor/feature-md-schema.md
```

Expected output: both `diff` commands print nothing.

- [ ] **Step 8: Commit the framework pages (noldor scope)**

```bash
git add docs/noldor/triage.md docs/noldor/feature-md-schema.md templates/docs/noldor/triage.md templates/docs/noldor/feature-md-schema.md
git commit -m "docs(noldor): document stable entry ids on triage + feature-md-schema pages" -m "Noldor-FD: stable-entry-ids-for-roadmap-backlog"
```

- [ ] **Step 9: Full verification sweep**

```bash
pnpm vitest run src/triage src/utils/__tests__/parse-blocks.test.ts src/features src/core
pnpm lint
pnpm noldor triage validate
git status --short
```

Expected output: every suite green (the `src/features`/`src/core` globs cover the schema test wherever Task 7 found it); `oxlint` clean; `validate:triage OK` with entry-id enforcement live; working tree clean (nothing unstaged left behind).
