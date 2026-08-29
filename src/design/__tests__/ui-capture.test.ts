// @tests: pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../../core/run-capture.js';
import { main as captureMain, declaredSurfaces } from '../ui-capture-cli.js';
import { blobIdOfWorktreeFile, readReceipt, receiptPath, receiptRelPath } from '../ui-capture.js';

/**
 * Scripted capture runner: a command prefix → the result it produces, plus a
 * record of what it was asked to run. Hand-rolled and injected as a parameter
 * rather than `vi.mock`ed — the subprocess spawn is the system boundary, and
 * everything on this side of it is real (real temp dirs, the real receipt
 * writer, the real schema).
 */
/** Module-level so two runners in one test never write identical bytes. */
let captureSeq = 0;

function scriptedRunner(script: Record<string, Partial<CaptureResult>>, cwd?: () => string) {
  const ran: string[] = [];
  const run = async (command: string): Promise<CaptureResult> => {
    ran.push(command);
    const hit = Object.entries(script).find(([prefix]) => command.startsWith(prefix));
    const result = { code: 0, timedOut: false, stderrTail: '', ...hit?.[1] };
    // A real capture rewrites the surface's baseline, and the wrapper now
    // refuses to vouch when the file is byte-identical to what it was before —
    // a command that exits 0 having written nothing is a failed capture. The
    // fake has to model that or every success case reads as one.
    if (result.code === 0 && !result.timedOut && cwd) {
      const surface = command.replace(/^capture-/, '');
      const abs = join(cwd(), 'docs/design/ui/baseline', `${surface}.pen`);
      if (existsSync(abs)) {
        captureSeq += 1;
        writeFileSync(abs, `CAPTURED-${surface}-${captureSeq}`);
      }
    }
    return result;
  };
  return { run, ran };
}

describe('receiptPath', () => {
  it('refuses a surface name that is not slug-shaped, before building any path', () => {
    for (const bad of ['../escape', 'a/b', 'App', '']) {
      const r = receiptPath('/repo', bad);
      expect(r.ok).toBe(false);
    }
  });

  it('builds the per-surface path under .noldor/ui-capture', () => {
    const r = receiptPath('/repo', 'app');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe('/repo/.noldor/ui-capture/app.json');
    expect(receiptRelPath('app')).toBe('.noldor/ui-capture/app.json');
  });
});

describe('declaredSurfaces', () => {
  it('is the implicit app surface when uiSurfaces is absent', () => {
    expect(declaredSurfaces({ uiPaths: ['src/**'] })).toEqual(['app']);
  });
  it('is every declared surface, sorted, when uiSurfaces is present', () => {
    expect(
      declaredSurfaces({ uiPaths: ['src/**'], uiSurfaces: { b: ['src/b/**'], a: ['src/a/**'] } }),
    ).toEqual(['a', 'b']);
  });
  it('is empty when nothing is UI-bearing', () => {
    expect(declaredSurfaces({})).toEqual([]);
  });
});

describe('design capture', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ui-capture-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function writeConfig(consumer: Record<string, unknown>): Promise<void> {
    await mkdir(join(cwd, '.noldor'), { recursive: true });
    await writeFile(
      join(cwd, '.noldor/config.json'),
      JSON.stringify({
        consumer: {
          name: 'x',
          repoUrl: 'https://example.com/x',
          lockstepPackages: ['x'],
          e2ePrefix: 'e2e',
          samplesPath: 'samples',
          packagePrefix: '@x/',
          appPathPrefix: 'apps/',
          ...consumer,
        },
      }),
      'utf8',
    );
  }

  async function writeBaseline(surface: string, content: string): Promise<void> {
    const abs = join(cwd, 'docs/design/ui/baseline', `${surface}.pen`);
    await mkdir(join(cwd, 'docs/design/ui/baseline'), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }

  const deps = (script: Record<string, Partial<CaptureResult>>) => {
    const s = scriptedRunner(script, () => cwd);
    return { deps: { run: s.run, now: () => '2026-08-29T00:00:00.000Z' }, ran: s.ran };
  };

  it('writes a receipt bound to the produced baseline when the command exits 0', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN-BYTES');
    const { deps: d } = deps({ 'capture-app': { code: 0 } });

    expect(await captureMain([], cwd, d)).toBe(0);

    const receipt = readReceipt(cwd, 'app');
    expect(receipt).not.toBeNull();
    expect(receipt?.baselineBlob).toBe(
      blobIdOfWorktreeFile(cwd, 'docs/design/ui/baseline/app.pen'),
    );
    expect(receipt?.command).toBe('capture-app');
  });

  it('leaves the receipt untouched when the command exits non-zero', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN-BYTES');
    const priorPath = receiptPath(cwd, 'app');
    if (!priorPath.ok) throw new Error(priorPath.message);
    await mkdir(join(cwd, '.noldor/ui-capture'), { recursive: true });
    const prior = JSON.stringify({
      capturedAt: '2020-01-01T00:00:00.000Z',
      baselineBlob: 'a'.repeat(40),
      command: 'capture-app',
    });
    await writeFile(priorPath.path, prior, 'utf8');

    const { deps: d } = deps({ 'capture-app': { code: 8, stderrTail: 'state 8 of 10 failed' } });
    expect(await captureMain([], cwd, d)).toBe(1);

    expect(await readFile(priorPath.path, 'utf8')).toBe(prior);
  });

  it('treats a timeout as a failed capture, leaving no receipt', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN-BYTES');
    const { deps: d } = deps({ 'capture-app': { code: 0, timedOut: true } });

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(readReceipt(cwd, 'app')).toBeNull();
  });

  it('refuses to vouch when the command exits 0 but left the baseline untouched', async () => {
    // Exit 0 alone proves nothing. A misconfigured command can succeed without
    // writing, and an old baseline already on disk would then satisfy the
    // existence check and advance the receipt — the false-fresh, restored.
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'noop-cmd' } } });
    await writeBaseline('app', 'STALE-FROM-LAST-TIME');
    // `noop-cmd` does not match the runner's `capture-` prefix, so it writes
    // nothing — exactly the broken-command shape.
    const { deps: d } = deps({});

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(readReceipt(cwd, 'app')).toBeNull();
    expect(await readFile(join(cwd, 'docs/design/ui/baseline/app.pen'), 'utf8')).toBe(
      'STALE-FROM-LAST-TIME',
    );
  });

  it('refuses to vouch when the command exits 0 but produced no baseline', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    const { deps: d } = deps({ 'capture-app': { code: 0 } });

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(readReceipt(cwd, 'app')).toBeNull();
  });

  it('captures one surface without disturbing another surface receipt', async () => {
    await writeConfig({
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
      uiCapture: { a: { command: 'capture-a' }, b: { command: 'capture-b' } },
    });
    await writeBaseline('a', 'A-BYTES');
    await writeBaseline('b', 'B-BYTES');
    const { deps: d, ran } = deps({});
    await captureMain([], cwd, d);
    const bBefore = await readFile(join(cwd, receiptRelPath('b')), 'utf8');

    const { deps: d2, ran: ran2 } = deps({});
    expect(await captureMain(['--surface', 'a'], cwd, d2)).toBe(0);

    expect(ran).toEqual(['capture-a', 'capture-b']);
    expect(ran2).toEqual(['capture-a']);
    expect(await readFile(join(cwd, receiptRelPath('b')), 'utf8')).toBe(bBefore);
  });

  it('persists the surfaces that succeeded when another fails, and still exits non-zero', async () => {
    await writeConfig({
      uiPaths: ['src/a/**', 'src/b/**', 'src/c/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'], c: ['src/c/**'] },
      uiCapture: {
        a: { command: 'capture-a' },
        b: { command: 'capture-b' },
        c: { command: 'capture-c' },
      },
    });
    await writeBaseline('a', 'A');
    await writeBaseline('b', 'B');
    await writeBaseline('c', 'C');
    const { deps: d } = deps({ 'capture-b': { code: 3 } });

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(readReceipt(cwd, 'a')).not.toBeNull();
    expect(readReceipt(cwd, 'b')).toBeNull();
    expect(readReceipt(cwd, 'c')).not.toBeNull();
  });

  it('records the id git would store, not a hash of the working-tree bytes', async () => {
    // Both sides of the binding check must come from git, or `core.autocrlf`, a
    // `text=auto` attribute, a clean filter or LFS would make the receipt
    // disagree with the stored blob permanently — a blocking stale no capture
    // can clear.
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN-BYTES');
    const { deps: d } = deps({});
    await captureMain([], cwd, d);

    const stored = readReceipt(cwd, 'app')?.baselineBlob;
    const viaGit = execFileSync('git', ['hash-object', '--', 'docs/design/ui/baseline/app.pen'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    expect(stored).toBe(viaGit);
  });

  it('--vouch-only records the baseline on disk without running the command', async () => {
    // The gate's sanctioned Step 4 write-back pencil-edits the baseline by
    // hand. That changes the blob, so the surface mints stale — and re-running
    // the consumer's capture to clear it would overwrite the very edit just
    // made. Vouching is the only move that keeps both.
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'HAND-EDITED-BY-PENCIL');
    const { deps: d, ran } = deps({});

    expect(await captureMain(['--surface', 'app', '--vouch-only'], cwd, d)).toBe(0);

    expect(ran).toEqual([]);
    expect(await readFile(join(cwd, 'docs/design/ui/baseline/app.pen'), 'utf8')).toBe(
      'HAND-EDITED-BY-PENCIL',
    );
    expect(readReceipt(cwd, 'app')?.baselineBlob).toBe(
      blobIdOfWorktreeFile(cwd, 'docs/design/ui/baseline/app.pen'),
    );
  });

  it('refuses to nest, so a self-invoking alias fails cleanly', async () => {
    // Pointing uiCapture.command at the alias that invokes this wrapper makes
    // it call itself; each level spawns another detached group the outer
    // timeout cannot reap, so the failure mode is process exhaustion.
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN');
    const { deps: d, ran } = deps({});
    const prior = process.env.NOLDOR_CAPTURE_RUNNING;
    process.env.NOLDOR_CAPTURE_RUNNING = '1';
    try {
      expect(await captureMain([], cwd, d)).toBe(2);
      expect(ran).toEqual([]);
    } finally {
      if (prior === undefined) delete process.env.NOLDOR_CAPTURE_RUNNING;
      else process.env.NOLDOR_CAPTURE_RUNNING = prior;
    }
  });

  it('restores the nesting flag so a second in-process run is not refused', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN');
    const { deps: d } = deps({});
    expect(await captureMain([], cwd, d)).toBe(0);
    expect(process.env.NOLDOR_CAPTURE_RUNNING).toBeUndefined();
  });

  it('does not resolve a surface named after an Object prototype key', async () => {
    // SURFACE_NAME_RE admits `constructor`, and a plain index would resolve it
    // to `Object` rather than undefined — spawning `/bin/sh -c undefined` with
    // an undefined timeout.
    await writeConfig({
      uiPaths: ['src/**'],
      uiSurfaces: { constructor: ['src/**'] },
      uiCapture: {},
    });
    const { deps: d, ran } = deps({});

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(ran).toEqual([]);
  });

  it('refuses a bare --vouch-only, which would green untouched surfaces', async () => {
    await writeConfig({
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
      uiCapture: { a: { command: 'capture-a' }, b: { command: 'capture-b' } },
    });
    await writeBaseline('a', 'A');
    await writeBaseline('b', 'B');
    const { deps: d } = deps({});

    expect(await captureMain(['--vouch-only'], cwd, d)).toBe(2);
    expect(readReceipt(cwd, 'a')).toBeNull();
    expect(readReceipt(cwd, 'b')).toBeNull();
  });

  it('vouches for a surface that declares no capture command, so adoption has an exit', async () => {
    // Without this, a consumer that later drops `uiCapture` for an adopted
    // surface has every subsequent UI commit block the release with no command
    // able to clear it. Vouching runs nothing, so it needs no command.
    await writeConfig({ uiPaths: ['src/**'] });
    await writeBaseline('app', 'PEN');
    const { deps: d, ran } = deps({});

    expect(await captureMain(['--surface', 'app', '--vouch-only'], cwd, d)).toBe(0);
    expect(ran).toEqual([]);
    expect(readReceipt(cwd, 'app')?.baselineBlob).toBe(
      blobIdOfWorktreeFile(cwd, 'docs/design/ui/baseline/app.pen'),
    );
  });

  it('reports an unwritable receipt as a failed surface instead of aborting the run', async () => {
    await writeConfig({
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
      uiCapture: { a: { command: 'capture-a' }, b: { command: 'capture-b' } },
    });
    await writeBaseline('a', 'A');
    await writeBaseline('b', 'B');
    // A regular file where the receipt directory must go: mkdirSync throws
    // ENOTDIR, which would otherwise escape writeReceipt's result type and kill
    // the whole multi-surface run on its first surface.
    await mkdir(join(cwd, '.noldor'), { recursive: true });
    await writeFile(join(cwd, '.noldor/ui-capture'), 'not a directory', 'utf8');
    const { deps: d, ran } = deps({});

    expect(await captureMain([], cwd, d)).toBe(1);
    // Both surfaces were still attempted — the failure did not abort the loop.
    expect(ran).toEqual(['capture-a', 'capture-b']);
  });

  it('exits 2 on an unknown surface and builds no path for it', async () => {
    await writeConfig({ uiPaths: ['src/**'], uiCapture: { app: { command: 'capture-app' } } });
    await writeBaseline('app', 'PEN');
    const { deps: d, ran } = deps({});

    expect(await captureMain(['--surface', 'nope'], cwd, d)).toBe(2);
    expect(ran).toEqual([]);
    expect(readReceipt(cwd, 'nope')).toBeNull();
  });

  it('exits non-zero when a UI surface declares no capture command', async () => {
    await writeConfig({
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
      uiCapture: { a: { command: 'capture-a' } },
    });
    await writeBaseline('a', 'A');
    const { deps: d } = deps({});

    expect(await captureMain([], cwd, d)).toBe(1);
    expect(readReceipt(cwd, 'a')).not.toBeNull();
  });
});
