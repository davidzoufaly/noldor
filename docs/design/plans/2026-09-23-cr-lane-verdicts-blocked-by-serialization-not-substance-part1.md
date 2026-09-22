# CR Lane Verdicts Blocked by Serialization, Not Substance — Part 1: Verifier Answer File Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** The verifier lane reads its verdict from a per-dispatch answer file instead of digging a fenced block out of stdout. A `pass` whose evidence quotes fenced code (Q-0239) reaches the sink as a `pass`, and the prose valve is gone.

**Architecture:** The runner capability table gains `answerFile` (`agent-writes` | `cli-writes`). A new answer reader (`src/cr/lane-answer.ts`) parses, drops placeholder entries and validates. A new seam, `createAnswerSeam` in `src/cr/lane-spawn.ts`, resolves the runner once, pins runner and model, names a per-dispatch answer path in the prompt, reads that file and runs at most one repair round. The verifier is the first lane moved onto it. Part 2 moves the ui-reviewer and render-export lanes and deletes the fence reader. Part 3 moves the reviewer and adds the blocking rule. Spec: `docs/design/specs/2026-09-22-cr-lane-verdicts-blocked-by-serialization-not-substance-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod, vitest (`pnpm vitest run <file>`), `pnpm typecheck`, Node `fs/promises`.

---

## File Structure

- `src/core/agent-runner/types.ts`: `RunnerCapabilities.answerFile`; `SpawnAgentOpts.model` and `SpawnAgentOpts.lastMessagePath`.
- `src/core/agent-runner/capabilities.ts`: declares `answerFile` per runner.
- `src/core/agent-runner/runners/codex.ts`: `lastMessagePath` renders as `--output-last-message`.
- `src/core/agent-runner/registry.ts`: a pinned model rides the pin, and `lastMessagePath` needs a `cli-writes` runner.
- `src/cr/filename.ts`: `laneAnswerPath` (per dispatch) and `laneAnswerDebugPath` (latest per lane).
- `src/cr/lane-answer.ts` (new): the answer contract types, the placeholder rule, the whole-file-fence unwrap, `readLaneAnswer` and `keepRaw`.
- `src/cr/lanes/prompt-parts.ts`: `answerInstruction(channel, path, shape)`.
- `src/cr/lane-spawn.ts`: `createAnswerSeam` plus the `setLaneSpawn` test seam.
- `src/cr/lanes/verify-dispatch.ts`: the verifier contract, a pass/fail refinement, and a repair prompt fed a `RepairContext`.
- `src/cr/lanes/verify.ts`: reads a `LaneAnswer`; the repair round and the prose valve are removed.
- `docs/noldor/agent-runtimes.md` + `templates/docs/noldor/agent-runtimes.md`: the answer-file row.
- `docs/noldor/cr-pipeline.md` + `templates/docs/noldor/cr-pipeline.md`: the verify transport paragraph and the resolved fence trap.
- Tests: `src/core/agent-runner/__tests__/runners.test.ts`, `src/core/agent-runner/__tests__/registry.test.ts`, `src/cr/__tests__/filename.test.ts`, `src/cr/__tests__/lane-answer.test.ts` (new), `src/cr/__tests__/lane-spawn.test.ts` (new), `src/cr/__tests__/lanes/verify-dispatch.test.ts`, `src/cr/__tests__/lanes/verify.test.ts`.

---

## Task 1: Runner answer channel, codex last-message flag, pinned model

**Files:**
- Modify: `src/core/agent-runner/types.ts`
- Modify: `src/core/agent-runner/capabilities.ts`
- Modify: `src/core/agent-runner/runners/codex.ts`
- Modify: `src/core/agent-runner/registry.ts`
- Modify: `docs/noldor/agent-runtimes.md`, `templates/docs/noldor/agent-runtimes.md`
- Test: `src/core/agent-runner/__tests__/runners.test.ts`, `src/core/agent-runner/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing capability and argv tests.** In `src/core/agent-runner/__tests__/runners.test.ts`, add inside `describe('capability matrix', …)`:

```ts
  it('declares which side writes a CR lane answer file (Q-0250)', () => {
    expect(CAPABILITIES.claude.answerFile).toBe('agent-writes');
    expect(CAPABILITIES.opencode.answerFile).toBe('agent-writes');
    expect(CAPABILITIES.stub.answerFile).toBe('agent-writes');
    expect(CAPABILITIES.codex.answerFile).toBe('cli-writes');
  });
```

and inside `describe('codex argv (extracted from run-codex.ts)', …)`:

```ts
  it('writes its final message to lastMessagePath and stays read-only', () => {
    expect(buildCodexArgv({ lastMessagePath: '/a.json' })).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-last-message',
      '/a.json',
      '-',
    ]);
  });
```

- [ ] **Step 2: Write the failing spawnAgent tests.** In `src/core/agent-runner/__tests__/registry.test.ts`, add inside `describe('spawnAgent', …)`:

```ts
  it('a pinned model rides the pin instead of being dropped (Q-0250)', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent(
      'p',
      { role: 'reviewer', runner: 'claude', model: 'opus', cwd: dir },
      { spawnImpl: f.impl as never },
    );
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.argv.slice(-2)).toEqual(['--model', 'opus']);
  });

  it('lastMessagePath reaches a pinned codex as --output-last-message, read-only', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent(
      'p',
      { role: 'reviewer', runner: 'codex', lastMessagePath: '/tmp/a.json', cwd: dir },
      { spawnImpl: f.impl as never },
    );
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.argv).toEqual(
      expect.arrayContaining(['read-only', '--output-last-message', '/tmp/a.json']),
    );
  });

  it('capability mismatch: lastMessagePath on an agent-writes runner rejects before spawning', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    await expect(
      spawnAgent(
        'x',
        { role: 'reviewer', lastMessagePath: '/tmp/a.json', cwd: dir },
        { spawnImpl: f.impl as never },
      ),
    ).rejects.toThrow(/capability-mismatch.*claude/);
    expect(f.impl).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests to verify they fail.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts src/core/agent-runner/__tests__/registry.test.ts
```

Expected: FAIL. `answerFile` reads `undefined`, the codex argv lacks `--output-last-message`, the pinned-model argv lacks `--model opus`, and the mismatch test times out (`Test timed out in 5000ms`) because nothing rejects.

- [ ] **Step 4: Add the capability field and the spawn options.** In `src/core/agent-runner/types.ts`, add this member at the end of `interface RunnerCapabilities`, after `promptDispatch`:

```ts
  /**
   * Who writes a CR lane's answer file (Q-0250). `agent-writes`: the child writes it with its
   * own tools. `cli-writes`: the CLI writes the child's final message there itself (codex
   * `--output-last-message`), so a read-only sandbox never needs write access.
   */
  answerFile: 'agent-writes' | 'cli-writes';
```

In `interface SpawnAgentOpts`, add directly after `runner?: RunnerName;`:

```ts
  /** Model for a pinned {@link SpawnAgentOpts.runner}; ignored without a pin, where role resolution supplies it. */
  model?: string;
```

and directly after `schemaPath?: string;`:

```ts
  /** Requires a `cli-writes` runner (codex): its CLI writes the child's final message to this path. */
  lastMessagePath?: string;
```

- [ ] **Step 5: Declare the channel per runner.** Replace the whole body of `src/core/agent-runner/capabilities.ts` with:

```ts
import type { RunnerCapabilities, RunnerName } from './types.js';

/** Spec §Unit 2 table. Doc twin: docs/noldor/agent-runtimes.md. */
export const CAPABILITIES: Record<RunnerName, RunnerCapabilities> = {
  claude: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: false,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
    promptDispatch: 'slash-command',
    answerFile: 'agent-writes',
  },
  codex: {
    structuredOutput: 'schema',
    sandbox: 'coarse',
    supportsLocalModels: false,
    questionSuppression: 'non-interactive',
    rulesFile: 'AGENTS.md',
    promptDispatch: 'prose',
    answerFile: 'cli-writes',
  },
  opencode: {
    structuredOutput: 'events',
    sandbox: 'fine',
    supportsLocalModels: true,
    questionSuppression: 'permission-config',
    rulesFile: 'AGENTS.md',
    promptDispatch: 'prose',
    answerFile: 'agent-writes',
  },
  // Hermetic in-repo test double: no LLM, no network, scripted canned work.
  stub: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: true,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
    // Mirrors claude so contract-CI drain fixtures stay byte-identical (spec D5).
    promptDispatch: 'slash-command',
    answerFile: 'agent-writes',
  },
};
```

- [ ] **Step 6: Render the codex flag.** In `src/core/agent-runner/runners/codex.ts`, change the options type of `buildCodexArgv` to:

```ts
export function buildCodexArgv(opts: {
  needsWrite?: boolean;
  schemaPath?: string;
  lastMessagePath?: string;
  model?: string;
}): string[] {
```

and directly after the line `if (opts.schemaPath) argv.push('--output-schema', opts.schemaPath);` add:

```ts
  if (opts.lastMessagePath) argv.push('--output-last-message', opts.lastMessagePath);
```

- [ ] **Step 7: Honour the pinned model and gate the new option.** In `src/core/agent-runner/registry.ts`, replace

```ts
  const resolved: ResolvedRunner = opts.runner
    ? { runner: opts.runner }
    : resolveRunner(opts.role, cfg);
```

with

```ts
  const resolved: ResolvedRunner = opts.runner
    ? { runner: opts.runner, ...(opts.model !== undefined ? { model: opts.model } : {}) }
    : resolveRunner(opts.role, cfg);
```

Directly after the closing `}` of the `if (opts.schemaPath && caps.structuredOutput !== 'schema') { … }` block, add:

```ts
  if (opts.lastMessagePath && caps.answerFile !== 'cli-writes') {
    return Promise.reject(
      new Error(
        `capability-mismatch: role '${opts.role}' resolved to runner '${resolved.runner}' ` +
          `(answerFile: ${caps.answerFile}) but lastMessagePath requires 'cli-writes'. ` +
          `Its child writes the answer file itself — drop lastMessagePath for this runner.`,
      ),
    );
  }
```

In `planSpawn`, in the `case 'codex':` branch, change the `buildCodexArgv({ … })` call to:

```ts
        argv: buildCodexArgv({
          needsWrite: opts.needsWrite,
          schemaPath: opts.schemaPath,
          lastMessagePath: opts.lastMessagePath,
          model: resolved.model,
        }),
```

- [ ] **Step 8: Run the tests to verify they pass.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts src/core/agent-runner/__tests__/registry.test.ts && pnpm typecheck
```

Expected: PASS. Every test is green and `tsc` prints nothing.

- [ ] **Step 9: Document the channel.** In `docs/noldor/agent-runtimes.md`, add this row to the `## Flag mapping` table directly after the `| structured output | … |` row:

```markdown
| CR lane answer file | the child writes it (`answerFile: agent-writes`) | the CLI writes the final message: `--output-last-message <path>` (`answerFile: cli-writes`) | the child writes it (`answerFile: agent-writes`) |
```

Then mirror the twin:

```bash
cp docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
```

- [ ] **Step 10: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with exactly:

```text
feat(core): declare which side writes a CR lane answer file

Why — CR lanes are about to stop digging their verdict out of stdout and read it from a per-dispatch answer file instead (Q-0250). Codex runs review roles in a read-only sandbox, so its child cannot write that file, and a runner pin currently drops the model a role configured.

How — RunnerCapabilities gains answerFile: agent-writes for claude, opencode and stub, cli-writes for codex. buildCodexArgv gains lastMessagePath, rendered as --output-last-message, so the codex CLI writes the final message itself. spawnAgent keeps a pinned model and refuses lastMessagePath on a runner whose child writes the file.

What — types.ts, capabilities.ts, runners/codex.ts and registry.ts, the agent-runtimes flag table and its template twin, plus capability-matrix, argv and spawnAgent tests.

Noldor-Sibling-Scope: noldor:agent-runtimes
Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/core/agent-runner/types.ts src/core/agent-runner/capabilities.ts src/core/agent-runner/runners/codex.ts src/core/agent-runner/registry.ts src/core/agent-runner/__tests__/runners.test.ts src/core/agent-runner/__tests__/registry.test.ts docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 2: Per-dispatch answer paths

**Files:**
- Modify: `src/cr/filename.ts`
- Test: `src/cr/__tests__/filename.test.ts`

- [ ] **Step 1: Write the failing tests.** In `src/cr/__tests__/filename.test.ts`, replace the import block with:

```ts
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Slug } from '../../core/slug.js';
import { inferLaneFromFilename, laneAnswerDebugPath, laneAnswerPath } from '../filename.js';
```

and append:

```ts
describe('laneAnswerPath', () => {
  const root = mkdtempSync(join(tmpdir(), 'noldor-answer-path-'));
  const slug = 'feat-x' as Slug;

  it('gives each dispatch its own file under .noldor/cr/answers/', () => {
    const a = laneAnswerPath(root, slug, 'code', 'verifier', 'id-1');
    const b = laneAnswerPath(root, slug, 'code', 'verifier', 'id-2');
    expect(a).toEqual({
      ok: true,
      path: join(root, '.noldor', 'cr', 'answers', 'feat-x-code-verifier-id-1.json'),
    });
    expect(b).toEqual({
      ok: true,
      path: join(root, '.noldor', 'cr', 'answers', 'feat-x-code-verifier-id-2.json'),
    });
  });

  it('keeps the latest debug copy under a per-lane name', () => {
    expect(laneAnswerDebugPath(root, slug, 'spec', 'reviewer')).toEqual({
      ok: true,
      path: join(root, '.noldor', 'cr', 'answers', 'feat-x-spec-reviewer.json'),
    });
  });

  it('refuses a symlinked answer file segment', () => {
    mkdirSync(join(root, '.noldor', 'cr', 'answers'), { recursive: true });
    symlinkSync('/etc/hosts', join(root, '.noldor', 'cr', 'answers', 'feat-x-code-verifier-evil.json'));
    expect(laneAnswerPath(root, slug, 'code', 'verifier', 'evil')).toMatchObject({
      ok: false,
      error: { kind: 'unsafe-symlink' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest run src/cr/__tests__/filename.test.ts
```

Expected: FAIL with `laneAnswerPath is not a function`.

- [ ] **Step 3: Add the builders.** In `src/cr/filename.ts`, add directly after the `laneSinkPath` function:

```ts
/**
 * Where one dispatch's answer file goes: `<root>/.noldor/cr/answers/<slug>-<kind>-<lane>-<dispatchId>.json`.
 *
 * A subdirectory, never `.noldor/cr/` itself: `aggregate` reads every top-level `.json` there
 * as a sink. The per-dispatch id means the file cannot exist before the child writes it, so a
 * dispatch never reads an earlier round's answer or a concurrent dispatch's (Q-0250).
 */
export function laneAnswerPath(
  root: string,
  slug: Slug,
  kind: ArtifactKind,
  lane: string,
  dispatchId: string,
): { ok: true; path: string } | { ok: false; error: PathError } {
  return slugPath(root, ['.noldor', 'cr', 'answers'], slug, {
    suffix: `-${kind}-${lane}-${dispatchId}.json`,
  });
}

/** The latest raw answer kept per lane for debugging: `answers/<slug>-<kind>-<lane>.json`. */
export function laneAnswerDebugPath(
  root: string,
  slug: Slug,
  kind: ArtifactKind,
  lane: string,
): { ok: true; path: string } | { ok: false; error: PathError } {
  return slugPath(root, ['.noldor', 'cr', 'answers'], slug, { suffix: `-${kind}-${lane}.json` });
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest run src/cr/__tests__/filename.test.ts
```

Expected: PASS (all `inferLaneFromFilename` and `laneAnswerPath` tests green).

- [ ] **Step 5: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
feat(cr): build per-dispatch CR lane answer paths through slugPath

laneAnswerPath names one dispatch's answer file under .noldor/cr/answers/ with a per-dispatch id, and laneAnswerDebugPath names the latest copy kept per lane. Both go through the slugPath choke point beside laneSinkPath, so a symlinked segment is refused like every other per-slug CR path.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/filename.ts src/cr/__tests__/filename.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 3: The answer reader

**Files:**
- Create: `src/cr/lane-answer.ts`
- Test: `src/cr/__tests__/lane-answer.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/cr/__tests__/lane-answer.test.ts`:

```ts
// @tests: cr-lane-verdicts-blocked-by-serialization-not-substance
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  dropPlaceholders,
  isPlaceholderText,
  readLaneAnswer,
  unwrapWholeFence,
} from '../lane-answer.js';

describe('isPlaceholderText', () => {
  it.each(['(none)', '- None.', '**N/A**', '[]', '', '  nothing  ', 'No findings.', 'no issues'])(
    'treats %j as a placeholder',
    (text) => {
      expect(isPlaceholderText(text)).toBe(true);
    },
  );
  it.each([
    'none of the tests assert the exit code',
    'N/A until the cap is fixed',
    'nothing checks the exit code',
  ])('keeps %j as a finding', (text) => {
    expect(isPlaceholderText(text)).toBe(false);
  });
});

describe('dropPlaceholders', () => {
  it('drops placeholder entries from the named object and string lists only', () => {
    const raw = {
      findings: [{ message: '(none)' }, { message: 'real finding' }],
      mismatches: ['n/a', 'object promised, array observed'],
      untouched: ['(none)'],
    };
    expect(
      dropPlaceholders(raw, [{ list: 'findings', text: 'message' }, { list: 'mismatches' }]),
    ).toEqual({
      findings: [{ message: 'real finding' }],
      mismatches: ['object promised, array observed'],
      untouched: ['(none)'],
    });
  });
  it('passes anything that is not a plain object through untouched', () => {
    expect(dropPlaceholders(['(none)'], [{ list: 'findings' }])).toEqual(['(none)']);
    expect(dropPlaceholders(null, [{ list: 'findings' }])).toBeNull();
  });
});

describe('unwrapWholeFence', () => {
  it('removes one fence around the whole file and nothing inside it', () => {
    const inner = '{"observed":"```bash\\npnpm release\\n```"}';
    expect(unwrapWholeFence(`\`\`\`json\n${inner}\n\`\`\`\n`)).toBe(inner);
  });
  it('leaves an unfenced answer as it is, trimmed', () => {
    expect(unwrapWholeFence('  {"a":1}\n')).toBe('{"a":1}');
  });
});

describe('readLaneAnswer', () => {
  const schema = z
    .object({ verdict: z.enum(['pass', 'fail']), mismatches: z.array(z.string()).default([]) })
    .refine((v) => (v.verdict === 'pass' ? v.mismatches.length === 0 : v.mismatches.length > 0));
  const contract = { lane: 'verifier', schema, placeholderFields: [{ list: 'mismatches' }] };

  it('reads a verdict whose evidence quotes a fenced block (Q-0239)', () => {
    const text =
      '```json\n{"verdict":"pass","mismatches":[],"note":"ran ```bash\\npnpm release\\n``` fine"}\n```';
    expect(readLaneAnswer(text, contract)).toEqual({
      ok: true,
      answer: { verdict: 'pass', mismatches: [] },
    });
  });
  it('validates a pass padded with a placeholder as the clean pass it is', () => {
    expect(readLaneAnswer('{"verdict":"pass","mismatches":["(none)"]}', contract)).toMatchObject({
      ok: true,
    });
  });
  it('rejects a fail whose only mismatches are placeholders', () => {
    expect(readLaneAnswer('{"verdict":"fail","mismatches":["n/a"]}', contract)).toMatchObject({
      ok: false,
    });
  });
  it('reports a missing file, bad JSON and a schema mismatch as errors', () => {
    expect(readLaneAnswer(null, contract)).toEqual({
      ok: false,
      error: 'no answer file was written',
    });
    expect(readLaneAnswer('Verified end-to-end.', contract)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^answer is not valid JSON/),
    });
    expect(readLaneAnswer('{"verdict":"maybe"}', contract)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^answer does not match the verifier schema/),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest run src/cr/__tests__/lane-answer.test.ts
```

Expected: FAIL with `Failed to load url ../lane-answer.js` (the module does not exist yet).

- [ ] **Step 3: Implement the reader.** Create `src/cr/lane-answer.ts`:

```ts
import type { Slug } from '../core/slug.js';
import type { ArtifactKind } from './findings-schema.js';

/**
 * Reading a CR lane child's answer file (Q-0250).
 *
 * Lanes used to dig their verdict out of stdout: a fenced JSON block that the first quoted
 * triple backtick closed early, or markdown buckets whose `- (none)` bullet became a blocker.
 * The answer now travels in a file that holds nothing else, so reading it is parse, drop
 * placeholders, validate — no heuristic has to find the answer inside the chatter.
 */

/** Where a dispatch's answer file lives: the lane's repo, slug and artifact kind. */
export interface AnswerLocation {
  repoRoot: string;
  slug: Slug;
  kind: ArtifactKind;
}

/**
 * A list field whose placeholder entries are dropped before validation. `text` names the
 * string property of an object entry; omit it for a list of strings.
 */
export interface PlaceholderField {
  list: string;
  text?: string;
}

/** Why the first answer was rejected, handed to the one repair round. */
export interface RepairContext {
  /** The first child's stdout, kept as evidence — '' when unavailable. */
  stdout: string;
  /** What the first child wrote to the answer file, or null when it wrote nothing. */
  rejected: string | null;
  /** Why that answer was rejected. */
  error: string;
}

/** The part of a zod schema the reader needs, so this module never imports zod. */
export interface SafeParser<T> {
  safeParse: (
    v: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
}

/** What a lane's child must hand back, and how to read it. */
export interface LaneAnswerContract<T> {
  /** Lane segment of the answer file name, e.g. `verifier`. */
  lane: string;
  /** Schema sketch rendered into the answer instruction. */
  shape: string;
  schema: SafeParser<T>;
  placeholderFields?: readonly PlaceholderField[];
  /** Body of the repair round's transcription prompt; the seam appends the answer instruction. */
  repairPrompt: (ctx: RepairContext) => string;
}

/** One read of one answer file. */
export type ReadResult<T> = { ok: true; answer: T } | { ok: false; error: string };

/** A lane's answer after at most one repair round. */
export type LaneAnswer<T> =
  | { ok: true; answer: T; notes: string[] }
  | { ok: false; detail: string; notes: string[] };

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  '',
  'none',
  'n/a',
  'na',
  'no issues',
  'no findings',
  'nothing',
]);

/** Whitespace and `- * _ . , : ; ! ( ) [ ] { } < >`, at either end of the text only. */
const EDGE_NOISE = /^[\s\-*_.,:;!()[\]{}<>]+|[\s\-*_.,:;!()[\]{}<>]+$/g;

/**
 * True when `text` says "nothing here" instead of stating something. Normalization touches
 * the ends only, so `none of the tests assert the exit code` is a finding, not a placeholder.
 */
export function isPlaceholderText(text: string): boolean {
  const normalized = text.replace(EDGE_NOISE, '').replace(/\s+/g, ' ').toLowerCase();
  return PLACEHOLDERS.has(normalized);
}

/**
 * `raw` with every placeholder entry removed from the named list fields. Anything that is
 * not a plain object, and any field that is missing or not an array, passes through
 * untouched — the schema, not this pass, reports those.
 */
export function dropPlaceholders(raw: unknown, fields: readonly PlaceholderField[]): unknown {
  if (fields.length === 0 || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const field of fields) {
    const list = out[field.list];
    if (!Array.isArray(list)) continue;
    out[field.list] = list.filter((entry: unknown) => {
      const text =
        field.text === undefined
          ? entry
          : typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>)[field.text]
            : undefined;
      return !(typeof text === 'string' && isPlaceholderText(text));
    });
  }
  return out;
}

/**
 * The text with ONE fence around the whole file removed. A child told "no fence" sometimes
 * fences anyway; only the first and last lines are touched, and a JSON object never ends in
 * a backtick, so a fence quoted inside a JSON string is never affected.
 */
export function unwrapWholeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  return lines.length < 3 ? trimmed : lines.slice(1, -1).join('\n');
}

/**
 * One answer file's text → the lane's validated answer; `null` means no file was written.
 * Placeholders are dropped BEFORE validation, so a `pass` padded with `["(none)"]` validates
 * as the clean pass it is, while a `fail` left with no real mismatch fails its refinement.
 */
export function readLaneAnswer<T>(
  text: string | null,
  contract: Pick<LaneAnswerContract<T>, 'lane' | 'schema' | 'placeholderFields'>,
): ReadResult<T> {
  if (text === null) return { ok: false, error: 'no answer file was written' };
  let raw: unknown;
  try {
    raw = JSON.parse(unwrapWholeFence(text));
  } catch (err) {
    return { ok: false, error: `answer is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = contract.schema.safeParse(dropPlaceholders(raw, contract.placeholderFields ?? []));
  return parsed.success
    ? { ok: true, answer: parsed.data }
    : {
        ok: false,
        error: `answer does not match the ${contract.lane} schema: ${parsed.error.message.slice(0, 500)}`,
      };
}

/** How much raw child text one sink note keeps verbatim. */
const RAW_KEEP_CHARS = 20_000;

/** `raw` bounded for a sink note, marked when it was cut. */
export function keepRaw(raw: string): string {
  return raw.length <= RAW_KEEP_CHARS
    ? raw
    : `${raw.slice(0, RAW_KEEP_CHARS)}… [truncated, ${raw.length} chars total]`;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest run src/cr/__tests__/lane-answer.test.ts && pnpm typecheck
```

Expected: PASS (all four `describe` blocks green), and `tsc` prints nothing.

- [ ] **Step 5: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
feat(cr): read a CR lane answer file with an ends-only placeholder rule

readLaneAnswer parses one answer file, unwraps a single whole-file fence, drops placeholder entries from the lane's named list fields before validation, then validates with the lane's schema. The placeholder rule strips noise from both ends only and matches exactly, so "none of the tests assert the exit code" stays a finding.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lane-answer.ts src/cr/__tests__/lane-answer.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 4: The answer seam

**Files:**
- Modify: `src/cr/lanes/prompt-parts.ts`
- Modify: `src/cr/lane-spawn.ts`
- Test: `src/cr/__tests__/lane-spawn.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/cr/__tests__/lane-spawn.test.ts`:

```ts
// @tests: cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentResult, SpawnAgentOpts } from '../../core/agent-runner/types.js';
import type { Slug } from '../../core/slug.js';
import type { LaneAnswerContract } from '../lane-answer.js';
import { createAnswerSeam, setLaneSpawn } from '../lane-spawn.js';

const schema = z.object({ verdict: z.enum(['pass', 'fail']) }).strict();
type Answer = z.infer<typeof schema>;
const CONTRACT: LaneAnswerContract<Answer> = {
  lane: 'verifier',
  shape: '{"verdict": "pass" | "fail"}',
  schema,
  repairPrompt: (ctx) => `REPAIR because ${ctx.error}; rejected=${ctx.rejected ?? 'none'}`,
};
const seam = createAnswerSeam<{ timeoutMs?: number }, Answer>(() => 'REVIEW THE CHANGE', {
  role: 'verifier',
  site: 'test.lane-spawn',
  contract: CONTRACT,
  onFailure: (f) => {
    throw new Error(`${f.reason}: ${f.detail ?? `exit ${f.exitCode}`}`);
  },
});

function repo(agents?: unknown): { root: string; at: { repoRoot: string; slug: Slug; kind: 'code' } } {
  const root = mkdtempSync(join(tmpdir(), 'noldor-answer-seam-'));
  mkdirSync(join(root, '.noldor'), { recursive: true });
  writeFileSync(
    join(root, '.noldor', 'config.json'),
    JSON.stringify(agents === undefined ? {} : { agents }),
  );
  return { root, at: { repoRoot: root, slug: 'feat-x' as Slug, kind: 'code' } };
}

/** The path the agent-writes instruction names — a real child reads it from the prompt too. */
const pathIn = (prompt: string): string | undefined =>
  /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];

type Step = { file?: string; stdout?: string; exitCode?: number; timedOut?: boolean };

function child(steps: Step[]): Array<{ prompt: string; opts: SpawnAgentOpts }> {
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
    const step = steps[calls.length] ?? {};
    calls.push({ prompt, opts });
    const target = opts.lastMessagePath ?? pathIn(prompt);
    if (step.file !== undefined && target !== undefined) writeFileSync(target, step.file);
    return {
      exitCode: step.exitCode ?? 0,
      stdout: step.stdout ?? '',
      stderr: '',
      stderrBytes: 0,
      timedOut: step.timedOut ?? false,
    };
  });
  return calls;
}

afterEach(() => setLaneSpawn(undefined));

describe('createAnswerSeam', () => {
  it('reads the answer from the file the prompt names, never from stdout', async () => {
    const { at } = repo();
    child([{ file: '{"verdict":"pass"}', stdout: '{"verdict":"fail"}' }]);
    expect(await seam.dispatch({}, at)).toEqual({ ok: true, answer: { verdict: 'pass' }, notes: [] });
  });

  it('treats a verdict printed on stdout with no file as no answer, after one repair', async () => {
    const { at } = repo();
    const calls = child([{ stdout: '{"verdict":"pass"}' }, { stdout: '{"verdict":"pass"}' }]);
    const r = await seam.dispatch({}, at);
    expect(r).toMatchObject({ ok: false, detail: 'no answer file was written' });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(r.notes)).toContain('child output (kept verbatim)');
  });

  it('recovers through one repair round that sees the rejected answer and why', async () => {
    const { at } = repo();
    const calls = child([{ file: 'looks green to me' }, { file: '{"verdict":"pass"}' }]);
    const r = await seam.dispatch({}, at);
    expect(r).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
    expect(JSON.stringify(r.notes)).toContain('repair round');
    expect(calls[1]!.prompt).toContain('REPAIR because answer is not valid JSON');
    expect(calls[1]!.prompt).toContain('rejected=looks green to me');
  });

  it('gives every dispatch its own answer file and keeps the latest as a debug copy', async () => {
    const { root, at } = repo();
    const calls = child([{ file: 'nope' }, { file: '{"verdict":"fail"}' }]);
    await seam.dispatch({}, at);
    const [first, second] = calls.map((c) => pathIn(c.prompt));
    expect(first).toMatch(/\.noldor\/cr\/answers\/feat-x-code-verifier-[0-9a-f-]{36}\.json$/);
    expect(second).not.toBe(first);
    const answers = join(root, '.noldor', 'cr', 'answers');
    expect(readdirSync(answers)).toEqual(['feat-x-code-verifier.json']);
    expect(readFileSync(join(answers, 'feat-x-code-verifier.json'), 'utf8')).toBe(
      '{"verdict":"fail"}',
    );
  });

  it('pins the resolved runner and model, and lets a cli-writes runner write the file', async () => {
    const { at } = repo({ roles: { verifier: { runner: 'codex', model: 'gpt-x' } } });
    const calls = child([{ file: '{"verdict":"pass"}' }]);
    expect(await seam.dispatch({}, at)).toMatchObject({ ok: true });
    expect(calls[0]!.opts).toMatchObject({ runner: 'codex', model: 'gpt-x' });
    expect(calls[0]!.opts.lastMessagePath).toMatch(/feat-x-code-verifier-.+\.json$/);
    expect(calls[0]!.prompt).toContain('your FINAL message');
    expect(calls[0]!.prompt).not.toContain('write your answer to the file');
  });

  it('does not repair a dispatch that timed out', async () => {
    const { at } = repo();
    const calls = child([{ timedOut: true, exitCode: -1 }]);
    await expect(seam.dispatch({}, at)).rejects.toThrow(/timeout/);
    expect(calls).toHaveLength(1);
  });

  it('fails the dispatch when the answers directory cannot be made', async () => {
    const { root, at } = repo();
    mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
    writeFileSync(join(root, '.noldor', 'cr', 'answers'), 'a file where the directory goes');
    child([{ file: '{"verdict":"pass"}' }]);
    await expect(seam.dispatch({}, at)).rejects.toThrow();
  });

  it('runs the reader and the repair round for an injected child too', async () => {
    const { at } = repo();
    const seen: Array<string | null | undefined> = [];
    seam.setDispatcher(async (_input, repair) => {
      seen.push(repair?.rejected);
      return repair === undefined ? '{"verdict":"pass","extra":1}' : '```json\n{"verdict":"pass"}\n```';
    });
    try {
      expect(await seam.dispatch({}, at)).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
      expect(seen).toEqual([undefined, '{"verdict":"pass","extra":1}']);
    } finally {
      seam.setDispatcher(undefined);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest run src/cr/__tests__/lane-spawn.test.ts
```

Expected: FAIL with `createAnswerSeam is not a function` (and `setLaneSpawn is not a function`).

- [ ] **Step 3: Add the answer instruction.** In `src/cr/lanes/prompt-parts.ts`, add this import at the top of the file, below the header comment:

```ts
import type { RunnerCapabilities } from '../../core/agent-runner/types.js';
```

and append:

```ts
/**
 * The closing instruction for a lane whose child hands back one JSON object (Q-0250).
 * `agent-writes` children write the file themselves; for a `cli-writes` runner (codex) the CLI
 * writes the child's final message to the file, so the child only makes that message the
 * object. Either way nothing the child prints is read.
 */
export function answerInstruction(
  channel: RunnerCapabilities['answerFile'],
  path: string,
  shape: string,
): string {
  if (channel === 'cli-writes') {
    return `When done, make your FINAL message exactly ONE JSON object with this shape, and nothing else — no code fence, no prose before or after it:\n\n${shape}`;
  }
  return `When done, write your answer to the file \`${path}\` as exactly ONE JSON object with this shape, and nothing else in that file — no code fence, no prose:\n\n${shape}\n\nUse your file-writing tool. Only that file is read: an answer you print instead is ignored.`;
}
```

- [ ] **Step 4: Add the seam.** In `src/cr/lane-spawn.ts`, replace the three import lines at the top (`spawnAgent`, `DEFAULT_DISPATCH_TIMEOUT_MS`, `AgentRole`) with:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CAPABILITIES } from '../core/agent-runner/capabilities.js';
import { loadAgentsConfig, resolveRunner, spawnAgent } from '../core/agent-runner/registry.js';
import type { AgentResult, AgentRole, SpawnAgentOpts } from '../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../core/config.js';
import { laneAnswerDebugPath, laneAnswerPath } from './filename.js';
import {
  keepRaw,
  readLaneAnswer,
  type AnswerLocation,
  type LaneAnswer,
  type LaneAnswerContract,
  type ReadResult,
  type RepairContext,
} from './lane-answer.js';
import { answerInstruction } from './lanes/prompt-parts.js';
```

Then append to the end of the file:

```ts
/** Why an answer dispatch produced nothing usable, with the detail a non-exit failure carries. */
export interface LaneDispatchFailure {
  reason: LaneSpawnFailure;
  exitCode: number;
  timedOut: boolean;
  /** Set when the failure happened outside the child, e.g. creating the answers directory. */
  detail?: string;
}

type LaneSpawnFn = (prompt: string, opts: SpawnAgentOpts) => Promise<AgentResult>;
const defaultLaneSpawn: LaneSpawnFn = (prompt, opts) => spawnAgent(prompt, opts);
let laneSpawn: LaneSpawnFn = defaultLaneSpawn;

/** Test seam — production code never calls this. `undefined` restores the real spawn. */
export function setLaneSpawn(impl: LaneSpawnFn | undefined): void {
  laneSpawn = impl ?? defaultLaneSpawn;
}

/** A child's answer as a test double hands it back: the answer file's text, or null for none. */
export type ChildAnswer = string | null;

/**
 * Read one dispatch's answer file, then keep it as the lane's latest debug copy. An absent
 * file means the child wrote nothing (`null`). The rename is best-effort by design: the copy
 * is for a human reading a red round, and failing a dispatch over it would trade a verdict
 * for a log line.
 */
async function takeAnswerFile(path: string, at: AnswerLocation, lane: string): Promise<ChildAnswer> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const debug = laneAnswerDebugPath(at.repoRoot, at.slug, at.kind, lane);
  if (debug.ok) await rename(path, debug.path).catch(() => undefined);
  return text;
}

/**
 * A lane's dispatcher over an answer file (Q-0250): lane input in, validated answer out,
 * after at most one repair round. Nothing the child prints is parsed.
 *
 * The runner is resolved ONCE per dispatch and pinned, runner and model, because both the
 * prompt (who writes the file) and the spawn options (`lastMessagePath` for a `cli-writes`
 * runner) depend on it; letting `spawnAgent` resolve again could disagree with the prompt.
 *
 * `setDispatcher` replaces only the child: an injected impl returns what the child would have
 * written (or `null` for no file) and gets the repair context on its second call, while
 * reading, placeholder normalization, validation and the repair round still run.
 */
export function createAnswerSeam<I extends { timeoutMs?: number }, T>(
  build: (input: I) => string,
  opts: {
    role: AgentRole;
    /** Telemetry site tag, e.g. `cr.verify-dispatch`. */
    site: string;
    contract: LaneAnswerContract<T>;
    /** Turn an unusable dispatch into this lane's own failure. Must throw. */
    onFailure: (failure: LaneDispatchFailure) => never;
  },
): {
  dispatch: (input: I, at: AnswerLocation) => Promise<LaneAnswer<T>>;
  setDispatcher: (
    impl: ((input: I, repair?: RepairContext) => Promise<ChildAnswer>) | undefined,
  ) => void;
} {
  let injected: ((input: I, repair?: RepairContext) => Promise<ChildAnswer>) | undefined;

  const runChild = async (
    input: I,
    repair: RepairContext | undefined,
    at: AnswerLocation,
  ): Promise<{ answerText: ChildAnswer; stdout: string }> => {
    if (injected !== undefined) {
      // One argument on the first call, so a test double's call record matches the lane input.
      const answerText = await (repair === undefined ? injected(input) : injected(input, repair));
      return { answerText, stdout: '' };
    }
    const resolved = resolveRunner(opts.role, loadAgentsConfig(at.repoRoot));
    const channel = CAPABILITIES[resolved.runner].answerFile;
    const built = laneAnswerPath(at.repoRoot, at.slug, at.kind, opts.contract.lane, randomUUID());
    if (!built.ok) {
      // The slug is branded, so only repository tampering inside `.noldor/cr/answers` reaches
      // this arm — the same posture `openLane` takes for a sink path.
      throw new Error(`cannot place the ${opts.contract.lane} answer file: ${built.error.kind}`);
    }
    try {
      await mkdir(dirname(built.path), { recursive: true });
    } catch (err) {
      opts.onFailure({
        reason: 'dispatch-failed',
        exitCode: -1,
        timedOut: false,
        detail: `cannot create ${dirname(built.path)}: ${(err as Error).message}`,
      });
    }
    const body = repair === undefined ? build(input) : opts.contract.repairPrompt(repair);
    const r = await laneSpawn(`${body}\n\n${answerInstruction(channel, built.path, opts.contract.shape)}`, {
      role: opts.role,
      runner: resolved.runner,
      ...(resolved.model !== undefined ? { model: resolved.model } : {}),
      cwd: at.repoRoot,
      timeoutMs: input.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS,
      site: opts.site,
      ...(channel === 'cli-writes' ? { lastMessagePath: built.path } : {}),
    });
    if (r.timedOut) opts.onFailure({ reason: 'timeout', exitCode: r.exitCode, timedOut: true });
    if (r.exitCode !== 0) {
      opts.onFailure({ reason: 'dispatch-failed', exitCode: r.exitCode, timedOut: false });
    }
    return { answerText: await takeAnswerFile(built.path, at, opts.contract.lane), stdout: r.stdout };
  };

  const dispatch = async (input: I, at: AnswerLocation): Promise<LaneAnswer<T>> => {
    const first = await runChild(input, undefined, at);
    const read1 = readLaneAnswer(first.answerText, opts.contract);
    if (read1.ok) return { ok: true, answer: read1.answer, notes: [] };
    const kept = [
      ...(first.answerText !== null && first.answerText.trim() !== ''
        ? [`rejected answer (kept verbatim): ${keepRaw(first.answerText)}`]
        : []),
      ...(first.stdout.trim() !== '' ? [`child output (kept verbatim): ${keepRaw(first.stdout)}`] : []),
    ];
    let read2: ReadResult<T>;
    try {
      const second = await runChild(
        input,
        { stdout: first.stdout, rejected: first.answerText, error: read1.error },
        at,
      );
      read2 = readLaneAnswer(second.answerText, opts.contract);
    } catch (err) {
      // A failed repair is not a new failure class: the round falls through to the same
      // no-trustworthy-answer outcome an unrepaired one gets, with the reason kept.
      read2 = { ok: false, error: `the repair dispatch failed: ${(err as Error).message}` };
    }
    if (read2.ok) {
      return {
        ok: true,
        answer: read2.answer,
        notes: [`answer recovered by a repair round — the first answer was rejected: ${read1.error}`],
      };
    }
    return { ok: false, detail: read1.error, notes: [`repair round ran — ${read2.error}`, ...kept] };
  };

  return {
    dispatch,
    setDispatcher: (impl) => {
      injected = impl;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/lane-spawn.test.ts && pnpm typecheck
```

Expected: PASS (all eight `createAnswerSeam` tests green), and `tsc` prints nothing.

- [ ] **Step 6: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
feat(cr): add an answer-file dispatcher seam for CR lanes

createAnswerSeam resolves the lane's runner once and pins runner and model, names a per-dispatch answer path in the prompt (or hands it to a cli-writes CLI as --output-last-message), reads only that file, and runs at most one repair round with the rejected answer, the reason and the child's output. setLaneSpawn lets tests stand in for the child.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lanes/prompt-parts.ts src/cr/lane-spawn.ts src/cr/__tests__/lane-spawn.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 5: The verifier reads its answer file; the prose valve goes

**Files:**
- Modify: `src/cr/lanes/verify-dispatch.ts`
- Modify: `src/cr/lanes/verify.ts`
- Modify: `docs/noldor/cr-pipeline.md`, `templates/docs/noldor/cr-pipeline.md`
- Test: `src/cr/__tests__/lanes/verify-dispatch.test.ts`, `src/cr/__tests__/lanes/verify.test.ts`

- [ ] **Step 1: Update the dispatch tests.** In `src/cr/__tests__/lanes/verify-dispatch.test.ts`:

(a) Replace everything above `describe('buildVerifyPrompt', …)` — the `@tests` line, the `vi.mock(…)` block and both import blocks — with:

```ts
// @tests: acceptance-verify-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import type { Slug } from '../../../core/slug.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import {
  buildVerifyPrompt,
  buildVerifyRepairPrompt,
  dispatchVerify,
  verifyVerdictSchema,
} from '../../lanes/verify-dispatch.js';
```

(b) Replace the whole `describe('buildVerifyRepairPrompt', …)` and `describe('parseVerifyVerdict', …)` blocks with:

```ts
describe('buildVerifyRepairPrompt', () => {
  it('asks for a transcription of the rejected answer, never a second verification', () => {
    const p = buildVerifyRepairPrompt({
      stdout: 'Verified end-to-end. I forgot to write the file.',
      rejected: null,
      error: 'no answer file was written',
    });
    expect(p).toContain('Verified end-to-end. I forgot to write the file.');
    expect(p).toContain('no answer file was written');
    expect(p).toMatch(/do not re-verify/i);
    expect(p).toMatch(/never upgrade/i);
    expect(p).not.toContain('Boot surfaces');
  });
});

describe('verifyVerdictSchema', () => {
  it('ties the verdict to its mismatches', () => {
    expect(verifyVerdictSchema.safeParse({ verdict: 'pass', mismatches: [] }).success).toBe(true);
    expect(verifyVerdictSchema.safeParse({ verdict: 'pass', mismatches: ['m'] }).success).toBe(false);
    expect(verifyVerdictSchema.safeParse({ verdict: 'fail', mismatches: [] }).success).toBe(false);
    expect(
      verifyVerdictSchema.safeParse({ verdict: 'cannot-verify', reason: 'no boot path' }).success,
    ).toBe(true);
  });
});
```

(c) Replace the whole `describe('default dispatcher timeout', …)` block with:

```ts
describe('default dispatcher', () => {
  const dispatchBase = { acceptance: 'x', baseSha: 'a', headSha: 'b', surfaces: [], port: 4000 };
  const at = (): { repoRoot: string; slug: Slug; kind: 'code' } => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-verify-dispatch-'));
    mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
    writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
    return { repoRoot, slug: 'feat-x' as Slug, kind: 'code' };
  };
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  const answer = (text: string): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push({ prompt, opts });
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path) writeFileSync(path, text);
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false };
    });
  afterEach(() => {
    calls.length = 0;
    setLaneSpawn(undefined);
  });

  it('applies DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits timeoutMs', async () => {
    answer('{"verdict":"pass","evidence":[],"mismatches":[]}');
    await dispatchVerify(dispatchBase, at());
    expect(calls[0]!.opts.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
  });

  it('honors an explicit timeoutMs from the lane', async () => {
    answer('{"verdict":"pass","evidence":[],"mismatches":[]}');
    await dispatchVerify({ ...dispatchBase, timeoutMs: 55_000 }, at());
    expect(calls[0]!.opts.timeoutMs).toBe(55_000);
  });

  it('routes a rejected answer to the repair prompt instead of the primary one', async () => {
    answer('Verified end-to-end, no JSON.');
    await dispatchVerify(dispatchBase, at());
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toMatch(/do not re-verify/i);
    expect(calls[1]!.prompt).toContain('Verified end-to-end, no JSON.');
    expect(calls[1]!.prompt).not.toContain('Boot surfaces');
  });
});
```

- [ ] **Step 2: Update the lane tests.** In `src/cr/__tests__/lanes/verify.test.ts`:

(a) Change the verify import to:

```ts
import { reapPort, runVerify, setSmokeRunner } from '../../lanes/verify.js';
```

(b) Add these two tests inside `describe('runVerify', …)`, directly after the first test (`'pass → ok with evidence in the sink'`):

```ts
  it('reads a pass whose evidence quotes fenced code (Q-0239 replay)', async () => {
    setVerifyDispatcher(
      async () =>
        '```json\n{"verdict":"pass","evidence":[{"command":"pnpm noldor validate","observed":"docs:\\n```bash\\npnpm release\\n```\\nOK"}],"mismatches":[]}\n```',
    );
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect(JSON.stringify(sink.evidence)).toContain('```bash');
  });

  it('drops placeholder mismatches before judging the verdict', async () => {
    setVerifyDispatcher(async () => '{"verdict":"pass","evidence":[],"mismatches":["(none)"]}');
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(true);
    expect(readSink(cwd).verdict).toBe('pass');
  });
```

(c) Replace the whole test `'repair round recovers a verdict when only the JSON fence was missing'` with:

```ts
  it('repair round recovers a verdict when the first answer was not JSON', async () => {
    const seen: Array<string | null | undefined> = [];
    setVerifyDispatcher(async (_i, repair) => {
      seen.push(repair?.rejected);
      return repair === undefined
        ? 'Verified end-to-end. I forgot the JSON.'
        : '{"verdict":"pass","evidence":[{"command":"curl /x","observed":"{}"}],"mismatches":[]}';
    });
    const { cwd, input } = repo('blocking');
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect((sink.evidence as unknown[]).length).toBe(1);
    expect(JSON.stringify(sink.notes)).toContain('repair round');
    // Exactly one repair, and it carried the first answer to transcribe.
    expect(seen).toEqual([undefined, 'Verified end-to-end. I forgot the JSON.']);
  });
```

(d) Replace the whole test `'unparseable prose that plainly reports success degrades to cannot-verify, even in blocking mode'` with:

```ts
  it('prose with no valid answer fails closed in blocking mode, however green it sounds', async () => {
    setVerifyDispatcher(async () => 'Verified all clauses through real CLI/HTTP/API. Everything works.');
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('fail');
    expect(sink.reason).toBe('malformed-output');
  });
```

(e) Delete the whole `describe('proseReportsSuccess', …)` block.

- [ ] **Step 3: Run the tests to verify they fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify-dispatch.test.ts src/cr/__tests__/lanes/verify.test.ts
```

Expected: FAIL. `verifyVerdictSchema` accepts a `pass` with mismatches, `dispatchVerify` still calls the old seam (`calls` stays empty), and the Q-0239 replay reds with `verify lane errored`.

- [ ] **Step 4: Move the dispatch module onto the answer seam.** In `src/cr/lanes/verify-dispatch.ts`:

(a) Replace the six import lines at the top with:

```ts
import { z } from 'zod';
import type { VerifySurface } from '../../core/consumer-config.js';
import { verifyEvidenceSchema, verifyVerdictValueSchema } from '../findings-schema.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
```

(b) Replace the `export const verifyVerdictSchema = z.object({ … });` statement with:

```ts
/**
 * The verifier's answer. The refinement ties the verdict to its mismatches: a `pass` that
 * names a mismatch, or a `fail` that names none, is an ambiguous answer the repair round
 * gets to restate — never half-honored.
 */
export const verifyVerdictSchema = z
  .object({
    verdict: verifyVerdictValueSchema,
    evidence: z.array(verifyEvidenceSchema).default([]),
    mismatches: z.array(z.string()).default([]),
    reason: z.string().optional(),
  })
  .refine(
    (v) =>
      v.verdict === 'pass'
        ? v.mismatches.length === 0
        : v.verdict === 'fail'
          ? v.mismatches.length > 0
          : true,
    { message: 'a pass carries no mismatches and a fail carries at least one' },
  );
```

(c) In `interface VerifyDispatchInput`, delete the `repairOf?: string;` member and the doc comment above it.

(d) In `buildVerifyPrompt`, delete the blank line and the final `${fencedJsonInstruction(VERDICT_SHAPE)}` line, so the template literal ends right after hard rule 4: ``…use it with a reason instead of guessing.`;``. The seam appends the answer instruction.

(e) Replace the whole `buildVerifyRepairPrompt` function and its doc comment with:

```ts
/**
 * The repair round's prompt: a transcription task, not a verification one. It hands over the
 * answer the seam rejected, why, and the child's own output, and asks only for a valid answer.
 * It must never boot anything, judge the change, or upgrade a hedged report into `pass`; the
 * honest outcome when nothing states a verdict is `cannot-verify`.
 */
export function buildVerifyRepairPrompt(ctx: RepairContext): string {
  return `A previous Acceptance Verifier finished its work, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that verifier's conclusion as a valid answer — do not re-verify, do not boot anything, do not judge the change yourself.

Its rejected answer:
${ctx.rejected ?? '(it wrote no answer file)'}

Its output:
${ctx.stdout.trim() === '' ? '(none captured)' : ctx.stdout}

Transcription rules:
1. Report the verdict that verifier actually reached. Never upgrade a partial, hedged, or ambiguous report into \`pass\`.
2. Carry over only evidence that appears above — each entry is a command it says it ran plus what it says that printed. Invent nothing.
3. A \`fail\` names at least one mismatch, and a \`pass\` names none.
4. If nothing above clearly states one of the three verdicts, answer \`cannot-verify\` with a reason saying exactly that.`;
}
```

(f) Replace everything from the doc comment `/** Last fenced ```json block wins; null on absence or schema mismatch. */` to the end of the file with:

```ts
/** What the verifier child hands back, and how the seam reads it. */
export const VERIFY_ANSWER: LaneAnswerContract<VerifyVerdict> = {
  lane: 'verifier',
  shape: VERDICT_SHAPE,
  schema: verifyVerdictSchema,
  placeholderFields: [{ list: 'mismatches' }],
  repairPrompt: buildVerifyRepairPrompt,
};

const seam = createAnswerSeam<VerifyDispatchInput, VerifyVerdict>(buildVerifyPrompt, {
  role: 'verifier',
  site: 'cr.verify-dispatch',
  contract: VERIFY_ANSWER,
  onFailure: (f) => {
    throw new Error(
      `verify dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}${f.timedOut ? ' (timeout)' : ''}`,
    );
  },
});

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export const setVerifyDispatcher = seam.setDispatcher;
export const dispatchVerify = seam.dispatch;
```

- [ ] **Step 5: Move the lane onto the answer.** In `src/cr/lanes/verify.ts`:

(a) Replace the import line `import { dispatchVerify, parseVerifyVerdict } from './verify-dispatch.js';` with:

```ts
import type { LaneAnswer } from '../lane-answer.js';
import { dispatchVerify, type VerifyVerdict } from './verify-dispatch.js';
```

(b) Delete everything from the doc comment that begins `How much unparseable child prose the sink keeps verbatim` down to the closing `}` of `export function proseReportsSuccess` — that is `RAW_KEEP_CHARS`, `keepRaw`, the valve's doc comment, `PROSE_SUCCESS_RE`, `PROSE_FAILURE_RE` and `proseReportsSuccess`. Keep `reapPort`, which follows.

(c) Replace everything from the comment line `// 3. Agent judgment.` down to the closing `}` of the `if (parsed === null) { … }` block with:

```ts
  // 3. Agent judgment. The verdict arrives in the child's answer file, with at most one
  // repair round inside the seam (Q-0250) — nothing the child prints is parsed.
  const surfaces = Object.entries(loadVerifyCommands(input.repoRoot)).map(([name, s]) => ({
    ...s,
    name,
  }));
  let answer: LaneAnswer<VerifyVerdict> | null = null;
  let dispatchErr = '';
  // Pre-dispatch reap: smoke SIGKILLs its boots but teardown is async — make
  // sure the port is actually free before the agent boots the same surface.
  await reapPort(port);
  try {
    answer = await dispatchVerify(
      {
        acceptance,
        baseSha: baseShaForRange,
        headSha: input.artifactSha,
        surfaces,
        port,
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      { repoRoot: input.repoRoot, slug: input.slug, kind: input.kind },
    );
  } catch (err) {
    dispatchErr = (err as Error).message;
  } finally {
    // Covers the repair round too: its prompt forbids booting anything, but prompt
    // text is not enforcement.
    await reapPort(port);
  }
  const parsed = answer?.ok === true ? answer.answer : null;
  const answerNotes = answer?.notes ?? [];

  /** Carry the seam's notes (a recovery, the kept raw answer) onto the sink. */
  const withNotes = (payload: SinkPayload): SinkPayload =>
    answerNotes.length > 0
      ? { ...payload, notes: [...(payload.notes ?? []), ...answerNotes] }
      : payload;

  // 4. No trustworthy verdict (spawn fail, timeout, an answer the repair round could
  // not recover) — one class. There is no prose fallback: only an answer file counts.
  if (parsed === null) {
    const detail =
      dispatchErr ||
      `malformed verifier output: ${answer !== null && !answer.ok ? answer.detail : 'no answer'}`;
    const notes = [`no trustworthy verdict — ${detail}`, ...answerNotes];
    const reason = dispatchErr ? ('dispatch-failed' as const) : ('malformed-output' as const);
    if (mode === 'blocking') {
      return write(
        {
          ...basePayload(input),
          blockers: [mkFinding(input.artifact, `verify lane errored: ${detail}`, 'high')],
          summary: 'verify lane errored (fail-closed in blocking mode)',
          verdict: 'fail',
          reason,
          notes,
        },
        false,
      );
    }
    return write(
      {
        ...basePayload(input),
        summary: 'cannot-verify: no trustworthy verdict',
        verdict: 'cannot-verify',
        reason,
        notes,
      },
      true,
    );
  }
```

(d) In the remaining verdict branches below that block, change the comment `// 6. Honest agent verdicts × mode.` to `// 5. Honest agent verdicts × mode.` and replace every `withRepair(` call with `withNotes(`.

- [ ] **Step 6: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify-dispatch.test.ts src/cr/__tests__/lanes/verify.test.ts src/cr/__tests__/orchestrate.test.ts && pnpm typecheck
```

Expected: PASS. The Q-0239 replay is green, and `orchestrate.test.ts` still passes: its injected verifier returns a whole-file fenced answer, which the reader unwraps. `tsc` prints nothing.

- [ ] **Step 7: Update the pipeline doc.** In `docs/noldor/cr-pipeline.md`, replace the paragraph that begins `Malformed output gets two chances before it is read as that class.` and ends `from a serialization one.` with:

```markdown
The verdict travels in an answer file, never in the child's printed output (Q-0250). Each
dispatch gets its own path, `.noldor/cr/answers/<slug>-<kind>-<lane>-<dispatchId>.json`, and the
child writes one JSON object there. For a codex-mapped role the codex CLI writes the child's
final message there instead (`--output-last-message`), so its read-only sandbox never needs write
access. Fences, quoted code and prose around the answer therefore cannot break it. A missing file,
invalid JSON or a schema mismatch gets ONE repair round: the seam re-dispatches with the rejected
answer, the reason and the child's output, and asks only for a valid answer. That round is a
transcription, never a second verification: it boots nothing and may not upgrade a hedged report
into `pass`. A verdict it recovers is stamped with a `repair round` note. When the repair fails
too, the round is the "no trustworthy verdict" class above. There is no prose fallback. It stamps
`reason` (`malformed-output`, or `dispatch-failed` when the spawn itself failed) and keeps the
rejected answer and the child's output verbatim in `notes` (bounded at 20k chars). Each lane's
latest raw answer stays at `.noldor/cr/answers/<slug>-<kind>-<lane>.json` for debugging.
```

Then replace the bullet that begins `- **The verify lane cannot report on a change whose evidence contains fenced` and ends `class and is now shown to under-reach.` with:

```markdown
- **Resolved (Q-0250): the verify lane could not report on a change whose evidence contained
  fenced code.** Its verdict used to travel as a fenced JSON block, and evidence that quoted a
  ` ```bash ` block closed that fence early. Shipping Q-0239 lost two `pass` verdicts that way
  and ended on `Noldor-Path-Override`. The verdict now travels in an answer file, where a quoted
  fence is just characters inside a JSON string. If a verify round still reds with
  `reason: malformed-output`, read the rejected answer the sink keeps verbatim in `notes` before
  blaming the transport.
```

Then mirror the twin:

```bash
cp docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md
```

- [ ] **Step 8: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
fix(cr): read the verifier's verdict from its answer file

The verifier now answers through createAnswerSeam: its verdict arrives in a per-dispatch answer file, so evidence that quotes fenced code can no longer close the answer early (the Q-0239 failure). The seam owns the one repair round. verifyVerdictSchema ties pass and fail to their mismatches, and placeholder mismatches are dropped before validation. The prose valve (proseReportsSuccess and its word lists) is deleted: a verifier with no valid answer after the repair takes the existing no-trustworthy-verdict path.

Noldor-Sibling-Scope: noldor:cr-pipeline
Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lanes/verify-dispatch.ts src/cr/lanes/verify.ts src/cr/__tests__/lanes/verify-dispatch.test.ts src/cr/__tests__/lanes/verify.test.ts docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```
