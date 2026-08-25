# Geometry Compare Lane — Part 1: The Geometry Document Contract Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship the normalized geometry document as a usable contract: `pnpm noldor design geometry-validate <doc.json> --side design|impl --surface <name>` tells a consumer whether their capture output is STRUCTURALLY conformant — the schema's shape and invariants — before any comparison engine exists. It cannot judge the producer semantics parts 3 and 4 own (capture root, origin, inclusion rules); a document can pass this and still measure the wrong thing, which is what `design geometry-diff` and `design geometry-review` are for.
**Architecture:** One pure schema module under `src/cr/geometry/` plus a thin CLI entrypoint. This part pins the document's *shape and invariants* only — the producer-side semantics (capture root and origin subtraction, scroll and transform handling, node inclusion, pen's gap/padding normalization) belong to the producers and are pinned in part 3 (the capture script) and part 4 (the extraction prompt), per the spec's D3 and D4. Part 2 adds the comparison engine over these documents.
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
// @tests: ui-design-review-lane
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
    // Narrow on the discriminant before reading fontSize — the union is what
    // makes the un-narrowed read a type error.
    if (r.ok && r.doc.nodes[0].kind === 'text') expect(r.doc.nodes[0].fontSize).toBe(14);
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

  it('rejects a non-positive fontSize', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 }, fontSize: 0 }] }),
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

/** Fields every node carries, whatever its kind. `text` is NOT among them —
 * see the per-kind members: a text node must carry it and no other kind may. */
const nodeCommon = {
  name: z.string().optional(),
  box: geometryBoxSchema,
  spacing: geometrySpacingSchema.optional(),
};

/**
 * A text-bearing node: `fontSize` is REQUIRED here and absent from every other
 * kind. A discriminated union rather than one object plus a refinement, so the
 * coupling holds in the TYPE as well as at runtime — downstream code reading
 * `n.fontSize` after narrowing on `kind` gets a `number`, not `number |
 * undefined`, and a producer document with an inherited wrapper font-size
 * cannot type-check its way past the boundary.
 */
export const geometryTextNodeSchema = z
  .object({
    ...nodeCommon,
    kind: z.literal('text'),
    fontSize: finite.positive(),
    /** The rendered text, required here: `kind: 'text'` means text-bearing, and
     * a producer that cannot say what the text is has mis-classified the node. */
    text: z.string().min(1),
  })
  .strict();
export type GeometryTextNode = z.infer<typeof geometryTextNodeSchema>;

/** A node with element children but no direct text of its own. */
export const geometryContainerNodeSchema = z
  .object({ ...nodeCommon, kind: z.literal('container') })
  .strict();

/** Anything else with a box: leaf shapes, images, SVG roots. */
export const geometryShapeNodeSchema = z
  .object({ ...nodeCommon, kind: z.literal('shape') })
  .strict();

export const geometryNodeSchema = z.discriminatedUnion('kind', [
  geometryTextNodeSchema,
  geometryContainerNodeSchema,
  geometryShapeNodeSchema,
]);
export type GeometryNode = z.infer<typeof geometryNodeSchema>;
export type GeometryNodeKind = GeometryNode['kind'];

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

What — src/cr/geometry/geometry-doc.ts with geometryDocSchema as a
discriminated union on kind, parseGeometryDoc, and the exported node, box and
spacing types, plus nine boundary tests covering each rejection class.

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
// @tests: ui-design-review-lane
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

  it('exits 1 when the surface does not match', async () => {
    const p = await write('impl.json', doc([{ kind: 'shape', box: { x: 0, y: 0, w: 1, h: 1 } }]));
    const out: string[] = [];
    expect(
      await runGeometryValidate([p, '--side', 'impl', '--surface', 'settings'], (s) => out.push(s)),
    ).toBe(1);
  });

  it('exits 2 on a bad side, a missing --surface, an unknown flag, and no path', async () => {
    const p = await write('impl.json', doc([]));
    const out: string[] = [];
    expect(await runGeometryValidate([p, '--side', 'nonsense', '--surface', 'x'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryValidate([p, '--side', 'impl'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryValidate([p, '--side', 'impl', '--surface', 'x', '--zoom'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryValidate(['--side', 'impl', '--surface', 'x'], (s) => out.push(s))).toBe(2);
  });

  it('does not mistake a path whose text equals a flag value for that value', async () => {
    // The positional is string-equal to the --surface value, which is what the
    // old by-value filter dropped; index-based filtering keeps it.
    const dir = await mkdtemp(join(tmpdir(), 'geo-val-'));
    const rel = 'surface-doc';
    await writeFile(join(dir, rel), JSON.stringify({
      surface: rel,
      viewport: { width: 10, height: 10 },
      nodes: [{ kind: 'shape', box: { x: 0, y: 0, w: 1, h: 1 } }],
    }), 'utf8');
    const out: string[] = [];
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await runGeometryValidate([rel, '--side', 'impl', '--surface', rel], (s) => out.push(s))).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it('exits 2 on malformed JSON and on a value-less flag that would swallow the next', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-val-'));
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{not json', 'utf8');
    const out: string[] = [];
    expect(await runGeometryValidate([bad, '--side', 'impl', '--surface', 'x'], (s) => out.push(s))).toBe(2);
    const good = await write('ok.json', doc([]));
    expect(await runGeometryValidate([good, '--side', 'impl', '--surface', '--zoom'], (s) => out.push(s))).toBe(2);
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

import { optionalFlag, runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import { parseGeometryDoc, type GeometrySide } from './geometry-doc.js';

const LABEL = 'geometry-validate';
const USAGE = `usage: noldor design ${LABEL} <doc.json> --side design|impl --surface <name>`;

/** Narrowing predicate, not a cast: `side` arrives as untrusted argv text. */
const isSide = (s: string): s is GeometrySide => s === 'design' || s === 'impl';
/** Every flag this command takes a value for — an unknown flag is user error. */
const VALUE_FLAGS = ['--side', '--surface'] as const;

/**
 * Exit 0 = conformant, 1 = the document violates the contract, 2 = usage error
 * or the file could not be read. A violation is exit 1 rather than 2 because it
 * is the tool's real answer, not a failure to answer.
 */
export async function runGeometryValidate(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const values = new Map<string, string>();
  for (const flag of VALUE_FLAGS) {
    const read = optionalFlag(argv, flag, LABEL);
    if (!read.ok) {
      emit(read.error);
      return 2;
    }
    // `optionalFlag` deliberately does not check the value's shape, so a
    // forgotten value (`--surface --out doc.json`) would otherwise swallow the
    // NEXT FLAG's name as the surface. Reject flag-shaped values here.
    if (read.value !== undefined && read.value.startsWith('--')) {
      emit(`${LABEL}: ${flag} requires a value\n${USAGE}`);
      return 2;
    }
    if (read.value !== undefined) values.set(flag, read.value);
  }
  // Positionals are found by INDEX, not by value: a path whose text equals a
  // flag's value must not be swallowed as that value's twin.
  const consumedIdx = new Set<number>();
  for (const flag of VALUE_FLAGS) {
    const i = argv.indexOf(flag);
    if (i >= 0) consumedIdx.add(i).add(i + 1);
  }
  const positional = argv.filter((a, i) => !consumedIdx.has(i));
  const unknownFlag = positional.find((a) => a.startsWith('--'));
  if (unknownFlag !== undefined) {
    emit(`${LABEL}: unknown flag ${unknownFlag}\n${USAGE}`);
    return 2;
  }
  const side = values.get('--side');
  const surface = values.get('--surface');
  // `--surface` is REQUIRED: defaulting it to whatever the document claims would
  // make the surface-equality check self-satisfying, and that check is the whole
  // point of passing a side and a surface separately.
  if (positional.length !== 1 || side === undefined || surface === undefined || !isSide(side)) {
    emit(USAGE);
    return 2;
  }
  let raw: unknown;
  try {
    // Exit 2 covers "there is no document to judge" — the file is unreadable OR
    // its bytes are not JSON. Exit 1 is reserved for a document that parsed and
    // then violated the contract, which is the only case where the tool has an
    // answer ABOUT a document.
    raw = JSON.parse(await readFile(positional[0], 'utf8'));
  } catch (err) {
    emit(`${LABEL}: could not read ${positional[0]} as JSON: ${errMessage(err)}`);
    return 2;
  }
  // `side` is narrowed by `isSide`, never asserted: this is an external-input
  // boundary, and a cast would be a claim rather than a check.
  const parsed = parseGeometryDoc(raw, side, surface);
  if (!parsed.ok) {
    emit(`${LABEL}: ${parsed.detail}`);
    return 1;
  }
  emit(
    `${LABEL}: ${positional[0]} is a valid ${side} document for surface '${surface}' — ${parsed.doc.nodes.length} node(s), viewport ${parsed.doc.viewport.width}x${parsed.doc.viewport.height}`,
  );
  return 0;
}

runIfDirect('geometry-validate-cli', `design ${LABEL}`, (argv) => runGeometryValidate(argv));
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-validate-cli.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 6 passed`.

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

Expected output: `usage: noldor design geometry-validate <doc.json> --side design|impl --surface <name>`.

- [ ] **Step 7: Add the catalog entry, twinned.** Append to `docs/noldor/script-catalog.md` immediately after the `design:pen-bridge` section, then copy the identical block into `templates/docs/noldor/script-catalog.md` at the same position:

```markdown
### `design:geometry-validate`

- **Trigger:** `pnpm noldor design geometry-validate <doc.json> --side design|impl --surface <name>`. Run while writing or debugging a `geometryCommand` capture script.
- **Inputs:** one normalized geometry document, the side that produced it, and the surface it must report. All three are required — defaulting the surface to whatever the document claims would make the surface check self-satisfying.
- **Outputs:** the node count and viewport on success, or the first contract violation. Exit 0 = conformant, 1 = violates the contract, 2 = usage error or unreadable file.
- **When to use:** before wiring `geometryCommand` into `consumer.uiBoot` — the same parse runs inside the `geometry-compare` lane, where a violation lands as `geometry-unparseable`.
- **Source:** [`src/cr/geometry/geometry-validate-cli.ts`](../../src/cr/geometry/geometry-validate-cli.ts)
```

- [ ] **Step F: Format what the plan dictated.**

```bash
pnpm fmt && git diff --stat
```

Expected output: `oxfmt` reflows the blocks this plan pasted (the code here is written for reading, not to `oxfmt`'s exact column choices) and prints the files it touched. Run this BEFORE the gate below — `pnpm verify` includes `fmt:check`, which fails on an unformatted block before it ever reaches the tests.

- [ ] **Step 8: Verify the gates.**

```bash
pnpm noldor validate script-catalog && pnpm noldor checks template-sync && pnpm verify
```

Expected output: all three exit 0 — `pnpm verify` is the repo's own gate chain (lint, `fmt:check`, typecheck, tests, triage refs), so a formatting drift fails here rather than at the pre-push hook.

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
