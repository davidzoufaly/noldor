# Geometry Compare Lane — Part 1: Recipe Config + Reference Capture Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Let a consumer declare `geometryCommand` in `consumer.uiBoot` and capture a conformant implementation document: the framework ships the reference Playwright producer, `validate noldor-config` accepts the recipe, and `screenshotCommand` is no longer required for a consumer who never runs the pixel lane.
**Architecture:** Schema work in `src/core/consumer-config.ts` over a field-labelled `screenshotTemplateIssues`, one narrowing in `render-compare`, and one scaffold-only template script. With the shipped `design geometry-validate` and `design geometry-diff`, this gives a hand-runnable capture → validate → compare loop before the lane exists.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest; the template script is plain ESM JavaScript that loads the consumer's own Playwright lazily.

**Depends on:** nothing earlier in this series — it builds only on the shipped `geometryDocSchema` (`src/cr/geometry/geometry-doc.ts`) and `GEOMETRY_FAMILIES` (`src/cr/geometry/geometry-compare-core.ts`). Parts 3–5 depend on this part.

---

## File Structure

- `src/core/ui-boot.ts` — `screenshotTemplateIssues(template, field)`: same quoting contract, every message names the field being validated (Modify).
- `src/core/consumer-config.ts` — `UiBootRecipeSchema`: `screenshotCommand` optional, `geometryCommand` added, `geometryTolerance` / `geometryBudget` partial records over the four families, at-least-one-capture-command refine (Modify).
- `src/cr/lanes/render-compare.ts` — a recipe without `screenshotCommand` is declined as `no-boot-recipe`; jobs carry a narrowed recipe type (Modify).
- `templates/scripts/geometry-capture.mjs` — the reference Playwright producer, scaffolded by `init`, owned by the consumer afterwards (Create).
- `src/templates/manifest.ts` — add the script to `SCAFFOLD_ONLY_TEMPLATES` (Modify).
- `src/cr/__tests__/lanes/render-compare-core.test.ts` — field-label cases beside the existing `screenshotTemplateIssues` tests (Modify).
- `src/cr/__tests__/geometry/geometry-recipe.test.ts` — recipe acceptance/rejection, family keys pinned to `GEOMETRY_FAMILIES` (Create).
- `src/cr/__tests__/lanes/render-compare.test.ts` — geometry-only recipe declined by the pixel lane (Modify).
- `src/templates/__tests__/templates.test.ts` — the script ships, is scaffold-only, and validates its inputs before loading Playwright (Modify).

---

## Task 1: Parameterize the template validator's field label

**Files:**
- Modify: `src/core/ui-boot.ts`
- Modify: `src/core/consumer-config.ts`
- Test: `src/cr/__tests__/lanes/render-compare-core.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/cr/__tests__/lanes/render-compare-core.test.ts`, replace the existing block:

```ts
describe('screenshotCommand template contract', () => {
  it('requires all four placeholders and rejects unknown tokens', () => {
    expect(screenshotTemplateIssues('shot --size={width},{height} {url} {out}')).toEqual([]);
    expect(screenshotTemplateIssues('shot {url} {out}')).toEqual([
      'screenshotCommand is missing {width}',
      'screenshotCommand is missing {height}',
    ]);
    expect(screenshotTemplateIssues('shot {url} {out} {width} {height} {state}')).toEqual([
      'screenshotCommand carries unknown placeholder {state}',
    ]);
  });
});
```

with:

```ts
describe('screenshotCommand template contract', () => {
  it('requires all four placeholders and rejects unknown tokens', () => {
    expect(
      screenshotTemplateIssues('shot --size={width},{height} {url} {out}', 'screenshotCommand'),
    ).toEqual([]);
    expect(screenshotTemplateIssues('shot {url} {out}', 'screenshotCommand')).toEqual([
      'screenshotCommand is missing {width}',
      'screenshotCommand is missing {height}',
    ]);
    expect(
      screenshotTemplateIssues('shot {url} {out} {width} {height} {state}', 'screenshotCommand'),
    ).toEqual(['screenshotCommand carries unknown placeholder {state}']);
  });

  it('names whichever field the caller is validating, in every message', () => {
    expect(screenshotTemplateIssues('cap {url} {out}', 'geometryCommand')).toEqual([
      'geometryCommand is missing {width}',
      'geometryCommand is missing {height}',
    ]);
    expect(
      screenshotTemplateIssues('cap {url} {out} {width} {height} {zoom}', 'geometryCommand'),
    ).toEqual(['geometryCommand carries unknown placeholder {zoom}']);
    const quoted = screenshotTemplateIssues(
      `cap '{url}' "{out}" {width} {height}`,
      'geometryCommand',
    );
    expect(quoted).toHaveLength(2);
    expect(quoted.every((i) => i.startsWith('geometryCommand may not contain'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare-core.test.ts -t 'template contract'
```

Expected output: the first case passes (the extra argument is ignored at runtime) and `names whichever field the caller is validating` fails — the messages still read `screenshotCommand is missing {width}`.

- [ ] **Step 3: Implement the parameter.** In `src/core/ui-boot.ts`, replace everything from the doc comment above `screenshotTemplateIssues` to the end of the file:

```ts
/**
 * Template problems `validate noldor-config` rejects: a missing required
 * placeholder, any `{token}` outside the four the lane substitutes, or ANY
 * single quote. The lane wraps every substituted value in single quotes, so a
 * consumer-quoted placeholder (`cap '{url}' …`) would produce `''…''` — the
 * value lands OUTSIDE the quoting and its permitted `&` could split the
 * command. Write templates with bare placeholders; static arguments that need
 * quoting use double quotes.
 */
export function screenshotTemplateIssues(template: string): string[] {
  const issues: string[] = [];
  for (const p of SCREENSHOT_PLACEHOLDERS) {
    if (!template.includes(`{${p}}`)) issues.push(`screenshotCommand is missing {${p}}`);
  }
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(SCREENSHOT_PLACEHOLDERS as readonly string[]).includes(m[1])) {
      issues.push(`screenshotCommand carries unknown placeholder {${m[1]}}`);
    }
  }
  if (template.includes("'")) {
    issues.push(
      'screenshotCommand may not contain single quotes — the lane single-quotes every substituted placeholder itself',
    );
  }
  // Double quotes are rejected too: a placeholder inside them ("{url}") would
  // make the lane's inserted single quotes LITERAL characters while $ and
  // backticks stay live — the quoting contract only holds for bare
  // placeholders in an otherwise quote-free template.
  if (template.includes('"')) {
    issues.push(
      'screenshotCommand may not contain double quotes — write bare placeholders; the lane owns all quoting',
    );
  }
  return issues;
}
```

with:

```ts
/**
 * Template problems `validate noldor-config` rejects in a capture template
 * (`screenshotCommand` or `geometryCommand` — one contract, so the quoting
 * guard cannot drift between two copies): a missing required placeholder, any
 * `{token}` outside the four the lane substitutes, or ANY quote character. The
 * lane wraps every substituted value in single quotes, so a consumer-quoted
 * placeholder (`cap '{url}' …`) would produce `''…''` — the value lands OUTSIDE
 * the quoting and its permitted `&` could split the command. Write templates
 * with bare placeholders and no quotes at all.
 *
 * @param template - The consumer's capture template.
 * @param field - The config key being validated; every message names it, so a
 *   bad `geometryCommand` is never reported as a `screenshotCommand` problem.
 * @returns One message per problem, empty when the template is in contract.
 */
export function screenshotTemplateIssues(template: string, field: string): string[] {
  const issues: string[] = [];
  for (const p of SCREENSHOT_PLACEHOLDERS) {
    if (!template.includes(`{${p}}`)) issues.push(`${field} is missing {${p}}`);
  }
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(SCREENSHOT_PLACEHOLDERS as readonly string[]).includes(m[1])) {
      issues.push(`${field} carries unknown placeholder {${m[1]}}`);
    }
  }
  if (template.includes("'")) {
    issues.push(
      `${field} may not contain single quotes — the lane single-quotes every substituted placeholder itself`,
    );
  }
  // Double quotes are rejected too: a placeholder inside them ("{url}") would
  // make the lane's inserted single quotes LITERAL characters while $ and
  // backticks stay live — the quoting contract only holds for bare
  // placeholders in an otherwise quote-free template.
  if (template.includes('"')) {
    issues.push(
      `${field} may not contain double quotes — write bare placeholders; the lane owns all quoting`,
    );
  }
  return issues;
}
```

- [ ] **Step 4: Update the one production caller.** In `src/core/consumer-config.ts`, inside `UiBootRecipeSchema`'s `screenshotCommand` field, replace:

```ts
        for (const issue of screenshotTemplateIssues(tpl)) {
```

with:

```ts
        for (const issue of screenshotTemplateIssues(tpl, 'screenshotCommand')) {
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare-core.test.ts src/core/__tests__/consumer-config.test.ts && pnpm typecheck
```

Expected output: both suites pass (the existing `consumer.uiBoot` and quoting-rule cases still match `missing {width}`, `unknown placeholder {state}` and `may not contain single quotes`), and typecheck is clean.

- [ ] **Step 6: Commit.** This is the branch's first code-bearing commit, so its body carries the PR summary.

```bash
cat > "${TMPDIR:-/tmp}/geo-p1t1.msg" <<'MSG'
refactor(core): let the capture-template validator name its own field

Why — the geometry-compare core and its hand-run commands shipped, but no CR
round runs them: a consumer has to export the design document, capture the
implementation and diff the two by hand, so layout drift from the approved
.pen is caught only when someone remembers to look. This branch makes that
comparison a code-stage CR lane, and it starts at the recipe the lane will
validate.

How — one consumer.uiBoot recipe serves both booting lanes, so the new
geometryCommand reuses the screenshotCommand quoting contract rather than a
second copy of it, where the single-quote guard would drift. The validator's
six messages hardcoded screenshotCommand, so it now takes the field label and
the one production caller passes its own name.

What — across the branch: the recipe fields and a reference Playwright capture
script, the geometry-extract child with design geometry-export, design
geometry-review, and the geometry-compare lane wired into orchestrate. This
commit: screenshotTemplateIssues in src/core/ui-boot.ts takes the field label,
consumer-config passes screenshotCommand, and tests cover the label in every
message.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/ui-boot.ts src/core/consumer-config.ts src/cr/__tests__/lanes/render-compare-core.test.ts
git commit -F "${TMPDIR:-/tmp}/geo-p1t1.msg"
```

Expected output: the commit lands; lefthook's `test-links` sync may re-stage `docs/features/ui-design-review-lane.md`.

---

## Task 2: The recipe schema and the pixel lane's screenshot-less row

**Files:**
- Modify: `src/core/consumer-config.ts`
- Modify: `src/cr/lanes/render-compare.ts`
- Test: `src/cr/__tests__/geometry/geometry-recipe.test.ts`
- Test: `src/cr/__tests__/lanes/render-compare.test.ts`

- [ ] **Step 1: Write the failing schema test.** Create `src/cr/__tests__/geometry/geometry-recipe.test.ts`:

```ts
// @tests: ui-design-review-lane
// The uiBoot recipe fields the geometry-compare lane reads (spec D2/AC3). The
// test lives beside the geometry core, not in src/core, because it pins the
// recipe's family keys to GEOMETRY_FAMILIES — core may not import lane code,
// so the schema restates the four keys and this file keeps them in step.
import { describe, expect, it } from 'vitest';

import { UiBootRecipeSchema } from '../../../core/consumer-config.js';
import { DEFAULT_BUDGET, GEOMETRY_FAMILIES } from '../../geometry/geometry-compare-core.js';

const base = { verifyCommand: 'dev', route: '/dashboard' };
const shot = 'pnpm shot {url} {out} {width} {height}';
const geo = 'node scripts/geometry-capture.mjs {url} {out} {width} {height}';

const messages = (input: unknown): string => {
  const r = UiBootRecipeSchema.safeParse(input);
  return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
};

describe('UiBootRecipeSchema capture commands', () => {
  it('accepts a screenshot-only recipe (unchanged behaviour)', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, screenshotCommand: shot }).success).toBe(true);
  });

  it('accepts a geometry-only recipe', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo }).success).toBe(true);
  });

  it('rejects a recipe with neither capture command', () => {
    expect(messages(base)).toContain('at least one of screenshotCommand');
  });

  it('rejects a mis-templated geometryCommand, naming geometryCommand', () => {
    expect(messages({ ...base, geometryCommand: 'cap {url} {out}' })).toContain(
      'geometryCommand is missing {width}',
    );
    expect(
      messages({ ...base, geometryCommand: "cap '{url}' {out} {width} {height}" }),
    ).toContain('geometryCommand may not contain single quotes');
  });
});

describe('UiBootRecipeSchema per-family knobs', () => {
  it('accepts every shipped family key in both records', () => {
    const all = Object.fromEntries(GEOMETRY_FAMILIES.map((f) => [f, 3]));
    const r = UiBootRecipeSchema.parse({
      ...base,
      geometryCommand: geo,
      geometryTolerance: all,
      geometryBudget: all,
    });
    expect(r.geometryTolerance).toEqual(all);
    expect(r.geometryBudget).toEqual(all);
  });

  it('leaves omitted families absent for the lane to fill from the defaults', () => {
    const r = UiBootRecipeSchema.parse({ ...base, geometryCommand: geo, geometryBudget: { edgesX: 2 } });
    expect(r.geometryTolerance).toBeUndefined();
    expect(r.geometryBudget).toEqual({ edgesX: 2 });
    expect({ ...DEFAULT_BUDGET, ...r.geometryBudget }).toEqual({
      edgesX: 2,
      edgesY: 0,
      fontSize: 0,
      spacing: 0,
    });
  });

  it('rejects a key outside the four families, including the retired edges', () => {
    for (const key of ['edges', 'lineHeight']) {
      expect(
        UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, geometryBudget: { [key]: 1 } })
          .success,
      ).toBe(false);
      expect(
        UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, geometryTolerance: { [key]: 1 } })
          .success,
      ).toBe(false);
    }
  });

  it('rejects a negative tolerance and a non-integer or negative budget', () => {
    const parses = (extra: Record<string, unknown>): boolean =>
      UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, ...extra }).success;
    expect(parses({ geometryTolerance: { edgesY: -1 } })).toBe(false);
    expect(parses({ geometryBudget: { edgesX: 1.5 } })).toBe(false);
    expect(parses({ geometryBudget: { spacing: -1 } })).toBe(false);
    expect(parses({ geometryTolerance: { fontSize: 0.5 } })).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing lane test.** In `src/cr/__tests__/lanes/render-compare.test.ts`, inside `describe('runRenderCompare — per-surface cannot-review classes', …)`, insert immediately before `  it('exporter dispatch failure marks every recipe surface export-failed', async () => {`:

```ts
  it('a recipe without screenshotCommand is no-boot-recipe, never exported or booted', async () => {
    const log = seams(DESIGN_PNG);
    let dispatched = 0;
    setRenderExportDispatcher(async () => {
      dispatched++;
      return report({ surfaces: [] });
    });
    const { cwd, input } = repo({
      uiBoot: {
        dashboard: {
          verifyCommand: 'dashboard',
          route: '/',
          geometryCommand: 'geo {url} {out} {width} {height}',
        },
      },
    });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true); // advisory default
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'no-boot-recipe' });
    expect(String(s.notes)).toContain('has a uiBoot recipe but no screenshotCommand');
    expect(dispatched).toBe(0);
    expect(log.boots).toHaveLength(0);
  });

```

- [ ] **Step 3: Run both and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-recipe.test.ts src/cr/__tests__/lanes/render-compare.test.ts -t 'UiBootRecipeSchema|without screenshotCommand'
```

Expected output: the geometry-only, per-family and neither-command cases fail (`Unrecognized key(s) in object: 'geometryCommand'`, `screenshotCommand` still `Required`), and the lane case fails with `reason: 'config-unreadable'` instead of `no-boot-recipe`.

- [ ] **Step 4: Implement the schema.** In `src/core/consumer-config.ts`, replace the doc comment and schema (after Task 1):

```ts
/**
 * One render-compare boot recipe (spec R2), keyed by surface name in
 * `consumer.uiBoot`. `verifyCommand` references a `consumer.verifyCommands`
 * entry of `kind: "server"` (boot/health are not respecified); `route` is the
 * path that renders the surface; `page` selects among several
 * `FINAL:<surface>: <name>` design pages; `screenshotCommand` is the
 * consumer-owned capture template — the lane substitutes every placeholder as
 * a single-quoted shell token.
 */
export const UiBootRecipeSchema = z
```

through the end of the object:

```ts
    screenshotCommand: z
      .string()
      .min(1)
      .superRefine((tpl, ctx) => {
        for (const issue of screenshotTemplateIssues(tpl, 'screenshotCommand')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }
      }),
    maxDiffRatio: z.number().finite().min(0).max(1).default(0.25),
    // Rejected at validate when out of contract, never clamped (spec R2).
    captureTimeoutMs: z.number().int().min(1).max(120_000).default(60_000),
  })
  .strict();
```

with the following (the `verifyCommand`, `route` and `page` fields between the two excerpts stay exactly as they are):

```ts
/**
 * A capture-command template field: the shared quoting contract, with every
 * message naming `field`. Optional — which of the two a recipe needs is the
 * object-level refine's call, not the field's.
 */
const captureTemplate = (field: 'screenshotCommand' | 'geometryCommand') =>
  z
    .string()
    .min(1)
    .superRefine((tpl, ctx) => {
      for (const issue of screenshotTemplateIssues(tpl, field)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
      }
    })
    .optional();

/**
 * A per-family record over the four families the geometry lane compares. The
 * keys mirror `GEOMETRY_FAMILIES` in `src/cr/geometry/geometry-compare-core.ts`
 * and are restated because core may not import lane code;
 * `src/cr/__tests__/geometry/geometry-recipe.test.ts` pins the two together.
 * Every key is optional — the lane fills omitted families from
 * `DEFAULT_TOLERANCE` / `DEFAULT_BUDGET` — and the object is strict, so a
 * misspelt or retired key (`edges`) is rejected rather than ignored.
 */
const familyRecord = (value: z.ZodNumber) =>
  z
    .object({
      edgesX: value.optional(),
      edgesY: value.optional(),
      fontSize: value.optional(),
      spacing: value.optional(),
    })
    .strict()
    .optional();

/**
 * One boot recipe (spec R2), keyed by surface name in `consumer.uiBoot` and
 * shared by `render-compare` and `geometry-compare`. `verifyCommand` references
 * a `consumer.verifyCommands` entry of `kind: "server"` (boot/health are not
 * respecified); `route` is the path that renders the surface; `page` selects
 * among several `FINAL:<surface>: <name>` design pages. `screenshotCommand`
 * (pixel lane) and `geometryCommand` (geometry lane) are consumer-owned
 * capture templates — each lane substitutes every placeholder as a
 * single-quoted shell token — and a recipe carries at least one of them.
 */
export const UiBootRecipeSchema = z
```

and, for the tail:

```ts
    // Optional since the geometry lane exists: a consumer who never runs the
    // pixel lane has no screenshot tool to name. `render-compare` reports
    // `no-boot-recipe` for a surface whose recipe omits it.
    screenshotCommand: captureTemplate('screenshotCommand'),
    // Writes a `geometryDocSchema` document rather than a PNG; same
    // placeholders, same quoting contract.
    geometryCommand: captureTemplate('geometryCommand'),
    maxDiffRatio: z.number().finite().min(0).max(1).default(0.25),
    // Rejected at validate when out of contract, never clamped (spec R2).
    captureTimeoutMs: z.number().int().min(1).max(120_000).default(60_000),
    // Covering tolerance in CSS px per family, and the unmatched values a
    // family may carry before it fails (spec D2).
    geometryTolerance: familyRecord(z.number().finite().min(0)),
    geometryBudget: familyRecord(z.number().int().min(0)),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (recipe.screenshotCommand === undefined && recipe.geometryCommand === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'a uiBoot recipe needs at least one of screenshotCommand (render-compare) or geometryCommand (geometry-compare)',
      });
    }
  });
```

- [ ] **Step 5: Run the schema suites and see the typecheck gap.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-recipe.test.ts src/core/__tests__/consumer-config.test.ts && pnpm typecheck
```

Expected output: both suites pass; typecheck reports one error in `src/cr/lanes/render-compare.ts` at `substituteScreenshotCommand(job.recipe.screenshotCommand, …)` — `string | undefined` is not assignable to `string`. Step 6 fixes it.

- [ ] **Step 6: Decline a screenshot-less recipe in `render-compare`.** In `src/cr/lanes/render-compare.ts`, replace:

```ts
    const withRecipe = surfaces.filter((s) => recipes.has(s));
    for (const s of surfaces) {
      if (!recipes.has(s)) {
        outcomes.push(cannot(s, 'no-boot-recipe', `surface '${s}' has no consumer.uiBoot recipe`));
      }
    }
```

with:

```ts
    // A recipe without `screenshotCommand` is as unusable to THIS lane as no
    // recipe at all — the field became optional when `geometryCommand` landed
    // — so both get the same row with different details.
    const withRecipe = surfaces.filter((s) => recipes.get(s)?.screenshotCommand !== undefined);
    for (const s of surfaces) {
      const recipe = recipes.get(s);
      if (recipe === undefined) {
        outcomes.push(cannot(s, 'no-boot-recipe', `surface '${s}' has no consumer.uiBoot recipe`));
      } else if (recipe.screenshotCommand === undefined) {
        outcomes.push(
          cannot(s, 'no-boot-recipe', `surface '${s}' has a uiBoot recipe but no screenshotCommand`),
        );
      }
    }
```

- [ ] **Step 7: Narrow the job's recipe type.** In the same file, replace the `SurfaceJob` field:

```ts
  recipe: UiBootRecipe;
```

with:

```ts
  /** Built only from `withRecipe`, so `screenshotCommand` is always present. */
  recipe: ScreenshotRecipe;
```

insert directly above `/** A surface's per-round working state, keyed off its recipe + design raster. */`:

```ts
/** A recipe the pixel lane can run: `withRecipe` admits only these. */
type ScreenshotRecipe = UiBootRecipe & { screenshotCommand: string };

```

and replace the cast where the job is pushed:

```ts
            recipe: recipes.get(r.surface) as UiBootRecipe,
```

with:

```ts
            recipe: recipes.get(r.surface) as ScreenshotRecipe,
```

- [ ] **Step 8: Run everything touched and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-recipe.test.ts src/cr/__tests__/lanes/render-compare.test.ts src/core/__tests__/consumer-config.test.ts && pnpm typecheck
```

Expected output: all three suites pass, including `a recipe without screenshotCommand is no-boot-recipe`; typecheck is clean.

- [ ] **Step 9: Verify the repo's own config still validates.**

```bash
pnpm noldor validate noldor-config
```

Expected output: exit 0 — this repo declares no `uiBoot`, so the new fields are inert here.

- [ ] **Step 10: Commit.**

```bash
cat > "${TMPDIR:-/tmp}/geo-p1t2.msg" <<'MSG'
feat(core): add geometryCommand and per-family knobs to the uiBoot recipe

The geometry lane needs the boot inputs render-compare already reads plus a
different capture command, so one recipe serves both rather than a parallel
block whose route and verifyCommand could drift. screenshotCommand becomes
optional — a consumer who never runs the pixel lane has no screenshot tool to
name — and a refine requires at least one capture command so a recipe that
captures nothing is rejected.

geometryTolerance and geometryBudget are partial records over the four shipped
families (edgesX, edgesY, fontSize, spacing), strict so a retired edges key is
an error; the lane fills omitted families from the core defaults. The keys are
restated in core and pinned to GEOMETRY_FAMILIES by a test, because core may
not import lane code.

render-compare declines a screenshot-less recipe with no-boot-recipe instead
of substituting undefined into a command, and its jobs carry a narrowed recipe
type.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/consumer-config.ts src/cr/lanes/render-compare.ts src/cr/__tests__/geometry/geometry-recipe.test.ts src/cr/__tests__/lanes/render-compare.test.ts
git commit -F "${TMPDIR:-/tmp}/geo-p1t2.msg"
```

Expected output: the commit lands; the `test-links` sync may re-stage the FD with the new test path.

---

## Task 3: The reference capture script

**Files:**
- Create: `templates/scripts/geometry-capture.mjs`
- Modify: `src/templates/manifest.ts`
- Test: `src/templates/__tests__/templates.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/templates/__tests__/templates.test.ts`, change the tag line:

```ts
// @tests: noldor-package-lift, self-refreshing-compact-knowledge-graph
```

to:

```ts
// @tests: noldor-package-lift, self-refreshing-compact-knowledge-graph, ui-design-review-lane
```

and append at the end of the file:

```ts
describe('scripts/geometry-capture.mjs template (geometry-compare producer)', () => {
  const rel = 'scripts/geometry-capture.mjs';
  const run = (args: string[], surface?: string) => {
    const env = { ...process.env };
    delete env.NOLDOR_GEOMETRY_SURFACE;
    if (surface !== undefined) env.NOLDOR_GEOMETRY_SURFACE = surface;
    return spawnSync(process.execPath, [join(TEMPLATES_ROOT, rel), ...args], {
      env,
      encoding: 'utf8',
    });
  };

  it('ships in the template manifest', () => {
    expect(templateFiles()).toContain(rel);
  });

  it('is scaffold-only and excluded from the template-sync drift set', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
    expect(templateFiles().filter((f) => !SCAFFOLD_ONLY_TEMPLATES.has(f))).not.toContain(rel);
  });

  // noldor has no playwright dependency, so these cases also prove the inputs
  // are checked BEFORE the lazy import: loading it first would exit 1 on
  // ERR_MODULE_NOT_FOUND instead of 2 with the usage line.
  it('exits 2 with usage when its four arguments are missing', () => {
    const r = run([], 'dashboard');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });

  it('exits 2 without NOLDOR_GEOMETRY_SURFACE instead of guessing a surface name', () => {
    const r = run(['http://127.0.0.1:4001/', '/tmp/out.json', '1440', '900']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('NOLDOR_GEOMETRY_SURFACE');
  });

  it('exits 2 on a width or height that is not a positive number', () => {
    for (const [w, h] of [
      ['abc', '900'],
      ['1440', '0'],
    ]) {
      const r = run(['http://127.0.0.1:4001/', '/tmp/out.json', w, h], 'dashboard');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('positive');
    }
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/templates/__tests__/templates.test.ts -t 'geometry-capture'
```

Expected output: every case fails — the template file does not exist (the spawn cases exit 1 on a missing module) and the set does not contain it.

- [ ] **Step 3: Write the reference producer.** Create `templates/scripts/geometry-capture.mjs`:

```js
// Reference `geometryCommand` producer for the noldor `geometry-compare` lane.
//
// Usage:
//   NOLDOR_GEOMETRY_SURFACE=<surface> node scripts/geometry-capture.mjs <url> <out.json> <width> <height>
//
// The lane sets NOLDOR_GEOMETRY_SURFACE to the uiBoot key under review; set it
// yourself when running by hand. Validate the output with
// `pnpm noldor design geometry-validate <out.json> --side impl --surface <name>`.
//
// This file is SCAFFOLDED, not synced: it is yours to edit. Add the waits, the
// login step, or the fixture seeding your app needs — `noldor init --update`
// never overwrites it and `checks template-sync` never compares it.
//
// It needs playwright in YOUR package.json (`pnpm add -D playwright`); the
// framework ships no browser dependency. Playwright is imported only after the
// inputs are checked, so a usage error prints even where it is not installed.

import { writeFile } from 'node:fs/promises';

const USAGE =
  'usage: NOLDOR_GEOMETRY_SURFACE=<surface> node scripts/geometry-capture.mjs <url> <out.json> <width> <height>';

/** Input errors exit 2, the same code the noldor CLIs use for usage errors. */
function usageError(why) {
  process.stderr.write(`geometry-capture: ${why}\n${USAGE}\n`);
  process.exit(2);
}

const [url, out, widthArg, heightArg] = process.argv.slice(2);
if (!url || !out || !widthArg || !heightArg) usageError('expected four arguments');

// Playwright viewports are whole pixels. The lane's {width}/{height} come from
// the design document and may be fractional; rounding stays inside the lane's
// 1px viewport agreement.
const width = Math.round(Number(widthArg));
const height = Math.round(Number(heightArg));
if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
  usageError(`width and height must be positive numbers, got '${widthArg}' x '${heightArg}'`);
}

// Required, never defaulted: the document's `surface` must equal the surface
// under review, and a guessed name would fail that check on every surface but one.
const surface = process.env.NOLDOR_GEOMETRY_SURFACE;
if (!surface) usageError('NOLDOR_GEOMETRY_SURFACE is not set');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  process.stderr.write(
    `geometry-capture: cannot load playwright (${err instanceof Error ? err.message : String(err)}) — add it: pnpm add -D playwright\n`,
  );
  process.exit(1);
}

// The element the route renders into. Change this to your app's root if it is
// not `body` — every box is reported relative to it.
const CAPTURE_ROOT = 'body';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width, height },
    // Device pixel ratio 1 is part of the document contract: the design side
    // reports CSS pixels, so a 2x capture would double every value.
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // ADD YOUR WAITS HERE — e.g. await page.getByRole('table').waitFor();

  const nodes = await page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (root === null) throw new Error(`capture root '${rootSelector}' matched nothing`);
    const origin = root.getBoundingClientRect();
    const num = (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const found = [];
    const walk = (el) => {
      const style = window.getComputedStyle(el);
      // Excluded per the document contract: invisible and
      // hidden-from-assistive-tech subtrees are not layout.
      if (style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') return;
      if (style.display === 'contents') {
        for (const child of el.children) walk(child);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // Both rects are viewport-relative, so the scroll offset cancels and
        // the difference puts the capture root at {0,0}.
        const box = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        const fontSize = num(style.fontSize);
        // The document requires a positive fontSize and non-empty text on
        // every text node; an element failing either is not text-bearing.
        const text = (el.textContent ?? '').trim().slice(0, 120);
        const isText = hasText && fontSize > 0 && text !== '';
        const spacing = {
          padding: [
            num(style.paddingTop),
            num(style.paddingRight),
            num(style.paddingBottom),
            num(style.paddingLeft),
          ],
          margin: [
            num(style.marginTop),
            num(style.marginRight),
            num(style.marginBottom),
            num(style.marginLeft),
          ],
        };
        if (style.rowGap !== 'normal' && num(style.rowGap) !== 0) spacing.rowGap = num(style.rowGap);
        if (style.columnGap !== 'normal' && num(style.columnGap) !== 0) {
          spacing.columnGap = num(style.columnGap);
        }
        const node = {
          name: el.id !== '' ? el.id : el.tagName.toLowerCase(),
          kind: isText ? 'text' : el.children.length > 0 ? 'container' : 'shape',
          box,
          spacing,
        };
        if (isText) {
          node.fontSize = fontSize;
          node.text = text;
        }
        found.push(node);
      }
      // An SVG root is layout; its internal geometry is paint.
      if (el.tagName.toLowerCase() === 'svg') return;
      for (const child of el.children) walk(child);
    };
    for (const child of root.children) walk(child);
    return found;
  }, CAPTURE_ROOT);

  // The viewport reported is the one set above, not the capture root's box:
  // <body> is shorter than the design page on any non-full-height route, and
  // the lane compares viewports before anything else.
  const doc = { surface, viewport: { width, height }, nodes };
  await writeFile(out, JSON.stringify(doc, null, 1), 'utf8');
} finally {
  await browser.close();
}
```

- [ ] **Step 4: Register it as scaffold-only.** In `src/templates/manifest.ts`, inside `SCAFFOLD_ONLY_TEMPLATES`, replace:

```ts
  'docs/architecture/flows.md',
]);
```

with:

```ts
  'docs/architecture/flows.md',
  // Reference `geometryCommand` producer for the geometry-compare lane. Every
  // real app adds its own waits, auth and capture root here, so a synced twin
  // would turn each of those edits into a template-sync red.
  'scripts/geometry-capture.mjs',
]);
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/templates/__tests__/templates.test.ts
```

Expected output: the whole suite passes, including the five `geometry-capture` cases.

- [ ] **Step 6: Check the script's shape without a browser.**

```bash
node --check templates/scripts/geometry-capture.mjs && node templates/scripts/geometry-capture.mjs; echo "exit=$?"
```

Expected output: `--check` prints nothing (valid ESM); the second command prints `geometry-capture: expected four arguments` and the usage line, then `exit=2`.

- [ ] **Step 7: Format, then run the full gate.**

```bash
pnpm fmt && git diff --stat && pnpm verify
```

Expected output: `oxfmt` reflows any block this plan wrote to a different column choice and lists the touched files; `pnpm verify` (lint, `fmt:check`, typecheck, tests, triage validate) exits 0. Format first — `fmt:check` fails on an unformatted block before the tests run.

- [ ] **Step 8: Commit.**

```bash
cat > "${TMPDIR:-/tmp}/geo-p1t3.msg" <<'MSG'
feat(templates): ship a reference geometryCommand capture script

The geometry document is harder to produce than a screenshot: boxes relative
to a capture root, device pixel ratio pinned to 1, font size and text only on
text-bearing elements, spacing kept positionally. Shipping only the schema
would leave every consumer to re-derive that DOM walk, each slightly
differently, in a lane whose value is a trustworthy noise floor.

init lands the script once at scripts/geometry-capture.mjs and never syncs it
(SCAFFOLD_ONLY_TEMPLATES): every real app needs its own waits, auth and
capture root there. It checks its arguments and the required
NOLDOR_GEOMETRY_SURFACE before importing playwright lazily, so a usage error
prints without the browser dependency, and it reports the viewport it set
rather than body's box, which is shorter than the design page on most routes.

Noldor-FD: ui-design-review-lane
MSG
git add templates/scripts/geometry-capture.mjs src/templates/manifest.ts src/templates/__tests__/templates.test.ts
git commit -F "${TMPDIR:-/tmp}/geo-p1t3.msg"
```

Expected output: the commit lands; the `test-links` sync may re-stage the FD with `src/templates/__tests__/templates.test.ts`.
