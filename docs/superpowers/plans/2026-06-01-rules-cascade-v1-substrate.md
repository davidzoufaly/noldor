# Rules Cascade v1 (Substrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rule store + cascade resolver substrate — `.noldor/rules/*.md` files, a frontmatter loader, a glob+stage cascade resolver with a cached index, the `pnpm noldor rules` CLI, a `path → stage` mapping, and a `session.json` field — so later phases (PreToolUse push, enforce hooks, doc-sync) have a single resolver to call.

**Architecture:** Pure functions in `src/core/rules/` (stage map) and `src/rules/` (load, resolve, index), each with a thin argv entrypoint following the existing manifest-dispatch pattern (`src/cli/index.ts` reshapes `process.argv`, entrypoints run on import). Rules are markdown files with gray-matter frontmatter; globs matched with `minimatch`; frontmatter validated with `zod`. No PreToolUse wiring, no enforce hook, no bulk migration — those are v2 phases.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `zod`, `gray-matter`, `minimatch`, `vitest`, `tsx` runtime via `bin/noldor.mjs`.

---

## Scope

This plan covers **v1 substrate only** (per spec `docs/superpowers/specs/2026-06-01-rules-cascade-architecture-design.md`, Phasing). Out of this plan: PreToolUse delta injection (v2-push), `enforce:true` lefthook job (v2-enforce), const→doc generator + link-presence detector + bulk `docs/noldor/` migration (v2-sync). v1 migrates one representative slice (`.claude/engineering-rules.md`) to prove the model.

## File Structure

- Create `src/core/rules/stage.ts` — `Stage` type + pure `pathToStage(path)`. (Lives in `core/` beside `session.ts` since it maps the session path.)
- Create `src/rules/types.ts` — `Rule` interface + `RuleFrontmatterSchema` (zod).
- Create `src/rules/load.ts` — scan `.noldor/rules/*.md`, parse + validate, dup-id detection. Pure `loadRulesFromDir`.
- Create `src/rules/index-cache.ts` — build/read a serialized rule index with mtime invalidation.
- Create `src/rules/resolve.ts` — `resolveRules(rules, query)` cascade (glob + stage filter, specificity order, injected/enforce partition).
- Create `src/rules/cli-resolve.ts`, `src/rules/cli-list.ts`, `src/rules/cli-validate.ts` — argv entrypoints.
- Modify `src/cli/manifest.ts` — add the `rules` group.
- Modify `src/core/session.ts` — add `injectedRules` to the schema.
- Create `.noldor/rules/` — directory + 3 real rule files migrated from `.claude/engineering-rules.md`.
- Tests under `src/core/rules/__tests__/` and `src/rules/__tests__/`.

---

### Task 1: Stage model (`pathToStage`)

**Files:**
- Create: `src/core/rules/stage.ts`
- Test: `src/core/rules/__tests__/stage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/rules/__tests__/stage.test.ts
import { describe, expect, it } from 'vitest';
import { pathToStage, type Stage } from '../stage.js';

describe('pathToStage', () => {
  it('maps code-producing paths to "code"', () => {
    for (const p of [
      'micro-chore',
      'fast-track',
      'full-new',
      'full-attach',
      'specs-only-new',
      'specs-only-attach',
    ] as const) {
      expect(pathToStage(p)).toBe('code');
    }
  });

  it('maps release paths to "release"', () => {
    expect(pathToStage('release-sweep')).toBe('release');
    expect(pathToStage('release-automation')).toBe('release');
  });

  it('Stage type includes triage and review for explicit callers', () => {
    const stages: Stage[] = ['triage', 'code', 'review', 'release'];
    expect(stages).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/rules/__tests__/stage.test.ts`
Expected: FAIL — cannot find module `../stage.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/rules/stage.ts
import type { Path } from '../session.js';

/**
 * Lifecycle stage — cascade key 2 for rule resolution.
 * `triage` is pre-gate (no session path); `review` is a transient sub-state of
 * code paths. Both are only ever passed explicitly by callers (triage skill, CR
 * flow). `pathToStage` only projects the persisted session path, so it returns
 * the two stages a session marker can be in.
 */
export type Stage = 'triage' | 'code' | 'review' | 'release';

const RELEASE_PATHS = new Set<Path>(['release-sweep', 'release-automation']);

export function pathToStage(path: Path): Extract<Stage, 'code' | 'release'> {
  return RELEASE_PATHS.has(path) ? 'release' : 'code';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/rules/__tests__/stage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/rules/stage.ts src/core/rules/__tests__/stage.test.ts
git commit -m "feat(rules): add path-to-stage cascade mapping"
```

---

### Task 2: Rule types + frontmatter schema

**Files:**
- Create: `src/rules/types.ts`
- Test: `src/rules/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/rules/__tests__/types.test.ts
import { describe, expect, it } from 'vitest';
import { RuleFrontmatterSchema, frontmatterToRule } from '../types.js';

describe('RuleFrontmatterSchema', () => {
  it('accepts a full glob rule', () => {
    const fm = {
      id: 'ts-no-default-export',
      'applies-to': ['src/**/*.ts'],
      stage: ['code'],
      enforce: false,
      links: ['docs/noldor/testing-principles.md'],
    };
    expect(() => RuleFrontmatterSchema.parse(fm)).not.toThrow();
  });

  it('accepts a stage-level rule with no globs', () => {
    const fm = { id: 'review-checklist', stage: ['review'] };
    const parsed = RuleFrontmatterSchema.parse(fm);
    expect(parsed['applies-to']).toBeUndefined();
  });

  it('rejects a non-kebab id', () => {
    expect(() => RuleFrontmatterSchema.parse({ id: 'Not Kebab' })).toThrow();
  });

  it('frontmatterToRule fills defaults and attaches body', () => {
    const rule = frontmatterToRule({ id: 'a-rule' }, 'Body text.');
    expect(rule).toEqual({
      id: 'a-rule',
      appliesTo: [],
      stage: [],
      enforce: false,
      links: [],
      body: 'Body text.',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/rules/__tests__/types.test.ts`
Expected: FAIL — cannot find module `../types.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rules/types.ts
import { z } from 'zod';
import type { Stage } from '../core/rules/stage.js';

const STAGES = ['triage', 'code', 'review', 'release'] as const satisfies readonly Stage[];

/** Raw frontmatter as authored in `.noldor/rules/<id>.md` (kebab keys). */
export const RuleFrontmatterSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    'applies-to': z.array(z.string().min(1)).optional(),
    stage: z.array(z.enum(STAGES)).optional(),
    enforce: z.boolean().optional(),
    links: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type RuleFrontmatter = z.infer<typeof RuleFrontmatterSchema>;

/** Normalised, in-memory rule. */
export interface Rule {
  readonly id: string;
  readonly appliesTo: string[];
  readonly stage: Stage[];
  readonly enforce: boolean;
  readonly links: string[];
  readonly body: string;
}

export function frontmatterToRule(fm: RuleFrontmatter, body: string): Rule {
  return {
    id: fm.id,
    appliesTo: fm['applies-to'] ?? [],
    stage: fm.stage ?? [],
    enforce: fm.enforce ?? false,
    links: fm.links ?? [],
    body: body.trim(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/rules/__tests__/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rules/types.ts src/rules/__tests__/types.test.ts
git commit -m "feat(rules): add rule frontmatter schema + normalizer"
```

---

### Task 3: Rule loader (`loadRulesFromDir`)

**Files:**
- Create: `src/rules/load.ts`
- Test: `src/rules/__tests__/load.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/rules/__tests__/load.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRulesFromDir } from '../load.js';

function makeRulesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-rules-'));
  const rulesDir = join(dir, '.noldor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(rulesDir, name), content);
  }
  return dir;
}

const RULE_A = `---\nid: rule-a\napplies-to: ["src/**/*.ts"]\nstage: [code]\n---\nNamed exports only.\n`;
const RULE_B = `---\nid: rule-b\n---\nStage-agnostic guidance.\n`;

describe('loadRulesFromDir', () => {
  it('loads + normalizes all rule files', () => {
    const dir = makeRulesDir({ 'rule-a.md': RULE_A, 'rule-b.md': RULE_B });
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
    expect(rules.map((r) => r.id).sort()).toEqual(['rule-a', 'rule-b']);
    expect(rules.find((r) => r.id === 'rule-a')?.appliesTo).toEqual(['src/**/*.ts']);
    expect(rules.find((r) => r.id === 'rule-b')?.body).toBe('Stage-agnostic guidance.');
  });

  it('reports duplicate ids as errors, not throws', () => {
    const dir = makeRulesDir({ 'one.md': RULE_A, 'two.md': RULE_A });
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules).toHaveLength(1);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('reports malformed frontmatter and skips the file', () => {
    const dir = makeRulesDir({ 'bad.md': `---\nid: Bad Id\n---\nx\n`, 'ok.md': RULE_B });
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules.map((r) => r.id)).toEqual(['rule-b']);
    expect(errors.some((e) => e.includes('bad.md'))).toBe(true);
  });

  it('returns empty for a missing rules dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-norules-'));
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules).toEqual([]);
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/rules/__tests__/load.test.ts`
Expected: FAIL — cannot find module `../load.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rules/load.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { RuleFrontmatterSchema, frontmatterToRule, type Rule } from './types.js';

export interface LoadResult {
  rules: Rule[];
  errors: string[];
}

const RULES_SUBDIR = join('.noldor', 'rules');

export function loadRulesFromDir(cwd: string = process.cwd()): LoadResult {
  const dir = join(cwd, RULES_SUBDIR);
  const errors: string[] = [];
  if (!existsSync(dir)) return { rules: [], errors };

  const seen = new Set<string>();
  const rules: Rule[] = [];

  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const raw = readFileSync(join(dir, name), 'utf8');
    let parsedFm;
    try {
      const { data, content } = matter(raw);
      const fm = RuleFrontmatterSchema.parse(data);
      parsedFm = frontmatterToRule(fm, content);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (seen.has(parsedFm.id)) {
      errors.push(`${name}: duplicate id '${parsedFm.id}'`);
      continue;
    }
    seen.add(parsedFm.id);
    rules.push(parsedFm);
  }

  return { rules, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/rules/__tests__/load.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rules/load.ts src/rules/__tests__/load.test.ts
git commit -m "feat(rules): add rule-dir loader with dup-id + malformed handling"
```

---

### Task 4: Cascade resolver (`resolveRules`)

**Files:**
- Create: `src/rules/resolve.ts`
- Test: `src/rules/__tests__/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/rules/__tests__/resolve.test.ts
import { describe, expect, it } from 'vitest';
import { resolveRules } from '../resolve.js';
import type { Rule } from '../types.js';

function rule(p: Partial<Rule> & { id: string }): Rule {
  return { appliesTo: [], stage: [], enforce: false, links: [], body: '', ...p };
}

const broad = rule({ id: 'broad', appliesTo: ['src/**/*.ts'], stage: ['code'] });
const narrow = rule({ id: 'narrow', appliesTo: ['src/rules/*.ts'], stage: ['code'] });
const enforced = rule({ id: 'enf', appliesTo: ['src/**/*.ts'], stage: ['code'], enforce: true });
const stageOnly = rule({ id: 'review-rule', stage: ['review'] });
const anyStage = rule({ id: 'any', appliesTo: ['**/*.md'] });

describe('resolveRules', () => {
  it('matches glob rules for a file at the given stage', () => {
    const { injected } = resolveRules([broad, enforced], { file: 'src/x.ts', stage: 'code' });
    expect(injected.map((r) => r.id)).toContain('broad');
  });

  it('excludes rules whose stage does not match', () => {
    const { injected } = resolveRules([broad], { file: 'src/x.ts', stage: 'release' });
    expect(injected).toHaveLength(0);
  });

  it('treats empty rule.stage as any-stage', () => {
    const { injected } = resolveRules([anyStage], { file: 'README.md', stage: 'release' });
    expect(injected.map((r) => r.id)).toEqual(['any']);
  });

  it('orders by specificity: narrower glob first', () => {
    const { injected } = resolveRules([broad, narrow], { file: 'src/rules/a.ts', stage: 'code' });
    expect(injected.map((r) => r.id)).toEqual(['narrow', 'broad']);
  });

  it('partitions enforce:true into the enforce bucket', () => {
    const { injected, enforce } = resolveRules([broad, enforced], {
      file: 'src/x.ts',
      stage: 'code',
    });
    expect(injected.map((r) => r.id)).toEqual(['broad']);
    expect(enforce.map((r) => r.id)).toEqual(['enf']);
  });

  it('stage-only query (no file) returns stage-level rules without globs', () => {
    const { injected } = resolveRules([stageOnly, broad], { stage: 'review' });
    expect(injected.map((r) => r.id)).toEqual(['review-rule']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/rules/__tests__/resolve.test.ts`
Expected: FAIL — cannot find module `../resolve.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rules/resolve.ts
import { minimatch } from 'minimatch';
import type { Stage } from '../core/rules/stage.js';
import type { Rule } from './types.js';

export interface ResolveQuery {
  /** Target file (relative POSIX path). Omit for a stage-only resolution. */
  file?: string;
  /** Lifecycle stage. Omit to match rules regardless of stage. */
  stage?: Stage;
}

export interface ResolveResult {
  injected: Rule[];
  enforce: Rule[];
}

/** Literal (non-wildcard) leading segments — higher = more specific. */
function specificity(glob: string): number {
  let n = 0;
  for (const seg of glob.split('/')) {
    if (seg.includes('*') || seg.includes('?') || seg.includes('{')) break;
    n++;
  }
  return n;
}

function stageMatches(rule: Rule, stage?: Stage): boolean {
  if (rule.stage.length === 0) return true;
  if (stage === undefined) return true;
  return rule.stage.includes(stage);
}

function fileMatches(rule: Rule, file?: string): boolean {
  if (file === undefined) return rule.appliesTo.length === 0; // stage-only query
  if (rule.appliesTo.length === 0) return false; // stage-level rule, not file-scoped
  return rule.appliesTo.some((g) => minimatch(file, g));
}

export function resolveRules(rules: Rule[], query: ResolveQuery): ResolveResult {
  const matched = rules
    .map((rule, declIndex) => ({ rule, declIndex }))
    .filter(({ rule }) => stageMatches(rule, query.stage) && fileMatches(rule, query.file));

  // Total order: specificity desc, declaration order asc as tiebreak.
  matched.sort((a, b) => {
    const sa = Math.max(0, ...a.rule.appliesTo.map(specificity));
    const sb = Math.max(0, ...b.rule.appliesTo.map(specificity));
    if (sa !== sb) return sb - sa;
    return a.declIndex - b.declIndex;
  });

  const injected: Rule[] = [];
  const enforce: Rule[] = [];
  for (const { rule } of matched) (rule.enforce ? enforce : injected).push(rule);
  return { injected, enforce };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/rules/__tests__/resolve.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rules/resolve.ts src/rules/__tests__/resolve.test.ts
git commit -m "feat(rules): add cascade resolver (glob+stage, specificity, partition)"
```

---

### Task 5: Cached rule index

**Files:**
- Create: `src/rules/index-cache.ts`
- Test: `src/rules/__tests__/index-cache.test.ts`

Rationale: `bin/noldor.mjs` runs via tsx, so each PreToolUse invocation is a fresh process. Cache the parsed rules to a serialized index, rebuilt only when the rules dir changes (max file mtime). v1 builds the API; v2-push calls it per edit.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rules/__tests__/index-cache.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRules, INDEX_FILE } from '../index-cache.js';

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-idx-'));
  const rulesDir = join(dir, '.noldor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(rulesDir, n), c);
  return dir;
}

const RULE = `---\nid: r1\napplies-to: ["src/**/*.ts"]\n---\nbody\n`;

describe('getRules (cached index)', () => {
  it('builds the index on first call and writes the cache file', () => {
    const dir = repoWith({ 'r1.md': RULE });
    const rules = getRules(dir);
    expect(rules.map((r) => r.id)).toEqual(['r1']);
    expect(existsSync(join(dir, INDEX_FILE))).toBe(true);
  });

  it('rebuilds when a rule file changes mtime', () => {
    const dir = repoWith({ 'r1.md': RULE });
    getRules(dir); // prime cache
    const second = `---\nid: r2\n---\nbody2\n`;
    writeFileSync(join(dir, '.noldor', 'rules', 'r2.md'), second);
    // bump dir mtime deterministically
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(dir, '.noldor', 'rules'), future, future);
    const rules = getRules(dir);
    expect(rules.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/rules/__tests__/index-cache.test.ts`
Expected: FAIL — cannot find module `../index-cache.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rules/index-cache.ts
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRulesFromDir } from './load.js';
import type { Rule } from './types.js';

export const INDEX_FILE = join('.noldor', '.rules-index.json');
const RULES_DIR = join('.noldor', 'rules');

interface CachedIndex {
  stamp: number; // max mtimeMs across rules dir + files
  rules: Rule[];
}

function dirStamp(cwd: string): number {
  const dir = join(cwd, RULES_DIR);
  if (!existsSync(dir)) return 0;
  let max = statSync(dir).mtimeMs;
  for (const name of readdirSync(dir)) {
    const m = statSync(join(dir, name)).mtimeMs;
    if (m > max) max = m;
  }
  return max;
}

export function getRules(cwd: string = process.cwd()): Rule[] {
  const stamp = dirStamp(cwd);
  const cachePath = join(cwd, INDEX_FILE);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as CachedIndex;
      if (cached.stamp === stamp) return cached.rules;
    } catch {
      // fall through to rebuild
    }
  }
  const { rules } = loadRulesFromDir(cwd);
  const payload: CachedIndex = { stamp, rules };
  if (existsSync(join(cwd, '.noldor'))) {
    writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  }
  return rules;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/rules/__tests__/index-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `.rules-index.json` to gitignore + commit**

Run: `printf '\n# Generated rule index\n.noldor/.rules-index.json\n' >> .gitignore`

```bash
git add src/rules/index-cache.ts src/rules/__tests__/index-cache.test.ts .gitignore
git commit -m "feat(rules): add mtime-invalidated cached rule index"
```

---

### Task 6: Extend `session.json` with `injectedRules`

**Files:**
- Modify: `src/core/session.ts:19-42`
- Test: `src/core/rules/__tests__/session-injected.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/rules/__tests__/session-injected.test.ts
import { describe, expect, it } from 'vitest';
import { SessionMarkerSchema } from '../../session.js';

describe('SessionMarker injectedRules', () => {
  it('accepts an injectedRules array', () => {
    const m = SessionMarkerSchema.parse({
      path: 'fast-track',
      startedAt: '2026-06-01T00:00:00Z',
      injectedRules: ['rule-a', 'rule-b'],
    });
    expect(m.injectedRules).toEqual(['rule-a', 'rule-b']);
  });

  it('treats injectedRules as optional', () => {
    const m = SessionMarkerSchema.parse({ path: 'fast-track', startedAt: 'x' });
    expect(m.injectedRules).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/rules/__tests__/session-injected.test.ts`
Expected: FAIL — `.strict()` schema rejects unknown key `injectedRules`.

- [ ] **Step 3: Add the field**

In `src/core/session.ts`, inside the `z.object({ ... })` (after line 26 `autonomous: z.boolean().optional(),`):

```typescript
    autonomous: z.boolean().optional(),
    injectedRules: z.array(z.string().min(1)).optional(),
    markerVersion: z.literal(2).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/rules/__tests__/session-injected.test.ts`
Expected: PASS (2 tests).

Then run the full session suite to confirm no regression:

Run: `pnpm vitest run src/core/__tests__`
Expected: PASS (existing session/consumer tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts src/core/rules/__tests__/session-injected.test.ts
git commit -m "feat(rules): add injectedRules to session marker schema"
```

---

### Task 7: `rules` CLI group (resolve / list / validate)

**Files:**
- Create: `src/rules/cli-resolve.ts`, `src/rules/cli-list.ts`, `src/rules/cli-validate.ts`
- Modify: `src/cli/manifest.ts` (add `rules` group)
- Test: `src/rules/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing test** (exercises the pure cores the entrypoints wrap)

```typescript
// src/rules/__tests__/cli.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResolve, runValidate } from '../cli-cores.js';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-rules-cli-'));
  const rd = join(dir, '.noldor', 'rules');
  mkdirSync(rd, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(rd, n), c);
  return dir;
}

const RULE = `---\nid: ts-rule\napplies-to: ["src/**/*.ts"]\nstage: [code]\n---\nNamed exports only.\n`;

describe('rules CLI cores', () => {
  it('runResolve returns matching rules for a file+stage', () => {
    const dir = repo({ 'ts-rule.md': RULE });
    const out = runResolve(dir, { file: 'src/x.ts', stage: 'code' });
    rmSync(dir, { recursive: true, force: true });
    expect(out.injected.map((r) => r.id)).toEqual(['ts-rule']);
  });

  it('runValidate returns ok for a clean store', () => {
    const dir = repo({ 'ts-rule.md': RULE });
    const res = runValidate(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('runValidate flags a malformed store', () => {
    const dir = repo({ 'bad.md': `---\nid: Bad\n---\nx\n` });
    const res = runValidate(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/rules/__tests__/cli.test.ts`
Expected: FAIL — cannot find module `../cli-cores.js`.

- [ ] **Step 3: Implement the cores + entrypoints**

```typescript
// src/rules/cli-cores.ts
import { getRules } from './index-cache.js';
import { loadRulesFromDir } from './load.js';
import { resolveRules, type ResolveQuery, type ResolveResult } from './resolve.js';
import type { Rule } from './types.js';

export function runResolve(cwd: string, query: ResolveQuery): ResolveResult {
  return resolveRules(getRules(cwd), query);
}

export function runList(cwd: string): Rule[] {
  return getRules(cwd);
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  count: number;
}

export function runValidate(cwd: string): ValidateResult {
  const { rules, errors } = loadRulesFromDir(cwd);
  return { ok: errors.length === 0, errors, count: rules.length };
}
```

```typescript
// src/rules/cli-resolve.ts
import { runResolve } from './cli-cores.js';
import type { Stage } from '../core/rules/stage.js';

function main(): void {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let stage: Stage | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i];
    else if (args[i] === '--stage') stage = args[++i] as Stage;
  }
  const { injected, enforce } = runResolve(process.cwd(), { file, stage });
  console.log(JSON.stringify({ injected, enforce }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

```typescript
// src/rules/cli-list.ts
import { runList } from './cli-cores.js';

function main(): void {
  for (const r of runList(process.cwd())) {
    const scope = r.appliesTo.length ? r.appliesTo.join(',') : '(stage-level)';
    console.log(`${r.id}\t${r.stage.join(',') || 'any'}\t${r.enforce ? 'enforce' : 'inject'}\t${scope}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

```typescript
// src/rules/cli-validate.ts
import { runValidate } from './cli-cores.js';

function main(): void {
  const res = runValidate(process.cwd());
  for (const e of res.errors) console.error(`error [rules] ${e}`);
  if (!res.ok) {
    console.error(`validate:rules failed with ${res.errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`validate:rules OK (${res.count} rule(s)).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

Add to `src/cli/manifest.ts` `MANIFEST` (place the group alphabetically, before `triage`):

```typescript
  rules: {
    desc: 'Engineering rule store: resolve / list / validate',
    subs: {
      resolve: { src: 'rules/cli-resolve.ts', desc: 'Resolve rules for --file / --stage (JSON)' },
      list: { src: 'rules/cli-list.ts', desc: 'List all rules in the store' },
      validate: { src: 'rules/cli-validate.ts', desc: 'Validate the rule store' },
    },
  },
```

- [ ] **Step 4: Run tests + a real CLI smoke**

Run: `pnpm vitest run src/rules/__tests__/cli.test.ts`
Expected: PASS (3 tests).

Run: `pnpm noldor rules validate`
Expected: `validate:rules OK (0 rule(s)).` (no rules dir yet → empty, ok).

- [ ] **Step 5: Commit**

```bash
git add src/rules/cli-cores.ts src/rules/cli-resolve.ts src/rules/cli-list.ts src/rules/cli-validate.ts src/cli/manifest.ts src/rules/__tests__/cli.test.ts
git commit -m "feat(rules): add 'noldor rules' CLI group (resolve/list/validate)"
```

---

### Task 8: Migrate a representative slice + wire `rules validate` into pre-commit

**Files:**
- Create: `.noldor/rules/ts-named-exports-only.md`, `.noldor/rules/test-real-behavior.md`, `.noldor/rules/import-js-specifiers.md`
- Modify: `lefthook/noldor.yml` (add a `validate rules` job to pre-commit)
- Reference: `.claude/engineering-rules.md` (migration source)

Before writing the rule files, read `.claude/engineering-rules.md` and pick three concrete, currently-prose rules to extract. The three below are placeholders for that content — replace the bodies with the actual rule text found there, keeping the frontmatter shape.

- [ ] **Step 1: Create the rules dir + three real rules**

```bash
mkdir -p .noldor/rules
```

```markdown
<!-- .noldor/rules/ts-named-exports-only.md -->
---
id: ts-named-exports-only
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md]
---
Named exports only — no `export default`. Default exports break rename refactors and tree-shaking, and obscure the imported symbol at call sites.
```

```markdown
<!-- .noldor/rules/import-js-specifiers.md -->
---
id: import-js-specifiers
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md]
---
Intra-repo imports use `.js` specifiers (ESM + tsx), e.g. `import { x } from './foo.js'`, even though the source file is `.ts`.
```

```markdown
<!-- .noldor/rules/test-real-behavior.md -->
---
id: test-real-behavior
applies-to: ["src/**/*.test.ts"]
stage: [code]
enforce: false
links: [docs/noldor/testing-principles.md]
---
Tests assert real behavior over fixtures and tmp dirs — no mocking of the unit under test. Use `mkdtempSync`/`tmpdir` for filesystem cases (see existing `__tests__`).
```

- [ ] **Step 2: Verify the store loads + resolves**

Run: `pnpm noldor rules validate`
Expected: `validate:rules OK (3 rule(s)).`

Run: `pnpm noldor rules resolve --file src/rules/resolve.ts --stage code`
Expected: JSON with `injected` containing `ts-named-exports-only` and `import-js-specifiers` (narrower/broader both match `src/**/*.ts`), `test-real-behavior` absent (file is not `*.test.ts`).

- [ ] **Step 3: Add `validate rules` to pre-commit**

In `lefthook/noldor.yml`, in the `pre-commit` block alongside the other `validate` jobs, add:

```yaml
      validate-rules:
        run: pnpm noldor rules validate
```

(Match the exact indentation/format of the neighboring jobs in that file — read the surrounding jobs first.)

- [ ] **Step 4: Confirm the hook runs**

Run: `pnpm noldor rules validate && echo "hook-cmd-ok"`
Expected: `validate:rules OK (3 rule(s)).` then `hook-cmd-ok`.

- [ ] **Step 5: Commit**

```bash
git add .noldor/rules lefthook/noldor.yml
git commit -m "feat(rules): seed rule store from engineering-rules + gate on validate"
```

---

### Task 9: Full-suite regression + typecheck

**Files:** none (verification task)

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Lint + format**

Run: `pnpm lint && pnpm fmt:check`
Expected: clean (run `pnpm fmt` then re-check if formatting differs).

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: PASS — all new `rules`/`stage` suites plus the existing suite green.

- [ ] **Step 4: Commit any fmt fixes**

```bash
git add -A
git commit -m "chore(rules): typecheck + fmt pass for rules substrate"
```

(Skip if nothing changed.)

---

## Self-Review

**Spec coverage (v1 scope only):**
- Rule file format → Task 2 (schema) + Task 8 (real files). ✓
- `load.ts` → Task 3. ✓
- `resolve.ts` (glob+stage, specificity, injected/enforce partition) → Task 4. ✓
- Cached index / perf path → Task 5. ✓
- `rules` CLI (resolve/list/validate; `for` folded into `resolve --file`) → Task 7. ✓
- `src/core/rules/` consts → `stage.ts` (Task 1). NOTE: the spec also lists migrating the drift enumerations (gate paths, allowlist globs, detector list) into `src/core/rules/` consts. That is **deferred to v2-sync** (it only matters once the const→doc generator exists); v1 establishes the directory + stage map. Flagged so it is not silently dropped.
- Stage model → Task 1 + Task 6 (`injectedRules` field). ✓
- Gate-pinned stage injection → the resolver + `rules resolve --stage` (Task 7) provide the mechanism; **wiring the `/gate` skill prose to call it and record `injectedRules`** is a one-line skill edit deferred to v2-push (it is delivery, not substrate). Flagged.
- Migration slice → Task 8 (`.claude/engineering-rules.md` → 3 rules). ✓

**Placeholder scan:** Task 8 rule bodies are explicitly marked as content-to-replace-from-source, not silent TODOs — the engineer reads `.claude/engineering-rules.md` and substitutes. All code steps contain complete code.

**Type consistency:** `Rule` (`appliesTo`, `stage`, `enforce`, `links`, `body`) defined in Task 2, used identically in Tasks 3/4/5/7. `Stage` defined in Task 1, imported in Tasks 2/4/7. `ResolveQuery`/`ResolveResult` defined in Task 4, reused in Task 7 cores. `resolveRules`, `loadRulesFromDir`, `getRules`, `runResolve/runList/runValidate` names consistent across tasks.

**Deferred-to-v2 (intentional, not gaps):** PreToolUse wiring, `.claude/settings.json`, subagent dispatch-prompt injection, `enforce:true` lefthook job, const→doc generator, link-presence detector, bulk `docs/noldor/` migration, 13 dangling `engineering-principles.md` re-targets.
