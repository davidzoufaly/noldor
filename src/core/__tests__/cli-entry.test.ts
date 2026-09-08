// @tests: code-clone-detector, main-module-guard-fails-on-percent-encoded-paths
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { invokedDirectly, isEntrypoint, readValueFlags } from '../cli-entry.js';

describe('invokedDirectly', () => {
  it('matches the module by stem across source and build extensions', () => {
    expect(invokedDirectly('clones-cli', '/repo/src/clones/clones-cli.ts')).toBe(true);
    expect(invokedDirectly('clones-cli', '/repo/dist/clones/clones-cli.js')).toBe(true);
    expect(invokedDirectly('clones-cli', '/repo/dist/clones/clones-cli.mjs')).toBe(true);
    expect(invokedDirectly('clones-cli', 'C:\\repo\\src\\clones\\clones-cli.js')).toBe(true);
  });

  it('does not match another module, a bare prefix, or a missing argv', () => {
    expect(invokedDirectly('clones-cli', '/repo/src/core/wait-cli.ts')).toBe(false);
    // The separator is required, so `my-clones-cli.ts` is a different module.
    expect(invokedDirectly('clones-cli', '/repo/src/my-clones-cli.ts')).toBe(false);
    expect(invokedDirectly('clones-cli', '/repo/src/clones/clones-cli.txt')).toBe(false);
    expect(invokedDirectly('clones-cli', undefined)).toBe(false);
  });
});

// A predicate that gates execution fails in two directions, and each is a
// different defect: a false negative silently disables the guarded body (the
// bug this replaces), a false positive makes an imported module run its CLI and
// call process.exit mid-dispatch. Both get their own rows.
//
// Expected URLs are hardcoded percent-encoded literals throughout. Deriving
// them with `pathToFileURL` would move both sides of the assertion together, so
// every row would pass for any encoder — the reverted `file://${argv[1]}`
// template included, which is exactly the defect these rows exist to catch.
describe('isEntrypoint', () => {
  it('matches a path needing percent-encoding, which the file:// template did not', () => {
    expect(isEntrypoint('file:///repo/my%20dir/m.ts', '/repo/my dir/m.ts')).toBe(true);
    expect(isEntrypoint('file:///repo/a%23b/m.ts', '/repo/a#b/m.ts')).toBe(true);
    expect(isEntrypoint('file:///repo/caf%C3%A9/m.ts', '/repo/café/m.ts')).toBe(true);
  });

  it('matches a plain path, and one whose characters need no encoding', () => {
    expect(isEntrypoint('file:///repo/src/m.ts', '/repo/src/m.ts')).toBe(true);
    expect(isEntrypoint('file:///repo/a+b/m.ts', '/repo/a+b/m.ts')).toBe(true);
  });

  it('resolves a relative argv against the cwd', () => {
    // Asserted against this file's own runtime URL rather than a built literal:
    // the expectation is `true`, and the path comes from the inverse function.
    const self = fileURLToPath(import.meta.url);
    expect(isEntrypoint(import.meta.url, relative(process.cwd(), self))).toBe(true);
  });

  it('does not match a sibling module or a namesake in another directory', () => {
    expect(isEntrypoint('file:///repo/src/a.ts', '/repo/src/b.ts')).toBe(false);
    expect(isEntrypoint('file:///repo/src/release/index.ts', '/repo/src/cli/index.ts')).toBe(false);
    expect(isEntrypoint('file:///repo/src/cr/codex.ts', '/repo/src/cr/lanes/codex.ts')).toBe(false);
  });

  it('returns false for an empty argv without throwing', () => {
    // `''` is the assertion, not `undefined`: an explicit `undefined` selects
    // the `process.argv[1]` default and would compare against the test
    // runner's own path, pinning nothing.
    expect(() => isEntrypoint('file:///repo/src/m.ts', '')).not.toThrow();
    expect(isEntrypoint('file:///repo/src/m.ts', '')).toBe(false);
  });

  it('separates namesakes that invokedDirectly cannot', () => {
    // Why this predicate exists beside `invokedDirectly`: six `index.ts` and
    // four `codex.ts` files live under `src/`, so a stem regex cannot tell a
    // dispatched `cli/index.ts` from an imported `release/index.ts` — it says
    // yes to both, and the imported one would run its CLI body.
    expect(invokedDirectly('index', '/repo/src/cli/index.ts')).toBe(true);
    expect(isEntrypoint('file:///repo/src/release/index.ts', '/repo/src/cli/index.ts')).toBe(false);
  });

  // No Windows-drive row. `pathToFileURL` is platform-dependent — on POSIX it
  // treats `C:\repo\m.ts` as one cwd-relative filename and encodes the
  // backslashes — so such a row would pin Node's platform behaviour rather than
  // this predicate. `invokedDirectly` needs its own separator row above because
  // its regex handles separators itself; this one delegates that to Node.
});

describe('readValueFlags', () => {
  it('reads every declared flag and returns the leftovers as positionals', () => {
    const r = readValueFlags(
      ['doc.json', '--side', 'impl', '--surface', 'dashboard'],
      ['--side', '--surface'],
      'demo',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.get('--side')).toBe('impl');
      expect(r.values.get('--surface')).toBe('dashboard');
      expect(r.positional).toEqual(['doc.json']);
    }
  });

  it('keeps a positional whose text equals a flag value', () => {
    const r = readValueFlags(['impl', '--side', 'impl'], ['--side'], 'demo');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.positional).toEqual(['impl']);
  });

  it('rejects a flag-shaped value rather than swallowing the next flag name', () => {
    const r = readValueFlags(
      ['doc.json', '--surface', '--side', 'impl'],
      ['--side', '--surface'],
      'demo',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('--surface requires a value');
  });

  it('reports an unknown flag left among the positionals', () => {
    const r = readValueFlags(['doc.json', '--zoom'], ['--side'], 'demo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown flag --zoom');
  });

  it('reports a flag given as the last token', () => {
    const r = readValueFlags(['doc.json', '--side'], ['--side'], 'demo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('--side requires a value');
  });
});
