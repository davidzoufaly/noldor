// @tests: ui-design-review-lane
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../../../core/run-capture.js';
import { runGeometryReview } from '../../geometry/geometry-review-cli.js';
import { setGeometryReviewDeps } from '../../geometry/geometry-review.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const root = mkdtempSync(join(tmpdir(), 'geo-review-cli-'));
const pen = join(root, 'design.pen');
writeFileSync(pen, 'encrypted');
const TPL = 'node cap.mjs {url} {out} {width} {height}';
const base = [
  '--pen',
  pen,
  '--surface',
  'dashboard',
  '--url',
  'http://127.0.0.1:5173/',
  '--capture',
  TPL,
];

const doc = (x: number): string =>
  JSON.stringify({
    surface: 'dashboard',
    viewport: { width: 1440, height: 900 },
    nodes: [{ kind: 'shape', name: 'Card', box: { x, y: 0, w: 100, h: 40 } }],
  });

/** Stub the reader (design at x=24) and the capture (impl at `implX`, or a failing exit). */
function stub(implX: number | 'fail'): void {
  setGeometryExtractDispatcher(async (input) => {
    writeFileSync(input.requests[0].outPath, doc(24));
    return JSON.stringify({
      surfaces: [{ surface: 'dashboard', candidates: ['overview'], excluded: [] }],
    });
  });
  setGeometryReviewDeps({
    capture: async (command): Promise<CaptureResult> => {
      if (implX === 'fail') return { code: 3, timedOut: false, stderrTail: 'boom' };
      const out = /'([^']+\.impl\.json)'/.exec(command)?.[1];
      if (out === undefined) throw new Error(`no {out} path in ${command}`);
      writeFileSync(out, doc(implX));
      return { code: 0, timedOut: false, stderrTail: '' };
    },
  });
}

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runGeometryReview(argv, (l) => lines.push(l));
  return { code, out: lines.join('\n') };
}

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setGeometryReviewDeps({ capture: undefined });
});

describe('design geometry-review', () => {
  it('prints usage and exits 2 without the required flags', async () => {
    const r = await run(['--pen', pen]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('usage: noldor design geometry-review');
  });

  it('rejects an unknown flag, a malformed slug and a template missing a placeholder', async () => {
    expect((await run([...base, '--bogus', 'x'])).out).toContain('unknown flag --bogus');
    const slug = await run([...base, '--slug', 'Not_A_Slug']);
    expect(slug.code).toBe(2);
    const tpl = await run([
      '--pen',
      pen,
      '--surface',
      'dashboard',
      '--url',
      'http://x/',
      '--capture',
      'node cap.mjs {url}',
    ]);
    expect(tpl.code).toBe(2);
    expect(tpl.out).toContain('--capture is missing {out}');
  });

  it('exits 2 when the design file does not exist', async () => {
    const r = await run(['--pen', join(root, 'nope.pen'), ...base.slice(2)]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('no such design file');
  });

  it('exits 0 with every family within budget on a match', async () => {
    stub(24);
    const r = await run(base);
    expect(r.code).toBe(0);
    expect(r.out).toContain("surface 'dashboard' — pass");
    expect(r.out).toContain('edgesX: 0 unmatched (budget 0)');
  });

  it('exits 1 and names the unmatched values of the failing family on drift', async () => {
    stub(30);
    const r = await run(base);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'edgesX: 4 unmatched (budget 0) design-only [24.00, 124.00] impl-only [30.00, 130.00]',
    );
  });

  it('exits 2 and prints the reason code when the surface cannot be compared', async () => {
    stub('fail');
    const r = await run(base);
    expect(r.code).toBe(2);
    expect(r.out).toContain('geometry-review: geometry-capture-failed: capture exited 3 — boom');
  });
});
