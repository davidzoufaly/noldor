# Parallel-Agent Dispatch for Research Jobs Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A `noldor research fanout` CLI that spawns one read-only researcher agent per independent task (K-concurrent), collects stdout-envelope findings, renders a deterministic INDEX (+ opt-in synthesis), plus a thin `noldor-research` skill.

**Architecture:** New `src/research/` module behind the existing `spawnAgent` seam (`src/core/agent-runner/registry.ts`) with a new `researcher` role; `runWithConcurrency` hoisted from `src/prep/spawn.ts` to `src/core/concurrency.ts`; children never write — the CLI is the only writer, staging under gitignored `.noldor/research/<stamp>/`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod, vitest, node:child_process via `spawnAgent`.

Spec: `docs/design/specs/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md`

---

## File Structure

- `src/core/concurrency.ts` — create; hoisted `runWithConcurrency` worker-pool util (single responsibility: bounded parallel map)
- `src/core/__tests__/concurrency.test.ts` — create; first-ever tests for the util
- `src/core/git-porcelain.ts` — create; hoisted fail-open `gitStatusPorcelain` helper (copy #1 was `src/prep/prep-fanout.ts:21`)
- `src/core/__tests__/git-porcelain.test.ts` — create; fail-open contract test
- `src/prep/spawn.ts` — modify; drop `runWithConcurrency` (keeps `spawnClaude` only)
- `src/prep/prep-fanout.ts` — modify; import `runWithConcurrency` + `gitStatusPorcelain` from core, drop the local helper
- `src/core/agent-runner/types.ts` — modify; append `'researcher'` to `AGENT_ROLES`
- `src/core/agent-runner/__tests__/registry.test.ts` — modify; researcher default-resolution test
- `src/research/types.ts` — create; zod schemas (TaskSpec, tasks file, ResearchMeta) + result/manifest interfaces
- `src/research/__tests__/types.test.ts` — create; schema acceptance/rejection cases
- `src/research/prompt.ts` — create; `buildResearchPrompt` + `parseResearchStdout` (pure)
- `src/research/__tests__/prompt.test.ts` — create; envelope parse happy/degenerate paths
- `src/research/staging.ts` — create; atomic batch-dir creation, paths, manifest write, INDEX render
- `src/research/__tests__/staging.test.ts` — create; dir suffix-on-collision, INDEX table
- `src/research/fanout.ts` — create; CLI entrypoint (parseArgs, loadTasks, run with DI spawn seam)
- `src/research/__tests__/fanout.test.ts` — create; args, dup-ids, run() with spawn double
- `src/cli/manifest.ts` — modify; `research` group → `fanout`
- `.gitignore` — modify; add `.noldor/research/`
- `.claude/skills/noldor-research/SKILL.md` — create; driving-agent discipline
- `templates/.claude/skills/noldor-research/SKILL.md` — create; byte-identical twin
- `docs/noldor/research-fanout.md` — create; CLI reference page (`noldor-page: research-fanout`)
- `templates/docs/noldor/research-fanout.md` — create; twin
- `docs/noldor/skill-catalog.md` + twin — modify; `## /noldor-research` section, count 11 → 12
- `docs/noldor/agent-runtimes.md` + twin — modify; `researcher` in roles prose
- `docs/noldor/README.md` + twin — modify; Pages bullet for `research-fanout.md`
- `docs/features/parallel-agent-dispatch-for-research-jobs.md` — modify; final `links.code`/`links.tests`

---

## Task 1: Hoist `runWithConcurrency` + `gitStatusPorcelain` to core

**Files:**

- Create: `src/core/concurrency.ts`
- Create: `src/core/__tests__/concurrency.test.ts`
- Create: `src/core/git-porcelain.ts`
- Create: `src/core/__tests__/git-porcelain.test.ts`
- Modify: `src/prep/spawn.ts`
- Modify: `src/prep/prep-fanout.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/concurrency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '../concurrency';

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.toSorted()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // it actually ran in parallel
  });

  it('resolves immediately on empty input', async () => {
    let called = false;
    await runWithConcurrency([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it('passes the item index through', async () => {
    const pairs: Array<[string, number]> = [];
    await runWithConcurrency(['a', 'b'], 1, async (item, index) => {
      pairs.push([item, index]);
    });
    expect(pairs).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/core/__tests__/concurrency.test.ts
```

Expected output: `Cannot find module '../concurrency'` (or equivalent resolve error), 1 failed suite.

- [ ] **Step 3: Create `src/core/concurrency.ts`** (implementation moved verbatim from `src/prep/spawn.ts:37-57`):

```ts
/**
 * Run `fn` over `items` with at most `limit` in flight at once. Resolves when all
 * have completed; `fn` should swallow/record its own errors (a throw rejects the run).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor++;
          if (index >= items.length) break;
          await fn(items[index]!, index);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
```

- [ ] **Step 4: Write the failing git-porcelain test**

Create `src/core/__tests__/git-porcelain.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitStatusPorcelain } from '../git-porcelain';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'git-porcelain-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gitStatusPorcelain', () => {
  it('fails open to empty string outside a git repo', () => {
    expect(gitStatusPorcelain(dir)).toBe('');
  });
});
```

- [ ] **Step 5: Run to verify FAIL**

```bash
pnpm vitest run src/core/__tests__/git-porcelain.test.ts
```

Expected output: module-resolve failure for `../git-porcelain`.

- [ ] **Step 6: Create `src/core/git-porcelain.ts`** (implementation moved verbatim from `src/prep/prep-fanout.ts:21-27`, doc generalized):

```ts
import { execFileSync } from 'node:child_process';

/**
 * `git status --porcelain` (tracked changes only). Returns '' when git is
 * unavailable so callers' tree guards never block their run — fail-open by
 * contract. Callers snapshot before/after a spawn batch and warn on delta.
 */
export function gitStatusPorcelain(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
```

- [ ] **Step 7: Delete the hoisted code from prep** — in `src/prep/spawn.ts` remove the `runWithConcurrency` function and its JSDoc (lines 33-57; the file ends after `spawnClaude`). In `src/prep/prep-fanout.ts` remove the local `gitStatusPorcelain` function and its JSDoc (lines 16-27) and replace:

```ts
import { spawnClaude, runWithConcurrency } from './spawn.js';
```

with:

```ts
import { runWithConcurrency } from '../core/concurrency.js';
import { gitStatusPorcelain } from '../core/git-porcelain.js';
import { spawnClaude } from './spawn.js';
```

(Also drop the now-unused `execFileSync` import from `prep-fanout.ts` if nothing else in the file uses it.)

- [ ] **Step 8: Run to verify PASS**

```bash
pnpm vitest run src/core/__tests__/concurrency.test.ts src/core/__tests__/git-porcelain.test.ts src/prep && pnpm typecheck
```

Expected output: concurrency suite 4 passed, git-porcelain 1 passed; all prep suites pass; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/core/concurrency.ts src/core/__tests__/concurrency.test.ts src/core/git-porcelain.ts src/core/__tests__/git-porcelain.test.ts src/prep/spawn.ts src/prep/prep-fanout.ts
git commit -m "refactor(core): hoist runWithConcurrency + gitStatusPorcelain from prep to core" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 2: `researcher` role

**Files:**

- Modify: `src/core/agent-runner/types.ts`
- Modify: `src/core/agent-runner/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test** — append to the existing `describe('resolveRunner', …)` block in `src/core/agent-runner/__tests__/registry.test.ts`:

```ts
it('researcher is a declared role that defaults to claude', () => {
  expect(AGENT_ROLES).toContain('researcher');
  const cfg = agentsConfigSchema.parse({});
  expect(resolveRunner('researcher', cfg)).toEqual({ runner: 'claude' });
});
```

Add the needed imports: `import { AGENT_ROLES, agentsConfigSchema } from '../types';` (merge into the existing `../types` import if one exists). The `AGENT_ROLES` containment assertion is what makes this genuinely red: vitest transpiles without typechecking, and `resolveRunner('researcher', …)` alone would already return `{ runner: 'claude' }` today via the `cfg.default` fallback (`registry.ts:38-41`).

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts
```

Expected output: 1 failed — `expected [ 'implementer', 'reviewer', 'second-opinion', 'polish', 'verifier' ] to include 'researcher'`.

- [ ] **Step 3: Append the role** — in `src/core/agent-runner/types.ts` change:

```ts
export const AGENT_ROLES = [
  'implementer',
  'reviewer',
  'second-opinion',
  'polish',
  'verifier',
] as const;
```

to:

```ts
export const AGENT_ROLES = [
  'implementer',
  'reviewer',
  'second-opinion',
  'polish',
  'verifier',
  'researcher',
] as const;
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/core/agent-runner
```

Expected output: all agent-runner suites pass (registry/types/doctor-runners/runners/no-stray-spawns).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-runner/types.ts src/core/agent-runner/__tests__/registry.test.ts
git commit -m "feat(research): add researcher agent role" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 3: Research schemas (`src/research/types.ts`)

**Files:**

- Create: `src/research/types.ts`
- Test: `src/research/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/__tests__/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FALLBACK_META, researchMetaSchema, taskSpecSchema, tasksFileSchema } from '../types';

describe('taskSpecSchema', () => {
  it('accepts a minimal task and defaults scope to []', () => {
    const t = taskSpecSchema.parse({ id: 'cr-guard', question: 'How does X work?' });
    expect(t.scope).toEqual([]);
  });

  it('rejects non-kebab ids', () => {
    for (const id of ['Bad Id', 'UPPER', '-lead', 'trail/slash']) {
      expect(taskSpecSchema.safeParse({ id, question: 'q' }).success).toBe(false);
    }
  });

  it('rejects unknown keys (strict)', () => {
    expect(taskSpecSchema.safeParse({ id: 'a', question: 'q', extra: 1 }).success).toBe(false);
  });
});

describe('tasksFileSchema', () => {
  it('requires at least one task', () => {
    expect(tasksFileSchema.safeParse({ tasks: [] }).success).toBe(false);
  });
});

describe('researchMetaSchema', () => {
  it('accepts a full meta and defaults confidence/refs', () => {
    const m = researchMetaSchema.parse({ status: 'answered', headline: 'Uses archive-and-overwrite' });
    expect(m.confidence).toBe('med');
    expect(m.refs).toEqual([]);
  });

  it('rejects unknown status', () => {
    expect(researchMetaSchema.safeParse({ status: 'maybe', headline: 'h' }).success).toBe(false);
  });
});

describe('FALLBACK_META', () => {
  it('is itself schema-valid', () => {
    expect(researchMetaSchema.safeParse(FALLBACK_META).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/research
```

Expected output: module-resolve failure for `../types`.

- [ ] **Step 3: Create `src/research/types.ts`**

```ts
import { z } from 'zod';

/** One independent research question; `id` is the findings-file stem. */
export const taskSpecSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a kebab-case filename stem'),
    question: z.string().min(1),
    /** Paths/globs to focus on — a hint for the agent, not a sandbox. */
    scope: z.array(z.string().min(1)).default([]),
    /** Self-contained background; children never inherit session history. */
    context: z.string().optional(),
    /** What a good answer contains. */
    expects: z.string().optional(),
  })
  .strict();
export type TaskSpec = z.infer<typeof taskSpecSchema>;

export const tasksFileSchema = z.object({ tasks: z.array(taskSpecSchema).min(1) }).strict();

/** The fenced-JSON trailer every researcher must end its final message with. */
export const researchMetaSchema = z
  .object({
    status: z.enum(['answered', 'partial', 'blocked']),
    headline: z.string().min(1),
    confidence: z.enum(['low', 'med', 'high']).default('med'),
    refs: z.array(z.string()).default([]),
  })
  .strict();
export type ResearchMeta = z.infer<typeof researchMetaSchema>;

/** Applied whenever the envelope cannot be parsed — raw output is still preserved. */
export const FALLBACK_META: ResearchMeta = {
  status: 'blocked',
  headline: 'unparsed output',
  confidence: 'low',
  refs: [],
};

/** Per-task outcome computed by the CLI (the only writer). */
export interface ResearchResult {
  readonly id: string;
  readonly question: string;
  /** Spawn succeeded (exit 0, no timeout) AND the envelope parsed. */
  readonly ok: boolean;
  /** 'ok' | 'timeout' | 'exit <n>' | 'error: <msg>' */
  readonly spawnStatus: string;
  readonly meta: ResearchMeta;
  /** Batch-dir-relative findings filename. */
  readonly findingsFile: string;
}

export interface ResearchManifest {
  readonly startedAt: string;
  readonly batchDir: string;
  readonly results: readonly ResearchResult[];
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/research
```

Expected output: types suite passes (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/research/types.ts src/research/__tests__/types.test.ts
git commit -m "feat(research): task/meta schemas + result types" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 4: Prompt builder + envelope parser (`src/research/prompt.ts`)

**Files:**

- Create: `src/research/prompt.ts`
- Test: `src/research/__tests__/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/__tests__/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildResearchPrompt, parseResearchStdout } from '../prompt';
import { FALLBACK_META, taskSpecSchema } from '../types';

const task = taskSpecSchema.parse({
  id: 'cr-guard',
  question: 'How does the CR overwrite-guard decide archive vs skip?',
  scope: ['src/cr/'],
  context: 'CR sinks live under .noldor/cr/.',
  expects: 'Name the deciding function and its inputs.',
});

describe('buildResearchPrompt', () => {
  it('carries question, scope, context, expects and the read-only directive', () => {
    const p = buildResearchPrompt(task);
    expect(p).toContain(task.question);
    expect(p).toContain('src/cr/');
    expect(p).toContain('CR sinks live under');
    expect(p).toContain('Name the deciding function');
    expect(p).toMatch(/do not edit, write, create, or delete/i);
    expect(p).toContain('```json');
  });

  it('omits optional sections cleanly', () => {
    const bare = taskSpecSchema.parse({ id: 'a', question: 'q?' });
    const p = buildResearchPrompt(bare);
    expect(p).not.toContain('Context:');
    expect(p).not.toContain('Start here:');
  });
});

describe('parseResearchStdout', () => {
  const meta = '```json\n{"status":"answered","headline":"Uses guardLaneOverwrite"}\n```';

  it('splits findings from the trailing meta fence', () => {
    const r = parseResearchStdout(`## Findings\n\nBody text.\n\n${meta}\n`);
    expect(r.parsed).toBe(true);
    expect(r.meta.status).toBe('answered');
    expect(r.findings).toBe('## Findings\n\nBody text.');
  });

  it('uses the LAST json fence when several exist', () => {
    const first = '```json\n{"status":"blocked","headline":"early example"}\n```';
    const r = parseResearchStdout(`${first}\n\nmore text\n\n${meta}`);
    expect(r.parsed).toBe(true);
    expect(r.meta.headline).toBe('Uses guardLaneOverwrite');
  });

  it('falls back on missing fence — raw output preserved', () => {
    const r = parseResearchStdout('just prose, no fence');
    expect(r.parsed).toBe(false);
    expect(r.meta).toEqual(FALLBACK_META);
    expect(r.findings).toBe('just prose, no fence');
  });

  it('falls back on invalid JSON', () => {
    const r = parseResearchStdout('text\n```json\n{not json}\n```');
    expect(r.parsed).toBe(false);
    expect(r.findings).toContain('text');
  });

  it('falls back on schema-invalid meta', () => {
    const r = parseResearchStdout('text\n```json\n{"status":"maybe","headline":"h"}\n```');
    expect(r.parsed).toBe(false);
  });

  it('falls back on empty stdout', () => {
    const r = parseResearchStdout('');
    expect(r.parsed).toBe(false);
    expect(r.findings).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/research/__tests__/prompt.test.ts
```

Expected output: module-resolve failure for `../prompt`.

- [ ] **Step 3: Create `src/research/prompt.ts`**

```ts
import { FALLBACK_META, researchMetaSchema, type ResearchMeta, type TaskSpec } from './types.js';

/**
 * Self-contained prompt for one read-only researcher child. Directives ride the
 * prompt, never env/flags (PR #33 rule, enforced at the spawnAgent seam).
 */
export function buildResearchPrompt(task: TaskSpec): string {
  const lines: string[] = [
    'You are a read-only research agent investigating this repository.',
    'Answer ONE question. Do NOT edit, write, create, or delete any file;',
    'do not run state-changing commands (no git commit/push, no installs).',
    'Your entire deliverable is your final message.',
    '',
    `Question: ${task.question}`,
  ];
  if (task.context !== undefined) lines.push('', `Context: ${task.context}`);
  if (task.scope.length > 0) lines.push('', `Start here: ${task.scope.join(', ')}`);
  if (task.expects !== undefined) lines.push('', `A good answer: ${task.expects}`);
  lines.push(
    '',
    'Return contract — your final message MUST be:',
    '1. Markdown findings: the answer first, then evidence citing real file:line paths.',
    '2. Terminated by exactly one fenced ```json block holding:',
    '   {"status":"answered|partial|blocked","headline":"<one-line answer>","confidence":"low|med|high","refs":["<file paths you cite>"]}',
  );
  return lines.join('\n');
}

export interface ParsedResearchOutput {
  readonly findings: string;
  readonly meta: ResearchMeta;
  /** False when the meta fence was missing/invalid — meta is FALLBACK_META. */
  readonly parsed: boolean;
}

const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n\s*```/g;

/**
 * Split a child's stdout into findings + meta. Takes the LAST ```json fence as
 * meta; everything before it is findings. Never throws — unparseable output is
 * preserved verbatim with {@link FALLBACK_META}.
 */
export function parseResearchStdout(stdout: string): ParsedResearchOutput {
  const matches = [...stdout.matchAll(JSON_FENCE_RE)];
  const last = matches.at(-1);
  if (!last) return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]!);
  } catch {
    return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  }
  const meta = researchMetaSchema.safeParse(raw);
  if (!meta.success) return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  return { findings: stdout.slice(0, last.index).trim(), meta: meta.data, parsed: true };
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/research
```

Expected output: types + prompt suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/research/prompt.ts src/research/__tests__/prompt.test.ts
git commit -m "feat(research): researcher prompt builder + stdout envelope parser" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 5: Staging (`src/research/staging.ts`)

**Files:**

- Create: `src/research/staging.ts`
- Test: `src/research/__tests__/staging.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `src/research/__tests__/staging.test.ts`:

```ts
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBatchDir, renderIndex } from '../staging';
import type { ResearchManifest } from '../types';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'research-staging-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const NOW = new Date('2026-07-01T14:22:33.000Z');

describe('createBatchDir', () => {
  it('creates .noldor/research/<YYYY-MM-DD-HHMMSS>', () => {
    const b = createBatchDir(cwd, NOW);
    expect(b.rel).toBe(join('.noldor', 'research', '2026-07-01-142233'));
    expect(existsSync(b.abs)).toBe(true);
  });

  it('suffixes -2, -3 on same-second collision', () => {
    const first = createBatchDir(cwd, NOW);
    const second = createBatchDir(cwd, NOW);
    const third = createBatchDir(cwd, NOW);
    expect(first.rel.endsWith('142233')).toBe(true);
    expect(second.rel.endsWith('142233-2')).toBe(true);
    expect(third.rel.endsWith('142233-3')).toBe(true);
  });
});

describe('renderIndex', () => {
  it('renders one row per result and escapes pipes in headlines', () => {
    const manifest: ResearchManifest = {
      startedAt: NOW.toISOString(),
      batchDir: '.noldor/research/2026-07-01-142233',
      results: [
        {
          id: 'cr-guard',
          question: 'How does the guard work?',
          ok: true,
          spawnStatus: 'ok',
          meta: { status: 'answered', headline: 'uses a | pipe', confidence: 'high', refs: [] },
          findingsFile: 'cr-guard.findings.md',
        },
        {
          id: 'drain-rules',
          question: 'Where are eligibility rules?',
          ok: false,
          spawnStatus: 'timeout',
          meta: { status: 'blocked', headline: 'unparsed output', confidence: 'low', refs: [] },
          findingsFile: 'drain-rules.findings.md',
        },
      ],
    };
    const md = renderIndex(manifest);
    expect(md).toContain('| cr-guard | answered | high | uses a \\| pipe |');
    expect(md).toContain('[cr-guard.findings.md](cr-guard.findings.md)');
    expect(md).toContain('| drain-rules | blocked |');
    expect(md).toContain('timeout');
    expect(md).toContain('1/2 ok');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/research/__tests__/staging.test.ts
```

Expected output: module-resolve failure for `../staging`.

- [ ] **Step 3: Create `src/research/staging.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResearchManifest } from './types.js';

export interface BatchDir {
  /** Repo-root-relative, e.g. `.noldor/research/2026-07-01-142233`. */
  readonly rel: string;
  readonly abs: string;
}

/** `2026-07-01T14:22:33.456Z` → `2026-07-01-142233`. */
function stampFor(now: Date): string {
  return now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
}

/**
 * Atomically claim a fresh batch dir. Non-recursive `mkdirSync` + EEXIST retry
 * with a `-2`, `-3`… suffix — no exists-check (check-then-act races for the
 * two-batches-same-second case this exists to solve).
 */
export function createBatchDir(cwd: string, now: Date): BatchDir {
  const root = join(cwd, '.noldor', 'research');
  mkdirSync(root, { recursive: true });
  const stamp = stampFor(now);
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? stamp : `${stamp}-${attempt}`;
    const abs = join(root, name);
    try {
      mkdirSync(abs);
      return { rel: join('.noldor', 'research', name), abs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 100) throw err;
    }
  }
}

export function findingsFileName(id: string): string {
  return `${id}.findings.md`;
}

export function writeManifest(batchAbs: string, manifest: ResearchManifest): void {
  writeFileSync(join(batchAbs, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Deterministic findings table — the one artifact a driving session must read. */
export function renderIndex(manifest: ResearchManifest): string {
  const okCount = manifest.results.filter((r) => r.ok).length;
  const lines = [
    '# Research Fanout Index',
    '',
    `Started: ${manifest.startedAt} — ${okCount}/${manifest.results.length} ok`,
    '',
    '| id | status | confidence | headline | spawn | findings |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of manifest.results) {
    lines.push(
      `| ${escapeCell(r.id)} | ${r.meta.status} | ${r.meta.confidence} | ${escapeCell(r.meta.headline)} | ${escapeCell(r.spawnStatus)} | [${r.findingsFile}](${r.findingsFile}) |`,
    );
  }
  lines.push('', 'Exit code 0 = every agent ran and parsed — NOT that questions were answered; read the status column.', '');
  return lines.join('\n');
}
```

- [ ] **Step 4: Add `.noldor/research/` to `.gitignore`** — append the line after the existing `.noldor/prep-batch/` entry:

```
.noldor/research/
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/research
```

Expected output: types + prompt + staging suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/research/staging.ts src/research/__tests__/staging.test.ts .gitignore
git commit -m "feat(research): atomic batch-dir staging + INDEX renderer" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 6: Fanout CLI (`src/research/fanout.ts`)

**Files:**

- Create: `src/research/fanout.ts`
- Test: `src/research/__tests__/fanout.test.ts`
- Modify: `src/cli/manifest.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/__tests__/fanout.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTasks, parseArgs, run, type SpawnAgentLike } from '../fanout';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'research-fanout-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const NOW = new Date('2026-07-01T14:22:33.000Z');

function okSpawn(headline = 'answer'): SpawnAgentLike {
  return vi.fn(async () => ({
    exitCode: 0,
    stdout: `Findings body.\n\n\`\`\`json\n{"status":"answered","headline":"${headline}"}\n\`\`\``,
    timedOut: false,
  }));
}

describe('parseArgs', () => {
  it('defaults: max 4, timeout 900000, no flags', () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({ max: 4, timeoutMs: 900_000, synthesize: false, dryRun: false, json: false, inlineTasks: [] });
  });

  it('collects repeated --task and parses flags', () => {
    const a = parseArgs(['--task', 'q1', '--task', 'q2', '--max', '2', '--timeout', '1000', '--synthesize', '--dry-run', '--json', '--tasks', 't.json']);
    expect(a.inlineTasks).toEqual(['q1', 'q2']);
    expect(a).toMatchObject({ max: 2, timeoutMs: 1000, synthesize: true, dryRun: true, json: true, tasksFile: 't.json' });
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/);
  });
});

describe('loadTasks', () => {
  it('namespaces inline tasks as cli-task-<n> and concatenates after the file', () => {
    writeFileSync(join(cwd, 't.json'), JSON.stringify({ tasks: [{ id: 'task-1', question: 'from file' }] }), 'utf8');
    const tasks = loadTasks({ ...parseArgs(['--tasks', 't.json', '--task', 'inline q']) }, cwd);
    expect(tasks.map((t) => t.id)).toEqual(['task-1', 'cli-task-1']);
  });

  it('throws on duplicate ids', () => {
    writeFileSync(join(cwd, 't.json'), JSON.stringify({ tasks: [{ id: 'a', question: 'q' }, { id: 'a', question: 'q2' }] }), 'utf8');
    expect(() => loadTasks(parseArgs(['--tasks', 't.json']), cwd)).toThrow(/duplicate task id/);
  });

  it('throws when no tasks are given', () => {
    expect(() => loadTasks(parseArgs([]), cwd)).toThrow(/no tasks/);
  });
});

describe('run', () => {
  it('all-ok: writes findings + INDEX + manifest, exits 0', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--task', 'q2'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(0);
    const batch = join(cwd, '.noldor', 'research', '2026-07-01-142233');
    expect(existsSync(join(batch, 'cli-task-1.findings.md'))).toBe(true);
    expect(existsSync(join(batch, 'INDEX.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(batch, 'manifest.json'), 'utf8'));
    expect(manifest.results).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('a rejected spawn fails only its task — batch completes, exit 1', async () => {
    let call = 0;
    const spawn: SpawnAgentLike = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('spawn-failed: ENOENT');
      return { exitCode: 0, stdout: 'ok\n```json\n{"status":"answered","headline":"h"}\n```', timedOut: false };
    });
    const code = await run(['--task', 'q1', '--task', 'q2'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(1);
    const manifest = JSON.parse(readFileSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'manifest.json'), 'utf8'));
    const statuses = manifest.results.map((r: { spawnStatus: string }) => r.spawnStatus).toSorted();
    expect(statuses[0]).toMatch(/^error: spawn-failed/);
    expect(statuses[1]).toBe('ok');
  });

  it('unparseable stdout: raw preserved, exit 1', async () => {
    const spawn: SpawnAgentLike = vi.fn(async () => ({ exitCode: 0, stdout: 'no fence here', timedOut: false }));
    const code = await run(['--task', 'q1'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(1);
    const findings = readFileSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'cli-task-1.findings.md'), 'utf8');
    expect(findings).toContain('no fence here');
  });

  it('dry-run lists tasks and spawns nothing', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--dry-run'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.noldor', 'research'))).toBe(false);
  });

  it('--synthesize with >=2 ok findings writes SYNTHESIS.md via one extra spawn', async () => {
    const spawn = okSpawn();
    const code = await run(['--task', 'q1', '--task', 'q2', '--synthesize'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(existsSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'SYNTHESIS.md'))).toBe(true);
  });

  it('synthesis failure degrades to warning — exit stays 0', async () => {
    let call = 0;
    const spawn: SpawnAgentLike = vi.fn(async () => {
      call++;
      if (call === 3) return { exitCode: 1, stdout: '', timedOut: false };
      return { exitCode: 0, stdout: 'ok\n```json\n{"status":"answered","headline":"h"}\n```', timedOut: false };
    });
    const code = await run(['--task', 'q1', '--task', 'q2', '--synthesize'], { cwd, now: () => NOW, spawnAgentImpl: spawn });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.noldor', 'research', '2026-07-01-142233', 'SYNTHESIS.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/research/__tests__/fanout.test.ts
```

Expected output: module-resolve failure for `../fanout`.

- [ ] **Step 3: Create `src/research/fanout.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { runWithConcurrency } from '../core/concurrency.js';
import { gitStatusPorcelain } from '../core/git-porcelain.js';
import { spawnAgent } from '../core/agent-runner/registry.js';

import { buildResearchPrompt, parseResearchStdout } from './prompt.js';
import { createBatchDir, findingsFileName, renderIndex, writeManifest } from './staging.js';
import { FALLBACK_META, tasksFileSchema, type ResearchResult, type TaskSpec } from './types.js';

export interface FanoutArgs {
  tasksFile?: string;
  inlineTasks: string[];
  max: number;
  timeoutMs: number;
  synthesize: boolean;
  dryRun: boolean;
  json: boolean;
}

function intArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Consume a flag's value; a missing value or a following `--flag` is a usage error. */
function strArg(value: string | undefined, name: string): string {
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseArgs(argv: readonly string[]): FanoutArgs {
  const args: FanoutArgs = {
    inlineTasks: [],
    max: 4,
    timeoutMs: 900_000,
    synthesize: false,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--synthesize') args.synthesize = true;
    else if (a === '--max') args.max = intArg(argv[++i], '--max');
    else if (a === '--timeout') args.timeoutMs = intArg(argv[++i], '--timeout');
    else if (a === '--tasks') args.tasksFile = strArg(argv[++i], '--tasks');
    else if (a === '--task') args.inlineTasks.push(strArg(argv[++i], '--task'));
    else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

/**
 * File tasks first, then inline sugar namespaced `cli-task-<n>` (so a file that
 * legitimately contains `task-1` never trips the duplicate-id error).
 */
export function loadTasks(args: FanoutArgs, cwd: string): TaskSpec[] {
  const tasks: TaskSpec[] = [];
  if (args.tasksFile !== undefined) {
    const path = isAbsolute(args.tasksFile) ? args.tasksFile : join(cwd, args.tasksFile);
    tasks.push(...tasksFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).tasks);
  }
  args.inlineTasks.forEach((question, i) => {
    tasks.push({ id: `cli-task-${i + 1}`, question, scope: [] });
  });
  if (tasks.length === 0) throw new Error('no tasks: pass --tasks <file.json> and/or --task "<question>"');
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
  }
  return tasks;
}

/** Matches the shape of {@link spawnAgent} that fanout consumes — DI seam for tests. */
export type SpawnAgentLike = (
  prompt: string,
  opts: {
    role: 'researcher';
    needsWrite: false;
    stdio: 'pipe';
    site: string;
    timeoutMs: number;
    cwd: string;
  },
) => Promise<{ exitCode: number; stdout: string; timedOut: boolean }>;

export interface RunDeps {
  cwd?: string;
  now?: () => Date;
  spawnAgentImpl?: SpawnAgentLike;
}

const COST_WARN_TASKS = 8;

export async function run(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const args = parseArgs(argv);
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? (() => new Date());
  // spawnAgent is structurally assignable: SpawnAgentLike's opts are narrower
  // than SpawnAgentOpts and AgentResult matches the return shape — no cast.
  const spawn: SpawnAgentLike = deps.spawnAgentImpl ?? spawnAgent;

  const tasks = loadTasks(args, cwd);

  if (args.dryRun) {
    const list = tasks.map((t) => `  ${t.id}: ${t.question}`).join('\n');
    process.stdout.write(
      args.json
        ? `${JSON.stringify({ dryRun: true, tasks: tasks.map((t) => ({ id: t.id, question: t.question })) })}\n`
        : `research fanout (dry-run): ${tasks.length} task(s) would run:\n${list}\n`,
    );
    return 0;
  }

  if (tasks.length > COST_WARN_TASKS) {
    process.stderr.write(
      `research fanout: WARNING — ${tasks.length} tasks (> ${COST_WARN_TASKS}); each spawns a full agent. Consider batching.\n`,
    );
  }

  const startedDate = now(); // one capture — manifest.startedAt and the dir stamp must agree
  const startedAt = startedDate.toISOString();
  const batch = createBatchDir(cwd, startedDate);
  process.stderr.write(
    `research fanout: ${tasks.length} researcher(s) into ${batch.rel} (max ${args.max} concurrent)\n`,
  );

  const preStatus = gitStatusPorcelain(cwd);
  const results: ResearchResult[] = new Array(tasks.length);
  await runWithConcurrency(tasks, args.max, async (task, index) => {
    process.stderr.write(`  -> researching ${task.id}\n`);
    const file = findingsFileName(task.id);
    // Whole worker body guarded: ANY throw (spawn rejection, parse bug, disk
    // error on write) must fail only this task — runWithConcurrency rejects
    // the whole run on an uncaught throw and would lose the in-flight batch.
    try {
      let spawnStatus: string;
      let stdout = '';
      try {
        const res = await spawn(buildResearchPrompt(task), {
          role: 'researcher',
          needsWrite: false,
          stdio: 'pipe',
          site: 'research.fanout',
          timeoutMs: args.timeoutMs,
          cwd,
        });
        stdout = res.stdout;
        spawnStatus = res.timedOut ? 'timeout' : res.exitCode === 0 ? 'ok' : `exit ${res.exitCode}`;
      } catch (err) {
        spawnStatus = `error: ${(err as Error).message}`;
      }
      const parsed = parseResearchStdout(stdout);
      // Comment header carries enum/kebab-safe fields only (id regex + status
      // enum) — free text like spawnStatus could embed `-->`; it lives in the
      // manifest and INDEX instead.
      const header = `<!-- research id:${task.id} status:${parsed.meta.status} -->`;
      writeFileSync(join(batch.abs, file), `${header}\n\n${parsed.findings}\n`, 'utf8');
      results[index] = {
        id: task.id,
        question: task.question,
        ok: spawnStatus === 'ok' && parsed.parsed,
        spawnStatus,
        meta: parsed.meta,
        findingsFile: file,
      };
    } catch (err) {
      results[index] = {
        id: task.id,
        question: task.question,
        ok: false,
        spawnStatus: `error: ${(err as Error).message}`,
        meta: FALLBACK_META,
        findingsFile: file,
      };
    }
  });

  // Post-batch tree diff: any change vs the pre-spawn snapshot means a child
  // violated the read-only contract (the batch dir itself is gitignored). Warn,
  // never fail — mirrors prep-fanout's D3 posture.
  const postStatus = gitStatusPorcelain(cwd);
  if (postStatus !== preStatus) {
    process.stderr.write(
      `research fanout: WARNING — tracked files changed during fanout (a read-only child wrote); review with \`git status\`:\n${postStatus}\n`,
    );
  }

  const okResults = results.filter((r) => r.ok);
  let synthesized = false;
  if (args.synthesize) {
    if (okResults.length >= 2) {
      const prompt = [
        'You are a read-only synthesis agent. Read the research findings files below',
        '(you may read files; do NOT edit, write, create, or delete anything).',
        'Merge them into one coherent markdown synthesis: agreements, contradictions,',
        'gaps, and a short "what this means" section. Your final message IS the synthesis.',
        '',
        'Questions asked:',
        ...okResults.map((r) => `- ${r.id}: ${r.question}`),
        '',
        'Findings files:',
        ...okResults.map((r) => `- ${join(batch.abs, r.findingsFile)}`),
      ].join('\n');
      try {
        const res = await spawn(prompt, {
          role: 'researcher',
          needsWrite: false,
          stdio: 'pipe',
          site: 'research.synthesize',
          timeoutMs: args.timeoutMs,
          cwd,
        });
        if (!res.timedOut && res.exitCode === 0 && res.stdout.trim().length > 0) {
          writeFileSync(join(batch.abs, 'SYNTHESIS.md'), `${res.stdout.trim()}\n`, 'utf8');
          synthesized = true;
        } else {
          process.stderr.write('research fanout: WARNING — synthesis agent failed; findings + INDEX stand alone.\n');
        }
      } catch (err) {
        process.stderr.write(`research fanout: WARNING — synthesis spawn failed (${(err as Error).message}); findings + INDEX stand alone.\n`);
      }
    } else {
      process.stderr.write(`research fanout: skipping synthesis (${okResults.length} ok finding(s), need >= 2).\n`);
    }
  }

  const manifest = { startedAt, batchDir: batch.rel, results };
  writeManifest(batch.abs, manifest);
  writeFileSync(join(batch.abs, 'INDEX.md'), renderIndex(manifest), 'utf8');

  const okCount = okResults.length;
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ batchDir: batch.rel, ok: okCount, total: results.length, synthesized, index: join(batch.rel, 'INDEX.md') })}\n`,
    );
  } else {
    process.stdout.write(
      `research fanout: ${okCount}/${results.length} ok. Read ${join(batch.rel, 'INDEX.md')}${synthesized ? ` + ${join(batch.rel, 'SYNTHESIS.md')}` : ''}.\n`,
    );
    for (const r of results) {
      if (!r.ok) process.stdout.write(`  ! ${r.id}: ${r.spawnStatus}${r.spawnStatus === 'ok' ? ' (envelope unparsed)' : ''}\n`);
    }
  }
  return okCount === results.length ? 0 : 1;
}

function main(): void {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`research fanout: ${(err as Error).message}\n`);
      process.exit(1);
    });
}

const invokedDirect = /[\\/]fanout\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
```

(The `gitStatusPorcelain` before/after pair implements the spec's belt-and-braces guard for the prompt-enforced read-only contract; it returns `''` outside a git repo, so the temp-dir tests are unaffected.)

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/research
```

Expected output: all 4 research suites pass.

- [ ] **Step 5: Register the CLI group** — in `src/cli/manifest.ts`, insert after the `prep` group's closing `},`:

```ts
  research: {
    desc: 'Parallel read-only research agents (fanout + opt-in synthesis)',
    subs: {
      fanout: {
        src: 'research/fanout.ts',
        desc: 'Spawn one researcher per task (--tasks file / --task sugar); findings + INDEX.md (+ --synthesize)',
      },
    },
  },
```

- [ ] **Step 6: Verify CLI wiring + full suite**

```bash
pnpm noldor research fanout --dry-run --task "smoke question" && pnpm test 2>&1 | tail -3
```

Expected output: `research fanout (dry-run): 1 task(s) would run:` then all test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/research/fanout.ts src/research/__tests__/fanout.test.ts src/cli/manifest.ts
git commit -m "feat(research): noldor research fanout CLI (parallel read-only researchers)" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 7: Skill + docs page + catalog/runtimes/README rows (+ twins)

**Files:**

- Create: `.claude/skills/noldor-research/SKILL.md`
- Create: `templates/.claude/skills/noldor-research/SKILL.md`
- Create: `docs/noldor/research-fanout.md`
- Create: `templates/docs/noldor/research-fanout.md`
- Modify: `docs/noldor/skill-catalog.md` + `templates/docs/noldor/skill-catalog.md`
- Modify: `docs/noldor/agent-runtimes.md` + `templates/docs/noldor/agent-runtimes.md`
- Modify: `docs/noldor/README.md` + `templates/docs/noldor/README.md`

- [ ] **Step 1: Create `.claude/skills/noldor-research/SKILL.md`**

```markdown
---
name: noldor-research
description: Fan out parallel read-only research agents via `pnpm noldor research fanout`. Use when facing 2+ independent read-only questions (codebase research, multi-subsystem investigation, cross-file audits, pre-spec understanding) whose answers don't depend on each other.
---

# /noldor-research

Dispatch one context-isolated researcher agent per independent question, in parallel, then synthesize. Protects the driving session's context: you read the INDEX (and selected findings), not every intermediate file dump.

## When

- 2+ independent **read-only** questions. One question → just investigate inline.
- Answers must not depend on each other (task B never consumes task A's output — if it does, run sequentially or merge into one task).
- Never fan out write-work — building/fixing in parallel is the drain's job.

## Flow

1. **Decompose.** One task per independent question. Each task self-contained: the child inherits NO session history — put everything it needs in `context`, point it at starting paths via `scope`, state what a good answer contains in `expects`.
2. **Write the tasks file** (skip for quick one-liners — use repeated `--task "<question>"` instead):

   ```json
   {
     "tasks": [
       {
         "id": "cr-guard",
         "question": "How does the CR overwrite-guard decide archive vs skip?",
         "scope": ["src/cr/"],
         "context": "CR sinks live under .noldor/cr/; the guard runs inside cr orchestrate.",
         "expects": "Name the deciding function, its inputs, and each outcome."
       }
     ]
   }
   ```

3. **Run:**

   ```bash
   pnpm noldor research fanout --tasks tasks.json [--synthesize] [--max 4] [--timeout 900000]
   ```

4. **Read `INDEX.md`** in the printed batch dir (`.noldor/research/<stamp>/`). Exit code 0 = every agent ran and parsed — NOT that questions were answered; read the status column. Pull individual `<id>.findings.md` only where the headline isn't enough; `--synthesize` adds `SYNTHESIS.md` when you want one merged artifact.
5. **Integrate.** Fold what matters into the artifact you're writing (spec, plan, audit). Cite the batch dir path so the trail survives.

## Rules

- Researchers are read-only by contract (`needsWrite: false` + prompt directive); they return findings via stdout — the CLI is the only writer.
- Task `id`s are kebab-case filename stems; duplicates are a usage error.
- The operator's explicit instructions always override this skill.
```

- [ ] **Step 2: Copy to the twin**

```bash
mkdir -p templates/.claude/skills/noldor-research
cp .claude/skills/noldor-research/SKILL.md templates/.claude/skills/noldor-research/SKILL.md
```

- [ ] **Step 3: Create `docs/noldor/research-fanout.md`**

```markdown
---
noldor-page: research-fanout
---

# Research Fanout

Parallel read-only research agents: `pnpm noldor research fanout` takes N independent task specs, spawns one context-isolated `researcher` agent per task through the [agent-runner registry](agent-runtimes.md) (max K concurrent), and writes findings + a deterministic `INDEX.md` to a gitignored staging dir. The build-side twin of this read-side primitive is the K-concurrent drain.

## CLI

```bash
pnpm noldor research fanout --tasks tasks.json --synthesize --max 4 --timeout 900000
pnpm noldor research fanout --task "quick question A" --task "quick question B"
```

- `--tasks <file.json>` — canonical input; zod-validated `{ "tasks": [{ id, question, scope?, context?, expects? }] }`. `id` is a kebab-case filename stem; duplicates error.
- `--task "<question>"` — repeatable sugar; ids are namespaced `cli-task-<n>` and concatenate after the file's tasks.
- `--max <n>` (default 4) — concurrency cap. More than 8 tasks warns (each task is a full agent spawn).
- `--timeout <ms>` (default 900000) — per-task; timeout SIGKILLs the child's process group.
- `--synthesize` — after collection, one extra agent reads the findings files and writes `SYNTHESIS.md`. Skipped below 2 ok findings; failure degrades to a warning.
- `--dry-run` / `--json` — list without spawning / machine output.

## Output layout

`.noldor/research/<YYYY-MM-DD-HHMMSS>[-n]/` (gitignored; suffix claims a fresh dir atomically when two batches start the same second):

- `<id>.findings.md` — per-task findings (raw child output preserved even when the envelope fails to parse)
- `INDEX.md` — findings table: id, status (`answered|partial|blocked`), confidence, headline, spawn status, link
- `manifest.json` — machine twin of INDEX
- `SYNTHESIS.md` — only with `--synthesize`

**Exit code 0 means every agent ran and its envelope parsed — NOT that questions were answered.** A batch of all-`blocked` findings still exits 0; headless callers read the INDEX status column (or `manifest.json`), not just the exit code.

## Return contract (envelope)

Children are read-only (`needsWrite: false` + prompt directive) and return everything via stdout: markdown findings terminated by one fenced ```json block — `{"status","headline","confidence","refs"}`. The CLI takes the LAST json fence as meta; a missing/invalid fence falls back to `status: blocked` with the raw output preserved. The CLI is the only writer.

## Telemetry

Every spawn appends an [agent-event](agent-runtimes.md) with `role: researcher` and `site: research.fanout` (`research.synthesize` for the synthesis pass).

## Integration points

The primitive is caller-agnostic; invoke it from:

- **Gate spec-stage** — "understand X before we spec it" (via the `noldor-research` skill)
- **Plan-stage investigation** — survey the files a plan will touch
- **`/garden` deep-dives** — parallel audits of drift candidates
- **Standalone operator research** — quick `--task` one-liners

Auto-wiring these flows is deliberately out of scope; each adoption is its own roadmap entry.
```

- [ ] **Step 4: Copy to the twin**

```bash
cp docs/noldor/research-fanout.md templates/docs/noldor/research-fanout.md
```

- [ ] **Step 5: Catalog section** — in `docs/noldor/skill-catalog.md`: change the intro sentence `Noldor ships 11 user-invocable skills` → `Noldor ships 12 user-invocable skills`, and append after the `## /noldor-plan` section:

```markdown
## /noldor-research

- **Trigger:** `/noldor-research`. Manual, any time 2+ independent read-only questions pile up.
- **Inputs:** independent research questions; optionally a `tasks.json` (`id`/`question`/`scope`/`context`/`expects` per task).
- **Outputs:** a `.noldor/research/<stamp>/` batch — per-task `<id>.findings.md`, `INDEX.md`, `manifest.json`, optional `SYNTHESIS.md` (`--synthesize`). Read-only: researcher children return via stdout; the CLI is the only writer. See [`research-fanout.md`](research-fanout.md).
- **When to use:** codebase research, multi-subsystem investigation, cross-file audits, "understand X before we spec it" — whenever the questions don't depend on each other. Never for write-work (that's the drain's job).
```

- [ ] **Step 6: Runtimes prose** — in `docs/noldor/agent-runtimes.md` change:

```markdown
Roles: `implementer` (drain gate runs, prep fanout), `reviewer` (CR subagent
```

to:

```markdown
Roles: `implementer` (drain gate runs, prep fanout), `researcher` (research
fanout — read-only, stdout-return), `reviewer` (CR subagent
```

- [ ] **Step 7: README Pages bullet** — in `docs/noldor/README.md`, insert into the `## Pages` list after the `graph-integration.md` bullet:

```markdown
- [`research-fanout.md`](research-fanout.md) — parallel read-only research agents: task specs, envelope contract, INDEX/synthesis
```

- [ ] **Step 8: Sync the three modified twins**

```bash
cp docs/noldor/skill-catalog.md templates/docs/noldor/skill-catalog.md
cp docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
cp docs/noldor/README.md templates/docs/noldor/README.md
```

- [ ] **Step 9: Run to verify PASS**

```bash
pnpm noldor validate skill-catalog && pnpm noldor validate noldor
```

Expected output: both validators exit clean (skill-catalog heading ↔ `.claude/skills/noldor-research` mapping satisfied; `noldor-page: research-fanout` frontmatter valid).

- [ ] **Step 10: Commit** (docs/noldor staged → commit scope must be `noldor`):

```bash
git add .claude/skills/noldor-research templates/.claude/skills/noldor-research docs/noldor/research-fanout.md templates/docs/noldor/research-fanout.md docs/noldor/skill-catalog.md templates/docs/noldor/skill-catalog.md docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md docs/noldor/README.md templates/docs/noldor/README.md
git commit -m "docs(noldor): add research-fanout page + noldor-research skill, catalog/runtimes/README rows" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```

---

## Task 8: FD links + full verification

**Files:**

- Modify: `docs/features/parallel-agent-dispatch-for-research-jobs.md`

- [ ] **Step 1: Correct the FD `links` frontmatter** — replace the promote-time guesses with what shipped:

```yaml
links:
  code:
    - src/research/types.ts
    - src/research/prompt.ts
    - src/research/staging.ts
    - src/research/fanout.ts
    - src/core/concurrency.ts
    - src/core/agent-runner/types.ts
    - src/cli/manifest.ts
    - .claude/skills/noldor-research/SKILL.md
    - docs/noldor/research-fanout.md
  tests:
    - src/research/__tests__/types.test.ts
    - src/research/__tests__/prompt.test.ts
    - src/research/__tests__/staging.test.ts
    - src/research/__tests__/fanout.test.ts
    - src/core/__tests__/concurrency.test.ts
  spec: docs/design/specs/2026-07-01-parallel-agent-dispatch-for-research-jobs-design.md
```

- [ ] **Step 2: Full verification**

```bash
pnpm noldor validate features && pnpm typecheck && pnpm test 2>&1 | tail -3
```

Expected output: `Validated 51 feature MD(s) — all OK.`; typecheck clean; all test files pass (232 + 5 new suites).

- [ ] **Step 3: Commit**

```bash
git add docs/features/parallel-agent-dispatch-for-research-jobs.md
git commit -m "docs(features:parallel-agent-dispatch-for-research-jobs): final links.code/tests" -m "Noldor-FD: parallel-agent-dispatch-for-research-jobs"
```
