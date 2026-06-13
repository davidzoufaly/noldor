import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Migration } from '../types.js';
import { resolveChain, runChain, renderSteps } from '../chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', '0.2.0');
const cfg = { frameworkVersion: '0.2.0' } as never;

// Synthetic migrations exercise the engine without faking production ones.
const m030: Migration = {
  from: '0.2.0',
  to: '0.3.0',
  description: 'rewrite sample.txt key',
  dryRun(cwd) {
    const path = 'sample.txt';
    const before = readFileSync(join(cwd, path), 'utf8');
    return [{ path, before, after: before.replace('oldKey', 'newKey') }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, cfg);
    for (const s of steps) writeFileSync(join(cwd, s.path), s.after);
    return steps;
  },
};
const m040: Migration = {
  from: '0.3.0',
  to: '0.4.0',
  description: 'append marker',
  dryRun(cwd) {
    const path = 'sample.txt';
    const before = readFileSync(join(cwd, path), 'utf8');
    return [{ path, before, after: `${before}migrated: true\n` }];
  },
  migrate(cwd) {
    const steps = this.dryRun(cwd, cfg);
    for (const s of steps) writeFileSync(join(cwd, s.path), s.after);
    return steps;
  },
};

const ALL = [m040, m030]; // deliberately unsorted

describe('resolveChain', () => {
  it('selects + orders the contiguous slice', () => {
    expect(resolveChain(ALL, '0.2.0', '0.4.0').map((m) => m.to)).toEqual(['0.3.0', '0.4.0']);
  });
  it('is empty when already current', () => {
    expect(resolveChain(ALL, '0.4.0', '0.4.0')).toEqual([]);
  });
  it('throws on downgrade', () => {
    expect(() => resolveChain(ALL, '0.4.0', '0.2.0')).toThrow(/downgrade/);
  });
  it('throws on a chain gap', () => {
    expect(() => resolveChain([m040], '0.2.0', '0.4.0')).toThrow(/gap/);
  });
});

describe('runChain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-mig-'));
    cpSync(FIXTURE, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('dry-run reports steps without touching disk', () => {
    const before = readFileSync(join(dir, 'sample.txt'), 'utf8');
    const chain = resolveChain(ALL, '0.2.0', '0.4.0');
    const res = runChain(chain, dir, cfg, { dryRun: true });
    expect(res.flatMap((r) => r.steps)).toHaveLength(2);
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe(before);
  });

  it('apply lands every step (snapshot)', () => {
    const chain = resolveChain(ALL, '0.2.0', '0.4.0');
    runChain(chain, dir, cfg, { dryRun: false });
    expect(readFileSync(join(dir, 'sample.txt'), 'utf8')).toBe('newKey: value\nmigrated: true\n');
  });
});

describe('renderSteps', () => {
  it('shows path + changed lines', () => {
    const out = renderSteps([{ path: 'a.txt', before: 'x\n', after: 'y\n' }]);
    expect(out).toContain('a.txt');
    expect(out).toContain('-x');
    expect(out).toContain('+y');
  });
});
