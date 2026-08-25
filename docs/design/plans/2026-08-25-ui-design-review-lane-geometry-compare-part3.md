# Geometry Compare Lane — Part 3: Recipe Config + Reference Capture Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Let a consumer declare `geometryCommand` in `consumer.uiBoot` and actually capture a conformant implementation document — the framework ships the reference Playwright producer, `validate noldor-config` accepts the recipe, and `screenshotCommand` stops being mandatory for a consumer who never runs the pixel lane.
**Architecture:** Schema work in `src/core/consumer-config.ts` over a field-label-parameterized `screenshotTemplateIssues`, plus one scaffold-only template script. With part 1's validator and part 2's diff CLI, this completes a hand-runnable capture → validate → compare loop before the lane exists.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest; the template script is plain ESM JavaScript driving the consumer's own Playwright.

**Depends on:** part 1 (`geometryDocSchema`) and part 2 (`design geometry-diff`) for the loop to be useful; the schema work here is independent of both.

---

## File Structure

- `src/core/ui-boot.ts` — `screenshotTemplateIssues(template, field)`: the same quoting contract, messages naming whichever field is being validated (Modify).
- `src/core/consumer-config.ts` — `UiBootRecipeSchema`: `screenshotCommand` optional, `geometryCommand` added, at-least-one-capture-command refine, `geometryTolerance`/`geometryBudget` records (Modify).
- `templates/scripts/geometry-capture.mjs` — the reference Playwright producer, scaffolded by `init` and owned by the consumer thereafter (Create).
- `src/templates/manifest.ts` — add the script to `SCAFFOLD_ONLY_TEMPLATES` (Modify).
- `src/core/__tests__/consumer-config.test.ts` — recipe acceptance/rejection cases (Modify).
- `src/core/__tests__/ui-boot.test.ts` — field-label parameterization (Modify or Create).

---

## Task 1: Parameterize the template validator's field label

**Files:**
- Modify: `src/core/ui-boot.ts`
- Test: `src/core/__tests__/ui-boot.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `src/core/__tests__/ui-boot.test.ts` (create the file with this content if it does not exist):

```ts
import { describe, expect, it } from 'vitest';

import { screenshotTemplateIssues } from '../ui-boot.js';

describe('screenshotTemplateIssues field label', () => {
  it('names screenshotCommand by default', () => {
    expect(screenshotTemplateIssues('cap {out} {width} {height}')).toContain(
      'screenshotCommand is missing {url}',
    );
  });

  it('names whichever field the caller is validating', () => {
    const issues = screenshotTemplateIssues("cap '{url}' {out} {width} {height}", 'geometryCommand');
    expect(issues.some((i) => i.startsWith('geometryCommand is'))).toBe(true);
    expect(issues.some((i) => i.includes('screenshotCommand'))).toBe(false);
  });

  it('names the field in the unknown-placeholder message too', () => {
    expect(screenshotTemplateIssues('cap {url} {out} {width} {height} {zoom}', 'geometryCommand')).toContain(
      'geometryCommand carries unknown placeholder {zoom}',
    );
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/ui-boot.test.ts -t 'field label'
```

Expected output: the second and third cases fail — the messages still read `screenshotCommand`.

- [ ] **Step 3: Implement the parameter.** In `src/core/ui-boot.ts`, change `screenshotTemplateIssues` to take the label and use it in all six messages:

```ts
export function screenshotTemplateIssues(
  template: string,
  field: 'screenshotCommand' | 'geometryCommand' = 'screenshotCommand',
): string[] {
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

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/core/__tests__/ui-boot.test.ts && pnpm typecheck
```

Expected output: the suite passes and typecheck is clean — the default parameter keeps every existing caller compiling.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-p3t1.msg <<'MSG'
refactor(core): let the capture-template validator name its own field

Why — the geometry-compare lane validates geometryCommand with the same quoting
contract screenshotCommand uses, and reusing the validator is right: a second
copy is where the single-quote guard would drift. But all six of its messages
hardcode the string screenshotCommand, so a bad geometryCommand would be
rejected while naming a field the consumer never wrote.

How — the function takes the field label as a second parameter defaulting to
screenshotCommand, so every existing caller is unchanged and the new one passes
its own name.

What — screenshotTemplateIssues in src/core/ui-boot.ts plus tests covering the
default label, the overridden label, and the unknown-placeholder message.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/ui-boot.ts src/core/__tests__/ui-boot.test.ts
git commit -F /tmp/geo-p3t1.msg
```

---

## Task 2: The recipe schema

**Files:**
- Modify: `src/core/consumer-config.ts`
- Test: `src/core/__tests__/consumer-config.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `src/core/__tests__/consumer-config.test.ts`:

```ts
import { UiBootRecipeSchema } from '../consumer-config.js';

const base = { verifyCommand: 'dev', route: '/dashboard' };
const shot = 'pnpm shot {url} {out} {width} {height}';
const geo = 'node scripts/geometry-capture.mjs {url} {out} {width} {height}';

describe('UiBootRecipeSchema capture commands', () => {
  it('accepts a screenshot-only recipe (unchanged behaviour)', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, screenshotCommand: shot }).success).toBe(true);
  });

  it('accepts a geometry-only recipe', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo }).success).toBe(true);
  });

  it('rejects a recipe with neither capture command', () => {
    const r = UiBootRecipeSchema.safeParse(base);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain('at least one of screenshotCommand');
    }
  });

  it('rejects a geometryCommand missing a placeholder, naming geometryCommand', () => {
    const r = UiBootRecipeSchema.safeParse({ ...base, geometryCommand: 'cap {url} {out}' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message).join(' ')).toContain('geometryCommand is missing {width}');
    }
  });

  it('defaults tolerances and budgets per family', () => {
    const r = UiBootRecipeSchema.parse({ ...base, geometryCommand: geo });
    expect(r.geometryTolerance).toEqual({ edges: 2, fontSize: 1, spacing: 1 });
    expect(r.geometryBudget).toEqual({ edges: 0, fontSize: 0, spacing: 0 });
  });

  it('accepts a partial override and fills the rest', () => {
    const r = UiBootRecipeSchema.parse({ ...base, geometryCommand: geo, geometryBudget: { edges: 2 } });
    expect(r.geometryBudget).toEqual({ edges: 2, fontSize: 0, spacing: 0 });
  });

  it('rejects a negative tolerance and a non-integer budget', () => {
    expect(
      UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, geometryTolerance: { edges: -1 } }).success,
    ).toBe(false);
    expect(
      UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, geometryBudget: { edges: 1.5 } }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts -t 'capture commands'
```

Expected output: the geometry-only case fails (`Unrecognized key(s) in object: 'geometryCommand'`) and the neither-command case fails because `screenshotCommand` is still required.

- [ ] **Step 3: Implement the schema.** In `src/core/consumer-config.ts`, replace the `screenshotCommand` field of `UiBootRecipeSchema` and extend the object:

```ts
    // Optional since the geometry lane exists: a consumer who never runs the
    // pixel lane has no screenshot tool to name, and `render-compare` reports
    // `no-boot-recipe` for a surface that omits it — the same row it already
    // emits when there is no recipe at all.
    screenshotCommand: z
      .string()
      .min(1)
      .superRefine((tpl, ctx) => {
        for (const issue of screenshotTemplateIssues(tpl, 'screenshotCommand')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }
      })
      .optional(),
    // The geometry lane's capture template: same placeholders, same quoting
    // contract, different producer — it writes a `geometryDocSchema` document
    // rather than a PNG.
    geometryCommand: z
      .string()
      .min(1)
      .superRefine((tpl, ctx) => {
        for (const issue of screenshotTemplateIssues(tpl, 'geometryCommand')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }
      })
      .optional(),
    maxDiffRatio: z.number().finite().min(0).max(1).default(0.25),
    // Rejected at validate when out of contract, never clamped (spec R2).
    captureTimeoutMs: z.number().int().min(1).max(120_000).default(60_000),
    // Per-family clustering tolerance in CSS px and unmatched-value budget.
    // Partial overrides fill from the defaults, so a consumer names only the
    // family they mean.
    geometryTolerance: z
      .object({
        edges: z.number().finite().min(0).default(2),
        fontSize: z.number().finite().min(0).default(1),
        spacing: z.number().finite().min(0).default(1),
      })
      .strict()
      .default({}),
    geometryBudget: z
      .object({
        edges: z.number().int().min(0).default(0),
        fontSize: z.number().int().min(0).default(0),
        spacing: z.number().int().min(0).default(0),
      })
      .strict()
      .default({}),
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

Keep the existing `verifyCommand`, `route`, and `page` fields above unchanged.

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts && pnpm typecheck
```

Expected output: the suite passes; typecheck reports errors wherever `UiBootRecipe.screenshotCommand` is now `string | undefined` — Step 5 fixes them.

- [ ] **Step 5: Teach `render-compare` about a screenshot-less recipe.** Making the field optional means the pixel lane can now be handed a recipe it cannot use, and it must decline that surface rather than substitute `undefined` into a command. In `src/cr/lanes/render-compare.ts`, narrow the recipe filter and add the row. Replace:

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
    // recipe at all — the field became optional when `geometryCommand` landed,
    // so the two cases get the same row with different details.
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

Then find the `substituteScreenshotCommand(job.recipe.screenshotCommand, …)` call and assert the narrowing at the job boundary — `jobs` is only ever built from `withRecipe`, so type the `SurfaceJob.recipe` field as `UiBootRecipe & { screenshotCommand: string }` and cast once where the job is pushed, exactly as the geometry lane's `SurfaceJob` does.

- [ ] **Step 6: Verify the pixel lane still behaves.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare.test.ts && pnpm typecheck
```

Expected output: the existing render-compare suite passes unchanged and typecheck is clean — the narrowing removed every `string | undefined` error.

- [ ] **Step 7: Verify the repo's own config still validates.**

```bash
pnpm noldor validate noldor-config
```

Expected output: exit 0 — this repo declares no `uiBoot`, so the new fields are inert here.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/geo-p3t2.msg <<'MSG'
feat(core): add geometryCommand and per-family knobs to the uiBoot recipe

Why — the geometry lane needs the same boot inputs render-compare needs plus a
different capture command, and restating route, verifyCommand and page in a
parallel config block would invite the two to drift. Requiring
screenshotCommand alongside it is also wrong: a consumer who never runs the
pixel lane has no screenshot tool to name, and config theatre is how a lane
becomes something people work around.

How — one recipe serves both lanes. screenshotCommand becomes optional,
geometryCommand joins it under the same quoting contract with its own field
label in the messages, and a refine requires at least one of the two so a
recipe that captures nothing is rejected rather than silently useless. The
per-family tolerance and budget records default per family and accept partial
overrides, so a consumer names only the family they mean.

What — UiBootRecipeSchema in src/core/consumer-config.ts, render-compare
declining a screenshot-less surface with no-boot-recipe rather than substituting
undefined into a command, plus tests covering screenshot-only, geometry-only,
neither, a mis-templated geometryCommand, the defaults, a partial override, and
out-of-range values.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/consumer-config.ts src/cr/lanes/render-compare.ts src/core/__tests__/consumer-config.test.ts
git commit -F /tmp/geo-p3t2.msg
```

---

## Task 3: The reference capture script

**Files:**
- Create: `templates/scripts/geometry-capture.mjs`
- Modify: `src/templates/manifest.ts`
- Test: `src/core/__tests__/templates-manifest.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `src/core/__tests__/templates-manifest.test.ts` (create it with this content if absent):

```ts
import { describe, expect, it } from 'vitest';

import { SCAFFOLD_ONLY_TEMPLATES, templateFiles } from '../../templates/manifest.js';

describe('geometry capture template', () => {
  it('ships as a template file', () => {
    expect(templateFiles()).toContain('scripts/geometry-capture.mjs');
  });

  it('is scaffold-only, never a synced twin', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has('scripts/geometry-capture.mjs')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/templates-manifest.test.ts
```

Expected output: both cases fail — the template file does not exist and the set does not contain it.

- [ ] **Step 3: Write the reference producer.** Create `templates/scripts/geometry-capture.mjs`:

```js
// Reference `geometryCommand` producer for the noldor `geometry-compare` lane.
//
// Usage: node scripts/geometry-capture.mjs <url> <out.json> <width> <height>
//
// This file is SCAFFOLDED, not synced: it is yours to edit. Add the waits, the
// login step, or the fixture seeding your app needs — `noldor init --update`
// will never overwrite it, and `checks template-sync` will never ask it to
// match the framework's copy.
//
// It requires playwright in YOUR package.json (`pnpm add -D playwright`); the
// framework ships no browser dependency. Validate the output with
// `pnpm noldor design geometry-validate <out.json> --side impl --surface <name>`.

import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const [url, out, width, height] = process.argv.slice(2);
if (!url || !out || !width || !height) {
  process.stderr.write('usage: node scripts/geometry-capture.mjs <url> <out.json> <width> <height>\n');
  process.exit(2);
}

// The element the route renders into. Change this to your app's root if it is
// not `body`'s first element child — every box is reported relative to it.
const CAPTURE_ROOT = 'body';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    // Device pixel ratio 1 is part of the document contract: the design side
    // reports CSS pixels, so a 2x capture would double every value.
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // ADD YOUR WAITS HERE — e.g. await page.getByRole('table').waitFor();

  const doc = await page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (root === null) throw new Error(`capture root '${rootSelector}' matched nothing`);
    const origin = root.getBoundingClientRect();
    const sx = window.scrollX;
    const sy = window.scrollY;
    const num = (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const nodes = [];
    const walk = (el) => {
      const style = window.getComputedStyle(el);
      // Excluded per the document contract: invisible, box-less, and
      // hidden-from-assistive-tech subtrees are not layout.
      if (style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') return;
      if (style.display === 'contents') {
        for (const child of el.children) walk(child);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // Rects are viewport-relative and scroll-affected; add the scroll back,
        // then subtract the capture root so the root sits at {0,0}.
        const box = {
          x: r.left + sx - (origin.left + sx),
          y: r.top + sy - (origin.top + sy),
          w: r.width,
          h: r.height,
        };
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        const spacing = {};
        const rowGap = num(style.rowGap);
        const columnGap = num(style.columnGap);
        if (style.rowGap !== 'normal' && rowGap !== 0) spacing.rowGap = rowGap;
        if (style.columnGap !== 'normal' && columnGap !== 0) spacing.columnGap = columnGap;
        spacing.padding = [
          num(style.paddingTop),
          num(style.paddingRight),
          num(style.paddingBottom),
          num(style.paddingLeft),
        ];
        spacing.margin = [
          num(style.marginTop),
          num(style.marginRight),
          num(style.marginBottom),
          num(style.marginLeft),
        ];
        const node = {
          name: el.id !== '' ? el.id : el.tagName.toLowerCase(),
          kind: hasText ? 'text' : el.children.length > 0 ? 'container' : 'shape',
          box,
          spacing,
        };
        if (hasText) {
          node.fontSize = num(style.fontSize);
          node.text = (el.textContent ?? '').trim().slice(0, 120);
        }
        nodes.push(node);
      }
      // An SVG root is layout; its internal geometry is paint.
      if (el.tagName.toLowerCase() === 'svg') return;
      for (const child of el.children) walk(child);
    };
    for (const child of root.children) walk(child);
    return { viewport: { width: origin.width, height: origin.height }, nodes };
  }, CAPTURE_ROOT);

  // `surface` must match the uiBoot key the lane is reviewing; the lane passes
  // it through the URL's route, so derive or hardcode it per surface.
  const surface = process.env.NOLDOR_GEOMETRY_SURFACE ?? 'app';
  await writeFile(out, JSON.stringify({ surface, ...doc }, null, 1), 'utf8');
} finally {
  await browser.close();
}
```

- [ ] **Step 4: Register it as scaffold-only.** In `src/templates/manifest.ts`, add to `SCAFFOLD_ONLY_TEMPLATES` before the closing bracket:

```ts
  // Reference `geometryCommand` producer for the geometry-compare lane. Every
  // real app adds its own waits, auth, and capture root here, so a synced twin
  // would turn each of those edits into a template-sync red.
  'scripts/geometry-capture.mjs',
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/core/__tests__/templates-manifest.test.ts && pnpm noldor checks template-sync
```

Expected output: the suite passes and `template-sync` exits 0 — a scaffold-only template is never compared against a consumer copy.

- [ ] **Step 6: Verify the script's shape without a browser.**

```bash
node --check templates/scripts/geometry-capture.mjs && node templates/scripts/geometry-capture.mjs 2>&1 | head -1
```

Expected output: `--check` prints nothing (valid ESM), and the second command prints the usage line — the argument guard runs before the playwright import resolves any browser.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p3t3.msg <<'MSG'
feat(templates): ship a reference geometryCommand capture script

Why — the geometry document is far more involved to produce than a screenshot:
the capture root has to be subtracted, scroll offsets added back, device pixel
ratio pinned to 1, zero spacing sides dropped, and font size restricted to
text-bearing elements. Shipping only the schema would leave every consumer to
re-derive that DOM walk, each getting it subtly differently, which is an
adoption blocker for a lane whose whole value is a trustworthy noise floor.

How — a documented Playwright walk landed by init at scripts/geometry-capture.mjs
and registered as scaffold-only rather than a synced twin, because every real
app needs its own waits, auth steps and capture root there and a twin would turn
each of those edits into a template-sync failure. The browser dependency stays
in the consumer's package.json; the framework ships none.

What — templates/scripts/geometry-capture.mjs, its SCAFFOLD_ONLY_TEMPLATES
entry, and tests asserting it ships as a template and is never synced.

Noldor-FD: ui-design-review-lane
MSG
git add templates/scripts/geometry-capture.mjs src/templates/manifest.ts src/core/__tests__/templates-manifest.test.ts
git commit -F /tmp/geo-p3t3.msg
```
