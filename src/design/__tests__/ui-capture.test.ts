// @tests: pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
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
function scriptedRunner(script: Record<string, Partial<CaptureResult>>) {
  const ran: string[] = [];
  const run = async (command: string): Promise<CaptureResult> => {
    ran.push(command);
    const hit = Object.entries(script).find(([prefix]) => command.startsWith(prefix));
    return { code: 0, timedOut: false, stderrTail: '', ...hit?.[1] };
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
    const s = scriptedRunner(script);
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
