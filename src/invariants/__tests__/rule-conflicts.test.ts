// @tests: framework-script-test-migration-cleanup
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeRuleConflictsInvariant } from '../rule-conflicts.js';

import type { RulePairInvariant } from '../rule-pairs.js';

const pair: RulePairInvariant = {
  name: 'test-pair',
  docA: 'docs/a.md',
  docB: 'docs/b.md',
  patternA: /pnpm test\b/,
  patternB: /pnpm test\b/,
  message: 'docs/a.md and docs/b.md must both reference `pnpm test`.',
};

describe('makeRuleConflictsInvariant', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rule-conflicts-'));
    mkdirSync(join(root, 'docs'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes when both docs match the canonical phrasing', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'CI runs pnpm test\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.invariant).toBe('rule-conflicts');
    expect(result.violations).toEqual([]);
  });

  it('flags the non-matching side when exactly one doc matches', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'CI runs the suite\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([{ file: 'docs/b.md', message: pair.message }]);
  });

  it('stays silent when neither doc matches (rule absent in both)', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'nothing here\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'nothing here either\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([]);
  });

  it('treats a missing doc as non-matching (missing-file tolerance)', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([{ file: 'docs/b.md', message: pair.message }]);
  });
});
