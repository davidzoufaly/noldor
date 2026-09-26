// @tests: ui-design-review-lane
// Lane tests for `geometry-compare`: real git fixture repos (the resolution half
// is shared with render-compare), with the reader dispatch, boot, probe and
// capture seams injected. Every case asserts the sink.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
  dashboard: {
    verifyCommand: 'dashboard',
    route: '/',
    geometryCommand: 'cap {url} {out} {width} {height}',
  },
};
const SHOT_ONLY_BOOT = {
  dashboard: {
    verifyCommand: 'dashboard',
    route: '/',
    screenshotCommand: 'cap {url} {out} {width} {height}',
  },
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
  for (const d of ['.noldor', 'docs/features', 'docs/design/ui'])
    mkdirSync(join(cwd, d), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture',
        repoUrl: 'https://example.com/fixture',
        lockstepPackages: ['.'],
        e2ePrefix: 'e2e',
        samplesPath: 'samples',
        packagePrefix: '@fixture/',
        appPathPrefix: 'apps/',
        uiPaths: ['src/ui/**'],
        uiSurfaces: Object.fromEntries(Object.keys(uiBoot).map((k) => [k, ['src/ui/**']])),
        verifyCommands: {
          dashboard: { command: 'serve --port {port}', kind: 'server', healthPath: '/' },
        },
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
    JSON.stringify({
      path: 'specs-only-new',
      slug: SLUG,
      startedAt: new Date().toISOString(),
      markerVersion: 2,
    }),
  );
  mkdirSync(join(cwd, 'src', 'ui'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'ui', 'Panel.tsx'), 'export const P = 1;\n');
  writeFileSync(
    join(cwd, 'docs', 'design', 'ui', PEN),
    `${JSON.stringify({
      version: '2.6',
      children: [
        { id: 'p-dashboard', name: 'FINAL:dashboard: overview' },
        { id: 'p-settings', name: 'FINAL:settings: overview' },
      ],
    })}\n`,
  );
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
  JSON.parse(
    readFileSync(join(cwd, '.noldor', 'cr', `${SLUG}-code-geometry-compare.json`), 'utf8'),
  );

/** A Card at `x`; the design's Card also declares 16px padding. */
const doc = (x: number, padded: boolean, surface = 'dashboard'): GeometryDoc => ({
  surface,
  viewport: { width: 1440, height: 900 },
  nodes: [
    {
      kind: 'container',
      name: 'Card',
      box: { x, y: 0, w: 100, h: 40 },
      ...(padded
        ? { spacing: { padding: [16, 16, 16, 16] as [number, number, number, number] } }
        : {}),
    },
  ],
});

/** Stub every seam: the reader writes the design Card at 24; the capture writes `impl`. */
function seams(
  impl: GeometryDoc,
  onCapture: () => void = () => {},
): { boots: number; dispatches: number; requests: number } {
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
    for (const r of input.requests)
      writeFileSync(r.outPath, JSON.stringify(doc(24, true, r.surface)));
    return JSON.stringify({
      surfaces: input.requests.map((r) => ({
        surface: r.surface,
        candidates: ['overview'],
        excluded: [],
        pageId: `p-${r.surface}`,
      })),
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
    expect(
      JSON.parse(readFileSync(join(evidence, 'dashboard.report.json'), 'utf8')).unmatched,
    ).toEqual([]);
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
    expect(blockers[1].message).toBe(
      '[dashboard] spacing: 1 unmatched > budget 0 — design-only [16 (Card)]',
    );
    expect(blockers[0].file).toBe(`.noldor/cr/geometry-compare/${SLUG}/dashboard.report.json`);
  });

  it('writes the same failure to low suggestions under advisory mode', async () => {
    seams(doc(30, false));
    const { cwd, input } = repo('advisory');
    const r = await runGeometryCompare(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'fail', blockers: [] });
    expect((s.suggestions as Array<{ severity: string }>).map((f) => f.severity)).toEqual([
      'low',
      'low',
    ]);
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
      seams(doc(30, false), () =>
        appendFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'MUTATED\n'),
      );
      const r = await runGeometryCompare(input);
      expect(r.ok).toBe(false);
      const s = sink(cwd);
      expect(s).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
      expect(s.blockers as unknown[]).toHaveLength(1);
      expect(String(s.notes)).toContain('[dashboard] fail: edgesX 4/0');
    }
  });
});
