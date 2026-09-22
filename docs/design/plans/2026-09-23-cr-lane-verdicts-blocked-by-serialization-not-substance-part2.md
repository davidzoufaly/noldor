# CR Lane Verdicts Blocked by Serialization, Not Substance — Part 2: UI-Reviewer and Render-Export Answer Files Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** The ui-reviewer and render-export lanes read their reports from per-dispatch answer files, so a finding message that quotes fenced code can no longer break a report. With the last caller gone, the fenced-JSON reader and the old dispatcher seam are deleted.

**Architecture:** Both lanes move onto `createAnswerSeam` (Part 1, `src/cr/lane-spawn.ts`). Each declares a `LaneAnswerContract`: its schema, its example shape, its placeholder field (the ui-reviewer's `findings[].message`; render-export has none) and a transcription repair prompt. `parseLastJsonFence`, `parseFencedJson`, `fencedJsonInstruction`, `createDispatcherSeam` and `spawnLanePrompt` are then removed. Requires Part 1 (`docs/design/plans/2026-09-23-cr-lane-verdicts-blocked-by-serialization-not-substance-part1.md`).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod, vitest (`pnpm vitest run <file>`), `pnpm typecheck`.

---

## File Structure

- `src/cr/lanes/ui-review-dispatch.ts`: ui-reviewer contract (`UI_REVIEW_SHAPE`, `buildUiReviewRepairPrompt`, `UI_REVIEW_ANSWER`) on the answer seam; `parseUiReviewReport` is deleted.
- `src/cr/lanes/ui-review.ts`: reads a `LaneAnswer<UiReviewReport>`.
- `src/cr/lanes/render-export-dispatch.ts`: exporter contract (`RENDER_EXPORT_SHAPE`, `buildRenderExportRepairPrompt`, `RENDER_EXPORT_ANSWER`) on the answer seam; `parseRenderExportReport` is deleted.
- `src/cr/lanes/render-compare.ts`: reads a `LaneAnswer<RenderExportReport>`.
- `src/cr/extract-json.ts`: keeps only `extractJsonObject`.
- `src/cr/lanes/prompt-parts.ts`: keeps only `answerInstruction`.
- `src/cr/lane-spawn.ts`: keeps only the answer seam.
- Tests: `src/cr/__tests__/lanes/ui-review-dispatch.test.ts`, `src/cr/__tests__/lanes/ui-review.test.ts`, `src/cr/__tests__/lanes/render-compare.test.ts`.

---

## Task 1: The ui-reviewer reads its answer file

**Files:**
- Modify: `src/cr/lanes/ui-review-dispatch.ts`
- Modify: `src/cr/lanes/ui-review.ts`
- Test: `src/cr/__tests__/lanes/ui-review-dispatch.test.ts`, `src/cr/__tests__/lanes/ui-review.test.ts`

- [x] **Step 1: Rewrite the dispatch tests.** Replace the whole of `src/cr/__tests__/lanes/ui-review-dispatch.test.ts` with:

```ts
// @tests: ui-design-review-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
import { describe, expect, it } from 'vitest';
import { readLaneAnswer } from '../../lane-answer.js';
import {
  UI_REVIEW_ANSWER,
  UI_REVIEW_SHAPE,
  buildUiReviewPrompt,
} from '../../lanes/ui-review-dispatch.js';

const answer = (payload: unknown): string => JSON.stringify(payload);
const read = (text: string): ReturnType<typeof readLaneAnswer> =>
  readLaneAnswer(text, UI_REVIEW_ANSWER);

const EVIDENCE = {
  file: 'src/ui/Panel.tsx',
  severity: 'high' as const,
  message: 'missing',
  designPage: 'FINAL:app: default',
  designElement: 'Submit',
};

const INPUT = {
  penPath: '/tmp/scratch-abc/feat.pen',
  surfaces: ['app', 'settings'],
  baseSha: 'origin/main',
  headSha: 'deadbeef',
  repoRoot: '/repo',
  fdSummary: 'A settings panel.',
};

describe('UI_REVIEW_ANSWER', () => {
  it('reads a whole-file fenced answer whose message quotes a fence', () => {
    const text = `\`\`\`json\n${answer({ verdict: 'fail', findings: [{ ...EVIDENCE, message: 'label reads ```Save``` in code' }] })}\n\`\`\``;
    expect(read(text)).toMatchObject({ ok: true, answer: { verdict: 'fail' } });
  });

  it('accepts each well-formed verdict', () => {
    expect(read(answer({ verdict: 'pass', findings: [] }))).toMatchObject({ ok: true });
    expect(read(answer({ verdict: 'fail', findings: [EVIDENCE] }))).toMatchObject({ ok: true });
    expect(
      read(answer({ verdict: 'cannot-review', findings: [], reason: 'no-final-pages' })),
    ).toMatchObject({ ok: true, answer: { reason: 'no-final-pages' } });
  });

  it('drops a placeholder finding so a padded pass validates', () => {
    expect(
      read(answer({ verdict: 'pass', findings: [{ ...EVIDENCE, message: '(none)' }] })),
    ).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
  });

  it.each([
    ['plain prose', 'I reviewed it and it looks fine'],
    ['unparseable json', '{not json'],
    ['pass carrying findings', answer({ verdict: 'pass', findings: [EVIDENCE] })],
    ['fail carrying none', answer({ verdict: 'fail', findings: [] })],
    ['cannot-review without a reason', answer({ verdict: 'cannot-review', findings: [] })],
    [
      'cannot-review with an unknown reason',
      answer({ verdict: 'cannot-review', findings: [], reason: 'vibes' }),
    ],
    ['unknown verdict', answer({ verdict: 'maybe', findings: [] })],
    [
      'a finding missing its design-side evidence',
      answer({ verdict: 'fail', findings: [{ file: 'a.tsx', severity: 'high', message: 'm' }] }),
    ],
    [
      'a pass that also carries a reason (contradictory, unknown key)',
      answer({ verdict: 'pass', findings: [], reason: 'pen-unreadable' }),
    ],
    [
      'a fail that also carries a reason',
      answer({ verdict: 'fail', findings: [EVIDENCE], reason: 'pen-unreadable' }),
    ],
    [
      'a finding missing its code-side file',
      answer({
        verdict: 'fail',
        findings: [{ severity: 'high', message: 'm', designPage: 'p', designElement: 'e' }],
      }),
    ],
  ])('rejects %s', (_label, text) => {
    expect(read(text).ok).toBe(false);
  });
});

describe('buildUiReviewPrompt', () => {
  it('points the child at the scratch path and the surfaces in scope', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('/tmp/scratch-abc/feat.pen');
    expect(p).toContain('Surfaces in scope: app, settings');
    expect(p).toContain('origin/main..deadbeef');
    expect(p).toContain('A settings panel.');
  });

  it('tells the child to read every FINAL page when no surface was resolved', () => {
    const p = buildUiReviewPrompt({ ...INPUT, surfaces: [] });
    expect(p).toContain('read every `FINAL:` page');
    expect(p).not.toContain('Surfaces in scope:');
  });

  it('routes design reading through pencil MCP and forbids editing', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('execute({ filePath:');
    expect(p).toMatch(/Do not edit it/);
  });

  it('describes the three shapes as prose and keeps the example shape valid JSON', () => {
    expect(buildUiReviewPrompt(INPUT)).toContain('Emit no key beyond the ones your shape lists');
    // The seam renders this example into the answer instruction; a child that echoes it
    // verbatim must still write parseable JSON.
    expect(() => JSON.parse(UI_REVIEW_SHAPE) as unknown).not.toThrow();
  });

  it('states the non-normative properties so unpinned details are not flagged', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('NOT NORMATIVE');
    for (const token of ['pixel geometry', 'localization', 'never a finding']) {
      expect(p).toContain(token);
    }
  });
});
```

- [x] **Step 2: Make the lane test's child write a bare answer.** In `src/cr/__tests__/lanes/ui-review.test.ts`, replace

```ts
const report = (payload: unknown): string =>
  `prose\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
```

with

```ts
/** What the child writes to its answer file: the report and nothing else. */
const report = (payload: unknown): string => JSON.stringify(payload);
```

- [x] **Step 3: Run the tests to verify they fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/ui-review-dispatch.test.ts src/cr/__tests__/lanes/ui-review.test.ts
```

Expected: FAIL. `UI_REVIEW_ANSWER` and `UI_REVIEW_SHAPE` are not exported yet, and every performed-review test in `ui-review.test.ts` lands on `malformed-output`, because the old reader wants a fenced block.

- [x] **Step 4: Move the dispatch module onto the answer seam.** In `src/cr/lanes/ui-review-dispatch.ts`:

(a) Replace the three imports `parseFencedJson`, `createDispatcherSeam` and `fencedJsonInstruction` with:

```ts
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
```

(b) In `buildUiReviewPrompt`, delete the blank line and the final `${fencedJsonInstruction(…)}` call, so the template literal ends right after ``…one extra key makes the whole report unreadable.`;``. The seam appends the answer instruction with the shape.

(c) Replace the `parseUiReviewReport` doc comment and export with:

```ts
/** The example the answer instruction shows the child — valid JSON, so an echo still parses. */
export const UI_REVIEW_SHAPE =
  '{"verdict": "fail", "findings": [{"file": "src/ui/Panel.tsx", "line": 42, "severity": "high", "message": "...", "designPage": "FINAL:app: default", "designElement": "Submit"}]}';

/**
 * The repair round's prompt: restate the reviewer's report as a valid answer. It opens no
 * design, reads no code, and never upgrades a hedged report into `pass`.
 */
export function buildUiReviewRepairPrompt(ctx: RepairContext): string {
  return `A previous UI-Design Reviewer finished its review, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that reviewer's conclusion as a valid answer — do not open the design, do not read the code, do not review anything yourself.

Its rejected answer:
${ctx.rejected ?? '(it wrote no answer file)'}

Its output:
${ctx.stdout.trim() === '' ? '(none captured)' : ctx.stdout}

Transcription rules:
1. Use exactly one of the three shapes: pass with an empty findings array; fail with at least one finding naming its file, severity, message, designPage and designElement; or cannot-review with reason pen-unreadable or no-final-pages.
2. Never upgrade a partial or hedged report into pass, and invent no finding the output does not state.
3. If nothing above clearly states a verdict, write no answer at all.`;
}

/** What the ui-reviewer child hands back, and how the seam reads it. */
export const UI_REVIEW_ANSWER: LaneAnswerContract<UiReviewReport> = {
  lane: 'ui-reviewer',
  shape: UI_REVIEW_SHAPE,
  schema: uiReviewReportSchema,
  placeholderFields: [{ list: 'findings', text: 'message' }],
  repairPrompt: buildUiReviewRepairPrompt,
};
```

(d) Replace the `const seam = createDispatcherSeam<UiDispatchInput>(buildUiReviewPrompt, { … });` statement with:

```ts
const seam = createAnswerSeam<UiDispatchInput, UiReviewReport>(buildUiReviewPrompt, {
  role: 'ui-reviewer',
  site: 'cr.ui-review-dispatch',
  contract: UI_REVIEW_ANSWER,
  onFailure: (f) => {
    throw new UiDispatchError(
      f.reason,
      f.timedOut
        ? 'ui-review dispatch timed out'
        : `ui-review dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
    );
  },
});
```

- [x] **Step 5: Move the lane onto the answer.** In `src/cr/lanes/ui-review.ts`:

(a) Replace the `import { UiDispatchError, dispatchUiReview, parseUiReviewReport, type UiFinding } from './ui-review-dispatch.js';` statement with:

```ts
import type { LaneAnswer } from '../lane-answer.js';
import {
  UiDispatchError,
  dispatchUiReview,
  type UiFinding,
  type UiReviewReport,
} from './ui-review-dispatch.js';
```

(b) Replace the body of the outer `try { … }`, from `const cap = …` down to the final `return writeFailByMode(…);`, with:

```ts
    const cap = input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {};
    let answer: LaneAnswer<UiReviewReport> | null = null;
    let dispatchFailure: { reason: LaneReasonCode; message: string } | null = null;
    try {
      answer = await dispatchUiReview(
        {
          penPath: scratchPen,
          surfaces: design.surfaces,
          baseSha: design.base,
          headSha: input.artifactSha,
          repoRoot: input.repoRoot,
          fdSummary: design.fdSummary,
          ...cap,
        },
        { repoRoot: input.repoRoot, slug: input.slug, kind: input.kind },
      );
    } catch (err) {
      dispatchFailure = {
        reason: err instanceof UiDispatchError ? err.reason : 'dispatch-failed',
        message: errMessage(err),
      };
    }

    // Integrity is checked BEFORE the dispatch outcome is acted on — including a
    // failed dispatch. A child that edits the design and then times out would
    // otherwise land as an advisory-green `timeout` instead of the mandatory
    // `pen-modified` blocker.
    const integrity = await designChanged();
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail, notes);
    }

    if (dispatchFailure !== null) {
      return writeTerminal(
        { verdict: 'cannot-review', reason: dispatchFailure.reason, detail: dispatchFailure.message },
        notes,
      );
    }

    const roundNotes = [...notes, ...(answer?.notes ?? [])];
    if (answer === null || !answer.ok) {
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: 'malformed-output',
          detail: `no trustworthy child report: ${answer !== null && !answer.ok ? answer.detail : 'no answer'}`,
        },
        roundNotes,
      );
    }
    const report = answer.answer;
    if (report.verdict === 'cannot-review') {
      // The child's two reasons stay distinct: `no-final-pages` means the design
      // exists but pins nothing for the scope, `pen-unreadable` that it could not
      // be opened at all. Different remediation, so different codes.
      return writeTerminal(
        { verdict: 'cannot-review', reason: report.reason, detail: `child reported ${report.reason}` },
        roundNotes,
        design.repoRelPath,
      );
    }
    if (report.verdict === 'pass') {
      return write(
        {
          verdict: 'pass',
          blockers: [],
          suggestions: [],
          summary: 'implementation matches the approved design',
          ...(roundNotes.length > 0 ? { notes: roundNotes } : {}),
        },
        true,
      );
    }
    return writeFailByMode(
      write,
      mode,
      report.findings.map(toFinding),
      'implementation contradicts the approved design',
      roundNotes,
    );
```

- [x] **Step 6: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/ui-review-dispatch.test.ts src/cr/__tests__/lanes/ui-review.test.ts && pnpm typecheck
```

Expected: PASS. Every ui-review test is green, including `'reports malformed-output when the child emits no parseable report'`, which now fails validation once, repairs once and still lands on `malformed-output`. `tsc` prints nothing.

- [x] **Step 7: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
fix(cr): read the ui-reviewer's report from its answer file

The ui-reviewer lane now answers through createAnswerSeam, so a finding message that quotes fenced code can no longer close its report early. Its contract drops placeholder findings before the strict discriminated-union validation, and a transcription repair prompt gives an unreadable report one more chance before the lane records malformed-output.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lanes/ui-review-dispatch.ts src/cr/lanes/ui-review.ts src/cr/__tests__/lanes/ui-review-dispatch.test.ts src/cr/__tests__/lanes/ui-review.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 2: The render-compare exporter reads its answer file

**Files:**
- Modify: `src/cr/lanes/render-export-dispatch.ts`
- Modify: `src/cr/lanes/render-compare.ts`
- Test: `src/cr/__tests__/lanes/render-compare.test.ts`

- [x] **Step 1: Make the lane test's exporter write a bare report.** In `src/cr/__tests__/lanes/render-compare.test.ts`, replace

```ts
const report = (payload: unknown): string =>
  `prose\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
```

with

```ts
/** What the exporter writes to its answer file: the report and nothing else. */
const report = (payload: unknown): string => JSON.stringify(payload);
```

and add this test directly after `'an unparseable exporter report is export-failed — no trustworthy page enumeration'`:

```ts
  it('reads an exporter report that arrives inside one whole-file fence', async () => {
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      for (const r of input.requests) writeFileSync(r.outPath, DESIGN_PNG);
      return `\`\`\`json\n${report({ surfaces: input.requests.map((r) => ({ surface: r.surface, candidates: ['default'] })) })}\n\`\`\``;
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    expect(String(sink(cwd).notes)).not.toContain('no trustworthy FINAL: page enumeration');
  });
```

- [x] **Step 2: Run the tests to verify they fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare.test.ts
```

Expected: FAIL. The old reader wants prose followed by a fenced block, so every report now comes back unparseable and lands on `export-failed`.

- [x] **Step 3: Move the dispatch module onto the answer seam.** In `src/cr/lanes/render-export-dispatch.ts`:

(a) Replace the three imports `parseFencedJson`, `createDispatcherSeam` and `fencedJsonInstruction` with:

```ts
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
```

(b) In `buildRenderExportPrompt`, replace the closing lines

```ts
Report one entry per surface — the candidates are the report; there is no verdict field:

${fencedJsonInstruction(
  `{"surfaces": [{"surface": "dashboard", "candidates": ["overview"]}, {"surface": "settings", "candidates": ["default", "expanded"]}]}`,
)}`;
```

with

```ts
Report one entry per surface — the candidates are the report; there is no verdict field.`;
```

(c) Replace the `parseRenderExportReport` doc comment and export with:

```ts
/** The example the answer instruction shows the exporter — valid JSON, so an echo still parses. */
export const RENDER_EXPORT_SHAPE =
  '{"surfaces": [{"surface": "dashboard", "candidates": ["overview"]}, {"surface": "settings", "candidates": ["default", "expanded"]}]}';

/**
 * The repair round's prompt: restate the exporter's page enumeration as a valid report. It
 * opens no design, exports nothing and moves no file.
 */
export function buildRenderExportRepairPrompt(ctx: RepairContext): string {
  return `A previous design exporter finished its exports, but its report was rejected: ${ctx.error}. Your ONLY job is to restate the per-surface page enumeration that exporter reported — do not open the design, do not export anything, do not move any file.

Its rejected report:
${ctx.rejected ?? '(it wrote no answer file)'}

Its output:
${ctx.stdout.trim() === '' ? '(none captured)' : ctx.stdout}

Transcription rules:
1. One entry per surface the exporter reported, carrying the \`FINAL:<surface>:\` page names it found, verbatim.
2. Invent no surface and no page name the output does not state.
3. If nothing above states the enumeration, write no answer at all.`;
}

/** What the exporter child hands back, and how the seam reads it. */
export const RENDER_EXPORT_ANSWER: LaneAnswerContract<RenderExportReport> = {
  lane: 'render-compare',
  shape: RENDER_EXPORT_SHAPE,
  schema: renderExportReportSchema,
  repairPrompt: buildRenderExportRepairPrompt,
};
```

(d) Replace the `const seam = createDispatcherSeam<RenderExportInput>(buildRenderExportPrompt, { … });` statement with:

```ts
const seam = createAnswerSeam<RenderExportInput, RenderExportReport>(buildRenderExportPrompt, {
  role: 'render-compare',
  site: 'cr.render-export-dispatch',
  contract: RENDER_EXPORT_ANSWER,
  onFailure: (f) => {
    throw new RenderExportError(
      f.reason,
      f.timedOut
        ? 'render-compare export dispatch timed out'
        : `render-compare export dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
    );
  },
});
```

- [x] **Step 4: Move the lane onto the answer.** In `src/cr/lanes/render-compare.ts`:

(a) In the import from `./render-export-dispatch.js`, replace `parseRenderExportReport,` with `type RenderExportReport,`, and add below that import:

```ts
import type { LaneAnswer } from '../lane-answer.js';
```

(b) Replace

```ts
      let raw: string | null = null;
      let exportFailure: string | null = null;
      try {
        raw = await dispatchRenderExport({
          penPath: scratchPen,
          requests,
          ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
        });
      } catch (err) {
```

with

```ts
      let answer: LaneAnswer<RenderExportReport> | null = null;
      let exportFailure: string | null = null;
      try {
        answer = await dispatchRenderExport(
          {
            penPath: scratchPen,
            requests,
            ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
          },
          { repoRoot: input.repoRoot, slug: input.slug, kind: input.kind },
        );
      } catch (err) {
```

(c) Replace

```ts
      const report = exportFailure === null ? parseRenderExportReport(raw ?? '') : null;
```

with

```ts
      const report = exportFailure === null && answer?.ok === true ? answer.answer : null;
```

- [x] **Step 5: Run the tests to verify they pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare.test.ts && pnpm typecheck
```

Expected: PASS. Every render-compare test is green, and the unparseable-report test still lands on `export-failed` with `no trustworthy FINAL: page enumeration`. `tsc` prints nothing.

- [x] **Step 6: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
fix(cr): read the render-compare exporter's report from its answer file

The design exporter now answers through createAnswerSeam, like the verifier and the ui-reviewer: its page enumeration arrives in a per-dispatch answer file and gets one transcription repair round before the lane records export-failed.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/lanes/render-export-dispatch.ts src/cr/lanes/render-compare.ts src/cr/__tests__/lanes/render-compare.test.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```

---

## Task 3: Delete the fenced-JSON reader and the old seam

**Files:**
- Modify: `src/cr/extract-json.ts`
- Modify: `src/cr/lanes/prompt-parts.ts`
- Modify: `src/cr/lane-spawn.ts`

- [ ] **Step 1: Confirm nothing still calls them.**

```bash
rg -n "parseLastJsonFence|parseFencedJson|fencedJsonInstruction|createDispatcherSeam|spawnLanePrompt|LaneSpawnResult" src
```

Expected: only the definitions themselves, in `src/cr/extract-json.ts`, `src/cr/lanes/prompt-parts.ts` and `src/cr/lane-spawn.ts`. No `src/cr/lanes/*-dispatch.ts` file and no test file appears. If one does, move it onto `createAnswerSeam` first, following Part 2 Task 1.

- [ ] **Step 2: Trim `src/cr/extract-json.ts`.** Delete `parseLastJsonFence`, `parseFencedJson` and their doc comments. Then replace the last paragraph of `extractJsonObject`'s doc comment (the one beginning `Shared by the orchestrate codex lane`) with:

```ts
 * Used by `run-codex.ts`, which reads codex's own `CrRecord` from stdout. CR lanes that
 * return a structured verdict read an answer file instead (`src/cr/lane-answer.ts`), so
 * nothing here is shared with them any more.
```

- [ ] **Step 3: Trim `src/cr/lanes/prompt-parts.ts`.** Delete `fencedJsonInstruction` and its doc comment. Replace the header comment block (the lines before the import) with:

```ts
// @tests: ui-design-review-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
// Prompt fragments shared by the lanes whose child returns a structured verdict.
// `answerInstruction` is the counterpart of `readLaneAnswer` (src/cr/lane-answer.ts):
// the text telling the child where its answer goes and the reader of that file must
// agree, so they are worth keeping within one edit of each other.
```

- [ ] **Step 4: Trim `src/cr/lane-spawn.ts`.** Delete the `LaneSpawnResult` type, the `LaneSpawnOpts` interface, `spawnLanePrompt`, and `createDispatcherSeam`, each with its doc comment. Keep `LaneSpawnFailure`, which `LaneDispatchFailure` uses. Replace the header comment block with:

```ts
// @tests: ui-design-review-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
// The one "dispatch a lane's child and read its answer" seam. Every structured lane
// (verifier, ui-reviewer, render-export, and in Part 3 the reviewer) resolves its runner,
// names a per-dispatch answer file, and reads only that file — never the child's
// printed output (Q-0250).
```

- [ ] **Step 5: Run the whole CR suite and the type check.**

```bash
pnpm typecheck && pnpm vitest run src/cr src/core/agent-runner
```

Expected: PASS. `tsc` prints nothing, and every test under `src/cr` and `src/core/agent-runner` is green.

- [ ] **Step 6: Commit.** Write `$(git rev-parse --git-dir)/PLAN_MSG` with:

```text
refactor(cr): delete the fenced-JSON lane reader and the old dispatcher seam

With the verifier, ui-reviewer and render-export lanes reading answer files, parseLastJsonFence, parseFencedJson, fencedJsonInstruction, createDispatcherSeam and spawnLanePrompt have no callers left. extractJsonObject stays for the codex lane's CrRecord.

Noldor-FD: cr-lane-verdicts-blocked-by-serialization-not-substance
```

```bash
git add src/cr/extract-json.ts src/cr/lanes/prompt-parts.ts src/cr/lane-spawn.ts
git commit -F "$(git rev-parse --git-dir)/PLAN_MSG"
```
