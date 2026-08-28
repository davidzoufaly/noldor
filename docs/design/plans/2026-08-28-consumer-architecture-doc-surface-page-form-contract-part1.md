# Architecture Page Form Contract (Part 1: Section Presence) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `noldor docs architecture --check` names which registry sections a page is missing, and this repo's own four pages conform — all advisory, `status` untouched.
**Architecture:** A new pure module `src/docs/architecture-form.ts` answers "what does this page body violate"; `docs-architecture.ts` widens `ModuleAdvisory` into a discriminated `ArchitectureAdvisory` and calls it only for pages the blocking rules already accept; `garden/detectors/architecture.ts` derives `itemId` per variant. Part 2 adds the written decline marker and the templates; part 3 adds the prose budgets.
**Tech Stack:** TypeScript (ESNext, `as const satisfies`), vitest, existing helpers `listHeadings` (`src/utils/markdown-sections.ts`) and `stripCodeRegions` (`src/docs/docs-check.ts`).

---

## File Structure

- `src/docs/architecture-schema.ts` — MODIFY: add `sections` to `ArchitecturePage`; re-declare `ARCHITECTURE_PAGES` `as const satisfies readonly ArchitecturePage[]` so `ArchitecturePageId` narrows to the four literals.
- `src/docs/architecture-form.ts` — CREATE: pure form rules over a page body — section presence and flow heading count. No filesystem, no advisory shape. Part 2 adds cut parsing here.
- `src/docs/docs-architecture.ts` — MODIFY: widen the advisory type; call the form module for accepted pages; print the new rows with their fix.
- `src/garden/detectors/architecture.ts` — MODIFY: per-variant `itemId` so two advisory rows on one page cannot collide.
- `docs/architecture/context.md` — MODIFY: dogfood re-heading.
- `docs/architecture/containers.md` — MODIFY: dogfood re-heading.
- `docs/architecture/modules.md` — MODIFY: dogfood re-heading.
- `src/docs/__tests__/architecture-form.test.ts` — CREATE: unit tests for every form rule.
- `src/docs/__tests__/docs-architecture.test.ts` — MODIFY: advisory gating and union shape over a fixture repo.
- `src/garden/detectors/__tests__/architecture.test.ts` — MODIFY: per-variant id cases.

---

## Task 1: Registry carries the section sets

**Files:**
- Modify: `src/docs/architecture-schema.ts`
- Test: `src/docs/__tests__/docs-architecture.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/docs/__tests__/docs-architecture.test.ts`, inside the top-level `describe` block for the schema (create the block if the file has none — put it directly after the imports):

```ts
describe('ARCHITECTURE_PAGES sections', () => {
  it('carries bare section names, no "## " prefix', () => {
    const byId = Object.fromEntries(ARCHITECTURE_PAGES.map((p) => [p.id, p.sections]));
    expect(byId.context).toStrictEqual(['Actors', 'Externals', 'Boundary']);
    expect(byId.containers).toStrictEqual(['Runnable units', 'Durable state', 'Topology']);
    expect(byId.modules).toStrictEqual(['Dependency direction', 'State ownership']);
    expect(byId.flows).toStrictEqual([]);
  });

  it('never stores a rendered heading', () => {
    for (const page of ARCHITECTURE_PAGES) {
      for (const section of page.sections) {
        expect(section.startsWith('#'), `${page.id}/${section}`).toBeFalsy();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/docs-architecture.test.ts -t 'ARCHITECTURE_PAGES sections'
```

Expected output: two failures, both `TS`/runtime errors of the form `Property 'sections' does not exist on type 'ArchitecturePage'` (or `expected undefined to strictly equal [ 'Actors', ... ]` if the type error is not surfaced by the runner).

- [ ] **Step 3: Add the field to the interface.** In `src/docs/architecture-schema.ts`, inside `export interface ArchitecturePage`, after the `purpose` field:

```ts
  /**
   * H2 headings the page must carry, stored **bare** — `'Actors'`, never
   * `'## Actors'`. One representation: the templates render the `## ` and the
   * advisory messages and cut markers quote the bare name, so the prefix is
   * never stripped at two sites that then drift.
   *
   * An empty array is the `flows` sentinel: "at least one H2, names
   * unconstrained" rather than "nothing to check". The page's natural shape is
   * one section per flow, so no fixed set exists that does not lie about it —
   * and expressing the exemption as a registry value rather than a page id in
   * the checker is what keeps this list the full description of a page.
   *
   * Order is what the templates render, not what the check enforces: presence
   * is checked, order is not.
   */
  readonly sections: readonly string[];
```

- [ ] **Step 4: Fill in each page's set and narrow the registry type.** In the same file, add a `sections` entry to each of the four objects in `ARCHITECTURE_PAGES` and change its declaration. The declaration line becomes:

```ts
export const ARCHITECTURE_PAGES = [
```

each page object gains its set:

```ts
  {
    id: 'context',
    title: 'Context',
    purpose: 'The system, its actors, and the externals it talks to.',
    allowedKinds: ['flowchart', 'graph', 'c4context'],
    sections: ['Actors', 'Externals', 'Boundary'],
  },
  {
    id: 'containers',
    title: 'Containers',
    purpose:
      'Deployable and runnable units — frontend app, backend service, database, worker, CLI, infrastructure.',
    allowedKinds: ['flowchart', 'graph', 'c4container'],
    sections: ['Runnable units', 'Durable state', 'Topology'],
  },
  {
    id: 'modules',
    title: 'Modules',
    purpose: 'Internal dependency direction, and which module owns which durable state.',
    allowedKinds: ['flowchart', 'graph', 'classdiagram'],
    sections: ['Dependency direction', 'State ownership'],
  },
  {
    id: 'flows',
    title: 'Flows',
    purpose: 'The two or three load-bearing runtime flows, end to end.',
    allowedKinds: ['sequencediagram'],
    sections: [],
  },
```

and the closing line becomes:

```ts
] as const satisfies readonly ArchitecturePage[];
```

`as const satisfies` rather than the previous `: readonly ArchitecturePage[]` annotation: the annotation widened every `id` to `string`, so `ArchitecturePageId` — derived as `(typeof ARCHITECTURE_PAGES)[number]['id']` — was `string` and a page-id typo in a caller typechecked clean. `satisfies` keeps the shape checked against the interface while `as const` preserves the four literals.

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/docs/__tests__/docs-architecture.test.ts -t 'ARCHITECTURE_PAGES sections'
```

Expected output: `2 passed`.

- [ ] **Step 6: Verify the id union actually narrowed.** Write a throwaway probe and typecheck it:

```bash
cat > src/probe-arch-id.ts <<'EOF'
import type { ArchitecturePageId } from './docs/architecture-schema.js';
const bogus: ArchitecturePageId = 'not-a-page';
void bogus;
EOF
pnpm typecheck 2>&1 | grep probe-arch-id
rm src/probe-arch-id.ts
```

Expected output: a line naming `src/probe-arch-id.ts` with `error TS2322: Type '"not-a-page"' is not assignable to type '"context" | "containers" | "modules" | "flows"'`. Before Step 4 this probe typechecked clean — that is the whole point of the change. Delete the probe before committing; the `rm` above does it.

- [ ] **Step 7: Verify nothing else broke.**

```bash
pnpm typecheck && pnpm vitest run src/docs
```

Expected output: typecheck clean, and every test in `src/docs` passing. A failure here means an existing caller relied on the mutable array type — fix by reading, not by reverting Step 4.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/arch-form-t1.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): carry section sets in the architecture registry

Why — `docs/architecture/`'s four pages are checked for presence, a mermaid
fence and an allowed diagram kind, but nothing describes what belongs *inside*
a page. The pages drift into narrative prose and across C4 levels while passing
every check, so the surface stops being the terse reading it exists to give.

How — `ArchitecturePage` gains a `sections` field holding bare H2 names, so the
registry stays the single description of a page: the validator, the garden
detector, the SDD gap and the release probe already read this one list. The
`flows` page carries an empty array as a sentinel, because its natural shape is
one section per flow and no fixed set would be honest. The registry is
re-declared `as const satisfies` so `ArchitecturePageId` stops widening to
`string`.

What — `sections` on the interface and on all four registry entries, the
declaration narrowed, and tests pinning the bare-name representation.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/architecture-schema.ts src/docs/__tests__/docs-architecture.test.ts
git commit -F /tmp/arch-form-t1.msg
```

---

## Task 2: Section presence and the flows sentinel

**Files:**
- Create: `src/docs/architecture-form.ts`
- Test: `src/docs/__tests__/architecture-form.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/docs/__tests__/architecture-form.test.ts`:

```ts
// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { assessPageForm } from '../architecture-form.js';

const CONTEXT = { id: 'context', sections: ['Actors', 'Externals', 'Boundary'] } as const;
const FLOWS = { id: 'flows', sections: [] } as const;

describe(assessPageForm, () => {
  it('reports nothing when every section is present', () => {
    const body = '## Actors\n\na\n\n## Externals\n\nb\n\n## Boundary\n\nc\n';
    expect(assessPageForm(CONTEXT, body)).toStrictEqual({ missing: [], flowHeadings: null });
  });

  it('ignores section order and extra headings', () => {
    const body = '## Boundary\n\nc\n\n## Mine\n\nx\n\n## Actors\n\na\n\n## Externals\n\nb\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual([]);
  });

  it('matches a heading case-insensitively', () => {
    const body = '## actors\n## EXTERNALS\n## Boundary\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual([]);
  });

  it('names a missing section, in registry order', () => {
    expect(assessPageForm(CONTEXT, '## Externals\n\nb\n').missing).toStrictEqual([
      'Actors',
      'Boundary',
    ]);
  });

  it('does not see a heading inside a tilde fence', () => {
    const body = '## Actors\n\n## Externals\n\n~~~markdown\n## Boundary\n~~~\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual(['Boundary']);
  });

  it('does not see an H3 as a section', () => {
    const body = '## Actors\n## Externals\n### Boundary\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual(['Boundary']);
  });

  it('counts headings instead of names on an empty-sections page', () => {
    expect(assessPageForm(FLOWS, '## The gate flow\n\n## The release flow\n').flowHeadings).toBe(2);
    expect(assessPageForm(FLOWS, '## Only one\n').flowHeadings).toBe(1);
    expect(assessPageForm(FLOWS, 'no headings at all\n').flowHeadings).toBe(0);
  });

  it('never reports a missing section on an empty-sections page', () => {
    expect(assessPageForm(FLOWS, 'nothing here\n').missing).toStrictEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts
```

Expected output: the suite fails to collect — `Failed to load .../architecture-form.js` / `Cannot find module '../architecture-form.js'`.

- [ ] **Step 3: Implement.** Create `src/docs/architecture-form.ts`:

```ts
// @fd: consumer-architecture-doc-surface
/**
 * Pure form rules over one architecture page body.
 *
 * Nothing here reads the filesystem or knows the advisory shape — it answers
 * only "what does this body violate", so `docs-architecture.ts` owns the IO
 * boundary and the reporting shape exactly as it does for the blocking rules.
 */
import { listHeadings } from '../utils/markdown-sections.js';

/** The registry facts this module needs. Structural, so a test fixture need not build a whole page. */
export interface FormPage {
  readonly id: string;
  readonly sections: readonly string[];
}

/** What one page body violates. Nothing here is an advisory yet. */
export interface PageForm {
  /** Registry sections the page does not carry as an H2, in registry order. */
  readonly missing: readonly string[];
  /** H2 count, on an empty-`sections` page only. `null` elsewhere. */
  readonly flowHeadings: number | null;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Every H2 on the page, including repeats — two identically-named flows are two badly-named flows. */
function h2s(body: string): string[] {
  return listHeadings(body)
    .filter((h) => h.depth === 2)
    .map((h) => h.name);
}

/**
 * Assess one page body against its registry sections.
 *
 * Presence is heading-presence: the check asks whether the H2 exists, not
 * whether anything was written beneath it. No string test separates real prose
 * from plausible prose, so a check that guessed would be arguable exactly where
 * it matters — the claim is that the page's *questions* are on the page.
 *
 * Order is not checked and extra headings pass: order is what the templates
 * render, and making a consumer's editorial judgment a finding buys nothing.
 *
 * Heading scanning goes through `listHeadings`, the repo's one fully fence-aware
 * scanner, so a `## Boundary` inside a tilde fence or a long backtick run does
 * not count — and an H3 is not a section.
 *
 * An empty `sections` array is the `flows` sentinel: there is no set to check
 * names against, so the page is measured by heading *count* instead. The page's
 * natural shape is one section per flow, and one is a legitimate answer.
 *
 * @param page - Registry id and section set
 * @param body - Raw markdown
 */
export function assessPageForm(page: FormPage, body: string): PageForm {
  const present = new Set(h2s(body).map(norm));
  if (page.sections.length === 0) {
    return { missing: [], flowHeadings: h2s(body).length };
  }
  return { missing: page.sections.filter((s) => !present.has(norm(s))), flowHeadings: null };
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts
```

Expected output: `8 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/arch-form-t2.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): assess section presence and the flows sentinel

`assessPageForm` answers what one page body violates: which registry sections it
does not carry as an H2, and — on a page whose `sections` is empty — how many
H2s it has.

Presence is heading-presence only. Nothing separates real prose from plausible
prose, so the contract's claim is narrowed to "the questions are on the page".
Order is not checked and extra headings pass, because order is what the
templates render rather than what the check enforces.

Heading scanning goes through `listHeadings` rather than a fourth hand-rolled
scan, so a heading inside a tilde fence or a long backtick run does not count.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/architecture-form.ts src/docs/__tests__/architecture-form.test.ts
git commit -F /tmp/arch-form-t2.msg
```

---

## Task 3: Widen the advisory type

**Files:**
- Modify: `src/docs/docs-architecture.ts`
- Test: `src/docs/__tests__/docs-architecture.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/docs/__tests__/docs-architecture.test.ts`:

```ts
describe('advisory union', () => {
  it('carries a registry page id and a repo-relative path on every row', async () => {
    const root = await makeRepo();
    await writeArchitecture(root, {
      context: '# Context\n\n```mermaid\nflowchart LR\n  a --> b\n```\n',
      containers: fullPage('containers'),
      modules: fullPage('modules'),
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    const section = report.advisories.find((a) => a.kind === 'section');
    expect(section).toMatchObject({
      kind: 'section',
      pageId: 'context',
      page: 'docs/architecture/context.md',
    });
    expect(report.status).toBe('ok');
  });

  it('leaves status untouched when only advisories fire', async () => {
    const root = await makeRepo();
    await writeArchitecture(root, {
      context: '# Context\n\n```mermaid\nflowchart LR\n  a --> b\n```\n',
      containers: fullPage('containers'),
      modules: fullPage('modules'),
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    expect(report.findings).toStrictEqual([]);
    expect(report.status).toBe('ok');
  });
});
```

Add these two helpers above the new block, beside the existing `makeRepo`:

```ts
/** Write all four architecture pages into a fixture repo. */
async function writeArchitecture(root: string, pages: Record<string, string>): Promise<void> {
  const dir = join(root, 'docs', 'architecture');
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Object.entries(pages).map(([id, body]) => writeFile(join(dir, `${id}.md`), body, 'utf8')),
  );
}

/** A page that satisfies every blocking rule AND every section rule. */
function fullPage(id: string): string {
  const page = ARCHITECTURE_PAGES.find((p) => p.id === id)!;
  const kind = page.allowedKinds[0]!;
  const fence =
    kind === 'sequencediagram'
      ? '```mermaid\nsequenceDiagram\n  actor U\n  U->>S: go\n```'
      : `\`\`\`mermaid\n${kind} LR\n  a --> b\n\`\`\``;
  const heads =
    page.sections.length > 0
      ? page.sections.map((s) => `## ${s}\n\nprose.\n`).join('\n')
      : '## First flow\n\nprose.\n\n## Second flow\n\nprose.\n';
  return `# ${page.title}\n\n${heads}\n${fence}\n`;
}
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/docs-architecture.test.ts -t 'advisory union'
```

Expected output: the first case fails — `expected undefined to match object { kind: 'section', ... }`, because `checkArchitecture` still produces only module advisories.

- [ ] **Step 3: Replace the advisory type.** In `src/docs/docs-architecture.ts`, replace the whole `export interface ModuleAdvisory { … }` block with:

```ts
/**
 * Shared fields on every advisory row.
 *
 * The page is carried twice on purpose: `pageId` is the registry id, so a
 * construction site cannot invent a page, while `page` stays the repo-relative
 * label the module rows already print.
 */
interface AdvisoryBase {
  readonly pageId: ArchitecturePageId;
  /** Repo-relative path, POSIX separators. */
  readonly page: string;
  readonly message: string;
}

/**
 * A non-blocking observation about a page.
 *
 * Advisory by design: none of these reach `status`, so none reaches the release
 * probe. Keeping that promise also constrains how they may be reported —
 * routing them into garden's `sddGaps` would gate the auto-restamp and block a
 * release, so they ride their own `GardenFindings` key. See
 * `src/garden/detectors/architecture.ts`.
 *
 * One discriminated channel rather than an array per class: its only consumer
 * (`src/garden/garden-detect.ts`) reads one array today, and a second array
 * would make every future consumer enumerate classes.
 */
export type ArchitectureAdvisory =
  | (AdvisoryBase & { readonly kind: 'module'; readonly module: string })
  | (AdvisoryBase & { readonly kind: 'section'; readonly section: string })
  | (AdvisoryBase & { readonly kind: 'flow-headings'; readonly count: number });
```

Add `ArchitecturePageId` to the schema import at the top of the file:

```ts
import {
  ARCHITECTURE_PAGES,
  PLACEHOLDER_MARKER,
  pageFilename,
  type ArchitecturePageId,
} from './architecture-schema.js';
```

and change `ArchitectureReport`'s advisory field to:

```ts
  readonly advisories: readonly ArchitectureAdvisory[];
```

- [ ] **Step 4: Give the module rows their new fields.** In `collectModuleAdvisories`, the `reads` parameter type must carry the page id, so change its signature and mapper:

```ts
async function collectModuleAdvisories(
  cwd: string,
  reads: readonly { page: { id: ArchitecturePageId }; label: string; read: PageRead }[],
): Promise<ArchitectureAdvisory[]> {
  const modulesPage = reads.find((r) => r.page.id === 'modules');
  if (!modulesPage?.read.ok) return [];
  const body = modulesPage.read.body;
  const label = modulesPage.label;
  return (await listModuleDirs(cwd))
    .filter((module) => !mentionsModule(body, module))
    .map((module) => ({
      kind: 'module' as const,
      pageId: modulesPage.page.id,
      page: label,
      module,
      message: `${label} does not name ${module}`,
    }));
}
```

- [ ] **Step 5: Run to verify the type change compiles and module rows still work.**

```bash
pnpm typecheck && pnpm vitest run src/docs src/garden
```

Expected output: typecheck clean. Test failures are expected here — `src/garden/detectors/__tests__/architecture.test.ts` builds `ModuleAdvisory` literals without `kind`/`pageId` and will fail; Task 5 fixes it. Any failure in `src/docs` other than the still-unimplemented `advisory union` block is a real regression — read it before continuing.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/arch-form-t3.msg <<'EOF'
refactor(docs:consumer-architecture-doc-surface): widen ModuleAdvisory to a discriminated union

`ModuleAdvisory` carried a `module` field that a section or flow-heading row has
no value for. It becomes `ArchitectureAdvisory`, discriminated on `kind`, so the
new form rows ride the same channel its only consumer already reads rather than
a second parallel array.

Every row now carries `pageId` as well as `page`: the registry id makes an
invented page a type error, while the repo-relative label stays what gets
printed. Module rows are unchanged in behaviour.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/docs-architecture.ts src/docs/__tests__/docs-architecture.test.ts
git commit -F /tmp/arch-form-t3.msg
```

---

## Task 4: Garden per-variant item ids

**Files:**
- Modify: `src/garden/detectors/architecture.ts`
- Test: `src/garden/detectors/__tests__/architecture.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/garden/detectors/__tests__/architecture.test.ts`, replace the `advisories` array in the `report` factory with one row of each kind, and add a new block:

```ts
  advisories: [
    {
      kind: 'module',
      pageId: 'modules',
      page: 'docs/architecture/modules.md',
      module: 'src/unnamed',
      message: 'docs/architecture/modules.md does not name src/unnamed',
    },
    {
      kind: 'section',
      pageId: 'context',
      page: 'docs/architecture/context.md',
      section: 'Boundary',
      message: 'docs/architecture/context.md does not name section "Boundary"',
    },
    {
      kind: 'flow-headings',
      pageId: 'flows',
      page: 'docs/architecture/flows.md',
      count: 0,
      message: 'docs/architecture/flows.md names no flow as a heading',
    },
  ],
```

```ts
describe('advisory item ids', () => {
  it('gives every variant a distinct id', () => {
    const ids = toAdvisoryGaps(report()).map((g) => g.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never renders an undefined discriminator', () => {
    for (const gap of toAdvisoryGaps(report())) {
      expect(gap.itemId, gap.message).not.toContain('undefined');
    }
  });

  it('keeps the module row id stable', () => {
    const ids = toAdvisoryGaps(report()).map((g) => g.itemId);
    expect(ids).toContain('docs/architecture/modules.md#module:src/unnamed');
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/garden/detectors/__tests__/architecture.test.ts
```

Expected output: `never renders an undefined discriminator` and `gives every variant a distinct id` fail — ids read `docs/architecture/context.md#undefined` for every non-module row, so the two non-module rows also collide.

- [ ] **Step 3: Implement the discriminator.** In `src/garden/detectors/architecture.ts`, replace `toAdvisoryGaps` and the advisory half of `gapsFrom` with:

```ts
/** Module advisories as gaps. Never routed into `sddGaps` — see {@link toFindingGaps}. */
export function toAdvisoryGaps(report: ArchitectureReport): Gap[] {
  if (report.status === 'absent') return [];
  return report.advisories.map((advisory) => ({
    category: 'architecture',
    itemId: `${advisory.page}#${advisoryDiscriminator(advisory)}`,
    message: advisory.message,
  }));
}

/**
 * Stable per-row identity, prefixed by `kind` so two variants cannot collide on
 * one page.
 *
 * Every variant contributes something that distinguishes it from its siblings, so
 * a repeated run produces no duplicates — the promise this file documents. Part
 * 2's `unknown-cut` variant adds an ordinal here for the same reason.
 */
function advisoryDiscriminator(advisory: ArchitectureAdvisory): string {
  switch (advisory.kind) {
    case 'module':
      return `module:${advisory.module}`;
    case 'section':
      return `section:${advisory.section}`;
    case 'flow-headings':
      return 'flow-headings';
  }
}
```

Update the imports at the top of the file to:

```ts
import {
  checkArchitecture,
  type ArchitectureAdvisory,
  type ArchitectureReport,
} from '../../docs/docs-architecture.js';
```

Leave `toFindingGaps` and the shared `gapsFrom` alone if `toFindingGaps` still uses it; if `gapsFrom` now has exactly one caller, inline it into `toFindingGaps` rather than keeping a one-caller generic.

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/garden/detectors/__tests__/architecture.test.ts
```

Expected output: every case passes, including the four new ones.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/arch-form-t4.msg <<'EOF'
fix(garden): derive architecture advisory ids per variant

`toAdvisoryGaps` keyed `itemId` on `a.module`, which every non-module row lacks
— so a section or flow-heading row rendered as `<page>#undefined`, and two such
rows on one page collapsed into a single gap. That breaks the stable-identity
promise this file documents.

The discriminator is now derived per `kind` and prefixed with it, so two
variants cannot collide on one page.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/garden/detectors/architecture.ts src/garden/detectors/__tests__/architecture.test.ts
git commit -F /tmp/arch-form-t4.msg
```

---

## Task 5: Wire the form rules into the checker

**Files:**
- Modify: `src/docs/docs-architecture.ts`
- Test: `src/docs/__tests__/docs-architecture.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/docs/__tests__/docs-architecture.test.ts`:

```ts
describe('advisory gating', () => {
  it('suppresses form rows on a page carrying a blocking finding', async () => {
    const root = await makeRepo();
    await writeArchitecture(root, {
      // No fence AND no sections: the blocking rule wins, the form rows stay silent.
      context: '# Context\n\nprose only.\n',
      containers: fullPage('containers'),
      modules: fullPage('modules'),
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    expect(report.findings.map((f) => f.rule)).toStrictEqual(['no-fence']);
    expect(report.advisories.filter((a) => a.page.endsWith('context.md'))).toStrictEqual([]);
  });

  it('still emits module rows for a readable placeholder modules page', async () => {
    const root = await makeRepo();
    await mkdir(join(root, 'src', 'onlymodule'), { recursive: true });
    await writeArchitecture(root, {
      context: fullPage('context'),
      containers: fullPage('containers'),
      modules: `# Modules\n\n${PLACEHOLDER_MARKER} draw it -->\n\n\`\`\`mermaid\nflowchart TD\n  a --> b\n\`\`\`\n`,
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    expect(report.findings.some((f) => f.rule === 'placeholder')).toBe(true);
    expect(report.advisories.some((a) => a.kind === 'module')).toBe(true);
  });

  it('emits no advisories at all for an absent surface', async () => {
    const root = await makeRepo();
    const report = await checkArchitecture(root);
    expect(report.status).toBe('absent');
    expect(report.advisories).toStrictEqual([]);
  });
});
```

Import `PLACEHOLDER_MARKER` alongside `ARCHITECTURE_PAGES` at the top of the test file.

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/docs-architecture.test.ts -t 'advisory gating'
```

Expected output: the first case fails — `expected [] to strictly equal []` passes trivially only once the rows exist, so the observable failure is in the `advisory union` block from Task 4 (`expected undefined to match object`). Both blocks go green together in Step 4.

- [ ] **Step 3: Collect the form advisories.** In `src/docs/docs-architecture.ts`, add above `collectModuleAdvisories`:

```ts
/**
 * Form advisories for the pages the blocking rules accepted.
 *
 * Gated deliberately: a page that is missing, unreadable, still scaffolded or
 * undrawable produces its blocking finding and nothing else. Piling advisory
 * rows onto a page whose real problem is that it does not exist yet is how the
 * channel loses its reader.
 *
 * Module advisories are NOT gated this way and are collected separately —
 * `collectModuleAdvisories` skips only an unreadable modules page, so a readable
 * placeholder page emits its module rows today. That is shipped behaviour and
 * gating it here would silently delete rows a consumer already sees.
 */
function collectFormAdvisories(
  reads: readonly {
    page: (typeof ARCHITECTURE_PAGES)[number];
    label: string;
    read: PageRead;
  }[],
  blocked: ReadonlySet<string>,
): ArchitectureAdvisory[] {
  const out: ArchitectureAdvisory[] = [];
  for (const { page, label, read } of reads) {
    if (!read.ok || blocked.has(page.id)) continue;
    const form = assessPageForm(page, read.body);

    for (const section of form.missing) {
      out.push({
        kind: 'section',
        pageId: page.id,
        page: label,
        section,
        message: `${label} does not name section "${section}" — add a \`## ${section}\` heading.`,
      });
    }

    if (form.flowHeadings !== null && form.flowHeadings < 1) {
      out.push({
        kind: 'flow-headings',
        pageId: page.id,
        page: label,
        count: form.flowHeadings,
        message: `${label} names no flow as a heading — give each load-bearing flow its own \`## \` section.`,
      });
    }
  }
  return out;
}
```

Add to the file's imports:

```ts
import { assessPageForm } from './architecture-form.js';
```

- [ ] **Step 4: Call it from `checkArchitecture`.** In `checkArchitecture`, the findings loop already builds `findings`; record which pages were blocked as it goes. Immediately after the `for (const { page, label, read } of reads) { … }` loop that fills `findings`, and before the existing `const advisories = await collectModuleAdvisories(cwd, reads);` line, insert:

```ts
  // A page is blocked when any rule fired for it — that page's form rows stay silent.
  const blocked = new Set(
    reads.filter((r) => findings.some((f) => f.page === r.label)).map((r) => r.page.id),
  );
```

then change the advisories line to:

```ts
  const advisories = [
    ...(await collectModuleAdvisories(cwd, reads)),
    ...collectFormAdvisories(reads, blocked),
  ];
```

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/docs
```

Expected output: every test in `src/docs` passes, including the `advisory union` and `advisory gating` blocks.

- [ ] **Step 6: Confirm the release probe is untouched.**

```bash
pnpm vitest run src/release
```

Expected output: all passing. The `architecture` preflight row reads `status`, which no advisory reaches — this run is what proves it.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/arch-form-t5.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): report missing sections as advisories

`checkArchitecture` now reports, for every page the blocking rules accept, the
registry sections it neither names nor validly declines, the cut markers that
name nothing in its set, and a flows page that names no flow as a heading. Each
message carries its own fix.

None of it reaches `status`, so the release probe and the garden auto-restamp
are untouched: the blocking class stays exactly the presence rules the surface
shipped with. Form rows are suppressed for a page that already carries a
blocking finding, while module rows keep their existing behaviour — a readable
placeholder modules page still emits them.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/docs-architecture.ts src/docs/__tests__/docs-architecture.test.ts
git commit -F /tmp/arch-form-t5.msg
```

---

## Task 6: Dogfood this repo's pages

**Files:**
- Modify: `docs/architecture/context.md`, `docs/architecture/containers.md`, `docs/architecture/modules.md`

- [ ] **Step 1: See what the new check says about this repo.**

```bash
pnpm noldor docs architecture --check
```

Expected output: exit 0, with advisory lines naming `context.md` missing `Actors` / `Externals` / `Boundary`, `containers.md` missing `Runnable units` / `Durable state` / `Topology`, and `modules.md` missing `Dependency direction` / `State ownership`. `flows.md` produces none — it already carries two H2s, which satisfies the sentinel. Copy this list; Step 5 asserts it becomes empty.

- [ ] **Step 2: Re-head `docs/architecture/context.md`.** The page has no H2s today. Keep every paragraph and the diagram exactly as they are; insert `## Actors` before the paragraph beginning "Two kinds of actor drive it", `## Externals` before "It depends on four externals", and `## Boundary` before the closing paragraph "The boundary worth naming". The opening paragraph ("Noldor is a discipline framework…") stays above the first heading as the page's lede, and the mermaid fence stays where it is.

- [ ] **Step 3: Re-head `docs/architecture/containers.md`.** Insert `## Runnable units` before the paragraph beginning "**The CLI**", `## Durable state` before the paragraph beginning "**`.noldor/`** is the durable state", and `## Topology` before the closing paragraph "There is no deployment topology to draw". The opening paragraph and the mermaid fence stay put.

- [ ] **Step 4: Re-head `docs/architecture/modules.md`.** Rename the existing `## The diagram` to `## Dependency direction` and `## Who owns what durable state` to `## State ownership`. No prose moves.

- [ ] **Step 5: Run to verify the advisories are gone.**

```bash
pnpm noldor docs architecture --check
```

Expected output: exit 0 and no `advisory:` line mentioning a section — only `architecture: 4 page(s) OK.` plus any pre-existing module advisories, which this task does not touch.

- [ ] **Step 6: Verify the pages still pass every blocking rule and the suite is green.**

```bash
pnpm typecheck && pnpm test && pnpm noldor validate features
```

Expected output: typecheck clean, full suite passing, features valid.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/arch-form-t6.msg <<'EOF'
docs(architecture): re-head the four pages to the registry sections

The surface is dogfooded, so this repo's own pages adopt the contract they now
carry. Every paragraph and diagram is unchanged — the work is entirely
re-heading, which is itself the evidence the section sets describe pages someone
already wrote without them.

`context.md` gains Actors / Externals / Boundary, promoting its closing
boundary paragraph from the page's least findable fact to a named section.
`containers.md` gains Runnable units / Durable state / Topology, whose answer
here is that there is no deployment topology to draw. `modules.md` renames its
two existing headings. `flows.md` already conformed.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add docs/architecture
git commit -F /tmp/arch-form-t6.msg
```
