// @tests: noldor-package-lift
// The selector lives in bin/ as plain .mjs — it runs before any TypeScript is
// loadable — but its tests live here, where vitest's include glob reaches.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs sibling with no type declarations by design
import { STAMP_VERSION, computeDigest, selectRuntime } from '../../../bin/runtime-select.mjs';

const REPO_ROOT = join(import.meta.dirname, '../../..');

let root: string;

function tree(opts: { dist?: boolean; source?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-select-'));
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
  if (opts.source !== false) {
    mkdirSync(join(dir, 'src/cli'), { recursive: true });
    writeFileSync(join(dir, 'src/cli/index.ts'), 'export {};\n');
  }
  if (opts.dist !== false) {
    mkdirSync(join(dir, 'dist/cli'), { recursive: true });
    writeFileSync(join(dir, 'dist/cli/index.js'), 'export {};\n');
  }
  return dir;
}

const stamp = (dir: string, body: Record<string, unknown>): void =>
  writeFileSync(join(dir, 'dist/.build-stamp'), JSON.stringify(body));

beforeEach(() => {
  root = tree();
});
afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('selectRuntime overrides', () => {
  it('treats unset and empty alike as no override', () => {
    expect(selectRuntime(root, {}).reason).not.toBe('bad-override');
    expect(selectRuntime(root, { NOLDOR_RUNTIME: '' }).reason).not.toBe('bad-override');
  });

  it('rejects any other value', () => {
    expect(selectRuntime(root, { NOLDOR_RUNTIME: 'yes' })).toEqual({
      reason: 'bad-override',
      runtime: 'error',
      stale: false,
    });
  });

  it('errors when forced dist has no dist', () => {
    const bare = tree({ dist: false });
    try {
      expect(selectRuntime(bare, { NOLDOR_RUNTIME: 'dist' }).reason).toBe('forced-dist-absent');
    } finally {
      rmSync(bare, { force: true, recursive: true });
    }
  });

  it('errors when forced source has no src', () => {
    const bare = tree({ source: false });
    try {
      expect(selectRuntime(bare, { NOLDOR_RUNTIME: 'source' }).reason).toBe('forced-source-no-src');
    } finally {
      rmSync(bare, { force: true, recursive: true });
    }
  });

  it('errors when forced source finds no installed tsx', () => {
    expect(selectRuntime(root, { NOLDOR_RUNTIME: 'source' }).reason).toBe('forced-source-no-tsx');
  });

  it('serves a forced dist even when stale, flagged for the caller to announce', () => {
    expect(selectRuntime(root, { NOLDOR_RUNTIME: 'dist' })).toEqual({
      reason: 'forced-dist-stale',
      runtime: 'dist',
      stale: true,
    });
  });
});

describe('selectRuntime freshness', () => {
  it('reports no-stamp when the build never stamped', () => {
    expect(selectRuntime(root, {}).reason).toBe('no-stamp');
  });

  it('reports bad-stamp on malformed json, unknown version, or an escaping output', () => {
    writeFileSync(join(root, 'dist/.build-stamp'), 'not json');
    expect(selectRuntime(root, {}).reason).toBe('bad-stamp');
    stamp(root, { digest: 'x', outputs: [], version: 99 });
    expect(selectRuntime(root, {}).reason).toBe('bad-stamp');
    stamp(root, { digest: 'x', outputs: ['../escape.js'], version: STAMP_VERSION });
    expect(selectRuntime(root, {}).reason).toBe('bad-stamp');
  });

  it('reports digest-mismatch when a digest input changed', () => {
    stamp(root, { digest: 'stale', outputs: [], version: STAMP_VERSION });
    expect(selectRuntime(root, {}).reason).toBe('digest-mismatch');
  });

  it('reports missing-output when a recorded output is gone', () => {
    stamp(root, {
      digest: computeDigest(root),
      outputs: ['cli/index.js', 'gone.js'],
      version: STAMP_VERSION,
    });
    expect(selectRuntime(root, {}).reason).toBe('missing-output');
  });

  it('selects dist when the digest matches and every output exists', () => {
    stamp(root, { digest: computeDigest(root), outputs: ['cli/index.js'], version: STAMP_VERSION });
    expect(selectRuntime(root, {})).toEqual({
      reason: 'digest-match',
      runtime: 'dist',
      stale: false,
    });
  });

  it('changes the digest when an input is deleted, not only when one is edited', () => {
    const before = computeDigest(root);
    writeFileSync(join(root, 'src/cli/extra.ts'), 'export {};\n');
    const added = computeDigest(root);
    rmSync(join(root, 'src/cli/extra.ts'));
    expect(added).not.toBe(before);
    expect(computeDigest(root)).toBe(before);
  });

  it('changes the digest when tsconfig options move but the input set does not', () => {
    const before = computeDigest(root);
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "target": "ES2020" } }\n');
    expect(computeDigest(root)).not.toBe(before);
  });

  it('takes the source path while a live build holds the lock, and leaves the lock alone', () => {
    stamp(root, { digest: computeDigest(root), outputs: ['cli/index.js'], version: STAMP_VERSION });
    writeFileSync(join(root, 'dist/.build-lock'), String(process.pid));
    expect(selectRuntime(root, {}).reason).toBe('build-in-progress');
    expect(selectRuntime(root, {}).stale).toBe(true);
    expect(selectRuntime(root, {}).reason).toBe('build-in-progress');
  });

  it('ignores a lock left by a dead pid', () => {
    stamp(root, { digest: computeDigest(root), outputs: ['cli/index.js'], version: STAMP_VERSION });
    writeFileSync(join(root, 'dist/.build-lock'), '4194304');
    expect(selectRuntime(root, {}).reason).toBe('digest-match');
  });

  it('selects dist unconditionally in an installed package with no source tree', () => {
    const installed = tree({ source: false });
    try {
      expect(selectRuntime(installed, {})).toEqual({
        reason: 'no-source-tree',
        runtime: 'dist',
        stale: false,
      });
    } finally {
      rmSync(installed, { force: true, recursive: true });
    }
  });

  it('never writes to the filesystem', () => {
    const copy = mkdtempSync(join(tmpdir(), 'runtime-select-copy-'));
    cpSync(root, copy, { recursive: true });
    try {
      selectRuntime(root, {});
      selectRuntime(root, { NOLDOR_RUNTIME: 'dist' });
      selectRuntime(root, { NOLDOR_RUNTIME: 'bogus' });
      expect(computeDigest(root)).toBe(computeDigest(copy));
    } finally {
      rmSync(copy, { force: true, recursive: true });
    }
  });
});

describe('this repo', () => {
  it('resolves a verdict for the real tree', () => {
    // A generous ceiling on purpose. The 25ms acceptance budget is measured by
    // `node bin/bench-runtime-select.mjs`, in isolation: inside the parallel
    // suite the same code measures 15ms alone and 116ms under 17 workers, so a
    // tight assertion here would gate on machine contention rather than on the
    // verdict path. This bound only catches a pathological regression.
    const start = performance.now();
    const verdict = selectRuntime(REPO_ROOT, {});
    expect(performance.now() - start).toBeLessThan(2000);
    expect(['dist', 'source']).toContain(verdict.runtime);
  });
});
