# Geometry Compare Lane — Part 4: Design-Side Extraction Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Read resolved geometry out of a `.pen` design and land it as a conformant document: `pnpm noldor design geometry-export --pen <file> --surface <name> --out <doc.json>`. With part 3's capture script and part 2's diff CLI, that completes the whole workflow by hand — export the design, capture the implementation, compare them — before any lane exists.
**Architecture:** One dispatched pencil-MCP role (`geometry-extract`) built on `createDispatcherSeam`, mirroring `render-export-dispatch.ts`'s child-ENUMERATES / Node-SELECTS split, plus a CLI that drives one surface. The child writes documents to paths the caller names; the trusted evidence is the file, parsed Node-side.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** part 1 (`parseGeometryDoc`) and `selectFinalPage` from the existing `render-compare-core.ts`.

---

## File Structure

- `src/core/agent-runner/types.ts` — add the `geometry-extract` role so a consumer can pin it to a pencil-capable runner (Modify).
- `src/cr/lanes/geometry-extract-dispatch.ts` — the child's prompt, its report schema, and the dispatcher seam (Create).
- `src/cr/geometry/geometry-export-cli.ts` — `noldor design geometry-export`: dispatch for one surface, validate the written document (Create).
- `src/cli/manifest.ts` — one `design.subs['geometry-export']` row (Modify).
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — the catalog entry, twinned (Modify).
- `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts` — prompt content + report parsing.
- `src/cr/__tests__/geometry/geometry-export-cli.test.ts` — CLI paths with the dispatcher stubbed.

---

## Task 1: The extraction role and dispatch contract

**Files:**
- Create: `src/cr/lanes/geometry-extract-dispatch.ts`
- Modify: `src/core/agent-runner/types.ts`
- Test: `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildGeometryExtractPrompt,
  parseGeometryExtractReport,
} from '../../lanes/geometry-extract-dispatch.js';

const input = {
  penPath: '/tmp/scratch/slug.pen',
  requests: [
    { surface: 'dashboard', pageSelector: 'overview', outPath: '/tmp/out/dashboard.json' },
    { surface: 'settings', outPath: '/tmp/out/settings.json' },
  ],
};

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

  it('instructs absolutization inside the visitor and page-origin subtraction', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('parentCtx');
    expect(p).toContain('resolveVariables');
    expect(p).toContain('subtract');
  });
});

describe('parseGeometryExtractReport', () => {
  it('parses a well-formed report', () => {
    const r = parseGeometryExtractReport(
      '```json\n{"surfaces":[{"surface":"dashboard","candidates":["overview"],"excluded":["Badge (clipped)"]}]}\n```',
    );
    expect(r?.surfaces[0].candidates).toEqual(['overview']);
    expect(r?.surfaces[0].excluded).toEqual(['Badge (clipped)']);
  });

  it('defaults excluded and returns null on a schema mismatch or absence', () => {
    const ok = parseGeometryExtractReport('```json\n{"surfaces":[{"surface":"a","candidates":[]}]}\n```');
    expect(ok?.surfaces[0].excluded).toEqual([]);
    expect(parseGeometryExtractReport('```json\n{"surfaces":[{"nope":1}]}\n```')).toBeNull();
    expect(parseGeometryExtractReport('no fenced block here')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts
```

Expected output: collection error — `Failed to resolve import "../../lanes/geometry-extract-dispatch.js"`.

- [ ] **Step 3: Add the role.** In `src/core/agent-runner/types.ts`, add to `AGENT_ROLES` after `'render-compare'`:

```ts
  // The geometry-compare lane's design reader — opens the scratch `.pen`
  // through pencil MCP and writes a normalized geometry document per surface.
  // No judgment, no findings; separate from `render-compare` so a consumer can
  // pin the two pencil roles independently.
  'geometry-extract',
```

- [ ] **Step 4: Implement the dispatch module.** Create `src/cr/lanes/geometry-extract-dispatch.ts`:

```ts
// @tests: ui-design-review-lane
// Prompt + child contract for the `geometry-compare` lane's DESIGN READER (spec
// D3). The child opens the scratch `.pen` through pencil MCP, resolves each
// surface's `FINAL:` page, walks it with a `Get` visitor, and writes one
// normalized geometry document per surface. Its report carries the page
// ENUMERATION only — the lane re-derives the selection itself and trusts the
// written file, parsed against `geometryDocSchema`, as the evidence.

import { z } from 'zod';

import { penBridgeRecipe } from '../../design/pen-bridge.js';
import { parseFencedJson } from '../extract-json.js';
import { createDispatcherSeam } from '../lane-spawn.js';
import { fencedJsonInstruction } from './prompt-parts.js';

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
 * Per-surface report row: the page enumeration, plus which nodes the child
 * dropped as clipped. No outcome field — the child has nothing to be wrong
 * about, since the document on disk is what gets validated.
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
  return `You are a design GEOMETRY READER for a mechanical layout-diff pipeline. You read resolved geometry out of a Pencil \`.pen\` design and write it as JSON. You make no judgments and report no findings.

The design is a scratch COPY at \`${input.penPath}\`. It is encrypted — the ONLY reader is pencil MCP: call \`get_app_state\` once for the SCHEMA AND API DOCS ONLY, then do ALL reading via \`execute({ filePath: "${input.penPath}", input: ... })\`. get_app_state describes whatever file the editor has active — which may be a DIFFERENT design — so page names and node ids taken from it are invalid. Never open a \`.pen\` with a file-reading tool, and never touch any design file under the repository.

${penBridgeRecipe(input.penPath)}

Extraction jobs (one selected page per surface):
${jobs}

For each surface:
1. Enumerate the design's top-level pages named \`FINAL:<surface>: <name>\` for that surface (exact surface segment). Report ALL the trimmed \`<name>\` segments as the candidates, even when zero or ambiguous.
2. Select the page: with a page selector, the candidate exactly equal to it (trimmed, case-sensitive); without one, the single candidate if there is exactly one. Zero candidates, several without a selector, a selector matching none, or two identical names — do NOT write that surface's file (the parent recomputes the same rule from your candidates and classifies it).
3. Read the selected page with ONE visitor pass, resolving variables:

\`\`\`js
const abs = (c) => { let x = 0, y = 0; for (let k = c; k; k = k.parentCtx) { x += k.bounds.x; y += k.bounds.y; } return { x, y }; };
Get(pageId, (n, c) => { const o = abs(c); return { id: n.id, name: n.name, type: n.type, problems: c.problems,
  x: o.x, y: o.y, w: c.bounds.width, h: c.bounds.height,
  fontSize: n.fontSize, layout: n.layout, gap: n.gap, padding: n.padding }; }, { resolveVariables: true })
\`\`\`

\`Ctx.bounds\` is resolved in the PARENT's coordinate space, so the accumulation above is required — a node's own \`x\`/\`y\` are ignored under a flex layout and its \`width\`/\`height\` may be \`fit_content\`, \`fill_container\`, or a variable. Then subtract the page node's own accumulated origin from every node's \`x\`/\`y\` so the page's top-left is \`{0,0}\`.
4. Write \`<outPath>\` as JSON in exactly this shape:

\`\`\`json
{"surface":"<surface>","viewport":{"width":<page width>,"height":<page height>},
 "nodes":[{"name":"Card","kind":"container","box":{"x":24,"y":16,"w":320,"h":180},"spacing":{"rowGap":16,"padding":[24,24,24,24]}},
          {"name":"Title","kind":"text","box":{"x":48,"y":40,"w":200,"h":24},"fontSize":20,"text":"Revenue"}]}
\`\`\`

Rules for that file, all mandatory:
- \`kind\`: pen \`text\` → \`"text"\`, pen \`frame\` → \`"container"\`, everything else → \`"shape"\`.
- \`fontSize\` appears on \`"text"\` nodes and NOWHERE else.
- \`spacing\`: pen \`gap\` becomes \`rowGap\` under \`layout: "vertical"\` and \`columnGap\` under \`layout: "horizontal"\`; pen \`padding\` becomes the four-tuple \`[top, right, bottom, left]\` (a number becomes all four, \`[v, h]\` becomes \`[v, h, v, h]\`). Omit \`spacing\` entirely when the node declares neither. NEVER emit \`margin\` — pen has no margin property and the parent rejects a design document that carries one.
- Exclude any node whose \`problems\` is set (clipped), and list those node names in \`excluded\`.
- The page node itself is not a node; it is the viewport.

Do not create, modify, or save anything in the design; write no file except the listed output paths.

Report one entry per surface — the candidates and exclusions are the report; there is no verdict field:

${fencedJsonInstruction(
  `{"surfaces": [{"surface": "dashboard", "candidates": ["overview"], "excluded": []}, {"surface": "settings", "candidates": ["default", "expanded"], "excluded": []}]}`,
)}`;
}

/**
 * Last fenced ```json block wins; null on absence, bad JSON, or schema
 * mismatch — one class for the caller, which then trusts only the files.
 */
export const parseGeometryExtractReport = (md: string): GeometryExtractReport | null =>
  parseFencedJson(md, geometryExtractReportSchema);

/** Carries which reason detail the caller should record, so the sink stays specific. */
export class GeometryExtractError extends Error {
  constructor(
    readonly reason: 'timeout' | 'dispatch-failed',
    message: string,
  ) {
    super(message);
    this.name = 'GeometryExtractError';
  }
}

const seam = createDispatcherSeam<GeometryExtractInput>(buildGeometryExtractPrompt, {
  role: 'geometry-extract',
  site: 'cr.geometry-extract-dispatch',
  onFailure: (f) => {
    throw new GeometryExtractError(
      f.reason,
      f.timedOut
        ? 'geometry-extract dispatch timed out'
        : `geometry-extract dispatch failed: exit ${f.exitCode}`,
    );
  },
});

/** Test seam — production code never calls this. */
export const setGeometryExtractDispatcher = seam.setDispatcher;
export const dispatchGeometryExtract = seam.dispatch;
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts && pnpm typecheck
```

Expected output: `Test Files 1 passed`, `Tests 5 passed`, typecheck clean.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/geo-p4t1.msg <<'MSG'
feat(cr): add the design-side geometry extraction contract

Why — .pen files are encrypted and pencil MCP is their only reader, so the
design half of a geometry comparison has to be a dispatched child. What that
child reads is not the declared schema: an entity's x and y are ignored under a
flex layout and its width and height may be fit_content, fill_container, or a
variable reference. Only the Get visitor's ctx.bounds carries resolved
geometry, and it is parent-relative, so absolutization has to happen inside the
callback where the ancestor chain is still reachable.

How — the same child-ENUMERATES, Node-SELECTS split the render exporter uses:
the child reports the FINAL page candidates it found and writes one geometry
document per surface, while page selection and document validation stay
Node-side, so the child has nothing to be wrong about. The prompt spells out the
visitor, the page-origin subtraction, the pen-type-to-kind mapping, the gap and
padding normalization, the ban on emitting margin, and the exclusion of clipped
nodes.

What — src/cr/lanes/geometry-extract-dispatch.ts with the prompt builder,
report schema, dispatcher seam and error class; the geometry-extract agent role;
and tests over the prompt's content and the report parser.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/geometry-extract-dispatch.ts src/core/agent-runner/types.ts src/cr/__tests__/lanes/geometry-extract-dispatch.test.ts
git commit -F /tmp/geo-p4t1.msg
```

---

## Task 2: `noldor design geometry-export`

**Files:**
- Create: `src/cr/geometry/geometry-export-cli.ts`
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/cr/__tests__/geometry/geometry-export-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-export-cli.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGeometryExport } from '../../geometry/geometry-export-cli.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const doc = (surface: string): unknown => ({
  surface,
  viewport: { width: 1440, height: 900 },
  nodes: [{ kind: 'shape', box: { x: 24, y: 0, w: 100, h: 40 } }],
});

const dir = await mkdtemp(join(tmpdir(), 'geo-export-'));
const pen = join(dir, 'design.pen');
await writeFile(pen, 'encrypted-bytes', 'utf8');

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
});

describe('runGeometryExport', () => {
  it('writes the document and exits 0 when the child reports one candidate', async () => {
    const out = join(dir, 'ok.json');
    setGeometryExtractDispatcher(async (input) => {
      await writeFile(input.requests[0].outPath, JSON.stringify(doc('dashboard')), 'utf8');
      return '```json\n{"surfaces":[{"surface":"dashboard","candidates":["overview"]}]}\n```';
    });
    const lines: string[] = [];
    const code = await runGeometryExport(
      ['--pen', pen, '--surface', 'dashboard', '--out', out],
      (s) => lines.push(s),
    );
    expect(code).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8')).surface).toBe('dashboard');
  });

  it('exits 1 when the page selection is ambiguous', async () => {
    setGeometryExtractDispatcher(
      async () => '```json\n{"surfaces":[{"surface":"dashboard","candidates":["a","b"]}]}\n```',
    );
    const lines: string[] = [];
    const code = await runGeometryExport(
      ['--pen', pen, '--surface', 'dashboard', '--out', join(dir, 'amb.json')],
      (s) => lines.push(s),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('page selector');
  });

  it('exits 1 when the child writes a non-conformant document', async () => {
    const out = join(dir, 'bad.json');
    setGeometryExtractDispatcher(async (input) => {
      await writeFile(input.requests[0].outPath, JSON.stringify(doc('settings')), 'utf8');
      return '```json\n{"surfaces":[{"surface":"dashboard","candidates":["overview"]}]}\n```';
    });
    const lines: string[] = [];
    const code = await runGeometryExport(
      ['--pen', pen, '--surface', 'dashboard', '--out', out],
      (s) => lines.push(s),
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain("reports surface 'settings'");
  });

  it('exits 2 on a missing flag and on an absent pen file', async () => {
    const lines: string[] = [];
    expect(await runGeometryExport(['--pen', pen], (s) => lines.push(s))).toBe(2);
    expect(
      await runGeometryExport(
        ['--pen', join(dir, 'nope.pen'), '--surface', 'x', '--out', join(dir, 'o.json')],
        (s) => lines.push(s),
      ),
    ).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-export-cli.test.ts
```

Expected output: collection error — `Failed to resolve import "../../geometry/geometry-export-cli.js"`.

- [ ] **Step 3: Implement the CLI.** Create `src/cr/geometry/geometry-export-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-export — read one surface's resolved geometry out of a
// `.pen` and write it as a normalized document. The `geometry-compare` lane does
// this for every affected surface inside a round; this entrypoint exists so an
// operator can produce the design half by hand and diff it against a captured
// implementation document without booting anything.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  parseGeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { selectFinalPage } from '../lanes/render-compare-core.js';
import { parseGeometryDoc } from './geometry-doc.js';

const USAGE =
  'usage: noldor design geometry-export --pen <file.pen> --surface <name> --out <doc.json> [--page <name>]';

/**
 * Exit 0 = a conformant document was written, 1 = the design could not be read
 * for this surface (ambiguous page, missing file, non-conformant document),
 * 2 = usage error or the dispatch itself failed. The 1-vs-2 split mirrors the
 * lane's own distinction between "cannot review this surface" and "the round
 * broke".
 */
export async function runGeometryExport(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const penPath = flag('--pen');
  const surface = flag('--surface');
  const outPath = flag('--out');
  const pageSelector = flag('--page');
  if (penPath === undefined || surface === undefined || outPath === undefined) {
    emit(USAGE);
    return 2;
  }
  if (!existsSync(penPath)) {
    emit(`geometry-export: no such design file: ${penPath}`);
    return 2;
  }
  let raw: string;
  try {
    raw = await dispatchGeometryExtract({
      penPath,
      requests: [{ surface, ...(pageSelector !== undefined ? { pageSelector } : {}), outPath }],
    });
  } catch (err) {
    emit(
      `geometry-export: ${err instanceof GeometryExtractError ? err.message : `dispatch failed: ${errMessage(err)}`}`,
    );
    return 2;
  }
  const report = parseGeometryExtractReport(raw);
  if (report === null) {
    // Without a parseable report there is no trustworthy page enumeration, so a
    // file on disk could be the WRONG page — fail rather than trust it.
    emit('geometry-export: the reader returned no parseable report — page selection unverified');
    return 1;
  }
  const row = report.surfaces.find((s) => s.surface === surface);
  if (row === undefined) {
    emit(`geometry-export: the reader's report omits surface '${surface}'`);
    return 1;
  }
  // The child ENUMERATES, this side SELECTS: re-run the shared selection rule
  // over the reported candidates so the child's own judgment never decides
  // which page was read.
  const selection = selectFinalPage(surface, row.candidates, pageSelector);
  if (!selection.ok) {
    emit(`geometry-export: ${selection.detail}`);
    return 1;
  }
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(await readFile(outPath, 'utf8'));
  } catch (err) {
    emit(`geometry-export: the reader wrote no readable document: ${errMessage(err)}`);
    return 1;
  }
  const doc = parseGeometryDoc(parsedRaw, 'design', surface);
  if (!doc.ok) {
    emit(`geometry-export: ${doc.detail}`);
    return 1;
  }
  if (row.excluded.length > 0) {
    emit(`geometry-export: excluded ${row.excluded.length} clipped node(s): ${row.excluded.join(', ')}`);
  }
  emit(
    `geometry-export: wrote ${outPath} from page '${selection.page}' — ${doc.doc.nodes.length} node(s), viewport ${doc.doc.viewport.width}x${doc.doc.viewport.height}`,
  );
  return 0;
}

await runIfDirect(import.meta.url, async () => {
  process.exitCode = await runGeometryExport(process.argv.slice(2));
});
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-export-cli.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 4 passed`.

- [ ] **Step 5: Register the subcommand.** In `src/cli/manifest.ts`, inside the `design` group's `subs`, add after the `geometry-diff` entry:

```ts
      'geometry-export': {
        src: 'cr/geometry/geometry-export-cli.ts',
        desc: "Read one surface's resolved geometry out of a .pen into a normalized document",
      },
```

- [ ] **Step 6: Add the catalog entry, twinned.** Append to `docs/noldor/script-catalog.md` after the `design:geometry-diff` section, then copy the identical block into `templates/docs/noldor/script-catalog.md`:

```markdown
### `design:geometry-export`

- **Trigger:** `pnpm noldor design geometry-export --pen <file.pen> --surface <name> --out <doc.json> [--page <name>]`. Needs a live pencil bridge — run `pnpm noldor design pen-bridge` first if a call reports `A file needs to be open in the editor`.
- **Inputs:** a `.pen` design, the surface whose `FINAL:<surface>:` page to read, an output path, and an optional page selector when the surface has several.
- **Outputs:** a `geometryDocSchema` document at `--out`, plus the page it read, the node count, and any clipped nodes it excluded. Exit 0 = written and conformant, 1 = this surface could not be read (ambiguous page, unparseable report, non-conformant document), 2 = usage error or the dispatch failed.
- **When to use:** producing the design half of a comparison by hand — pair it with a captured implementation document and `pnpm noldor design geometry-diff`.
- **Source:** [`src/cr/geometry/geometry-export-cli.ts`](../../src/cr/geometry/geometry-export-cli.ts)
```

- [ ] **Step 7: Verify the gates.**

```bash
pnpm noldor validate script-catalog && pnpm noldor checks template-sync && pnpm typecheck && pnpm lint
```

Expected output: all four exit 0.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/geo-p4t2.msg <<'MSG'
feat(cli): add design geometry-export to read a .pen surface's geometry

Why — with the capture script and the diff command already in place, the only
missing half of a hand-runnable workflow is the design side, and it cannot be a
pure function: the file is encrypted and pencil MCP is its only reader. An
operator debugging a comparison, or checking that a design's FINAL page holds
what they think it holds, should not have to run a whole CR round to find out.

How — the CLI drives the geometry-extract dispatcher for one surface, then
applies the same two trust rules the lane will: page selection is recomputed
Node-side from the child's reported candidates via the shared selectFinalPage,
and the written file is validated against geometryDocSchema before the command
claims success. Exit 1 means this surface could not be read, exit 2 means the
dispatch or the invocation broke — the same distinction the lane draws between
cannot-review and a broken round.

What — src/cr/geometry/geometry-export-cli.ts, its manifest row, the twinned
script-catalog entry, and tests covering the happy path, ambiguous selection, a
non-conformant document, and bad usage with the dispatcher stubbed.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-export-cli.ts src/cr/__tests__/geometry/geometry-export-cli.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
git commit -F /tmp/geo-p4t2.msg
```
