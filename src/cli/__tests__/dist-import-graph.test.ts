// @tests: noldor-package-lift
// Every relative specifier in the compiled tree must resolve on disk.
//
// This is the check that `--help` cannot make: the router returns on a help flag
// BEFORE dispatching, so sweeping `<cmd> --help` proves only that the router
// loads. And tsx resolves an extensionless relative import while plain Node ESM
// does not, so `from '../core/session'` works in a checkout and crashes the same
// command under dist. Static resolution finds that class without executing 112
// entrypoints, which importing them would.

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs siblings, no type declarations by design
import { auditImportGraph } from '../../../bin/import-graph.mjs';
// @ts-expect-error — same
import { currentState } from '../../../bin/runtime-select.mjs';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const DIST = join(REPO_ROOT, 'dist');

describe('the compiled import graph', () => {
  it('audits a build that matches the current sources', () => {
    // Auditing a stale dist would pass on output unrelated to these sources.
    expect(currentState(REPO_ROOT)).toBe('digest-match');
  });

  it('resolves every relative specifier to a real file', () => {
    expect(auditImportGraph(DIST).unresolved).toEqual([]);
  });

  it('carries no extensionless relative specifier', () => {
    expect(auditImportGraph(DIST).extensionless).toEqual([]);
  });
});
