// @tests: main-module-guard-fails-on-percent-encoded-paths
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Proves the wiring, not the predicate: `cli-entry.test.ts` tables
 * `isEntrypoint` itself, and the choke-point invariant proves no site bypasses
 * it. What only a real process can show is that a checkout at an encoded path
 * still runs the dispatched module's body — the whole point of the change.
 *
 * Two entrypoints rather than all 42. A broken guard produces empty stdout
 * rather than an error (the module is imported, the body is skipped, the
 * process exits 0), so asserting on real output is exactly the discriminator.
 */
let tempBase: string;
let spacedRoot: string;

beforeAll(() => {
  // `realpathSync` the temp base before building anything under it. On macOS
  // `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`,
  // and Node resolves a module to its realpath while `process.argv[1]` keeps
  // the path as it was given. Skip this and the guard compares two spellings of
  // one file, so the fixture fails on the symlink rather than on the
  // percent-encoding it is here to test — a red that looks like the defect and
  // is not it.
  tempBase = mkdtempSync(join(realpathSync(tmpdir()), 'noldor-spaced-'));
  spacedRoot = join(tempBase, 'a dir with spaces');

  for (const rel of ['bin', 'src']) {
    cpSync(join(REPO_ROOT, rel), join(spacedRoot, rel), { recursive: true });
  }
  for (const rel of ['package.json', 'tsconfig.json']) {
    cpSync(join(REPO_ROOT, rel), join(spacedRoot, rel));
  }
  // Symlinked, not copied: node_modules is ~180M and module resolution follows
  // the link. The link target has no space in it, which is fine — the path
  // under test is the one Node puts in `process.argv[1]`, and that is the
  // copied `bin/noldor.mjs` below the spaced directory.
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(spacedRoot, 'node_modules'));
});

afterAll(() => {
  rmSync(tempBase, { force: true, recursive: true });
});

/** Run a routed command from the spaced-path copy, returning its stdout. */
function runFromSpacedPath(args: readonly string[]): string {
  return execFileSync(process.execPath, [join(spacedRoot, 'bin', 'noldor.mjs'), ...args], {
    cwd: spacedRoot,
    encoding: 'utf8',
    // Pinned so the fixture does not depend on whether a dist happens to exist
    // in the copy; the copy carries src/ and no dist/.
    env: { ...process.env, NOLDOR_RUNTIME: 'source' },
  });
}

describe('entrypoints invoked from a checkout whose path needs percent-encoding', () => {
  it('runs a validator body — the off-template isMain guard', () => {
    // src/milestones/validate-milestones.ts assigns the guard to `const isMain`
    // and branches on it below, rather than gating inline.
    expect(runFromSpacedPath(['validate', 'milestones'])).toContain(
      'Validated milestones — all OK.',
    );
  });

  it('runs a plain on-template entrypoint body', () => {
    // src/prep/print-format.ts is the ordinary shape: an inline `if` around the
    // whole body, which is what 33 of the swept sites look like.
    expect(runFromSpacedPath(['prep', 'format', 'spec'])).toContain('SPEC FORMAT');
  });

  it('confirms the fixture path really does need encoding, so the rows above mean something', () => {
    // Without this precondition the two tests above would pass from an
    // unencoded path and prove nothing about the defect. The claim is precisely
    // that the encoder and a hand-built template disagree here — which is what
    // made all 42 guards go silently false on such a checkout.
    expect(spacedRoot).toContain(' ');
    expect(pathToFileURL(spacedRoot).href).not.toBe(`file://${spacedRoot}`);
  });
});
