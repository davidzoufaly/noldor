# CR Lane Verdicts Blocked by Serialization, Not Substance — Part 3: Reviewer Answer File and Blocking Rule Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A reviewer finding blocks only when the reviewer marks it blocking under one written definition. A `minor`, `maybe:` or `unverified:` finding never blocks. `(none)` can never become a blocker, and the reviewer sink's summary can never read `approve` over a red round. Codex fills its `blockers` array under the same definition, and a codex blocker marked `maybe:` or `unverified:` is demoted to a suggestion in code, just as the reviewer's is.

**Architecture:** One exported constant, `BLOCKING_DEFINITION` (`src/cr/blocking-definition.ts`), is rendered by the reviewer prompt and by both codex prompt builders. The reviewer moves onto `createAnswerSeam` (Parts 1–2) with a JSON contract: `{assessment, strengths, findings: [{severity, blocking, class, message}]}`. `runSubagent` lifts any leftover `[mechanical]`/`[design]` message prefix into `class`, then computes effective blocking per finding. It maps blockers and suggestions from that one value and derives the sink summary from it. `parseSubagentMarkdown` and its markdown fixtures are deleted. Requires Parts 1 and 2.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod, vitest (`pnpm vitest run <file>`), `pnpm typecheck`.

---

## File Structure

- `src/cr/blocking-definition.ts` (new): `BLOCKING_DEFINITION`, the one text saying what blocks, and `isNeverBlockingMessage`, its code half, which both lanes call.
- `src/cr/run-codex.ts`: both prompt builders render the definition.
- `src/cr/review-with-codex.ts`: `toFindings` demotes a never-blocking codex blocker to a suggestion.
- `src/cr/lanes/subagent-dispatch.ts`: reviewer answer schema, JSON prompt tail, repair prompt, `REVIEWER_ANSWER`, answer seam.
- `src/cr/lanes/subagent.ts`: `normalizeFinding`, `isEffectivelyBlocking`, `toSinkFinding`, a derived summary; the markdown parser is deleted.
- `src/cr/__tests__/fixtures/subagent-markdown-{clean,issues,bolded,malformed}.md`: deleted.
- `docs/noldor/cr-pipeline.md` + `templates/docs/noldor/cr-pipeline.md`: the resolved `(none)` trap.
- `docs/features/cr-lane-verdicts-blocked-by-serialization-not-substance.md`: `links.code` / `links.tests`.
- Tests: `src/cr/__tests__/run-codex.test.ts`, `src/cr/__tests__/lanes/subagent-dispatch.test.ts`, `src/cr/__tests__/lanes/subagent.test.ts`.

---

## Task 1: One blocking definition, rendered to codex

**Files:**
- Create: `src/cr/blocking-definition.ts`
- Modify: `src/cr/run-codex.ts`
- Modify: `src/cr/review-with-codex.ts`
- Test: `src/cr/__tests__/run-codex.test.ts`

- [ ] **Step 1: Write the failing tests.** In `src/cr/__tests__/run-codex.test.ts`, add these imports below the existing imports:

```ts
import { BLOCKING_DEFINITION } from '../blocking-definition.js';
import { toFindings } from '../review-with-codex.js';
```

and append at the end of the file:

```ts
describe('toFindings never-blocks demotion (Q-0250)', () => {
  it('moves a codex blocker marked maybe: or unverified: to the suggestions', () => {
    const record = {
      summary: 's',
      blockers: [
        { file: 'a.ts', line: 1, severity: 'high' as const, message: 'real defect', suggestion: null },
        { file: 'a.ts', line: 2, severity: 'high' as const, message: 'maybe: a race', suggestion: null },
        { file: 'a.ts', line: 3, severity: null, message: 'Unverified: typecheck may fail', suggestion: null },
      ],
      suggestions: [],
    };
    expect(toFindings(record, 'x').map((f) => f.severity)).toEqual(['high', 'med', 'med']);
  });
});
```

and add this test inside `describe('cut-marker contract in the codex prompt (Q-0170)', …)`, after `'tells codex the same on a SPEC review, where the markers actually live'`:

```ts
  it('renders the shared blocking definition on code and spec reviews (Q-0250)', async () => {
    const code = capturingSpawn();
    await runCodex({ ctx, spawn: code.spawn });
    expect(code.stdin()).toContain(BLOCKING_DEFINITION);
    const spec = capturingSpawn();
    await runCodex({
      ctx: { artifact: 'A', kind: 'spec', featureMd: 'F', rules: 'R' },
      spawn: spec.spawn,
    });
    expect(spec.stdin()).toContain(BLOCKING_DEFINITION);
  });
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest run src/cr/__tests__/run-codex.test.ts
```

Expected: FAIL with `Failed to load url ../blocking-definition.js`. Once that loads, the demotion test fails on `['high', 'high', 'high']`.

- [ ] **Step 3: Create the definition.** Create `src/cr/blocking-definition.ts`:

```ts
/**
 * What blocks a merge: the one definition every review lane's prompt renders (Q-0250).
 *
 * Before it, no lane was told what blocks. Every reviewer Important item blocked while the
 * prompt never said so, and the codex prompt gave no definition at all. The round-cause
 * forensics behind Q-0250 found reviewers approving over Important items they had filed, and
 * nits keeping rounds red on their own. Kept in ONE place so the reviewer and codex prompts
 * cannot drift apart; {@link isNeverBlockingMessage} is its code half.
 */
export const BLOCKING_DEFINITION = `What blocks the merge: a finding blocks only when shipping the change as it is would
- produce wrong behaviour;
- break a stated contract or an existing caller;
- open a security hole;
- lose or corrupt data;
- leave a test that cannot fail; or
- put a false statement into docs that an agent or operator will act on.
Everything else never blocks: cleanup, naming, wording, formatting, cross-references, style, and any finding marked \`maybe:\` or \`unverified:\`. If you would approve this change, no finding blocks.`;

/** Never-blocks prefixes, matched on the trimmed message, case-insensitively. */
const NEVER_BLOCKS_PREFIX = /^(?:maybe|unverified):/i;

/**
 * The code half of the definition: true when a message marks its finding `maybe:` or
 * `unverified:`, which never blocks whatever a lane put it under. Prompt text is not
 * enforcement, so every lane that sorts blockers calls this.
 */
export function isNeverBlockingMessage(message: string): boolean {
  return NEVER_BLOCKS_PREFIX.test(message.trim());
}
```

- [ ] **Step 4: Render it in both codex prompts.** In `src/cr/run-codex.ts`, add this import below the existing imports:

```ts
import { BLOCKING_DEFINITION } from './blocking-definition.js';
```

Add this constant directly above `function formatPrompt(`:

```ts
/** How codex sorts its findings: into `blockers` only under the shared definition (Q-0250). */
const CODEX_BLOCKING = `Put a finding in \`blockers\` only when it blocks under this definition; every other finding goes in \`suggestions\`.\n\n${BLOCKING_DEFINITION}`;
```

In `formatCodePrompt`, change the returned array's first two entries from `JSON_ONLY_DIRECTIVE,` and `'',` to:

```ts
    JSON_ONLY_DIRECTIVE,
    '',
    CODEX_BLOCKING,
    '',
```

In `formatArtifactPrompt`, replace the array entry

```ts
    `Report gaps that must be fixed before the ${noun} is implementable as blockers; softer improvements as suggestions. For document-level findings with no specific line, set "line": null.`,
```

with

```ts
    `A finding about the ${noun} blocks only when implementing it as written would ship one of the defects below. For document-level findings with no specific line, set "line": null.`,
    '',
    CODEX_BLOCKING,
```

- [ ] **Step 5: Demote never-blocking codex blockers.** In `src/cr/review-with-codex.ts`, add this import below the existing imports:

```ts
import { isNeverBlockingMessage } from './blocking-definition.js';
```

and in `toFindings`, replace the line `...record.blockers.map((b) => map(b, 'high')),` with:

```ts
    // A codex blocker marked `maybe:` or `unverified:` never blocks (Q-0250): demote it to a
    // suggestion rather than trusting the prompt alone to keep it out of `blockers`.
    ...record.blockers.map((b) => map(b, isNeverBlockingMessage(b.message) ? 'med' : 'high')),
```

- [ ] **Step 6: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/run-codex.test.ts && pnpm typecheck
```

Expected: PASS (both new tests and every existing codex test green), and `tsc` prints nothing.

- [ ] **Step 7: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
feat(cr): tell codex what blocks, from one shared definition

BLOCKING_DEFINITION states once what makes a finding block a merge: wrong behaviour, a broken contract or caller, a security hole, lost data, a test that cannot fail, or a false statement in docs someone will act on. Cleanup, wording, style, maybe: and unverified: findings never block. Both codex prompt builders now render it, so codex fills its blockers array by the same rule the reviewer will follow, and toFindings demotes a codex blocker marked maybe: or unverified: to a suggestion, because prompt text alone is not enforcement.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/blocking-definition.ts src/cr/run-codex.ts src/cr/review-with-codex.ts src/cr/__tests__/run-codex.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 2: The reviewer answers in JSON with a blocking flag

**Files:**
- Modify: `src/cr/lanes/subagent-dispatch.ts`
- Modify: `src/cr/lanes/subagent.ts`
- Delete: `src/cr/__tests__/fixtures/subagent-markdown-clean.md`, `src/cr/__tests__/fixtures/subagent-markdown-issues.md`, `src/cr/__tests__/fixtures/subagent-markdown-bolded.md`, `src/cr/__tests__/fixtures/subagent-markdown-malformed.md`
- Test: `src/cr/__tests__/lanes/subagent-dispatch.test.ts`, `src/cr/__tests__/lanes/subagent.test.ts`

- [ ] **Step 1: Update the prompt tests.** In `src/cr/__tests__/lanes/subagent-dispatch.test.ts`:

(a) Replace everything above `const base = {` with:

```ts
// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer, rules-cascade-v1, cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import { ALL_DIMENSIONS, DEFAULT_REVIEW_PROFILES } from '../../../core/review-profile.js';
import type { Slug } from '../../../core/slug.js';
import { BLOCKING_DEFINITION } from '../../blocking-definition.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import { buildPrompt, CUT_MARKER_TOKEN, dispatchSubagent } from '../../lanes/subagent-dispatch.js';
```

(b) Replace the whole test `'keeps the unchanged output contract and defaults to the default profile'` with:

```ts
  it('asks for the JSON answer with a blocking flag, under the shared definition', () => {
    const p = buildPrompt(base);
    expect(p).toContain(BLOCKING_DEFINITION);
    expect(p).toContain('"blocking" (true | false');
    expect(p).toContain('a "minor" finding never blocks');
    expect(p).toContain('never write a placeholder finding such as "(none)"');
    expect(p).toContain('Approve only when no finding blocks.');
  });

  it('files a claim it could not verify as unverified, never as a blocker', () => {
    expect(buildPrompt(base)).toContain('an unverified finding never blocks');
  });
```

(c) Replace the whole test `'instructs the reviewer to classify blockers [mechanical] / [design]'` with:

```ts
  it('instructs the reviewer to classify blocking findings mechanical / design', () => {
    const p = buildPrompt(base);
    expect(p).toContain('"mechanical"');
    expect(p).toContain('"design"');
    // Both definitions must be present, or the reviewer is guessing at the axis.
    expect(p).toContain('the fix is determined by the finding itself');
    expect(p).toContain('requires a judgment call you are NOT making for them');
    // The tie-break points at the safe side: a design-classed blocker goes to a human,
    // which is what `cr autofix`'s fail-safe read relies on.
    expect(p).toContain('When in doubt, use "design"');
    // Classify by what the fix needs, not by severity — the two axes are orthogonal.
    expect(p).toContain('Classify by what the FIX needs, not by how severe');
  });
```

(d) In `'carries the classification instruction under every profile'`, change `toContain('[mechanical]')` to `toContain('"mechanical"')`.

(e) Replace the whole `describe('default dispatcher timeout', …)` block with:

```ts
describe('default dispatcher', () => {
  const at = (): { repoRoot: string; slug: Slug; kind: 'code' } => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-subagent-dispatch-'));
    mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
    writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
    return { repoRoot, slug: 'feat-x' as Slug, kind: 'code' };
  };
  const calls: SpawnAgentOpts[] = [];
  const clean = (): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push(opts);
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path) writeFileSync(path, '{"assessment":"approve","strengths":"s","findings":[]}');
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false };
    });
  afterEach(() => {
    calls.length = 0;
    setLaneSpawn(undefined);
  });

  it('applies DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits timeoutMs', async () => {
    clean();
    await dispatchSubagent(base, at());
    expect(calls[0]!.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
  });

  it('honors an explicit timeoutMs from the lane', async () => {
    clean();
    await dispatchSubagent({ ...base, timeoutMs: 42_000 }, at());
    expect(calls[0]!.timeoutMs).toBe(42_000);
  });
});
```

(f) Rename the last test `'asks every Critical and Important bullet to name a file and line'` to `'asks every critical and important finding to name a file and line'`. Its two assertions stay as they are.

- [ ] **Step 2: Rewrite the lane tests.** Delete the four markdown fixtures:

```bash
git rm src/cr/__tests__/fixtures/subagent-markdown-clean.md src/cr/__tests__/fixtures/subagent-markdown-issues.md src/cr/__tests__/fixtures/subagent-markdown-bolded.md src/cr/__tests__/fixtures/subagent-markdown-malformed.md
```

In `src/cr/__tests__/lanes/subagent.test.ts`:

(a) Change the `@tests` line to `// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer, cr-lane-verdicts-blocked-by-serialization-not-substance`. Change `import { join, resolve } from 'node:path';` to `import { join } from 'node:path';`, and replace `import { mkFindingFor, resolveChangedFiles, runSubagent } from '../../lanes/subagent.js';` with:

```ts
import {
  normalizeFinding,
  resolveChangedFiles,
  runSubagent,
  toSinkFinding,
} from '../../lanes/subagent.js';
```

(b) Replace the line `const FIX = resolve(__dirname, '..', 'fixtures');` with:

```ts
/** What the reviewer child writes to its answer file. */
const answer = (findings: unknown[] = [], assessment = 'approve — clear summary'): string =>
  JSON.stringify({ assessment, strengths: 'clear summary', findings });
const CLEAN = answer();

const sinkOf = async (r: { sinkPath: string }): Promise<Record<string, any>> =>
  JSON.parse(await readFile(r.sinkPath, 'utf8')) as Record<string, any>;
```

(c) Replace the six tests from `'clean markdown → approve summary, empty blockers'` through `'tolerates bolded + h3-decorated headings (real subagent output)'` with:

```ts
  it('clean answer → approve summary, empty blockers, the assessment kept in notes', async () => {
    dispatchSubagent.mockResolvedValueOnce(CLEAN);
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.summary).toBe('approve');
    expect(j.blockers).toEqual([]);
    expect(j.notes).toEqual(
      expect.arrayContaining(['Assessment: approve — clear summary', 'Strengths: clear summary']),
    );
  });

  it('maps severity × blocking into blockers and suggestions', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer(
        [
          { severity: 'critical', blocking: true, class: 'mechanical', message: 'missing section' },
          { severity: 'important', blocking: true, class: 'design', message: 'wrong default' },
          { severity: 'important', blocking: false, message: 'cleanup worth doing' },
          { severity: 'minor', blocking: false, message: 'typo' },
        ],
        'blockers found',
      ),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    const j = await sinkOf(r);
    expect(j.summary).toBe('blockers found (2)');
    expect(j.blockers).toEqual([
      expect.objectContaining({ severity: 'high', class: 'mechanical', message: 'missing section' }),
      expect.objectContaining({ severity: 'med', class: 'design', message: 'wrong default' }),
    ]);
    expect(j.suggestions.map((s: { severity: string }) => s.severity)).toEqual(['med', 'low']);
  });

  it('approves over non-blocking Important findings, keeping them as suggestions', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([{ severity: 'important', blocking: false, message: 'the two Important items are cleanup' }]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.summary).toBe('approve');
    expect(j.suggestions).toHaveLength(1);
  });

  it('never lets a minor, maybe: or unverified: finding block, whatever its flag says', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'minor', blocking: true, message: 'nit' },
        { severity: 'critical', blocking: true, message: 'maybe: a race in the retry loop' },
        { severity: 'important', blocking: true, message: 'Unverified: pnpm typecheck may fail' },
      ]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    expect((await sinkOf(r)).suggestions).toHaveLength(3);
  });

  it('drops placeholder findings, so (none) can never block (Q-0246 replay)', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([
        { severity: 'critical', blocking: true, message: '(none)' },
        { severity: 'important', blocking: true, message: '- None.' },
      ]),
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(true);
    const j = await sinkOf(r);
    expect(j.blockers).toEqual([]);
    expect(j.summary).toBe('approve');
  });

  it('a blocking finding without a class carries no class key, so autofix reads it as design', async () => {
    dispatchSubagent.mockResolvedValueOnce(
      answer([{ severity: 'critical', blocking: true, message: 'unclassified finding' }]),
    );
    const j = await sinkOf(await runSubagent(input()));
    expect(j.blockers).toHaveLength(1);
    expect('class' in j.blockers[0]).toBe(false);
  });

  it('an unreadable answer, even after the repair round, → synthetic blocker', async () => {
    dispatchSubagent.mockResolvedValue(
      'Strengths: fine\n\nIssues:\n  Critical:\n    - (none)\n\nAssessment: approve',
    );
    const r = await runSubagent(input());
    expect(r.ok).toBe(false);
    expect(dispatchSubagent).toHaveBeenCalledTimes(2);
    expect((await sinkOf(r)).blockers[0].message).toMatch(/no trustworthy answer/);
  });
```

(d) In every remaining test that still reads a fixture, replace `await readFile(join(FIX, 'subagent-markdown-clean.md'), 'utf8')` with `CLEAN`. That covers `'missing FD (ENOENT) …'`, both `timeoutMs` tests, `'forwards priorReview …'`, both `fullReview` tests and `"neither baseSha nor fullReview …"`.

(e) Replace the whole `describe('mkFinding locations', …)` block with:

```ts
describe('toSinkFinding / normalizeFinding', () => {
  const changed = ['src/cr/orchestrate.ts'];
  const toSink = toSinkFinding('a.md', changed);

  it('attaches a resolved location and leaves the message intact', () => {
    const f = toSink({
      severity: 'critical',
      blocking: true,
      class: 'design',
      message: '`orchestrate.ts:475` returns early',
    });
    expect(f).toMatchObject({
      severity: 'high',
      class: 'design',
      message: '`orchestrate.ts:475` returns early',
      locations: [{ file: 'src/cr/orchestrate.ts', line: 475 }],
    });
  });

  it('lifts a leftover [mechanical] message prefix into class when the field is absent', () => {
    expect(
      normalizeFinding({ severity: 'important', blocking: true, message: '[mechanical] missing section' }),
    ).toMatchObject({ class: 'mechanical', message: 'missing section' });
  });

  it('omits locations when the message names none, or none resolves', () => {
    expect(toSink({ severity: 'minor', blocking: false, message: 'this is simply wrong' })).not.toHaveProperty(
      'locations',
    );
    expect(
      toSink({ severity: 'minor', blocking: false, message: '`src/core/session.ts:10` is wrong' }),
    ).not.toHaveProperty('locations');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts src/cr/__tests__/lanes/subagent.test.ts
```

Expected: FAIL. The prompt still asks for markdown buckets, `normalizeFinding` and `toSinkFinding` are not exported, and every JSON answer lands on `subagent returned malformed markdown`.

- [ ] **Step 4: Move the reviewer prompt onto the answer seam.** In `src/cr/lanes/subagent-dispatch.ts`:

(a) Replace the two imports `spawnAgent` (from `../../core/agent-runner/registry.js`) and `DEFAULT_DISPATCH_TIMEOUT_MS` (from `../../core/config.js`) with:

```ts
import { z } from 'zod';
import { BLOCKING_DEFINITION } from '../blocking-definition.js';
import { FINDING_CLASSES } from '../finding-class.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
```

(b) In `buildPrompt`'s doc comment, replace the paragraph that begins `The prompt instructs the agent to act as a senior code reviewer` with:

```ts
 * The prompt instructs the agent to act as a senior code reviewer against the artifact path.
 * Its answer is one JSON object in the lane's answer file ({@link REVIEWER_ANSWER}), with a
 * per-finding `blocking` flag under {@link BLOCKING_DEFINITION}. Every runner qualifies:
 * agent-writes runners write the file, codex's CLI writes its final message there.
```

(c) In the template literal returned by `buildPrompt`, replace everything from the line beginning `Verify-before-flag protocol:` to the end of the template (the line `Leave a bucket's bullet list empty (no bullets) when there are no items at that severity.`, closing backtick and semicolon included) with:

```ts
Verify-before-flag protocol: before flagging a critical finding that claims a command, validator, or test will fail (e.g. \`pnpm validate:features\`, \`pnpm typecheck\`, \`pnpm test\`), run that exact command first and quote its actual error output in the message. If the command passes, or you cannot run it, prefix the message \`unverified:\` — an unverified finding never blocks.

${BLOCKING_DEFINITION}

Classify every blocking finding with "class":
- "mechanical" — the fix is determined by the finding itself: a missing required section, an unanswered open question, a lint-class defect, a stated contract not met. Someone applying your finding needs no judgment call beyond what you wrote.
- "design" — the fix requires a judgment call you are NOT making for them: disagreement about an approach, a default, a trade-off, or anything where two reasonable fixes exist and picking between them is the author's call.

Classify by what the FIX needs, not by how severe the finding is. When in doubt, use "design" — a design-classed blocker is routed to a human, which is always safe.

In every critical and important finding, name the file and line the finding is about, as \`path/to/file.ts:123\` (or \`path/to/file.ts:123-130\` for a range), inline in the message. Repo-relative paths are preferred; a bare filename is accepted when it is unambiguous. Omit it only when the finding genuinely has no single location.

Your answer has one field per part of the review:
- "assessment": your one-line verdict. Approve only when no finding blocks.
- "strengths": one line on what is well done.
- "findings": one entry per issue, each with "severity" ("critical" | "important" | "minor"), "blocking" (true | false, per the definition above — a "minor" finding never blocks), "class" (on blocking findings) and "message". With nothing to report, "findings" is [] — never write a placeholder finding such as "(none)".`;
```

(d) Replace everything from `type Dispatcher = (input: DispatchInput) => Promise<string>;` to the end of the file with:

```ts
/** One reviewer finding. `blocking` is the reviewer's own call under BLOCKING_DEFINITION. */
export const reviewerFindingSchema = z.object({
  severity: z.enum(['critical', 'important', 'minor']),
  blocking: z.boolean(),
  class: z.enum(FINDING_CLASSES).nullish(),
  message: z.string().min(1),
});
export type ReviewerFinding = z.infer<typeof reviewerFindingSchema>;

export const reviewerAnswerSchema = z.object({
  assessment: z.string().min(1),
  strengths: z.string().default(''),
  findings: z.array(reviewerFindingSchema).default([]),
});
export type ReviewerAnswer = z.infer<typeof reviewerAnswerSchema>;

const REVIEWER_SHAPE =
  '{"assessment": "...", "strengths": "...", "findings": [{"severity": "critical" | "important" | "minor", "blocking": true | false, "class": "mechanical" | "design", "message": "... path/to/file.ts:123 ..."}]}';

/**
 * The repair round's prompt: restate the review as a valid answer. It reviews nothing,
 * reads no file, drops no finding, and never softens a blocking one.
 */
export function buildReviewerRepairPrompt(ctx: RepairContext): string {
  return `A previous Senior Code Reviewer finished its review, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that review as a valid answer — do not review anything yourself, do not read any file.

Its rejected answer:
${ctx.rejected ?? '(it wrote no answer file)'}

Its output:
${ctx.stdout.trim() === '' ? '(none captured)' : ctx.stdout}

Transcription rules:
1. Carry over every finding the review states, with its severity, whether it blocks, its class and its message. Invent no finding and drop none.
2. Never turn a finding the review marked blocking into a non-blocking one, and never write an approving assessment the review did not give.
3. If nothing above states a review at all, write no answer.`;
}

/** What the reviewer child hands back, and how the seam reads it. */
export const REVIEWER_ANSWER: LaneAnswerContract<ReviewerAnswer> = {
  lane: 'reviewer',
  shape: REVIEWER_SHAPE,
  schema: reviewerAnswerSchema,
  placeholderFields: [{ list: 'findings', text: 'message' }],
  repairPrompt: buildReviewerRepairPrompt,
};

const seam = createAnswerSeam<DispatchInput, ReviewerAnswer>(buildPrompt, {
  role: 'reviewer',
  site: 'cr.subagent-dispatch',
  contract: REVIEWER_ANSWER,
  onFailure: (f) => {
    throw new Error(
      `subagent dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}${f.timedOut ? ' (timeout)' : ''}`,
    );
  },
});

/** Test injection point: swaps the reviewer child (see `createAnswerSeam`). */
export const setDispatcher = seam.setDispatcher;
export const dispatchSubagent = seam.dispatch;
```

- [ ] **Step 5: Read the answer in the lane.** In `src/cr/lanes/subagent.ts`:

(a) Replace `import { dispatchSubagent } from './subagent-dispatch.js';` with:

```ts
import { isNeverBlockingMessage } from '../blocking-definition.js';
import type { LaneAnswer } from '../lane-answer.js';
import { dispatchSubagent, type ReviewerAnswer, type ReviewerFinding } from './subagent-dispatch.js';
```

(b) Delete `interface ParsedMarkdown`, `stripDecorations` and `parseSubagentMarkdown`, each with its doc comment.

(c) Replace `mkFindingFor` and its doc comment with:

```ts
/**
 * The finding with a leftover `[mechanical]` / `[design]` message prefix lifted into `class`.
 * A model trained on the old bucket format may still tag the message; the tag is moved into
 * the field instead of staying in the text, and an explicit `class` field wins.
 */
export function normalizeFinding(f: ReviewerFinding): ReviewerFinding {
  const tagged = splitClassTag(f.message);
  const cls = f.class ?? tagged.class;
  return { ...f, message: tagged.message, ...(cls ? { class: cls } : {}) };
}

/**
 * Whether a reviewer finding actually blocks: the reviewer said so, it is not `minor`, and it
 * is not marked `maybe:` or `unverified:`. The never-blocks classes are enforced here, not only
 * requested in the prompt, so a model that flags an unverified claim blocking cannot red the
 * round on it (Q-0250).
 */
export function isEffectivelyBlocking(f: ReviewerFinding): boolean {
  return f.blocking && f.severity !== 'minor' && !isNeverBlockingMessage(f.message);
}

/**
 * Reviewer finding → sink {@link Finding}, curried on the artifact label and the round's
 * changed files. A blocker maps critical→high and important→med; a suggestion maps
 * critical or important→med and minor→low. `file` keeps its meaning — the artifact LABEL,
 * not a location — because `fingerprintBlockers` hashes it.
 */
export const toSinkFinding =
  (artifact: string, changedFiles: readonly string[]) =>
  (f: ReviewerFinding): Finding => {
    const severity: Finding['severity'] = isEffectivelyBlocking(f)
      ? f.severity === 'critical'
        ? 'high'
        : 'med'
      : f.severity === 'minor'
        ? 'low'
        : 'med';
    const locations = extractLocations(f.message, changedFiles);
    return {
      file: artifact,
      severity,
      message: f.message,
      ...(f.class ? { class: f.class } : {}),
      ...(locations.length > 0 ? { locations } : {}),
    };
  };
```

(d) In `runSubagent`, replace everything from `let markdown: string;` to the end of the file with:

```ts
  let answer: LaneAnswer<ReviewerAnswer>;
  try {
    // Fast-track ships no FD, so a missing FD file is a legitimate state
    // (drain-mode code review), not an error — review the diff without the
    // summary context. A present-but-malformed FD still errors below.
    const fdSummary = await readFdSummary(input.fdPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return '(no FD — fast-track change; review the diff on its own merits)';
      throw err;
    });
    const rulesBrief = resolveBindingRules(input, rulesBaseSha);
    answer = await dispatchSubagent(
      {
        artifact: input.artifact,
        fdSummary,
        baseSha: promptBaseSha,
        headSha: input.artifactSha,
        description: `${input.kind} for FD ${input.slug}`,
        ...(input.reviewProfile ? { reviewProfile: input.reviewProfile } : {}),
        ...(rulesBrief !== undefined ? { rulesBrief } : {}),
        ...(input.priorReview !== undefined ? { priorReview: input.priorReview } : {}),
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      { repoRoot: input.repoRoot, slug: input.slug, kind: input.kind },
    );
  } catch (err) {
    const errMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `subagent lane errored: ${errMsg}`,
        },
      ],
      suggestions: [],
      summary: 'subagent error',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  if (!answer.ok) {
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `reviewer returned no trustworthy answer: ${answer.detail}`,
        },
      ],
      suggestions: [],
      summary: 'subagent parse error',
      notes: answer.notes,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  // Blocking is the reviewer's per-finding call, with the never-blocks classes enforced by
  // `isEffectivelyBlocking`. The summary is derived from the same value `ok` reads, so the
  // sink can no longer say "approve" over a red round (Q-0250).
  const findings = answer.answer.findings.map(normalizeFinding);
  const toSink = toSinkFinding(input.artifact, changedFiles);
  const blockers = findings.filter(isEffectivelyBlocking).map(toSink);
  const suggestions = findings.filter((f) => !isEffectivelyBlocking(f)).map(toSink);
  const payload: LaneFindings = {
    lane: 'reviewer',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers,
    suggestions,
    summary: blockers.length === 0 ? 'approve' : `blockers found (${blockers.length})`,
    notes: [
      `Assessment: ${answer.answer.assessment}`,
      `Strengths: ${answer.answer.strengths}`,
      ...answer.notes,
    ],
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'reviewer', sinkPath, ok: blockers.length === 0 };
}
```

- [ ] **Step 6: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts src/cr/__tests__/lanes/subagent.test.ts src/cr/__tests__/orchestrate.test.ts src/cr/__tests__/autofix.test.ts && pnpm typecheck
```

Expected: PASS (every reviewer, orchestrate and autofix test green), and `tsc` prints nothing.

- [ ] **Step 7: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
fix(cr): let a reviewer finding block only when the reviewer says it does

The reviewer now answers through createAnswerSeam with one JSON object: an assessment, strengths, and findings that each carry severity, a blocking flag, a class and a message. An empty list is [], placeholder findings such as "(none)" are dropped before validation, and runSubagent enforces the never-blocks classes (minor, maybe:, unverified:) in code. The sink summary is derived from the same effective-blocking value ok reads, so a reviewer can no longer approve over a red round, and an approve over non-blocking Important findings is green. The markdown bucket parser and its fixtures are deleted; a leftover [mechanical]/[design] message prefix is still lifted into class.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lanes/subagent-dispatch.ts src/cr/lanes/subagent.ts src/cr/__tests__/lanes/subagent-dispatch.test.ts src/cr/__tests__/lanes/subagent.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 3: Docs and feature links

**Files:**
- Modify: `docs/noldor/cr-pipeline.md`, `templates/docs/noldor/cr-pipeline.md`
- Modify: `docs/features/cr-lane-verdicts-blocked-by-serialization-not-substance.md`

- [ ] **Step 1: Mark the `(none)` trap resolved.** In `docs/noldor/cr-pipeline.md`, replace the bullet that begins `- **A reviewer lane that writes \`- (none)\` under an empty severity bucket reds` and ends `a lane's serialization defect blocking a ship its own content approved.` with:

```markdown
- **Resolved (Q-0250): a reviewer that wrote `- (none)` under an empty severity bucket
  red the round with phantom blockers.** Shipping Q-0246, the reviewer approved and its sink
  still carried blockers whose message was the literal `(none)`. The reviewer now answers with
  one JSON object in its answer file. An empty list is `[]`, and placeholder entries such as
  `(none)` or `N/A` are dropped before validation. A finding blocks only when the reviewer marks
  it `blocking`, and never when it is `minor` or marked `maybe:` or `unverified:`. The sink
  `summary` is derived from those flags, so it can no longer read `approve` over a red round.
```

Then mirror the twin and confirm they match:

```bash
cp docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md && node bin/noldor.mjs checks template-sync
```

Expected: `template-sync` exits 0.

- [ ] **Step 2: Point the feature doc at what shipped.** In `docs/features/cr-lane-verdicts-blocked-by-serialization-not-substance.md`, replace the `links.code` and `links.tests` lists with:

```yaml
  code:
    - src/core/agent-runner/types.ts
    - src/core/agent-runner/capabilities.ts
    - src/core/agent-runner/runners/codex.ts
    - src/core/agent-runner/registry.ts
    - src/cr/filename.ts
    - src/cr/lane-answer.ts
    - src/cr/lane-spawn.ts
    - src/cr/extract-json.ts
    - src/cr/blocking-definition.ts
    - src/cr/run-codex.ts
    - src/cr/lanes/prompt-parts.ts
    - src/cr/lanes/verify-dispatch.ts
    - src/cr/lanes/verify.ts
    - src/cr/lanes/ui-review-dispatch.ts
    - src/cr/lanes/ui-review.ts
    - src/cr/lanes/render-export-dispatch.ts
    - src/cr/lanes/render-compare.ts
    - src/cr/lanes/subagent-dispatch.ts
    - src/cr/lanes/subagent.ts
  tests:
    - src/core/agent-runner/__tests__/runners.test.ts
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/cr/__tests__/filename.test.ts
    - src/cr/__tests__/lane-answer.test.ts
    - src/cr/__tests__/lane-spawn.test.ts
    - src/cr/__tests__/run-codex.test.ts
    - src/cr/__tests__/lanes/verify-dispatch.test.ts
    - src/cr/__tests__/lanes/verify.test.ts
    - src/cr/__tests__/lanes/ui-review-dispatch.test.ts
    - src/cr/__tests__/lanes/ui-review.test.ts
    - src/cr/__tests__/lanes/render-compare.test.ts
    - src/cr/__tests__/lanes/subagent-dispatch.test.ts
    - src/cr/__tests__/lanes/subagent.test.ts
```

- [ ] **Step 3: Validate.**

```bash
node bin/noldor.mjs validate features && pnpm typecheck && pnpm vitest run src/cr src/core/agent-runner
```

Expected: `Validated … feature MD(s) — all OK.`, `tsc` prints nothing, and every test is green.

- [ ] **Step 4: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
docs(features:cr-lane-verdicts-blocked-by-serialization-not-substance): record the reviewer answer contract and the shipped files

The cr-pipeline trap for the reviewer's (none) phantom blocker is marked resolved, with the JSON answer and blocking rule that replaced it, and the feature doc's links name every file the three parts changed.

Noldor-Sibling-Scope: noldor:cr-pipeline
Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md docs/features/cr-lane-verdicts-blocked-by-serialization-not-substance.md
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```
