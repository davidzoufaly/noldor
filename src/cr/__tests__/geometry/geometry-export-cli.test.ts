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

const report = (candidates: string[], excluded: string[] = [], pageId = 'p-overview'): string =>
  JSON.stringify({ surfaces: [{ surface: 'dashboard', candidates, excluded, pageId }] });

const dir = mkdtempSync(join(tmpdir(), 'geo-export-'));
const pen = join(dir, 'design.pen');
writeFileSync(
  pen,
  JSON.stringify({
    version: '2.6',
    children: [
      { id: 'p-overview', name: 'FINAL:dashboard: overview', type: 'frame' },
      { id: 'p-settings', name: 'FINAL:settings: default', type: 'frame' },
    ],
  }),
  'utf8',
);

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

  it('exits 1 without writing when the reported pages are not the ones in the named .pen', async () => {
    setGeometryExtractDispatcher(async (input) => {
      writeFileSync(input.requests[0].outPath, doc('dashboard'), 'utf8');
      return report(['home'], [], 'other-doc-page');
    });
    const { code, text } = await run(join(dir, 'other-doc.json'));
    expect(code).toBe(1);
    expect(text).not.toContain('wrote');
    expect(text).toContain('candidates [home] but the .pen on disk holds [overview]');
    expect(text).toContain('likely read a different open document');
  });

  it('exits 1 when the reported page id is not the selected page in the named .pen', async () => {
    setGeometryExtractDispatcher(async (input) => {
      writeFileSync(input.requests[0].outPath, doc('dashboard'), 'utf8');
      return report(['overview'], [], 'p-settings');
    });
    const { code, text } = await run(join(dir, 'wrong-id.json'));
    expect(code).toBe(1);
    expect(text).not.toContain('wrote');
    expect(text).toContain("page id 'p-settings'");
    expect(text).toContain('likely read a different open document');
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
