// @tests: ui-design-review-lane
// Lane tests for `render-compare`: real git fixture repos (the resolution half
// is shared with ui-reviewer and tested through the same production loaders),
// with the exporter dispatch, boot, capture, fetch, and port seams injected.
// Every case asserts the sink — a lane with no sink is indistinguishable from a
// lane that passed (Q-0100).

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bootServer } from '../../../verify/boot.js';
import type { LaneInput } from '../../lane-types.js';
import { runRenderCompare, setRenderCompareDeps } from '../../lanes/render-compare.js';
import { setRenderExportDispatcher } from '../../lanes/render-export-dispatch.js';
import type { RenderExportInput } from '../../lanes/render-export-dispatch.js';

const SLUG = 'feat-ui';
const PEN = `2026-08-20-${SLUG}.pen`;

function png16(paint: (x: number, y: number) => number): Buffer {
  const png = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const v = paint(x, y);
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const DESIGN_PNG = png16(() => 255);
/** 10 of 16 rows differ → ratio 0.625 (> 2 × 0.25 → high). */
const DRIFTED_PNG = png16((_x, y) => (y < 10 ? 0 : 255));

interface RepoOpts {
  mode?: 'blocking' | 'advisory';
  changed?: Record<string, string>;
  surfaces?: Record<string, string[]>;
  uiBoot?: Record<string, Record<string, unknown>>;
  verifyCommands?: Record<string, Record<string, unknown>>;
  waived?: boolean;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const DEFAULT_BOOT = {
  dashboard: {
    verifyCommand: 'dashboard',
    route: '/',
    screenshotCommand: 'cap {url} {out} {width} {height}',
  },
};
const DEFAULT_VERIFY = {
  dashboard: { command: 'serve --port {port}', kind: 'server', healthPath: '/' },
};

function repo(opts: RepoOpts = {}): { cwd: string; input: LaneInput } {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-render-compare-test-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 't@t']);
  git(cwd, ['config', 'user.name', 't']);
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'ui'), { recursive: true });

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
        uiSurfaces: opts.surfaces ?? { dashboard: ['src/ui/**'] },
        verifyCommands: opts.verifyCommands ?? DEFAULT_VERIFY,
        ...(opts.uiBoot !== undefined ? { uiBoot: opts.uiBoot } : {}),
      },
      ...(opts.mode ? { autonomous: { renderCompareMode: opts.mode } } : {}),
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
      ...(opts.waived ? { uiWaiver: { reason: 'no editor', at: new Date().toISOString() } } : {}),
    }),
  );
  for (const [rel, body] of Object.entries(
    opts.changed ?? { 'src/ui/Panel.tsx': 'export const P = 1;\n' },
  )) {
    mkdirSync(join(cwd, rel, '..'), { recursive: true });
    writeFileSync(join(cwd, rel), body);
  }
  writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'PEN-BYTES\n');
  // Matching design-approval record (Q-0196): resolveUiReviewTarget refuses an
  // unratified design before this lane ever compares anything.
  mkdirSync(join(cwd, '.noldor', 'design-approval'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'design-approval', PEN.replace(/\.pen$/, '.json')),
    JSON.stringify({
      outcome: 'approved',
      at: '2026-08-30T00:00:00.000Z',
      penBlob: git(cwd, ['hash-object', join('docs', 'design', 'ui', PEN)]),
      surfaces: ['app'],
    }),
  );
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'feature']);

  return {
    cwd,
    input: {
      slug: SLUG,
      artifact: 'src/ui/Panel.tsx',
      kind: 'code',
      fdPath: join('docs', 'features', `${SLUG}.md`),
      artifactSha: git(cwd, ['rev-parse', 'HEAD']),
      repoRoot: cwd,
    },
  };
}

function sink(cwd: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(cwd, '.noldor', 'cr', `${SLUG}-code-render-compare.json`), 'utf8'),
  ) as Record<string, unknown>;
}

const report = (payload: unknown): string =>
  `prose\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;

/** Exporter mock: writes `bytes` at every requested outPath, reports `exported`. */
function exporterWriting(bytes: Buffer | ((surface: string) => Buffer)): {
  seen: RenderExportInput[];
} {
  const seen: RenderExportInput[] = [];
  setRenderExportDispatcher(async (input) => {
    seen.push(input);
    for (const r of input.requests) {
      writeFileSync(r.outPath, typeof bytes === 'function' ? bytes(r.surface) : bytes);
    }
    return report({
      surfaces: input.requests.map((r) => ({
        surface: r.surface,

        candidates: ['overview'],
      })),
    });
  });
  return { seen };
}

interface SeamLog {
  boots: string[];
  captures: string[];
}

/**
 * Happy-path seams: boot succeeds, routes answer 200, capture writes `shot`
 * (or per-surface bytes) at the quoted `{out}` token. Returns the call log.
 */
function seams(
  shot: Buffer | ((outPath: string) => Buffer),
  overrides: Partial<Parameters<typeof setRenderCompareDeps>[0]> = {},
): SeamLog {
  const log: SeamLog = { boots: [], captures: [] };
  setRenderCompareDeps({
    resolvePort: async () => 4001,
    routeProbeBudgetMs: 100,
    boot: async (surface, port) => {
      log.boots.push(surface.command);
      return {
        ok: true,
        url: `http://127.0.0.1:${port}${surface.healthPath}`,
        command: surface.command,
        kill: () => {},
      };
    },
    fetchImpl: (async () => new Response('', { status: 200 })) as typeof fetch,
    capture: async (command) => {
      log.captures.push(command);
      const m = command.match(/'([^']*\.shot\.png)'/);
      if (m !== null) {
        writeFileSync(m[1], typeof shot === 'function' ? shot(m[1]) : shot);
      }
      return { code: 0, timedOut: false, stderrTail: '' };
    },
    ...overrides,
  });
  return log;
}

beforeEach(() => {
  // Deterministic default: any case that forgets a seam fails loudly, not by
  // booting a real server.
  setRenderCompareDeps({
    resolvePort: async () => 4001,
    routeProbeBudgetMs: 100,
    boot: async () => {
      throw new Error('boot seam not configured');
    },
    capture: async () => {
      throw new Error('capture seam not configured');
    },
    fetchImpl: (async () => new Response('', { status: 200 })) as typeof fetch,
  });
  setRenderExportDispatcher(async () => report({ surfaces: [] }));
});

afterEach(() => {
  setRenderCompareDeps({ boot: bootServer });
});

describe('runRenderCompare — rounds with nothing to review', () => {
  it('is not-applicable without booting when no changed path matches uiPaths', async () => {
    const log = seams(DESIGN_PNG);
    const { cwd, input } = repo({ changed: { 'src/core/x.ts': 'x\n' }, uiBoot: DEFAULT_BOOT });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'no-ui-paths' });
    expect(log.boots).toHaveLength(0);
  });

  it('is not-applicable when the operator waived the design step', async () => {
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ waived: true, uiBoot: DEFAULT_BOOT, mode: 'blocking' });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'waived' });
  });
});

describe('runRenderCompare — per-surface cannot-review classes', () => {
  it('a recipe-less affected surface is a full no-boot-recipe outcome, never pass (AC4)', async () => {
    seams(DESIGN_PNG);
    const { cwd, input } = repo({});
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true); // advisory default
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'no-boot-recipe' });
    expect(String(s.notes)).toContain('[dashboard] no-boot-recipe');
  });

  it('blocking mode reds an aggregated cannot-review with one high blocker (AC9)', async () => {
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ mode: 'blocking' });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(false);
    const s = sink(cwd);
    const blockers = s.blockers as Array<Record<string, unknown>>;
    expect(blockers).toHaveLength(1);
    expect(blockers[0].severity).toBe('high');
    expect(String(blockers[0].message)).toContain('no-boot-recipe');
  });

  it('exporter dispatch failure marks every recipe surface export-failed', async () => {
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async () => {
      throw new Error('pencil bridge down');
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'export-failed' });
    expect(String(s.notes)).toContain('pencil bridge down');
  });

  it('a child page-ambiguous report becomes page-ambiguous naming the candidates', async () => {
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async (input: RenderExportInput) =>
      report({
        surfaces: input.requests.map((r) => ({
          surface: r.surface,

          candidates: ['default', 'expanded'],
        })),
      }),
    );
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'page-ambiguous' });
    expect(String(s.notes)).toContain('default, expanded');
  });

  it('an exported claim without a decodable file is export-failed (files, not words)', async () => {
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      for (const r of input.requests) writeFileSync(r.outPath, 'not a png');
      return report({
        surfaces: input.requests.map((r) => ({
          surface: r.surface,

          candidates: ['overview'],
        })),
      });
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'export-failed' });
  });

  it('an unparseable exporter report is export-failed — no trustworthy page enumeration', async () => {
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      // Files exist and decode, but nothing trustworthy says which page they show.
      for (const r of input.requests) writeFileSync(r.outPath, DESIGN_PNG);
      return 'no fenced json here';
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'export-failed' });
    expect(String(s.notes)).toContain('no trustworthy FINAL: page enumeration');
  });

  it('Node re-derives the page selection from the reported candidates (child cannot mis-select)', async () => {
    // Child claims `exported` but enumerates TWO candidates while the recipe
    // declares no selector — Node's selectFinalPage overrules the claim.
    seams(DESIGN_PNG);
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      for (const r of input.requests) writeFileSync(r.outPath, DESIGN_PNG);
      return report({
        surfaces: input.requests.map((r) => ({
          surface: r.surface,

          candidates: ['overview', 'expanded'],
        })),
      });
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'page-ambiguous' });
    expect(String(s.notes)).toContain('overview, expanded');
  });

  it('non-selected FINAL: pages ride notes as unreviewed, never silently dropped', async () => {
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      for (const r of input.requests) writeFileSync(r.outPath, DESIGN_PNG);
      return report({
        surfaces: input.requests.map((r) => ({
          surface: r.surface,

          candidates: ['overview', 'expanded'],
        })),
      });
    });
    seams(DESIGN_PNG);
    const { cwd, input } = repo({
      uiBoot: { dashboard: { ...DEFAULT_BOOT.dashboard, page: 'overview' } },
    });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'pass' });
    expect(String(s.notes)).toContain('[dashboard] unreviewed FINAL: pages: expanded');
  });

  it('boot failure fails its whole group as boot-failed', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG, {
      boot: async (surface) => ({
        ok: false,
        url: 'http://127.0.0.1:4001/',
        command: surface.command,
        observed: 'port 4001 already in use before boot',
      }),
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'boot-failed' });
    expect(String(s.notes)).toContain('already in use');
  });

  it('a non-2xx final route status is route-unreachable, not a pixel verdict (AC5)', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG, {
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'route-unreachable' });
    expect(String(s.notes)).toContain('404');
  });

  it('a capture timeout is screenshot-failed naming the cap', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG, {
      capture: async () => ({ code: 1, timedOut: true, stderrTail: '' }),
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'screenshot-failed' });
    expect(String(s.notes)).toContain('timed out after 60000ms');
  });

  it('a capture non-zero exit is screenshot-failed with the stderr tail as a note', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG, {
      capture: async () => ({ code: 7, timedOut: false, stderrTail: 'no browser installed' }),
    });
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'screenshot-failed' });
    expect(String(s.notes)).toContain('no browser installed');
  });

  it('a size-mismatched screenshot is dimension-mismatch naming both sizes (AC5)', async () => {
    exporterWriting(DESIGN_PNG);
    const small = new PNG({ width: 8, height: 8 });
    seams(PNG.sync.write(small));
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    await runRenderCompare(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'dimension-mismatch' });
    expect(String(s.notes)).toContain('16x16');
    expect(String(s.notes)).toContain('8x8');
  });
});

describe('runRenderCompare — the diff verdict', () => {
  it('passes within threshold, records the ratio note, persists artifacts (AC8)', async () => {
    exporterWriting(DESIGN_PNG);
    const log = seams(DESIGN_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'pass' });
    expect(s.reason).toBeUndefined();
    expect(String(s.notes)).toContain('[dashboard] diffRatio 0.000000 ≤ 0.25');
    // {width}/{height} substituted from the decoded design raster.
    expect(log.captures[0]).toContain("'16' '16'");
    const dir = join(cwd, '.noldor', 'cr', 'render-compare', SLUG);
    for (const f of ['dashboard.design.png', 'dashboard.shot.png', 'dashboard.diff.png']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
  });

  it('advisory fail maps findings to low suggestions with ok: true (AC9)', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DRIFTED_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'fail' });
    expect(s.reason).toBeUndefined();
    expect(s.blockers).toEqual([]);
    const sugg = s.suggestions as Array<Record<string, unknown>>;
    expect(sugg).toHaveLength(1);
    expect(sugg[0].severity).toBe('low');
  });

  it('blocking fail carries ratio-derived severities and the full message contract (AC8)', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DRIFTED_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT, mode: 'blocking' });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(false);
    const s = sink(cwd);
    const blockers = s.blockers as Array<Record<string, unknown>>;
    expect(blockers).toHaveLength(1);
    expect(blockers[0].severity).toBe('high'); // 0.625 > 2 × 0.25
    expect(blockers[0].file).toBe(`.noldor/cr/render-compare/${SLUG}/dashboard.diff.png`);
    expect(String(blockers[0].message)).toContain('[dashboard] diffRatio 0.625000 > 0.25');
    expect(String(blockers[0].message)).toContain('design=');
    expect(String(blockers[0].message)).toContain('shot=');
  });

  it('a ratio exactly at the threshold passes (strict >)', async () => {
    exporterWriting(DESIGN_PNG);
    // 8 of 16 rows differ → 0.5 exactly; per-surface maxDiffRatio 0.5.
    seams(png16((_x, y) => (y < 8 ? 0 : 255)));
    const { cwd, input } = repo({
      uiBoot: { dashboard: { ...DEFAULT_BOOT.dashboard, maxDiffRatio: 0.5 } },
    });
    await runRenderCompare(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass' });
  });
});

describe('runRenderCompare — multi-surface aggregation (AC10)', () => {
  it('processes every surface, a failed boot group does not abort the round', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG, {
      boot: async (surface, port) =>
        surface.command.includes('settings')
          ? {
              ok: false,
              url: `http://127.0.0.1:${port}/`,
              command: surface.command,
              observed: 'spawn failed',
            }
          : {
              ok: true,
              url: `http://127.0.0.1:${port}${surface.healthPath}`,
              command: surface.command,
              kill: () => {},
            },
    });
    const { cwd, input } = repo({
      surfaces: { dashboard: ['src/ui/dash/**'], settings: ['src/ui/settings/**'] },
      changed: {
        'src/ui/dash/a.tsx': 'export const A = 1;\n',
        'src/ui/settings/b.tsx': 'export const B = 1;\n',
      },
      verifyCommands: {
        dash: { command: 'serve-dash --port {port}', kind: 'server', healthPath: '/' },
        set: { command: 'serve-settings --port {port}', kind: 'server', healthPath: '/' },
      },
      uiBoot: {
        dashboard: {
          verifyCommand: 'dash',
          route: '/',
          screenshotCommand: 'cap {url} {out} {width} {height}',
        },
        settings: {
          verifyCommand: 'set',
          route: '/settings',
          screenshotCommand: 'cap {url} {out} {width} {height}',
        },
      },
    });
    await runRenderCompare(input);
    const s = sink(cwd);
    // dashboard passed, settings could not boot → worst is cannot-review.
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'boot-failed' });
    const notes = String(s.notes);
    expect(notes).toContain('[dashboard] diffRatio 0.000000');
    expect(notes).toContain('[settings] boot-failed');
  });
});

describe('runRenderCompare — pen-modified precedence (AC6, AC9)', () => {
  it('overrides every per-surface outcome in both modes, keeping the rows as notes', async () => {
    for (const mode of ['advisory', 'blocking'] as const) {
      exporterWriting(DESIGN_PNG);
      const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT, mode });
      seams(DESIGN_PNG, {
        capture: async (command) => {
          const m = command.match(/'([^']*\.shot\.png)'/);
          if (m !== null) writeFileSync(m[1], DESIGN_PNG);
          // Mutate the REPO design mid-round — the one absolute red.
          appendFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'MUTATED\n');
          return { code: 0, timedOut: false, stderrTail: '' };
        },
      });
      const r = await runRenderCompare(input);
      expect(r.ok).toBe(false);
      const s = sink(cwd);
      expect(s).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
      const blockers = s.blockers as Array<Record<string, unknown>>;
      expect(blockers).toHaveLength(1);
      expect(blockers[0].severity).toBe('high');
      expect(String(s.notes)).toContain('[dashboard] diffRatio');
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exporter mutation of the scratch copy alone does NOT trip pen-modified (AC6)', async () => {
    setRenderExportDispatcher(async (input: RenderExportInput) => {
      appendFileSync(input.penPath, 'EXPORTER-TOUCH\n');
      for (const r of input.requests) writeFileSync(r.outPath, DESIGN_PNG);
      return report({
        surfaces: input.requests.map((r) => ({
          surface: r.surface,

          candidates: ['overview'],
        })),
      });
    });
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass' });
  });
});

describe('runRenderCompare — zero affected surfaces (design: required override)', () => {
  const requiredFd = (cwd: string): void => {
    writeFileSync(
      join(cwd, 'docs', 'features', `${SLUG}.md`),
      `---\ndesign: required\n---\n\n## Summary\n\nUI.\n`,
    );
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-qm', 'fd required']);
  };

  it('falls back to every configured uiBoot surface instead of a "0 surfaces" pass', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG);
    const { cwd, input } = repo({
      changed: { 'src/core/not-ui.ts': 'export const x = 1;\n' },
      uiBoot: DEFAULT_BOOT,
    });
    requiredFd(cwd);
    await runRenderCompare({ ...input, artifactSha: git(cwd, ['rev-parse', 'HEAD']) });
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'pass' });
    expect(String(s.notes)).toContain('reviewing every declared surface: dashboard');
    expect(String(s.notes)).toContain('[dashboard] diffRatio');
  });

  it('is cannot-review, never pass, when no uiBoot recipe exists to fall back to', async () => {
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ changed: { 'src/core/not-ui.ts': 'export const x = 1;\n' } });
    requiredFd(cwd);
    const r = await runRenderCompare({ ...input, artifactSha: git(cwd, ['rev-parse', 'HEAD']) });
    expect(r.ok).toBe(true); // advisory default
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-boot-recipe' });
  });
});

describe('runRenderCompare — evidence persistence is part of the contract', () => {
  it('a persist failure downgrades the round to cannot-review, rows kept as notes', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    // Occupy the artifact root with a FILE so the staging mkdir fails.
    mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
    writeFileSync(join(cwd, '.noldor', 'cr', 'render-compare'), 'not a directory');
    const r = await runRenderCompare(input);
    expect(r.ok).toBe(true); // advisory default
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'persist-failed' });
    expect(String(s.notes)).toContain('artifact persist failed');
    expect(String(s.notes)).toContain('[dashboard] diffRatio 0.000000');
  });
});

describe('runRenderCompare — coverage cannot silently shrink', () => {
  it('zero-affected fallback includes DECLARED surfaces without recipes (no partial pass)', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG);
    const { cwd, input } = repo({
      changed: { 'src/core/not-ui.ts': 'export const x = 1;\n' },
      surfaces: { dashboard: ['src/ui/dash/**'], settings: ['src/ui/settings/**'] },
      uiBoot: DEFAULT_BOOT, // recipe for dashboard only
    });
    writeFileSync(
      join(cwd, 'docs', 'features', `${SLUG}.md`),
      `---\ndesign: required\n---\n\n## Summary\n\nUI.\n`,
    );
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-qm', 'fd required']);
    await runRenderCompare({ ...input, artifactSha: git(cwd, ['rev-parse', 'HEAD']) });
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'no-boot-recipe' });
    expect(String(s.notes)).toContain('[settings] no-boot-recipe');
    expect(String(s.notes)).toContain('[dashboard] diffRatio');
  });

  it('a round with zero rasters leaves the prior evidence set untouched', async () => {
    exporterWriting(DESIGN_PNG);
    seams(DESIGN_PNG);
    const { cwd, input } = repo({ uiBoot: DEFAULT_BOOT });
    // Seed a "prior round" evidence set.
    const dir = join(cwd, '.noldor', 'cr', 'render-compare', SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dashboard.design.png'), DESIGN_PNG);
    // This round produces no rasters at all.
    setRenderExportDispatcher(async () => {
      throw new Error('bridge down');
    });
    await runRenderCompare(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'export-failed' });
    expect(existsSync(join(dir, 'dashboard.design.png'))).toBe(true);
  });
});
