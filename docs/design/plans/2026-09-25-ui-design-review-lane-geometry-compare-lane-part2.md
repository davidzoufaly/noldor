# Geometry Compare Lane — Part 2: Design-Side Extraction Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Read resolved geometry out of a `.pen` design and write it as a conformant document: `pnpm noldor design geometry-export --pen <file> --surface <name> --out <doc.json>`. With part 1's capture script and the shipped `design geometry-diff`, an operator can then run the whole workflow by hand (export the design, capture the implementation, compare) before any lane exists.
**Architecture:** One dispatched pencil-MCP role, `geometry-extract`, built on `createAnswerSeam` (`src/cr/lane-spawn.ts`) with a `LaneAnswerContract`, modelled on `src/cr/lanes/render-export-dispatch.ts`. The child lists the page candidates and Node picks the page. The child writes one document per surface to a path the caller names; that file, parsed by `parseGeometryDoc`, is the evidence. The child's answer file carries only the page enumeration and the clipped-node exclusions. A CLI drives one surface. It runs outside a CR round, so it takes an optional `--slug` that defaults to `GEOMETRY_ADHOC_SLUG`.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** nothing beyond current `main`. It uses the shipped `parseGeometryDoc` (`src/cr/geometry/geometry-doc.ts`), `selectFinalPage` (`src/cr/lanes/render-compare-core.ts`), `createAnswerSeam` and `readValueFlags`. Part 1 is independent. Part 4 consumes `dispatchGeometryExtract`, `setGeometryExtractDispatcher`, `GeometryExtractError` and `GEOMETRY_ADHOC_SLUG`.

---

## File Structure

- `src/core/agent-runner/types.ts` — add the `geometry-extract` role to `AGENT_ROLES`, so a consumer can pin it to a pencil-capable runner (Modify).
- `src/cr/lanes/geometry-extract-dispatch.ts` — the child's prompt, report schema, answer contract, repair prompt, error class and answer seam (Create).
- `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts` — prompt content, the answer contract, the repair round, and the real-spawn path (Create).
- `src/cr/geometry/geometry-cli-emit.ts` — add `GEOMETRY_ADHOC_SLUG`, the slug every `design geometry-*` dispatch files its answers under outside a round (Modify).
- `src/cr/geometry/geometry-export-cli.ts` — `noldor design geometry-export`: dispatch for one surface, re-select the page, validate the written document (Create).
- `src/cr/__tests__/geometry/geometry-export-cli.test.ts` — CLI paths with the dispatcher stubbed, plus the slug reaching the answer path (Create).
- `src/cli/manifest.ts` — one `design.subs['geometry-export']` row (Modify).
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — the catalog entry, twinned (Modify).
- `AGENTS.md` + `templates/AGENTS.md` — the generated capability index picks up the new subcommand (Modify, via `docs capability-index --write`).

---

## Task 1: The extraction role and its answer contract

**Files:**
- Create: `src/cr/lanes/geometry-extract-dispatch.ts`
- Modify: `src/core/agent-runner/types.ts`
- Test: `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import type { Slug } from '../../../core/slug.js';
import type { AnswerLocation, RepairContext } from '../../lane-answer.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import {
  buildGeometryExtractPrompt,
  buildGeometryExtractRepairPrompt,
  dispatchGeometryExtract,
  GEOMETRY_EXTRACT_ANSWER,
  GEOMETRY_EXTRACT_SHAPE,
  geometryExtractReportSchema,
  setGeometryExtractDispatcher,
} from '../../lanes/geometry-extract-dispatch.js';
import type { GeometryExtractInput } from '../../lanes/geometry-extract-dispatch.js';

const input: GeometryExtractInput = {
  penPath: '/tmp/scratch/slug.pen',
  requests: [
    { surface: 'dashboard', pageSelector: 'overview', outPath: '/tmp/out/dashboard.json' },
    { surface: 'settings', outPath: '/tmp/out/settings.json' },
  ],
};

/** A repo root with an empty config, so runner resolution falls back to the default. */
const at = (): AnswerLocation => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-geo-extract-'));
  mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
  writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
  return { repoRoot, slug: 'geometry-adhoc' as Slug, kind: 'code' };
};

const VALID = '{"surfaces":[{"surface":"dashboard","candidates":["overview"]}]}';

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setLaneSpawn(undefined);
});

describe('buildGeometryExtractPrompt', () => {
  it('names the scratch pen, every surface, and its output path', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('/tmp/scratch/slug.pen');
    expect(p).toContain('`dashboard`');
    expect(p).toContain('page selector: `overview`');
    expect(p).toContain('/tmp/out/settings.json');
  });

  it('carries the bridge-wake recipe and forbids touching repo designs', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('design pen-bridge');
    expect(p).toContain('never touch any design file under the repository');
  });

  it('absolutizes inside the visitor, resolves variables, and makes boxes page-relative', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('k = k.parentCtx');
    expect(p).toContain('{ resolveVariables: true }');
    expect(p).toContain('content: n.content');
    expect(p).toContain("subtract the page node's own accumulated origin");
  });

  it('states the document rules the parent validates', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain("`viewport` is the selected page node's own resolved size");
    expect(p).toContain('empty or whitespace-only `content` → `"shape"`');
    expect(p).toContain('Every `"text"` node carries `text`');
    expect(p).toContain('NEVER emit `margin`');
    expect(p).toContain("list its name in that surface's `excluded` report entry");
  });
});

describe('the answer contract', () => {
  it('runs as the geometry-extract role', () => {
    expect(GEOMETRY_EXTRACT_ANSWER.lane).toBe('geometry-extract');
  });

  it('shows the child an example that is itself a valid report', () => {
    expect(geometryExtractReportSchema.safeParse(JSON.parse(GEOMETRY_EXTRACT_SHAPE)).success).toBe(
      true,
    );
  });

  it('rejects a verdict field — the child has nothing to judge', () => {
    const r = geometryExtractReportSchema.safeParse({
      surfaces: [{ surface: 'a', candidates: [], verdict: 'pass' }],
    });
    expect(r.success).toBe(false);
  });

  it('builds a repair prompt that transcribes and never re-reads the design', () => {
    const ctx: RepairContext = { stdout: 'found overview', rejected: 'nope', error: 'bad JSON' };
    const p = buildGeometryExtractRepairPrompt(ctx);
    expect(p).toContain('bad JSON');
    expect(p).toContain('found overview');
    expect(p).toContain('do not open the design');
  });
});

describe('dispatchGeometryExtract (injected child)', () => {
  it('returns the validated report, defaulting excluded to []', async () => {
    setGeometryExtractDispatcher(async () => VALID);
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.answer.surfaces[0]).toEqual({
        surface: 'dashboard',
        candidates: ['overview'],
        excluded: [],
      });
    }
  });

  it('recovers a rejected first answer through one repair round', async () => {
    const repairs: Array<RepairContext | undefined> = [];
    setGeometryExtractDispatcher(async (_in, repair) => {
      repairs.push(repair);
      return repair === undefined ? 'not json' : VALID;
    });
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    expect(answer.notes[0]).toContain('repair round');
    expect(repairs[1]).toMatchObject({ stdout: '', rejected: 'not json' });
    expect(repairs[1]?.error).toContain('not valid JSON');
  });

  it('fails with the schema error when the repair writes nothing', async () => {
    setGeometryExtractDispatcher(async (_in, repair) =>
      repair === undefined ? '{"surfaces":[{"nope":1}]}' : null,
    );
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.detail).toContain('geometry-extract schema');
  });
});

describe('dispatchGeometryExtract (real spawn path)', () => {
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  const spawnWriting = (text: string, result: Partial<AgentResult> = {}): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push({ prompt, opts });
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path !== undefined && result.timedOut !== true) writeFileSync(path, text);
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false, ...result };
    });
  afterEach(() => {
    calls.length = 0;
  });

  it('spawns the geometry-extract role with the default timeout and a slugged answer file', async () => {
    spawnWriting(VALID);
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    expect(calls[0]?.opts.role).toBe('geometry-extract');
    expect(calls[0]?.opts.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
    expect(calls[0]?.prompt).toContain('geometry-adhoc-code-geometry-extract-');
  });

  it('throws GeometryExtractError with reason timeout on a timed-out child', async () => {
    spawnWriting(VALID, { exitCode: 124, timedOut: true });
    await expect(dispatchGeometryExtract(input, at())).rejects.toMatchObject({
      name: 'GeometryExtractError',
      reason: 'timeout',
    });
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts
```

Expected output: the file fails to collect with `Failed to resolve import "../../lanes/geometry-extract-dispatch.js"`.

- [ ] **Step 3: Add the role.** In `src/core/agent-runner/types.ts`, inside `AGENT_ROLES`, insert directly after the `'render-compare',` line:

```ts
  // The geometry-compare lane's design reader — opens the scratch `.pen`
  // through pencil MCP and writes a normalized geometry document per surface.
  // No judgment, no findings; separate from `render-compare` so a consumer can
  // pin the two pencil roles independently.
  'geometry-extract',
```

- [ ] **Step 4: Implement the dispatch module.** Create `src/cr/lanes/geometry-extract-dispatch.ts`:

````ts
// @tests: ui-design-review-lane
// Prompt + child contract for the `geometry-compare` lane's DESIGN READER (spec
// D3). The child opens the scratch `.pen` through pencil MCP, resolves each
// surface's `FINAL:` page, walks it with a `Get` visitor, and writes one
// normalized geometry document per surface. Its answer carries the page
// ENUMERATION and the clipped-node exclusions only — the caller re-derives the
// selection with `selectFinalPage` and trusts the written file, parsed by
// `parseGeometryDoc`, as the evidence.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { repairEvidence } from './prompt-parts.js';

/** One surface's extraction instruction. */
export interface ExtractRequest {
  surface: string;
  /** The recipe's `page` selector, when declared. */
  pageSelector?: string;
  /** Absolute path the surface's geometry document must land at. */
  outPath: string;
}

export interface GeometryExtractInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  requests: ExtractRequest[];
  /** Wall-clock cap; DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits it. */
  timeoutMs?: number;
}

/**
 * Per-surface answer row: the page enumeration, plus the nodes the child
 * dropped because pen reported problems on them. No outcome field — the
 * document on disk is what gets validated, so the child has nothing to be
 * wrong about in its answer.
 */
export const extractOutcomeSchema = z
  .object({
    surface: z.string().min(1),
    /** `FINAL:<surface>:` page names found, `<name>` segment only. */
    candidates: z.array(z.string()).default([]),
    /** Nodes excluded because pen reported them clipped (spec D3). */
    excluded: z.array(z.string()).default([]),
  })
  .strict();
export type ExtractOutcome = z.infer<typeof extractOutcomeSchema>;

export const geometryExtractReportSchema = z
  .object({ surfaces: z.array(extractOutcomeSchema) })
  .strict();
export type GeometryExtractReport = z.infer<typeof geometryExtractReportSchema>;

export function buildGeometryExtractPrompt(input: GeometryExtractInput): string {
  const jobs = input.requests
    .map(
      (r) =>
        `- surface \`${r.surface}\`${r.pageSelector !== undefined ? ` (page selector: \`${r.pageSelector}\`)` : ' (no page selector)'} → \`${r.outPath}\``,
    )
    .join('\n');
  return `You are a design GEOMETRY READER for a mechanical layout-diff pipeline. You read resolved geometry out of a Pencil \`.pen\` design and write it as JSON documents. You make no judgments and report no findings.

The design is a scratch COPY at \`${input.penPath}\`. Read it through pencil MCP only: call \`get_app_state\` (with \`include_schema\`) once for the SCHEMA AND API DOCS ONLY, then do ALL reading via \`execute({ filePath: "${input.penPath}", input: ... })\`. get_app_state describes whatever file the editor has active — which may be a DIFFERENT design — so page names and node ids taken from it are invalid: enumerate pages exclusively through \`execute\` against the filePath above. Do not read a \`.pen\` with a file-reading tool (its raw JSON holds declared values, not resolved geometry), and never touch any design file under the repository.

${penBridgeRecipe(input.penPath)}

Extraction jobs (one selected page per surface):
${jobs}

For each surface:
1. Enumerate the design's top-level pages named \`FINAL:<surface>: <name>\` for that surface (exact surface segment). Collect the trimmed \`<name>\` segments as the candidates — report them ALL, verbatim, even when zero or ambiguous.
2. Select the page: with a page selector, the candidate exactly equal to it (trimmed, case-sensitive); without one, the single candidate if there is exactly one. Zero candidates, several candidates without a selector, a selector matching none, or two candidates with identical names — do NOT write that surface's file (the parent recomputes the same rule from your candidates and classifies it).
3. Read the selected page with ONE visitor pass, resolving variables:

\`\`\`js
const abs = (c) => { let x = 0, y = 0; for (let k = c; k; k = k.parentCtx) { x += k.bounds.x; y += k.bounds.y; } return { x, y }; };
Get(pageId, (n, c) => { const o = abs(c); return { id: n.id, name: n.name, type: n.type, problems: c.problems,
  x: o.x, y: o.y, w: c.bounds.width, h: c.bounds.height,
  content: n.content, fontSize: n.fontSize, layout: n.layout, gap: n.gap, padding: n.padding }; }, { resolveVariables: true })
\`\`\`

\`ctx.bounds\` is resolved in the PARENT's coordinate space, so the accumulation up \`parentCtx\` is required, and it must happen inside the callback, where the ancestor chain is still reachable. Never read a node's own \`x\`/\`y\`/\`width\`/\`height\`: \`x\`/\`y\` are ignored under a flex layout, and \`width\`/\`height\` may be \`fit_content\`, \`fill_container\`, or a variable. Then subtract the page node's own accumulated origin from every node's \`x\`/\`y\`, so the page's top-left is \`{0,0}\` and every box is page-relative.
4. Write the surface's output path as ONE JSON object in exactly this shape:

\`\`\`json
{"surface":"dashboard","viewport":{"width":1440,"height":900},
 "nodes":[{"name":"Card","kind":"container","box":{"x":24,"y":16,"w":320,"h":180},"spacing":{"rowGap":16,"padding":[24,24,24,24]}},
          {"name":"Title","kind":"text","box":{"x":48,"y":40,"w":200,"h":24},"fontSize":20,"text":"Revenue"},
          {"name":"Divider","kind":"shape","box":{"x":24,"y":200,"w":320,"h":1}}]}
\`\`\`

Rules for that file, all mandatory — the parent validates it and refuses the whole document on any violation:
- \`surface\` is the surface name exactly as listed in the jobs above.
- \`viewport\` is the selected page node's own resolved size (its \`ctx.bounds.width\` and \`ctx.bounds.height\`), both positive. The page node is the viewport, not an entry in \`nodes\`.
- \`nodes\` is a FLAT list of every node under the page, at any depth, in visit order.
- \`box\` is the page-relative \`{"x","y","w","h"}\` from step 3, in CSS pixels: every value a finite number, \`w\` and \`h\` at least 0.
- \`name\` is the pen node's name; omit the key when the node has none.
- \`kind\`: a pen \`text\` node whose \`content\` is non-empty after trimming → \`"text"\`; a pen \`text\` node with empty or whitespace-only \`content\` → \`"shape"\`; a pen \`frame\` → \`"container"\`; every other pen type → \`"shape"\`.
- Every \`"text"\` node carries \`text\` (its \`content\` as a plain, non-empty string; if \`content\` is not a plain string, join its runs' text) and \`fontSize\` (the resolved font size, a positive number). A text node whose font size does not resolve to a positive number is emitted as \`"shape"\`.
- \`text\` and \`fontSize\` appear on \`"text"\` nodes and NOWHERE else.
- \`spacing\`: pen \`gap\` becomes \`rowGap\` under \`layout: "vertical"\` and \`columnGap\` under \`layout: "horizontal"\` (drop it under any other layout); pen \`padding\` becomes the four-tuple \`[top, right, bottom, left]\` (a number becomes all four, \`[v, h]\` becomes \`[v, h, v, h]\`). Every spacing value is at least 0. Omit \`spacing\` entirely when the node declares neither. NEVER emit \`margin\` — pen has no margin property, and the parent rejects a design document that carries one.
- Exclude any node whose \`problems\` is set (pen reported it clipped): leave it out of \`nodes\` and list its name in that surface's \`excluded\` report entry (its id when it has no name).
- No other keys, at any level.

Do not create, modify, or save anything in the design; write no file except the listed output paths.

Report one entry per surface — its candidates and its excluded nodes are the report; there is no verdict field.`;
}

/** The example the answer instruction shows the reader — valid JSON, so an echo still parses. */
export const GEOMETRY_EXTRACT_SHAPE =
  '{"surfaces": [{"surface": "dashboard", "candidates": ["overview"], "excluded": []}, {"surface": "settings", "candidates": ["default", "expanded"], "excluded": ["Badge"]}]}';

/**
 * The repair round's prompt: restate the reader's page enumeration and exclusions as a
 * valid report. It opens no design and reads or writes no geometry document.
 */
export function buildGeometryExtractRepairPrompt(ctx: RepairContext): string {
  return `A previous design geometry reader finished its work, but its report was rejected: ${ctx.error}. Your ONLY job is to restate the per-surface report that reader gave — do not open the design, do not read or write any geometry document.

${repairEvidence(ctx)}

Transcription rules:
1. One entry per surface the reader reported, carrying the \`FINAL:<surface>:\` page names it found and the node names it excluded, verbatim.
2. Invent no surface, page name, or node name the output does not state; an entry whose exclusions are not stated gets \`"excluded": []\`.
3. If nothing above states the enumeration, write no answer at all.`;
}

/** What the reader child hands back, and how the seam reads it. */
export const GEOMETRY_EXTRACT_ANSWER: LaneAnswerContract<GeometryExtractReport> = {
  lane: 'geometry-extract',
  shape: GEOMETRY_EXTRACT_SHAPE,
  schema: geometryExtractReportSchema,
  repairPrompt: buildGeometryExtractRepairPrompt,
};

/** Carries which reason detail the caller should record, so the sink stays specific. */
export class GeometryExtractError extends Error {
  readonly reason: 'timeout' | 'dispatch-failed';

  constructor(reason: 'timeout' | 'dispatch-failed', message: string) {
    super(message);
    this.name = 'GeometryExtractError';
    this.reason = reason;
  }
}

const seam = createAnswerSeam<GeometryExtractInput, GeometryExtractReport>(
  buildGeometryExtractPrompt,
  {
    site: 'cr.geometry-extract-dispatch',
    contract: GEOMETRY_EXTRACT_ANSWER,
    onFailure: (f) => {
      throw new GeometryExtractError(
        f.reason,
        f.timedOut
          ? 'geometry-extract dispatch timed out'
          : `geometry-extract dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}`,
      );
    },
  },
);

/** Test seam — production code never calls this. */
export const setGeometryExtractDispatcher = seam.setDispatcher;
export const dispatchGeometryExtract = seam.dispatch;
````

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts && pnpm typecheck
```

Expected output: `Test Files  1 passed (1)`, `Tests  13 passed (13)`, then `tsc` exits 0 with no output.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/geo-p2t1.msg <<'MSG'
feat(cr): add the design-side geometry extraction contract

A .pen file is encrypted and pencil MCP is its only reader, so the design half
of a geometry comparison has to be a dispatched child. The declared schema is
not what it should read: under a flex layout a node's own x and y are ignored,
and its width and height may be fit_content, fill_container or a variable.
Only the Get visitor's ctx.bounds is resolved, and it is parent-relative, so
the prompt absolutizes inside the callback, where parentCtx is still reachable,
and then subtracts the page origin.

The child goes through createAnswerSeam like the render exporter. Its answer
file carries only the FINAL page candidates and the clipped nodes it dropped;
page selection and document validation stay Node-side. The prompt states the
geometryDocSchema rules: the kind mapping (an empty-content text node is a
shape), non-empty text on every text node, gap and padding normalization, no
margin, and the page node's size as the viewport.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/geometry-extract-dispatch.ts src/core/agent-runner/types.ts src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts
git commit -F /tmp/geo-p2t1.msg
```

---

## Task 2: `noldor design geometry-export`

**Files:**
- Create: `src/cr/geometry/geometry-export-cli.ts`
- Modify: `src/cr/geometry/geometry-cli-emit.ts`
- Test: `src/cr/__tests__/geometry/geometry-export-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-export-cli.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { GEOMETRY_ADHOC_SLUG } from '../../geometry/geometry-cli-emit.js';
import { runGeometryExport } from '../../geometry/geometry-export-cli.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const doc = (surface: string, nodes: unknown[] = []): string =>
  JSON.stringify({
    surface,
    viewport: { width: 1440, height: 900 },
    nodes: [{ kind: 'shape', box: { x: 24, y: 0, w: 100, h: 40 } }, ...nodes],
  });

const report = (candidates: string[], excluded: string[] = []): string =>
  JSON.stringify({ surfaces: [{ surface: 'dashboard', candidates, excluded }] });

const dir = mkdtempSync(join(tmpdir(), 'geo-export-'));
const pen = join(dir, 'design.pen');
writeFileSync(pen, 'encrypted-bytes', 'utf8');

/** Run the CLI for surface `dashboard`, collecting its lines. */
async function run(out: string, extra: string[] = []): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const code = await runGeometryExport(
    ['--pen', pen, '--surface', 'dashboard', '--out', out, ...extra],
    (s) => lines.push(s),
  );
  return { code, text: lines.join('\n') };
}

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setLaneSpawn(undefined);
  vi.restoreAllMocks();
});

describe('runGeometryExport', () => {
  it('exits 0 on a conformant document, naming the page and the exclusions', async () => {
    const out = join(dir, 'ok.json');
    setGeometryExtractDispatcher(async (input) => {
      writeFileSync(input.requests[0].outPath, doc('dashboard'), 'utf8');
      return report(['overview'], ['Badge']);
    });
    const { code, text } = await run(out);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8')).surface).toBe('dashboard');
    expect(text).toContain("from page 'overview'");
    expect(text).toContain('excluded 1 clipped node(s): Badge');
  });

  it('exits 1 when the page selection is ambiguous', async () => {
    setGeometryExtractDispatcher(async () => report(['a', 'b']));
    const { code, text } = await run(join(dir, 'amb.json'));
    expect(code).toBe(1);
    expect(text).toContain('page selector');
  });

  it('exits 1 when the document reports another surface', async () => {
    setGeometryExtractDispatcher(async (input) => {
      writeFileSync(input.requests[0].outPath, doc('settings'), 'utf8');
      return report(['overview']);
    });
    const { code, text } = await run(join(dir, 'bad-surface.json'));
    expect(code).toBe(1);
    expect(text).toContain("reports surface 'settings'");
  });

  it('exits 1 when a text node carries no text', async () => {
    setGeometryExtractDispatcher(async (input) => {
      const textless = { kind: 'text', box: { x: 0, y: 0, w: 10, h: 10 }, fontSize: 14 };
      writeFileSync(input.requests[0].outPath, doc('dashboard', [textless]), 'utf8');
      return report(['overview']);
    });
    const { code, text } = await run(join(dir, 'textless.json'));
    expect(code).toBe(1);
    expect(text).toContain('nodes.1.text');
  });

  it('exits 1 when the reader gives no usable answer, even with a file on disk', async () => {
    setGeometryExtractDispatcher(async (input, repair) => {
      writeFileSync(input.requests[0].outPath, doc('dashboard'), 'utf8');
      return repair === undefined ? 'not json' : null;
    });
    const { code, text } = await run(join(dir, 'unverified.json'));
    expect(code).toBe(1);
    expect(text).toContain('page selection is unverified');
  });

  it('never reports a stale --out file as fresh when the child writes nothing', async () => {
    const out = join(dir, 'stale.json');
    writeFileSync(out, doc('dashboard'), 'utf8');
    setGeometryExtractDispatcher(async () => report(['overview']));
    const { code, text } = await run(out);
    expect(code).toBe(1);
    expect(text).toContain('the reader wrote no readable document');
    expect(text).not.toContain(`wrote ${out}`);
  });

  it('exits 2 when the dispatch itself fails', async () => {
    setGeometryExtractDispatcher(async () => {
      throw new Error('pencil bridge down');
    });
    const { code, text } = await run(join(dir, 'down.json'));
    expect(code).toBe(2);
    expect(text).toContain('pencil bridge down');
  });

  it('exits 2 on a missing flag, an unknown flag, a bad slug, and an absent pen file', async () => {
    const lines: string[] = [];
    const emit = (s: string): void => {
      lines.push(s);
    };
    expect(await runGeometryExport(['--pen', pen], emit)).toBe(2);
    expect((await run(join(dir, 'x.json'), ['--bogus', 'v'])).code).toBe(2);
    expect((await run(join(dir, 'x.json'), ['--slug', 'Not_A_Slug'])).code).toBe(2);
    expect(
      await runGeometryExport(
        ['--pen', join(dir, 'nope.pen'), '--surface', 'x', '--out', join(dir, 'o.json')],
        emit,
      ),
    ).toBe(2);
  });
});

describe('the answer slug', () => {
  it('is geometry-adhoc by default', () => {
    expect(GEOMETRY_ADHOC_SLUG).toBe('geometry-adhoc');
  });

  it('files the answer under the default slug, or under --slug when given', async () => {
    const root = mkdtempSync(join(tmpdir(), 'geo-export-root-'));
    mkdirSync(join(root, '.noldor'), { recursive: true });
    writeFileSync(join(root, '.noldor', 'config.json'), '{}');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const out = join(dir, 'slugged.json');
    const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push({ prompt, opts });
      writeFileSync(out, doc('dashboard'), 'utf8');
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path !== undefined) writeFileSync(path, report(['overview']));
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false };
    });
    expect((await run(out)).code).toBe(0);
    expect((await run(out, ['--slug', 'feat-ui'])).code).toBe(0);
    expect(calls[0]?.opts.role).toBe('geometry-extract');
    expect(calls[0]?.prompt).toContain(
      join(root, '.noldor', 'cr', 'answers', 'geometry-adhoc-code-geometry-extract-'),
    );
    expect(calls[1]?.prompt).toContain('feat-ui-code-geometry-extract-');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-export-cli.test.ts
```

Expected output: the file fails to collect with `Failed to resolve import "../../geometry/geometry-export-cli.js"`.

- [ ] **Step 3: Add the ad-hoc slug.** Replace the whole of `src/cr/geometry/geometry-cli-emit.ts` with:

```ts
// @tests: ui-design-review-lane
// What every `design geometry-*` entrypoint shares: where its lines go, and
// which slug its dispatches file their answers under outside a CR round. Each
// command takes an `emit` so tests read output as strings instead of capturing
// a stream, and each defaults it to stdout — declared once here so the default
// cannot drift per command (and so the repeated signature stops reading as a
// duplicated block to the clone detector).

import { parseSlug, type Slug } from '../../core/slug.js';

/** Sink for one output line. */
export type Emit = (line: string) => void;

/** The production default: one line to stdout. */
export const stdoutEmit: Emit = (line) => process.stdout.write(`${line}\n`);

const adhoc = parseSlug('geometry-adhoc');
if (!adhoc.ok) throw new Error(adhoc.error.message);

/**
 * The slug a hand-run `design geometry-*` command files its pencil child's
 * answer under (`.noldor/cr/answers/geometry-adhoc-code-geometry-extract-*.json`)
 * when no `--slug` is given. Minted through `parseSlug` rather than cast, so the
 * brand is earned the same way a CR round's slug is.
 */
export const GEOMETRY_ADHOC_SLUG: Slug = adhoc.slug;
```

- [ ] **Step 4: Implement the CLI.** Create `src/cr/geometry/geometry-export-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-export — read one surface's resolved geometry out of a
// `.pen` and write it as a normalized document. The `geometry-compare` lane does
// this for every affected surface inside a round; this entrypoint lets an
// operator produce the design half by hand and diff it against a captured
// implementation document without booting anything.

import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readValueFlags, runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import { parseSlug } from '../../core/slug.js';
import type { LaneAnswer } from '../lane-answer.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  type GeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { selectFinalPage } from '../lanes/render-compare-core.js';
import { GEOMETRY_ADHOC_SLUG, stdoutEmit, type Emit } from './geometry-cli-emit.js';
import { parseGeometryDoc } from './geometry-doc.js';

const LABEL = 'geometry-export';
const USAGE = `usage: noldor design ${LABEL} --pen <file.pen> --surface <name> --out <doc.json> [--page <name>] [--slug <slug>]`;
/** Every flag this command takes a value for — an unknown flag is user error. */
const VALUE_FLAGS = ['--pen', '--surface', '--out', '--page', '--slug'] as const;

/**
 * Exit 0 = a conformant document was written, 1 = the design could not be read
 * for this surface (no usable answer, ambiguous page, missing or non-conformant
 * document), 2 = usage error or the dispatch itself failed. The 1-vs-2 split
 * mirrors the lane's own distinction between "cannot review this surface" and
 * "the round broke".
 */
export async function runGeometryExport(
  argv: readonly string[],
  emit: Emit = stdoutEmit,
): Promise<number> {
  const read = readValueFlags(argv, VALUE_FLAGS, LABEL);
  if (!read.ok) {
    emit(`${read.error}\n${USAGE}`);
    return 2;
  }
  const { values, positional } = read;
  const pen = values.get('--pen');
  const surface = values.get('--surface');
  const out = values.get('--out');
  const pageSelector = values.get('--page');
  if (positional.length !== 0 || pen === undefined || surface === undefined || out === undefined) {
    emit(USAGE);
    return 2;
  }
  // No CR round owns a hand run, so the answer file needs a slug of its own;
  // `--slug` lets an operator file it beside a round they are debugging.
  let slug = GEOMETRY_ADHOC_SLUG;
  const slugFlag = values.get('--slug');
  if (slugFlag !== undefined) {
    const parsed = parseSlug(slugFlag);
    if (!parsed.ok) {
      emit(`${LABEL}: ${parsed.error.message}\n${USAGE}`);
      return 2;
    }
    slug = parsed.slug;
  }
  // Absolute paths: the child runs in its own process and is told to write
  // exactly where the prompt says.
  const penPath = resolve(pen);
  const outPath = resolve(out);
  if (!existsSync(penPath)) {
    emit(`${LABEL}: no such design file: ${penPath}`);
    return 2;
  }
  // A document left from an earlier run (possibly another page) must never pass
  // as this dispatch's output: a child that answers but writes nothing fails.
  await rm(outPath, { force: true });
  let answer: LaneAnswer<GeometryExtractReport>;
  try {
    answer = await dispatchGeometryExtract(
      {
        penPath,
        requests: [{ surface, ...(pageSelector !== undefined ? { pageSelector } : {}), outPath }],
      },
      { repoRoot: process.cwd(), slug, kind: 'code' },
    );
  } catch (err) {
    emit(
      `${LABEL}: ${err instanceof GeometryExtractError ? err.message : `dispatch failed: ${errMessage(err)}`}`,
    );
    return 2;
  }
  for (const note of answer.notes) emit(`${LABEL}: note: ${note}`);
  if (!answer.ok) {
    // Without a valid answer there is no trustworthy page enumeration, so a
    // file on disk could be the WRONG page — fail rather than trust it.
    emit(
      `${LABEL}: the reader gave no usable answer, so page selection is unverified — ${answer.detail}`,
    );
    return 1;
  }
  const row = answer.answer.surfaces.find((s) => s.surface === surface);
  if (row === undefined) {
    emit(`${LABEL}: the reader's answer omits surface '${surface}'`);
    return 1;
  }
  // The child ENUMERATES, this side SELECTS: re-run the shared selection rule
  // over the reported candidates so the child's own judgment never decides
  // which page was read.
  const selection = selectFinalPage(surface, row.candidates, pageSelector);
  if (!selection.ok) {
    emit(`${LABEL}: ${selection.detail}`);
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(outPath, 'utf8'));
  } catch (err) {
    emit(`${LABEL}: the reader wrote no readable document: ${errMessage(err)}`);
    return 1;
  }
  const doc = parseGeometryDoc(raw, 'design', surface);
  if (!doc.ok) {
    emit(`${LABEL}: ${doc.detail}`);
    return 1;
  }
  if (row.excluded.length > 0) {
    emit(`${LABEL}: excluded ${row.excluded.length} clipped node(s): ${row.excluded.join(', ')}`);
  }
  emit(
    `${LABEL}: wrote ${outPath} from page '${selection.page}' — ${doc.doc.nodes.length} node(s), viewport ${doc.doc.viewport.width}x${doc.doc.viewport.height}`,
  );
  return 0;
}

runIfDirect('geometry-export-cli', `design ${LABEL}`, (argv) => runGeometryExport(argv));
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-export-cli.test.ts src/cr/__tests__/geometry/geometry-validate-cli.test.ts src/cr/__tests__/geometry/geometry-diff-cli.test.ts && pnpm typecheck
```

Expected output: `Test Files  3 passed (3)`. The new file contributes 10 passing tests; the two existing geometry CLI suites stay green over the edited `geometry-cli-emit.ts`. `tsc` exits 0 with no output.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/geo-p2t2.msg <<'MSG'
feat(cr): add design geometry-export to read a .pen surface's geometry

The capture script and the diff command already exist; the missing half of
the hand-run workflow is the design side. An operator debugging a comparison,
or checking what a design's FINAL page holds, should not need a whole CR round
for that.

The CLI drives the geometry-extract seam for one surface and applies the two
trust rules the lane will: the page is re-selected Node-side from the child's
candidates with selectFinalPage, and the written file must pass
parseGeometryDoc before the command reports success. It runs outside a round,
so its answer file goes under a fixed geometry-adhoc slug unless --slug names
one. Exit 1 means this surface could not be read; exit 2 means the invocation
or the dispatch broke.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-export-cli.ts src/cr/geometry/geometry-cli-emit.ts src/cr/__tests__/geometry/geometry-export-cli.test.ts
git commit -F /tmp/geo-p2t2.msg
```

---

## Task 3: Register the subcommand

**Files:**
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`, `AGENTS.md`, `templates/AGENTS.md`

- [ ] **Step 1: Add the manifest row.** In `src/cli/manifest.ts`, inside the `design` group's `subs`, insert between the `'geometry-diff'` entry and the `'geometry-validate'` entry:

```ts
      'geometry-export': {
        src: 'cr/geometry/geometry-export-cli.ts',
        desc: "Read one surface's resolved geometry out of a .pen into a normalized document",
      },
```

- [ ] **Step 2: Run the catalog checks and verify FAIL.**

```bash
pnpm noldor validate script-catalog; pnpm noldor docs capability-index
```

Expected output: `validate script-catalog` prints `✗ Manifest commands whose source is undocumented in docs/noldor/script-catalog.md:` listing `src/cr/geometry/geometry-export-cli.ts`, then `✗ Manifest commands never named in docs/noldor/script-catalog.md:` listing `pnpm noldor design geometry-export`. `docs capability-index` prints `✗ AGENTS.md: capability index is stale` and the same line for `templates/AGENTS.md`. Both commands exit non-zero.

- [ ] **Step 3: Add the catalog entry, twinned.** In `docs/noldor/script-catalog.md`, insert this block between the `### \`design:geometry-diff\`` section and the `### \`design:geometry-validate\`` section, then insert the identical block at the same place in `templates/docs/noldor/script-catalog.md`:

```markdown
### `design:geometry-export`

- **Trigger:** `pnpm noldor design geometry-export --pen <file.pen> --surface <name> --out <doc.json> [--page <name>] [--slug <slug>]`. Needs a live pencil bridge — run `pnpm noldor design pen-bridge` first if a call reports that a file needs to be open in the editor.
- **Inputs:** a `.pen` design, the surface whose `FINAL:<surface>:` page to read, an output path, an optional page selector when the surface has several, and an optional slug for the child's answer file (default `geometry-adhoc`, since a hand run belongs to no CR round).
- **Outputs:** a `geometryDocSchema` design document at `--out`, plus the page it read, the node count, the viewport, and any clipped nodes it excluded. Exit 0 = written and conformant, 1 = this surface could not be read (no usable answer, ambiguous page, missing or non-conformant document), 2 = usage error or the dispatch failed.
- **When to use:** producing the design half of a comparison by hand — pair it with a captured implementation document and `pnpm noldor design geometry-diff`.
- **Source:** [`src/cr/geometry/geometry-export-cli.ts`](../../src/cr/geometry/geometry-export-cli.ts)
```

- [ ] **Step 4: Regenerate the capability index.**

```bash
pnpm noldor docs capability-index --write && git diff --stat -- AGENTS.md templates/AGENTS.md
```

Expected output: both files change by one line each — the `design` row now lists `geometry-diff, geometry-export, geometry-validate` in manifest order.

- [ ] **Step 5: Run the catalog checks and verify PASS.**

```bash
pnpm noldor validate script-catalog && pnpm noldor docs capability-index && pnpm noldor checks template-sync
```

Expected output: `Validated script-catalog: 138 manifest command(s) …` and all three exit 0.

- [ ] **Step 6: Format and run the repo gate.**

```bash
pnpm fmt && pnpm verify
```

Expected output: `oxfmt` reflows any block this plan pasted at a different column choice, then `pnpm verify` (lint, `fmt:check`, typecheck, the full test suite, `triage validate --strict-refs`) exits 0. Stage any file `oxfmt` touched in the commit below.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p2t3.msg <<'MSG'
feat(cli): register design geometry-export

The manifest row makes the command reachable as pnpm noldor design
geometry-export. The script catalog gets its entry in both twins, placed
between geometry-diff and geometry-validate. The generated capability index in
AGENTS.md and its template is rewritten, so agents can see the verb exists.

Noldor-FD: ui-design-review-lane
Noldor-Sibling-Scope: noldor:script-catalog
MSG
git add src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
git commit -F /tmp/geo-p2t3.msg
```
