# Geometry Compare Lane — Part 5: The `geometry-compare` Lane Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `crLanes.code: ["reviewer", "geometry-compare"]` runs a real lane: it resolves the affected surfaces, boots the app once per `verifyCommand` group, compares each surface, persists evidence whose report names the nodes behind every unmatched value, and writes a standard lane sink. Orchestrate runs it code-only, never short-circuits it on an empty delta, and chains it after `verifier` and `render-compare`.
**Architecture:** The lane is a thin shell. `openDesignReviewRound` opens the round with `geometryCompareMode`; part 3's `forEachBootedSurface` supplies booted, probed URLs; part 4's `extractDesignDocs` reads every surface's design in one dispatch before any boot and `compareSurfaceGeometry` compares each booted surface; `aggregateOutcomes` picks the verdict. New here: a pure report builder that maps each unmatched value back to its producing nodes by re-scanning that side's document, a severity derived per family (`FamilyOutcome` carries none), the `CANONICAL_LANES` literal landing with its runner, and a sequential boot chain in orchestrate.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** part 1 (recipe fields), part 2 (`setGeometryExtractDispatcher`, the `geometry-extract` role), part 3 (`geometryCompareMode` and the mode-key type, the six reason codes, `swapRoundArtifacts`, `forEachBootedSurface`, `BootProbeDeps`, `AggregableOutcome`) and part 4 (`extractDesignDocs`, `compareSurfaceGeometry`, `setGeometryReviewDeps`).

---

## File Structure

- `src/cr/geometry/geometry-report.ts` — `buildSurfaceReport`, `familySeverity`, `nodeLabel` (Create).
- `src/core/lanes.ts` — `geometry-compare` in `CANONICAL_LANES` (Modify).
- `src/cr/lanes/geometry-compare.ts` — `runGeometryCompare`, `setGeometryCompareDeps` (Create).
- `src/cr/orchestrate.ts` — `LANES` entry, `NO_DELTA_SHORTCIRCUIT`, `CODE_ONLY_LANES`, and the `BOOTING_LANES` chain replacing the verifier → render-compare special case (Modify).
- `.noldor/indirection-baseline.json` — re-recorded in its own commit if the new import edges raise it (Modify).
- Tests: `src/cr/__tests__/geometry/geometry-report.test.ts` (Create), `src/cr/__tests__/lanes/geometry-compare.test.ts` (Create), `src/cr/__tests__/lanes/geometry-registration.test.ts` (Modify), `src/cr/__tests__/orchestrate.test.ts` (Modify).

---

## Task 1: The evidence report and the severity rule

**Files:**
- Create: `src/cr/geometry/geometry-report.ts`
- Test: `src/cr/__tests__/geometry/geometry-report.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-report.test.ts`:

```ts
// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { compareGeometry, DEFAULT_BUDGET, DEFAULT_TOLERANCE } from '../../geometry/geometry-compare-core.js';
import type { GeometryDoc } from '../../geometry/geometry-doc.js';
import { buildSurfaceReport, familySeverity, nodeLabel } from '../../geometry/geometry-report.js';

const design: GeometryDoc = {
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [
    { kind: 'container', name: 'Card', box: { x: 24, y: 0, w: 100, h: 40 }, spacing: { padding: [16, 16, 16, 16] } },
    { kind: 'text', box: { x: 40, y: 8, w: 60, h: 20 }, fontSize: 14, text: 'Revenue' },
  ],
};
const impl: GeometryDoc = {
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [
    { kind: 'container', name: 'Card', box: { x: 30, y: 0, w: 100, h: 40 } },
    { kind: 'container', name: 'Wrapper', box: { x: 30, y: 0, w: 100, h: 40 } },
    { kind: 'text', box: { x: 40, y: 8, w: 60, h: 20 }, fontSize: 14, text: 'Revenue' },
  ],
};

describe('buildSurfaceReport', () => {
  const cmp = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
  const report = buildSurfaceReport('dashboard', design, impl, cmp);

  it('names every node that produced an unmatched value, on its own side', () => {
    const at30 = report.unmatched.find((u) => u.family === 'edgesX' && u.value === 30);
    expect(at30?.side).toBe('impl');
    expect(at30?.nodes.map((n) => n.name)).toEqual(['Card', 'Wrapper']);
    const at24 = report.unmatched.find((u) => u.family === 'edgesX' && u.value === 24);
    expect(at24?.side).toBe('design');
    expect(at24?.nodes).toEqual([
      { name: 'Card', kind: 'container', box: { x: 24, y: 0, w: 100, h: 40 } },
    ]);
  });

  it('maps a spacing value back to the frame that declared it', () => {
    const spacing = report.unmatched.filter((u) => u.family === 'spacing');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]).toMatchObject({ side: 'design', value: 16 });
    expect(spacing[0].nodes.map((n) => n.name)).toEqual(['Card']);
  });

  it('carries every value per side and the per-family outcome', () => {
    expect(report.values.design.fontSize).toEqual([14]);
    expect(report.values.impl.edgesX).toEqual([30, 130, 30, 130, 40, 100]);
    expect(report.families.edgesX.unmatched).toBe(4);
    expect(report.verdict).toBe('fail');
  });
});

describe('familySeverity / nodeLabel', () => {
  it('is med for 1–2 unmatched values and high for 3 or more', () => {
    expect([1, 2, 3, 7].map(familySeverity)).toEqual(['med', 'med', 'high', 'high']);
  });

  it('labels a node by name, else by its text, else by its kind', () => {
    const box = { x: 0, y: 0, w: 1, h: 1 };
    expect(nodeLabel({ name: 'Card', kind: 'container', box })).toBe('Card');
    expect(nodeLabel({ kind: 'text', box, text: 'Revenue' })).toBe('"Revenue"');
    expect(nodeLabel({ kind: 'text', box, text: 'x'.repeat(30) })).toBe(`"${'x'.repeat(24)}…"`);
    expect(nodeLabel({ kind: 'shape', box })).toBe('shape');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-report.test.ts
```

Expected output: `Failed to resolve import "../../geometry/geometry-report.js"`.

- [ ] **Step 3: Implement.** Create `src/cr/geometry/geometry-report.ts`:

```ts
// @tests: ui-design-review-lane
// The geometry lane's evidence report (spec D7) and severity rule (spec D6). The
// shipped core returns bare values; this maps each unmatched value back to its
// producing nodes by re-scanning that side's document. Pure: no IO.

import type { Severity } from '../findings-schema.js';
import { extractFamilies, GEOMETRY_FAMILIES, type FamilyOutcome, type FamilyRecord, type FamilyValues, type GeometryComparison, type GeometryFamily } from './geometry-compare-core.js';
import type { GeometryBox, GeometryDoc, GeometryNode, GeometryNodeKind, GeometrySide } from './geometry-doc.js';

/** What the report shows of a node: enough to find it in pen or the DOM. */
export interface ReportNode { name?: string; kind: GeometryNodeKind; box: GeometryBox; text?: string }

/** One value with no counterpart, and every node on its side that produced it. */
export interface UnmatchedValue { family: GeometryFamily; side: GeometrySide; value: number; nodes: ReportNode[] }

/** The `<surface>.report.json` evidence file. */
export interface SurfaceReport {
  surface: string;
  verdict: GeometryComparison['verdict'];
  families: FamilyRecord<FamilyOutcome>;
  /** Every value each side contributed, per family. */
  values: { design: FamilyValues; impl: FamilyValues };
  unmatched: UnmatchedValue[];
}

/** Whether `node` contributes `value` to `family` — the reads `extractFamilies` makes. */
function produces(node: GeometryNode, family: GeometryFamily, value: number): boolean {
  switch (family) {
    case 'edgesX':
      return node.box.x === value || node.box.x + node.box.w === value;
    case 'edgesY':
      return node.box.y === value || node.box.y + node.box.h === value;
    case 'fontSize':
      return node.kind === 'text' && node.fontSize === value;
    case 'spacing': {
      const s = node.spacing;
      if (s === undefined) return false;
      return [s.rowGap, s.columnGap, ...(s.padding ?? []), ...(s.margin ?? [])].includes(value);
    }
  }
}

const reportNode = (n: GeometryNode): ReportNode => ({
  ...(n.name !== undefined ? { name: n.name } : {}),
  kind: n.kind,
  box: n.box,
  ...(n.kind === 'text' ? { text: n.text } : {}),
});

export function buildSurfaceReport(
  surface: string,
  design: GeometryDoc,
  impl: GeometryDoc,
  comparison: GeometryComparison,
): SurfaceReport {
  const docs = { design, impl };
  const unmatched: UnmatchedValue[] = [];
  for (const family of GEOMETRY_FAMILIES) {
    const o = comparison.families[family];
    const sides = [
      ['design', o.designOnly],
      ['impl', o.implOnly],
    ] as const;
    for (const [side, values] of sides) {
      for (const value of values) {
        const nodes = docs[side].nodes.filter((n) => produces(n, family, value)).map(reportNode);
        unmatched.push({ family, side, value, nodes });
      }
    }
  }
  return {
    surface,
    verdict: comparison.verdict,
    families: comparison.families,
    values: { design: extractFamilies(design), impl: extractFamilies(impl) },
    unmatched,
  };
}

/** Spec D6: `med` for 1–2 unmatched values, `high` for 3 or more. */
export const familySeverity = (unmatched: number): Severity => (unmatched >= 3 ? 'high' : 'med');

/** A short handle for a node in a finding: its layer name, else its text, else its kind. */
export function nodeLabel(n: ReportNode): string {
  if (n.name !== undefined) return n.name;
  if (n.text !== undefined) return `"${n.text.length > 24 ? `${n.text.slice(0, 24)}…` : n.text}"`;
  return n.kind;
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-report.test.ts && pnpm typecheck
```

Expected output: `Tests  5 passed (5)`. `tsc` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-p5t1.msg <<'MSG'
feat(cr): build the geometry evidence report that names nodes

An unmatched count is only actionable when it names the elements behind it.
buildSurfaceReport re-scans each side's document with the reads extractFamilies
makes and attaches every producing node to each unmatched value, leaving the
shipped core unchanged. The severity rule lives here because FamilyOutcome
carries none: med for one or two unmatched values, high for three or more.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-report.ts src/cr/__tests__/geometry/geometry-report.test.ts
git commit -F /tmp/geo-p5t1.msg
```

---

## Task 2: The lane and its registration

**Files:**
- Create: `src/cr/lanes/geometry-compare.ts`
- Modify: `src/core/lanes.ts`, `src/cr/orchestrate.ts`
- Test: `src/cr/__tests__/lanes/geometry-compare.test.ts`, `src/cr/__tests__/lanes/geometry-registration.test.ts`

The lane literal, its runner-map entry and its module land in one commit. The pre-commit build runs `tsc`, and `LANES` is typed `Record<Exclude<Lane, 'standalone'>, …>`, so neither half compiles without the other. From this commit on, `crLanes.code: [..., "geometry-compare"]` runs the lane.

- [ ] **Step 1: Write the failing tests.** Add this case inside the `describe('geometry-compare registration', …)` block of `src/cr/__tests__/lanes/geometry-registration.test.ts`, and add `import { LANE_NAMES, laneSchema } from '../../../core/lanes.js';` to its imports:

```ts
  it('is a canonical lane', () => {
    expect(LANE_NAMES).toContain('geometry-compare');
    expect(laneSchema.safeParse('geometry-compare').success).toBe(true);
  });
```

Create `src/cr/__tests__/lanes/geometry-compare.test.ts`. Like `render-compare.test.ts`, it builds real git fixture repos and injects the boot/probe seams (`setGeometryCompareDeps`), the reader child (`setGeometryExtractDispatcher`) and the capture (`setGeometryReviewDeps`):

```ts
// @tests: ui-design-review-lane
// Lane tests for `geometry-compare`: real git fixture repos (the resolution half
// is shared with render-compare), with the reader dispatch, boot, probe and
// capture seams injected. Every case asserts the sink.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Slug } from '../../../core/slug.js';
import type { GeometryDoc } from '../../geometry/geometry-doc.js';
import { setGeometryReviewDeps } from '../../geometry/geometry-review.js';
import type { LaneInput } from '../../lane-types.js';
import { runGeometryCompare, setGeometryCompareDeps } from '../../lanes/geometry-compare.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const SLUG = 'feat-ui';
const PEN = `2026-09-25-${SLUG}.pen`;
const GEO_BOOT = {
  dashboard: { verifyCommand: 'dashboard', route: '/', geometryCommand: 'cap {url} {out} {width} {height}' },
};
const SHOT_ONLY_BOOT = {
  dashboard: { verifyCommand: 'dashboard', route: '/', screenshotCommand: 'cap {url} {out} {width} {height}' },
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo(
  mode: 'blocking' | 'advisory',
  uiBoot: Record<string, Record<string, unknown>> = GEO_BOOT,
): { cwd: string; input: LaneInput } {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-geometry-compare-test-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 't@t']);
  git(cwd, ['config', 'user.name', 't']);
  for (const d of ['.noldor', 'docs/features', 'docs/design/ui']) mkdirSync(join(cwd, d), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture', repoUrl: 'https://example.com/fixture', lockstepPackages: ['.'],
        e2ePrefix: 'e2e', samplesPath: 'samples', packagePrefix: '@fixture/', appPathPrefix: 'apps/',
        uiPaths: ['src/ui/**'],
        uiSurfaces: Object.fromEntries(Object.keys(uiBoot).map((k) => [k, ['src/ui/**']])),
        verifyCommands: { dashboard: { command: 'serve --port {port}', kind: 'server', healthPath: '/' } },
        uiBoot,
      },
      autonomous: { geometryCompareMode: mode },
    }),
  );
  writeFileSync(join(cwd, 'docs', 'features', `${SLUG}.md`), `---\n---\n\n## Summary\n\nUI.\n`);
  writeFileSync(join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'base']);
  git(cwd, ['update-ref', 'refs/remotes/origin/main', git(cwd, ['rev-parse', 'HEAD'])]);
  writeFileSync(
    join(cwd, '.noldor', 'session.json'),
    JSON.stringify({ path: 'specs-only-new', slug: SLUG, startedAt: new Date().toISOString(), markerVersion: 2 }),
  );
  mkdirSync(join(cwd, 'src', 'ui'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'ui', 'Panel.tsx'), 'export const P = 1;\n');
  writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'PEN-BYTES\n');
  // A matching design-approval record (Q-0196), or resolution refuses the design.
  mkdirSync(join(cwd, '.noldor', 'design-approval'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'design-approval', PEN.replace(/\.pen$/, '.json')),
    JSON.stringify({
      outcome: 'approved',
      at: '2026-09-25T00:00:00.000Z',
      penBlob: git(cwd, ['hash-object', join('docs', 'design', 'ui', PEN)]),
      surfaces: ['app'],
    }),
  );
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'feature']);
  return {
    cwd,
    input: {
      slug: SLUG as Slug,
      artifact: 'src/ui/Panel.tsx',
      kind: 'code',
      fdPath: join('docs', 'features', `${SLUG}.md`),
      artifactSha: git(cwd, ['rev-parse', 'HEAD']),
      repoRoot: cwd,
    },
  };
}

const sink = (cwd: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(cwd, '.noldor', 'cr', `${SLUG}-code-geometry-compare.json`), 'utf8'));

/** A Card at `x`; the design's Card also declares 16px padding. */
const doc = (x: number, padded: boolean, surface = 'dashboard'): GeometryDoc => ({
  surface,
  viewport: { width: 1440, height: 900 },
  nodes: [{ kind: 'container', name: 'Card', box: { x, y: 0, w: 100, h: 40 }, ...(padded ? { spacing: { padding: [16, 16, 16, 16] } } : {}) }],
});

/** Stub every seam: the reader writes the design Card at 24; the capture writes `impl`. */
function seams(impl: GeometryDoc, onCapture: () => void = () => {}): { boots: number; dispatches: number; requests: number } {
  const log = { boots: 0, dispatches: 0, requests: 0 };
  setGeometryCompareDeps({
    resolvePort: async () => 4001,
    routeProbeBudgetMs: 100,
    boot: async (s, port) => {
      log.boots++;
      return { ok: true, url: `http://127.0.0.1:${port}/`, command: s.command, kill: () => {} };
    },
    fetchImpl: (async () => new Response('', { status: 200 })) as typeof fetch,
  });
  setGeometryExtractDispatcher(async (input) => {
    log.dispatches++;
    log.requests += input.requests.length;
    for (const r of input.requests) writeFileSync(r.outPath, JSON.stringify(doc(24, true, r.surface)));
    return JSON.stringify({
      surfaces: input.requests.map((r) => ({ surface: r.surface, candidates: ['overview'], excluded: [] })),
    });
  });
  setGeometryReviewDeps({
    capture: async (command, _cwd, _ms, env) => {
      const out = /'([^']+\.impl\.json)'/.exec(command)?.[1];
      const surface = env?.NOLDOR_GEOMETRY_SURFACE ?? impl.surface;
      if (out !== undefined) writeFileSync(out, JSON.stringify({ ...impl, surface }));
      onCapture();
      return { code: 0, timedOut: false, stderrTail: '' };
    },
  });
  return log;
}

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setGeometryReviewDeps({ capture: undefined });
});

describe('runGeometryCompare', () => {
  it('passes a matching surface and persists its evidence', async () => {
    seams(doc(24, true));
    const { cwd, input } = repo('blocking');
    const r = await runGeometryCompare(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass', blockers: [] });
    const evidence = join(cwd, '.noldor', 'cr', 'geometry-compare', SLUG);
    expect(existsSync(join(evidence, 'dashboard.design.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(evidence, 'dashboard.report.json'), 'utf8')).unmatched).toEqual([]);
  });

  it('extracts every surface with ONE reader dispatch before booting', async () => {
    const log = seams(doc(24, true));
    const { cwd, input } = repo('blocking', {
      dashboard: GEO_BOOT.dashboard,
      settings: { ...GEO_BOOT.dashboard, route: '/settings' },
    });
    await runGeometryCompare(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass' });
    expect([log.dispatches, log.requests, log.boots]).toEqual([1, 2, 1]);
  });

  it('writes a two-family failure to blockers under blocking mode', async () => {
    seams(doc(30, false));
    const { cwd, input } = repo('blocking');
    const r = await runGeometryCompare(input);
    expect(r.ok).toBe(false);
    const s = sink(cwd);
    expect(s.verdict).toBe('fail');
    const blockers = s.blockers as Array<{ severity: string; message: string; file: string }>;
    expect(blockers.map((b) => b.severity)).toEqual(['high', 'med']);
    expect(blockers[0].message).toBe(
      '[dashboard] edgesX: 4 unmatched > budget 0 — design-only [24 (Card), 124 (Card)] impl-only [30 (Card), 130 (Card)]',
    );
    expect(blockers[1].message).toBe('[dashboard] spacing: 1 unmatched > budget 0 — design-only [16 (Card)]');
    expect(blockers[0].file).toBe(`.noldor/cr/geometry-compare/${SLUG}/dashboard.report.json`);
  });

  it('writes the same failure to low suggestions under advisory mode', async () => {
    seams(doc(30, false));
    const { cwd, input } = repo('advisory');
    const r = await runGeometryCompare(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'fail', blockers: [] });
    expect((s.suggestions as Array<{ severity: string }>).map((f) => f.severity)).toEqual(['low', 'low']);
  });

  it('declines a surface whose recipe has no geometryCommand without booting', async () => {
    const log = seams(doc(24, true));
    const { cwd, input } = repo('advisory', SHOT_ONLY_BOOT);
    const r = await runGeometryCompare(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-geometry-recipe' });
    expect(log.boots).toBe(0);
  });

  it('lets pen-modified override every other outcome, in both modes', async () => {
    for (const mode of ['advisory', 'blocking'] as const) {
      const { cwd, input } = repo(mode);
      // The drifted capture would be a fail; mutating the REPO design mid-round must win.
      seams(doc(30, false), () => appendFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'MUTATED\n'));
      const r = await runGeometryCompare(input);
      expect(r.ok).toBe(false);
      const s = sink(cwd);
      expect(s).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
      expect(s.blockers as unknown[]).toHaveLength(1);
      expect(String(s.notes)).toContain('[dashboard] fail: edgesX 4/0');
    }
  });
});
```

- [ ] **Step 2: Run them and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-compare.test.ts src/cr/__tests__/lanes/geometry-registration.test.ts
```

Expected output: `geometry-compare.test.ts` fails with `Failed to resolve import "../../lanes/geometry-compare.js"`. The registration file fails on `is a canonical lane`; its two part-3 cases still pass.

- [ ] **Step 3: Register the lane.** In `src/core/lanes.ts`, append to `CANONICAL_LANES` after `'render-compare',`:

```ts
  // Code-only layout sibling of `render-compare`: boots the consumer's app and
  // compares alignment edges, font sizes and declared spacing against the
  // session's `.pen`. Its one agent role is the design reader (`geometry-extract`).
  'geometry-compare',
```

- [ ] **Step 4: Implement the lane.** Create `src/cr/lanes/geometry-compare.ts`:

```ts
// @tests: ui-design-review-lane
// The `geometry-compare` lane (spec D5–D7): compare LAYOUT, not paint, against a
// booted app. A shell over the shared round, boot, review and aggregate helpers;
// every terminating path writes exactly one sink.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { loadConsumerConfig, type UiBootRecipe, type VerifySurface } from '../../core/consumer-config.js';
import { errMessage } from '../../core/err-message.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import { GEOMETRY_FAMILIES } from '../geometry/geometry-compare-core.js';
import { buildSurfaceReport, familySeverity, nodeLabel, type SurfaceReport, type UnmatchedValue } from '../geometry/geometry-report.js';
import type { GeometryDoc } from '../geometry/geometry-doc.js';
import { compareSurfaceGeometry, extractDesignDocs } from '../geometry/geometry-review.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { forEachBootedSurface, type BootProbeDeps } from './boot-probe.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
import { aggregateOutcomes } from './render-compare-core.js';
import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';

const LANE = 'geometry-compare' as const;

interface SurfaceJob { surface: string; sanitized: string; recipe: UiBootRecipe & { geometryCommand: string } }

/** Per-surface outcome; a compared surface carries its evidence report. */
type Outcome =
  | { surface: string; kind: 'pass' | 'fail'; report: SurfaceReport }
  | { surface: string; kind: 'cannot-review'; reason: LaneReasonCode; detail: string };

const cannot = (surface: string, reason: LaneReasonCode, detail: string): Outcome =>
  ({ surface, kind: 'cannot-review', reason, detail });

/** Jobs and declines; a surface without `geometryCommand` is a full row, so partial coverage never passes. */
function planSurfaceJobs(
  surfaces: readonly string[],
  recipes: ReadonlyMap<string, UiBootRecipe>,
): { jobs: SurfaceJob[]; declined: Outcome[] } {
  const jobs: SurfaceJob[] = [];
  const declined: Outcome[] = [];
  for (const surface of surfaces) {
    const recipe = recipes.get(surface);
    const geometryCommand = recipe?.geometryCommand;
    if (recipe === undefined || geometryCommand === undefined) {
      const why = recipe === undefined ? 'has no consumer.uiBoot recipe' : 'has a uiBoot recipe but no geometryCommand';
      declined.push(cannot(surface, 'no-geometry-recipe', `surface '${surface}' ${why}`));
      continue;
    }
    jobs.push({ surface, sanitized: sanitizeSurfaceName(surface), recipe: { ...recipe, geometryCommand } });
  }
  return { jobs, declined };
}

const bySurface = (a: Outcome, b: Outcome): number =>
  a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0;

/** One `notes` row per surface, in surface order — the record of what was computed. */
function roundRows(outcomes: readonly Outcome[]): string[] {
  return [...outcomes].sort(bySurface).map((o) => {
    if (o.kind === 'cannot-review') return `[${o.surface}] ${o.reason}: ${o.detail}`;
    const fams = GEOMETRY_FAMILIES.map(
      (f) => `${f} ${o.report.families[f].unmatched}/${o.report.families[f].budget}`,
    );
    return `[${o.surface}] ${o.kind}: ${fams.join(', ')}`;
  });
}

const fmt = (v: number): string => String(Number(v.toFixed(2)));
const sideList = (entries: readonly UnmatchedValue[]): string =>
  entries.map((e) => `${fmt(e.value)} (${e.nodes.map(nodeLabel).join(', ') || 'no node'})`).join(', ');

/** One finding per failing family, naming the values, their nodes and the evidence file. */
function roundFindings(slug: string, outcomes: readonly Outcome[]): Finding[] {
  return [...outcomes].sort(bySurface).flatMap((o) => {
    if (o.kind !== 'fail') return [];
    const { report } = o;
    const failing = GEOMETRY_FAMILIES.filter((f) => report.families[f].unmatched > report.families[f].budget);
    return failing.map((f) => {
      const fam = report.families[f];
      const on = (side: 'design' | 'impl') => report.unmatched.filter((u) => u.family === f && u.side === side);
      const sides = [
        on('design').length > 0 ? `design-only [${sideList(on('design'))}]` : '',
        on('impl').length > 0 ? `impl-only [${sideList(on('impl'))}]` : '',
      ].filter((s) => s !== '');
      return {
        file: `.noldor/cr/${LANE}/${slug}/${sanitizeSurfaceName(o.surface)}.report.json`,
        severity: familySeverity(fam.unmatched),
        message: `[${o.surface}] ${f}: ${fam.unmatched} unmatched > budget ${fam.budget} — ${sides.join(' ')}`,
      };
    });
  });
}

let deps: BootProbeDeps = { boot: bootServer, fetchImpl: fetch, resolvePort, routeProbeBudgetMs: 15_000 };

/** Test seam — production code never calls this. */
export function setGeometryCompareDeps(partial: Partial<BootProbeDeps>): void {
  deps = { ...deps, ...partial };
}

export async function runGeometryCompare(input: LaneInput): Promise<LaneResult> {
  const opened = await openDesignReviewRound(input, LANE, 'geometryCompareMode', 'noldor-geometry-compare');
  if (opened.kind === 'done') return opened.result;
  const { mode } = opened;
  const { write, writeTerminal, design, notes } = opened.ctx;
  const { dir: scratchDir, penPath: scratchPen, designChanged } = opened.ctx.scratch;
  /** `pen-modified` precedence is absolute (spec D5): checked before every terminal. */
  const terminal = async (reason: LaneReasonCode, detail: string, rows: string[] = []): Promise<LaneResult> => {
    const integrity = await designChanged();
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail || detail, [...notes, ...rows]);
    }
    return writeTerminal({ verdict: 'cannot-review', reason, detail }, [...notes, ...rows]);
  };

  try {
    // Maps, not raw records: Object.entries copies OWN keys only, so a surface
    // named like an inherited property cannot alias a prototype member.
    let recipes: Map<string, UiBootRecipe>;
    let declaredSurfaces: string[];
    let verifyCommands: Map<string, VerifySurface>;
    try {
      const consumer = loadConsumerConfig(input.repoRoot);
      recipes = new Map(Object.entries(consumer.uiBoot ?? {}));
      declaredSurfaces = Object.keys(consumer.uiSurfaces ?? {});
      verifyCommands = new Map(Object.entries(consumer.verifyCommands));
    } catch (err) {
      return await terminal('config-unreadable', errMessage(err));
    }

    // Zero AFFECTED surfaces must not aggregate to a "0 surfaces" pass (a
    // blocking-mode bypass); same whole-design fallback render-compare uses.
    let surfaces = design.surfaces;
    if (surfaces.length === 0) {
      surfaces = [...new Set([...declaredSurfaces, ...recipes.keys()])].sort();
      if (surfaces.length === 0) {
        return await terminal('no-geometry-recipe', 'zero affected surfaces resolved and no consumer.uiBoot recipe to fall back to');
      }
      notes.push(`zero affected surfaces resolved — reviewing every declared surface: ${surfaces.join(', ')}`);
    }

    const { jobs, declined } = planSurfaceJobs(surfaces, recipes);
    const outcomes: Outcome[] = [...declined];
    const artifacts: RoundArtifact[] = [];
    const workDir = join(scratchDir, 'geometry'); // removed with the scratch dir
    await mkdir(workDir, { recursive: true });

    // ONE reader dispatch for every surface, BEFORE any boot: no dev server waits
    // on an agent, and a surface whose design cannot be read is never booted.
    const extractions = await extractDesignDocs({
      penPath: scratchPen,
      surfaces: jobs.map((j) => ({ surface: j.surface, ...(j.recipe.page !== undefined ? { pageSelector: j.recipe.page } : {}) })),
      outDir: workDir,
      repoRoot: input.repoRoot,
      slug: input.slug,
      ...(input.dispatchTimeoutMs !== undefined ? { dispatchTimeoutMs: input.dispatchTimeoutMs } : {}),
    });
    const ready: Array<SurfaceJob & { design: GeometryDoc }> = [];
    for (const job of jobs) {
      const e = extractions.get(job.surface);
      if (e?.kind !== 'extracted') {
        outcomes.push(cannot(job.surface, e?.reason ?? 'geometry-extract-failed', e?.detail ?? 'no extraction result'));
        continue;
      }
      if (e.excluded.length > 0) notes.push(`[${job.surface}] clipped design nodes excluded: ${e.excluded.join(', ')}`);
      ready.push({ ...job, design: e.design });
    }

    await forEachBootedSurface({
      jobs: ready,
      verifyCommands,
      repoRoot: input.repoRoot,
      deps,
      unreachable: (job, reason, detail) => {
        outcomes.push(cannot(job.surface, reason, detail));
      },
      reached: async (job, url) => {
        const result = await compareSurfaceGeometry({
          surface: job.surface,
          design: job.design,
          url,
          geometryCommand: job.recipe.geometryCommand,
          implPath: join(workDir, `${job.sanitized}.impl.json`),
          repoRoot: input.repoRoot,
          captureTimeoutMs: job.recipe.captureTimeoutMs,
          tolerance: job.recipe.geometryTolerance,
          budget: job.recipe.geometryBudget,
        });
        if (result.kind === 'declined') {
          outcomes.push(cannot(job.surface, result.reason, result.detail));
          return;
        }
        const report = buildSurfaceReport(job.surface, result.design, result.impl, result.comparison);
        artifacts.push(
          { name: `${job.sanitized}.design.json`, body: JSON.stringify(result.design, null, 1) },
          { name: `${job.sanitized}.impl.json`, body: JSON.stringify(result.impl, null, 1) },
          { name: `${job.sanitized}.report.json`, body: JSON.stringify(report, null, 1) },
        );
        outcomes.push({ surface: job.surface, kind: result.comparison.verdict, report });
      },
    });

    const rows = roundRows(outcomes);
    // A round with no documents keeps the prior evidence (empty list = no-op).
    const swap = await swapRoundArtifacts(join(input.repoRoot, '.noldor', 'cr', LANE), input.slug, artifacts);
    const integrity = await designChanged();
    if (integrity.changed) {
      return writePenModified(write, design.repoRelPath, integrity.detail, [...notes, ...rows]);
    }
    if (!swap.ok) return await terminal('persist-failed', `evidence unavailable: ${swap.detail}`, rows);

    const all = [...notes, ...rows];
    const agg = aggregateOutcomes(outcomes);
    if (agg.verdict === 'pass') {
      const n = outcomes.length;
      const summary = `every family within budget (${n} surface${n === 1 ? '' : 's'})`;
      return write({ verdict: 'pass', blockers: [], suggestions: [], summary, notes: all }, true);
    }
    if (agg.verdict === 'cannot-review') {
      const detail = agg.detail ?? 'geometry-compare could not review';
      return writeTerminal({ verdict: 'cannot-review', reason: agg.reason ?? 'dispatch-failed', detail }, all);
    }
    const findings = roundFindings(input.slug, outcomes);
    return writeFailByMode(write, mode, findings, 'implemented layout drifts from the design', all);
  } catch (err) {
    // A round never terminates without its sink; pen-modified still wins.
    return await terminal('dispatch-failed', `unexpected pipeline failure: ${errMessage(err)}`);
  } finally {
    await cleanupPenScratch(scratchDir, LANE);
  }
}
```

- [ ] **Step 5: Add the runner-map entry.** In `src/cr/orchestrate.ts`, add `import { runGeometryCompare } from './lanes/geometry-compare.js';` directly after the `import { runRenderCompare } …` line, and add `'geometry-compare': runGeometryCompare,` to the `LANES` object after `'render-compare': runRenderCompare,`.

- [ ] **Step 6: Run them and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-compare.test.ts src/cr/__tests__/lanes/geometry-registration.test.ts src/cr/__tests__/filename.test.ts src/cr/__tests__/orchestrate.test.ts && pnpm typecheck && pnpm lint
```

Expected output: `Test Files  4 passed (4)`: the lane file's 6 tests, the registration file's 3, and `filename.test.ts` still resolving `-render-compare.json` and `-ui-reviewer.json` next to the longer new suffix. `tsc` and `oxlint` exit 0.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p5t2.msg <<'MSG'
feat(cr): add the geometry-compare lane

A thin shell over parts 3 and 4: one reader dispatch for every surface before
any boot, one boot per verifyCommand group, a row for every surface (a missing
geometryCommand is no-geometry-recipe), durable evidence, and one verdict under
the mode knob, pen-modified outranking everything. Findings come one per
failing family, severity derived from the unmatched count, each value naming its
nodes. The lane literal and its LANES entry land together: neither compiles alone.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/geometry-compare.ts src/core/lanes.ts src/cr/orchestrate.ts src/cr/__tests__/lanes/geometry-compare.test.ts src/cr/__tests__/lanes/geometry-registration.test.ts
git commit -F /tmp/geo-p5t2.msg
```

---

## Task 3: Orchestrate — code-only, no delta short-circuit, one boot chain, ratchets

**Files:**
- Modify: `src/cr/orchestrate.ts`, `.noldor/indirection-baseline.json` (only if the ratchet reds)
- Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Mock the lane in the orchestrate suite.** In `src/cr/__tests__/orchestrate.test.ts`, directly after the `vi.mock('../lanes/render-compare.js', …)` block, add:

```ts
vi.mock('../lanes/geometry-compare.js', () => ({
  runGeometryCompare: vi.fn(async () => ({ lane: 'geometry-compare', sinkPath: 'gc', ok: true })),
}));
```

and directly after `import { runRenderCompare } from '../lanes/render-compare.js';` add `import { runGeometryCompare } from '../lanes/geometry-compare.js';`.

- [ ] **Step 2: Write the failing tests.** Append after the `describe('render-compare lane wiring', …)` block:

```ts
describe('geometry-compare lane wiring', () => {
  const code = (cwd: string, lanes: Lane[]) =>
    run({
      args: { slug: 's', artifact: 'a.ts', kind: 'code', lanes, fullReview: false, autonomous: true },
      cwd,
    });
  const smokeAfter = (events: string[]): void =>
    setSmokeRunner(async () => {
      await new Promise((r) => setTimeout(r, 50));
      events.push('verifier-smoke-done');
      return {
        ok: false,
        surfaces: [{ name: 'doctor', ok: false, evidence: { command: 'x', observed: 'boom' } }],
        notes: [],
      };
    });
  const repoDir = (tag: string): string => {
    const cwd = mkdtempSync(join(tmpdir(), `noldor-orch-gc-${tag}-`));
    mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
    return cwd;
  };

  it('rejects geometry-compare for non-code kinds at entry', async () => {
    for (const kind of ['spec', 'plan'] as const) {
      await expect(
        run({
          args: { slug: 's', artifact: 'spec.md', kind, lanes: ['geometry-compare'], fullReview: false, autonomous: true },
          cwd: repoDir('kind'),
        }),
      ).rejects.toThrow(/code-only/);
    }
  });

  it('never mints a synthetic OK for geometry-compare on an empty artifact diff', async () => {
    const cwd = repoDir('delta');
    writeFileSync(
      join(cwd, '.noldor', 'cr', 's-code-geometry-compare.json'),
      JSON.stringify({
        lane: 'geometry-compare',
        artifact: 'a.ts',
        kind: 'code',
        slug: 's',
        blockers: [],
        suggestions: [],
        summary: 'cannot-review: boot-failed',
        verdict: 'cannot-review',
        reason: 'boot-failed',
        startedAt: new Date().toISOString(),
      }),
    );
    const result = await run({
      args: { slug: 's', artifact: 'a.ts', kind: 'code', lanes: ['geometry-compare'], baseSha: 'base', fullReview: false, autonomous: true },
      cwd,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).not.toContain('geometry-compare');
    expect(vi.mocked(runGeometryCompare)).toHaveBeenCalled();
  });

  it('runs verifier, then render-compare, then geometry-compare, never two at once (AC2)', async () => {
    const events: string[] = [];
    smokeAfter(events);
    vi.mocked(runRenderCompare).mockImplementationOnce(async () => {
      events.push('render-compare-start');
      await new Promise((r) => setTimeout(r, 50));
      events.push('render-compare-done');
      return { lane: 'render-compare', sinkPath: 'rc', ok: true };
    });
    vi.mocked(runGeometryCompare).mockImplementationOnce(async () => {
      events.push('geometry-compare-start');
      return { lane: 'geometry-compare', sinkPath: 'gc', ok: true };
    });
    // Listed in reverse: the chain order must not depend on the lane list's order.
    await code(repoDir('chain'), ['geometry-compare', 'render-compare', 'verifier']);
    expect(events).toEqual([
      'verifier-smoke-done',
      'render-compare-start',
      'render-compare-done',
      'geometry-compare-start',
    ]);
  });

  it('follows the verifier directly when render-compare is absent', async () => {
    const events: string[] = [];
    smokeAfter(events);
    vi.mocked(runGeometryCompare).mockImplementationOnce(async () => {
      events.push('geometry-compare-start');
      return { lane: 'geometry-compare', sinkPath: 'gc', ok: true };
    });
    await code(repoDir('pair'), ['geometry-compare', 'verifier']);
    expect(events).toEqual(['verifier-smoke-done', 'geometry-compare-start']);
  });
});
```

If `Lane` is not already imported in this test file, add `import type { Lane } from '../../core/lanes.js';`.

- [ ] **Step 3: Run them and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t 'geometry-compare lane wiring'
```

Expected output: `Tests  4 failed`. The kind check does not reject. A synthetic OK is minted. In both chain cases `geometry-compare-start` fires first, because the lane still launches concurrently.

- [ ] **Step 4: Name the lane sets.** In `src/cr/orchestrate.ts`, replace the `NO_DELTA_SHORTCIRCUIT` declaration line with:

```ts
const NO_DELTA_SHORTCIRCUIT: ReadonlySet<Lane> = new Set<Lane>([
  'ui-reviewer',
  'render-compare',
  'geometry-compare',
]);

/** Lanes whose review object only exists at code stage; `run()` rejects them for spec/plan. */
const CODE_ONLY_LANES: readonly Lane[] = ['verifier', 'ui-reviewer', 'render-compare', 'geometry-compare'];

/**
 * Lanes that boot the consumer's `verifyCommands` servers, in the order they run.
 * Distinct ports do NOT make concurrent boots safe: two dev servers over one
 * project directory contend on the same build cache (`.next`, vite's dep cache).
 * So these run as a chain while every other lane launches concurrently; a lane
 * absent from the round contributes no link.
 */
const BOOTING_LANES: readonly Lane[] = ['verifier', 'render-compare', 'geometry-compare'];
```

and in `run()` replace `for (const codeOnly of ['verifier', 'ui-reviewer', 'render-compare'] as const) {` with `for (const codeOnly of CODE_ONLY_LANES) {`.

- [ ] **Step 5: Chain the boots.** In `src/cr/orchestrate.ts`, replace the block from the comment `// Port contention is real: \`verifier\` boots the same \`verifyCommands\` servers` through the closing `}` of the second `for (let i = 0; i < effective.length; i++) { if (effective[i] !== 'render-compare') continue; … }` loop (the line before `const settled = await Promise.allSettled(promises);`) with:

```ts
  // Port and build-cache contention are real: the BOOTING_LANES all boot the same
  // `verifyCommands` servers, so they run as a chain, each starting when the
  // previous RESOLVES (success or failure), with every boot's own pre-boot
  // occupancy check still guarding contention from outside the round (spec R4).
  const launch = (l: Lane): Promise<LaneResult> => {
    const context = contexts.get(l);
    const laneInput =
      context !== undefined ? { ...dispatchInput, priorReview: context } : dispatchInput;
    if (l === 'codex') return runCodex(laneInput);
    // standalone can't reach here — run() rejects it at entry.
    return LANES[l as Exclude<Lane, 'standalone'>](laneInput);
  };
  // `promises[i]` stays index-aligned with `effective[i]` for the result mapping below.
  const promises: Promise<LaneResult>[] = Array.from({ length: effective.length });
  for (let i = 0; i < effective.length; i++) {
    if (BOOTING_LANES.includes(effective[i])) continue;
    promises[i] = launch(effective[i]);
  }
  let previous: Promise<LaneResult> | undefined;
  for (const lane of BOOTING_LANES) {
    const i = effective.indexOf(lane);
    if (i < 0) continue;
    const start = (): Promise<LaneResult> => launch(lane);
    // `.then(start, start)` on purpose: a failed verifier must not strand the round.
    promises[i] = previous === undefined ? start() : previous.then(start, start);
    previous = promises[i];
  }
```

- [ ] **Step 6: Run the suite and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts src/cr/__tests__/orchestrate.integration.test.ts && pnpm typecheck && pnpm lint
```

Expected output: every orchestrate case passes. That includes the four new ones and the existing `starts only after the verifier lane resolves when both share the round (AC5)` and `starts immediately when verifier is absent from the round` render-compare cases, which the chain still satisfies. `tsc` and `oxlint` exit 0.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p5t3.msg <<'MSG'
feat(cr): chain the three booting lanes and exempt geometry-compare

The three booting lanes contend on one build cache whatever their ports, so
BOOTING_LANES chains them, each starting when the previous resolves; other lanes
launch concurrently. geometry-compare joins the empty-delta exemption and the
now-named CODE_ONLY_LANES.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/geo-p5t3.msg
```

- [ ] **Step 8: Check the clones ratchet.**

```bash
pnpm noldor clones check --against main
```

Expected output: exit 0. The lane's `cannot-review` path already goes through `makeTerminalWriter`'s `writeTerminal`, so only its `pass` write mirrors `render-compare`'s. If that is reported as a group, hoist the shared write into `ui-design-resolve.ts` next to `writeFailByMode`, switch both lanes to it, and amend Task 2's commit. Do not re-record the clones baseline.

- [ ] **Step 9: Check the indirection ratchet.**

```bash
pnpm noldor indirection check; echo "exit=$?"
```

Expected output: `exit=0`, or `exit=1` because `orchestrate.ts` → `geometry-compare.ts` pulls the geometry modules into the runner's closure. On `exit=0`, this part is done.

- [ ] **Step 10: Re-record the baseline (only after `exit=1`).**

```bash
pnpm noldor indirection baseline
```

Expected output: `indirection baseline: recorded excess sum <n> (RAISED from <prior>) across <m> module(s) -> .noldor/indirection-baseline.json`.

- [ ] **Step 11: Commit it on its own (only after Step 10).**

```bash
cat > /tmp/geo-p5t3b.msg <<'MSG'
chore(indirection): re-record the baseline for the geometry-compare lane

orchestrate.ts now imports the geometry-compare lane, which brings the review,
report and extraction modules into the runner's transitive closure.
Re-recorded as its own commit so the raise shows in the PR diff.

Noldor-FD: ui-design-review-lane
MSG
git add .noldor/indirection-baseline.json
git commit -F /tmp/geo-p5t3b.msg
```
