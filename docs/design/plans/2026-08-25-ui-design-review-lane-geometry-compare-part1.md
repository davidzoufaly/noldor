# Geometry Compare Lane — Part 1: The Geometry Document Contract Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship the normalized geometry document as a usable contract: `pnpm noldor design geometry-validate <doc.json> --side design|impl --surface <name>` tells a consumer whether their capture output conforms, before any comparison engine exists.
**Architecture:** One pure schema module under `src/cr/geometry/` plus a thin CLI entrypoint. Part 2 adds the comparison engine over these documents; part 3 wires the lane that produces them.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

---

## File Structure

- `src/cr/geometry/geometry-doc.ts` — `geometryDocSchema` + the boundary parse that enforces what the schema cannot (surface equality, text-node/`fontSize` coupling, design-side margin rejection).
- `src/cr/geometry/geometry-validate-cli.ts` — `noldor design geometry-validate`: parse one document from disk, report conformance, exit 0 valid / 1 invalid / 2 usage.
- `src/cli/manifest.ts` — one `design.subs['geometry-validate']` row (Modify).
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — the catalog entry, twinned (Modify).
- `src/cr/__tests__/geometry/geometry-doc.test.ts` — schema + boundary-parse tests.
- `src/cr/__tests__/geometry/geometry-validate-cli.test.ts` — CLI exit-code tests.

---

## Task 1: The geometry document contract

**Files:**
- Create: `src/cr/geometry/geometry-doc.ts`
- Test: `src/cr/__tests__/geometry/geometry-doc.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseGeometryDoc } from '../../geometry/geometry-doc.js';

const doc = (over: Record<string, unknown> = {}): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 100, h: 20 }, fontSize: 14, text: 'Hi' }],
  ...over,
});

describe('parseGeometryDoc', () => {
  it('accepts a well-formed design document', () => {
    const r = parseGeometryDoc(doc(), 'design', 'dashboard');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes[0].fontSize).toBe(14);
  });

  it('rejects a surface that is not the one under review', () => {
    const r = parseGeometryDoc(doc(), 'design', 'settings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("reports surface 'dashboard'");
  });

  it('rejects a text node without fontSize', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }] }),
      'impl',
      'dashboard',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('fontSize');
  });

  it('rejects fontSize on a non-text node', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'container', box: { x: 0, y: 0, w: 1, h: 1 }, fontSize: 14 }] }),
      'impl',
      'dashboard',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a non-finite coordinate and a negative dimension', () => {
    expect(
      parseGeometryDoc(
        doc({ nodes: [{ kind: 'shape', box: { x: Number.NaN, y: 0, w: 1, h: 1 } }] }),
        'impl',
        'dashboard',
      ).ok,
    ).toBe(false);
    expect(
      parseGeometryDoc(
        doc({ nodes: [{ kind: 'shape', box: { x: 0, y: 0, w: -1, h: 1 } }] }),
        'impl',
        'dashboard',
      ).ok,
    ).toBe(false);
  });

  it('rejects margin on the design side but accepts it on the implementation side', () => {
    const withMargin = doc({
      nodes: [
        {
          kind: 'container',
          box: { x: 0, y: 0, w: 10, h: 10 },
          spacing: { margin: [8, 0, 8, 0] },
        },
      ],
    });
    expect(parseGeometryDoc(withMargin, 'design', 'dashboard').ok).toBe(false);
    expect(parseGeometryDoc(withMargin, 'impl', 'dashboard').ok).toBe(true);
  });

  it('rejects a zero viewport and an unknown field', () => {
    expect(parseGeometryDoc(doc({ viewport: { width: 0, height: 900 } }), 'impl', 'dashboard').ok).toBe(false);
    expect(parseGeometryDoc(doc({ extra: 1 }), 'impl', 'dashboard').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-doc.test.ts
```

Expected output: the suite fails to collect — `Failed to resolve import "../../geometry/geometry-doc.js"`.

- [ ] **Step 3: Implement the schema.** Create `src/cr/geometry/geometry-doc.ts`:

```ts
// @tests: ui-design-review-lane
// The normalized geometry document both sides of the `geometry-compare` lane
// produce (spec D4). Two untrusted producers write it — a dispatched pencil-MCP
// child and a consumer-owned browser command — so every invariant the prose
// states is enforced here rather than assumed downstream: a structurally valid
// document that violates the contract is exactly what this boundary catches.

import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = finite.min(0);

/** Origin-relative box in CSS pixels at device pixel ratio 1. */
export const geometryBoxSchema = z
  .object({ x: finite, y: finite, w: nonNeg, h: nonNeg })
  .strict();
export type GeometryBox = z.infer<typeof geometryBoxSchema>;

/**
 * Declared spacing. Four-tuples keep zero sides POSITIONALLY (`[8,0,8,0]` is a
 * real declaration and cannot drop its zeros without losing which side is
 * which); excluding zeros is the population's job in
 * `geometry-compare-core.ts`, not the record's.
 */
export const geometrySpacingSchema = z
  .object({
    rowGap: nonNeg.optional(),
    columnGap: nonNeg.optional(),
    padding: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]).optional(),
    // Signed: negative margins are real on the implementation side.
    margin: z.tuple([finite, finite, finite, finite]).optional(),
  })
  .strict();
export type GeometrySpacing = z.infer<typeof geometrySpacingSchema>;

export const geometryNodeKindSchema = z.enum(['text', 'container', 'shape']);
export type GeometryNodeKind = z.infer<typeof geometryNodeKindSchema>;

/**
 * `fontSize` is coupled to `kind: 'text'` in BOTH directions: required on a
 * text node, forbidden elsewhere. That is what keeps `getComputedStyle`'s
 * inherited wrapper font-size out of the font-size family at the boundary
 * instead of relying on the producer's discipline.
 */
export const geometryNodeSchema = z
  .object({
    name: z.string().optional(),
    kind: geometryNodeKindSchema,
    box: geometryBoxSchema,
    fontSize: finite.positive().optional(),
    text: z.string().optional(),
    spacing: geometrySpacingSchema.optional(),
  })
  .strict()
  .superRefine((n, ctx) => {
    if (n.kind === 'text' && n.fontSize === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a 'text' node must carry fontSize" });
    }
    if (n.kind !== 'text' && n.fontSize !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fontSize is carried only on text nodes (kind '${n.kind}')`,
      });
    }
  });
export type GeometryNode = z.infer<typeof geometryNodeSchema>;

export const geometryDocSchema = z
  .object({
    surface: z.string().min(1),
    viewport: z.object({ width: finite.positive(), height: finite.positive() }).strict(),
    nodes: z.array(geometryNodeSchema),
  })
  .strict();
export type GeometryDoc = z.infer<typeof geometryDocSchema>;

/** Which producer wrote the document — the design side may not carry margin. */
export type GeometrySide = 'design' | 'impl';

export type GeometryParse =
  | { ok: true; doc: GeometryDoc }
  | { ok: false; detail: string };

/**
 * Boundary parse. Returns a result rather than throwing: an unparseable
 * document is an expected outcome of reviewing untrusted producer output, and
 * the lane maps `detail` into a `geometry-unparseable` sink.
 */
export function parseGeometryDoc(
  raw: unknown,
  side: GeometrySide,
  expectedSurface: string,
): GeometryParse {
  const parsed = geometryDocSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    return { ok: false, detail: `${side} document invalid — ${path}${first.message}` };
  }
  const doc = parsed.data;
  if (doc.surface !== expectedSurface) {
    return {
      ok: false,
      detail: `${side} document reports surface '${doc.surface}', expected '${expectedSurface}'`,
    };
  }
  if (side === 'design') {
    const i = doc.nodes.findIndex((n) => n.spacing?.margin !== undefined);
    if (i >= 0) {
      return {
        ok: false,
        detail: `design document node ${i} carries margin — pen has no margin property, so a design-side margin means the producer invented a value`,
      };
    }
  }
  return { ok: true, doc };
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-doc.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 8 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-t1.msg <<'MSG'
feat(cr): add the normalized geometry document contract

Why — the geometry-compare lane compares two documents written by two
untrusted producers: a dispatched pencil-MCP child reading an encrypted .pen,
and a consumer-owned browser command. Every invariant the spec states about
those documents has to be enforced where they enter the process, because a
structurally plausible document that violates the contract is precisely how a
wrong comparison would look like a real verdict.

How — one zod schema plus a boundary parse that returns a result instead of
throwing. The schema pins finite coordinates, non-negative dimensions, a
positive viewport, and positional four-tuples for padding and margin so a zero
side keeps its position in the record. The parse adds the three checks a schema
cannot express: the document must report the surface under review, a text node
must carry fontSize while a non-text node must not, and a design-side document
may not carry margin at all, since pen has no margin property and one appearing
there means the producer invented it.

What — src/cr/geometry/geometry-doc.ts with geometryDocSchema,
parseGeometryDoc, and the exported node/box/spacing types, plus eight boundary
tests covering each rejection class.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-doc.ts src/cr/__tests__/geometry/geometry-doc.test.ts
git commit -F /tmp/geo-t1.msg
```

---

---

## Task 2: `noldor design geometry-validate`

**Files:**
- Create: `src/cr/geometry/geometry-validate-cli.ts`
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/cr/__tests__/geometry/geometry-validate-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-validate-cli.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGeometryValidate } from '../../geometry/geometry-validate-cli.js';

const write = async (name: string, body: unknown): Promise<string> => {
  const p = join(await mkdtemp(join(tmpdir(), 'geo-val-')), name);
  await writeFile(p, JSON.stringify(body), 'utf8');
  return p;
};

const doc = (nodes: unknown[]): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes,
});

describe('runGeometryValidate', () => {
  it('exits 0 and reports the node count on a conformant document', async () => {
    const p = await write('impl.json', doc([{ kind: 'shape', box: { x: 0, y: 0, w: 10, h: 10 } }]));
    const out: string[] = [];
    const code = await runGeometryValidate([p, '--side', 'impl', '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('1 node');
  });

  it('exits 1 and names the violation on a non-conformant document', async () => {
    const p = await write('impl.json', doc([{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }]));
    const out: string[] = [];
    const code = await runGeometryValidate([p, '--side', 'impl', '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('fontSize');
  });

  it('exits 1 when the surface does not match and 2 on bad usage', async () => {
    const p = await write('impl.json', doc([]));
    const out: string[] = [];
    expect(await runGeometryValidate([p, '--side', 'impl', '--surface', 'settings'], (s) => out.push(s))).toBe(1);
    expect(await runGeometryValidate([p, '--side', 'nonsense'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryValidate([], (s) => out.push(s))).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-validate-cli.test.ts
```

Expected output: collection error — `Failed to resolve import "../../geometry/geometry-validate-cli.js"`.

- [ ] **Step 3: Implement the CLI.** Create `src/cr/geometry/geometry-validate-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-validate — check one normalized geometry document
// against `geometryDocSchema` and the side-specific rules. A consumer writing a
// `geometryCommand` capture script needs to know their output conforms BEFORE a
// lane exists to consume it; inside a round the same parse produces the
// `geometry-unparseable` sink, so the two can never disagree.

import { readFile } from 'node:fs/promises';

import { runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import { parseGeometryDoc, type GeometrySide } from './geometry-doc.js';

const USAGE =
  'usage: noldor design geometry-validate <doc.json> --side design|impl [--surface <name>]';

const SIDES: readonly GeometrySide[] = ['design', 'impl'];

/**
 * Exit 0 = conformant, 1 = the document violates the contract, 2 = usage error
 * or the file could not be read. A violation is exit 1 rather than 2 because it
 * is the tool's real answer, not a failure to answer.
 */
export async function runGeometryValidate(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flagValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const side = flagValue('--side');
  // A positional consumed by --side/--surface must not double as the path.
  const consumed = new Set([flagValue('--side'), flagValue('--surface')]);
  const path = positional.find((p) => !consumed.has(p));
  if (path === undefined || side === undefined || !SIDES.includes(side as GeometrySide)) {
    emit(USAGE);
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    emit(`geometry-validate: could not read ${path}: ${errMessage(err)}`);
    return 2;
  }
  const expected =
    flagValue('--surface') ??
    (typeof (raw as { surface?: unknown }).surface === 'string'
      ? (raw as { surface: string }).surface
      : '');
  const parsed = parseGeometryDoc(raw, side as GeometrySide, expected);
  if (!parsed.ok) {
    emit(`geometry-validate: ${parsed.detail}`);
    return 1;
  }
  emit(
    `geometry-validate: ${path} is a valid ${side} document for surface '${expected}' — ${parsed.doc.nodes.length} node(s), viewport ${parsed.doc.viewport.width}x${parsed.doc.viewport.height}`,
  );
  return 0;
}

await runIfDirect(import.meta.url, async () => {
  process.exitCode = await runGeometryValidate(process.argv.slice(2));
});
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-validate-cli.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 3 passed`.

- [ ] **Step 5: Register the subcommand.** In `src/cli/manifest.ts`, inside the `design` group's `subs`, add after the `log` entry:

```ts
      'geometry-validate': {
        src: 'cr/geometry/geometry-validate-cli.ts',
        desc: 'Validate a normalized geometry document against geometryDocSchema (--side design|impl)',
      },
```

- [ ] **Step 6: Verify the command routes.**

```bash
node bin/noldor.mjs design geometry-validate
```

Expected output: `usage: noldor design geometry-validate <doc.json> --side design|impl [--surface <name>]`.

- [ ] **Step 7: Add the catalog entry, twinned.** Append to `docs/noldor/script-catalog.md` immediately after the `design:pen-bridge` section, then copy the identical block into `templates/docs/noldor/script-catalog.md` at the same position:

```markdown
### `design:geometry-validate`

- **Trigger:** `pnpm noldor design geometry-validate <doc.json> --side design|impl [--surface <name>]`. Run while writing or debugging a `geometryCommand` capture script.
- **Inputs:** one normalized geometry document, the side that produced it, and the surface it should report (defaults to whatever the document claims).
- **Outputs:** the node count and viewport on success, or the first contract violation. Exit 0 = conformant, 1 = violates the contract, 2 = usage error or unreadable file.
- **When to use:** before wiring `geometryCommand` into `consumer.uiBoot` — the same parse runs inside the `geometry-compare` lane, where a violation lands as `geometry-unparseable`.
- **Source:** [`src/cr/geometry/geometry-validate-cli.ts`](../../src/cr/geometry/geometry-validate-cli.ts)
```

- [ ] **Step 8: Verify the gates.**

```bash
pnpm noldor validate script-catalog && pnpm noldor checks template-sync && pnpm typecheck && pnpm lint
```

Expected output: all four exit 0.

- [ ] **Step 9: Commit.**

```bash
cat > /tmp/geo-p1t2.msg <<'MSG'
feat(cli): add design geometry-validate for capture-script conformance

Why — a consumer has to write a geometryCommand capture script against a
framework-defined schema, and without a way to check its output they would be
debugging it through a full CR round: boot the app, dispatch a pencil child,
read a sink. The document contract is shippable on its own, and checking
conformance is the capability that makes it so.

How — a thin entrypoint over the same parseGeometryDoc the lane will use, so a
document the CLI accepts cannot be rejected inside a round and vice versa. It
reports the node count and viewport on success and the first violation
otherwise, exiting 1 for a non-conformant document because that is the tool's
real answer rather than a failure to answer, and 2 only for a usage error or an
unreadable file.

What — src/cr/geometry/geometry-validate-cli.ts, its manifest row under the
design group, the twinned script-catalog entry, and tests covering the
conformant, non-conformant, wrong-surface, and bad-usage paths.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-validate-cli.ts src/cr/__tests__/geometry/geometry-validate-cli.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
git commit -F /tmp/geo-p1t2.msg
```
