// @tests: architecture-invariants

import { formatResults, runAll } from '../check-invariants.js';

import type { Invariant } from '../../invariants/types.js';

const passing: Invariant = {
  description: 'always passes',
  name: 'pass',
  async run() {
    return { invariant: 'pass', violations: [], durationMs: 1 };
  },
};

const failing: Invariant = {
  description: 'always fails',
  name: 'fail',
  async run() {
    return {
      invariant: 'fail',
      violations: [{ file: 'x.ts', line: 5, message: 'bad' }],
      durationMs: 2,
    };
  },
};

const throwing: Invariant = {
  description: 'throws while running',
  name: 'throws',
  async run() {
    throw new Error('boom');
  },
};

const warning: Invariant = {
  description: 'emits a non-blocking warning',
  name: 'warn',
  async run() {
    return {
      invariant: 'warn',
      violations: [{ file: 'README.md', message: 'soft drift', severity: 'warn' }],
      durationMs: 3,
    };
  },
};

describe(runAll, () => {
  it('returns exit 0 and no failures when all pass', async () => {
    const result = await runAll([passing]);
    expect(result.exitCode).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it('returns exit 1 and lists failed invariants on any violation', async () => {
    const result = await runAll([passing, failing]);
    expect(result.exitCode).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.invariant).toBe('fail');
  });

  it('exits 0 when the only violations are warnings', async () => {
    const result = await runAll([passing, warning]);
    expect(result.exitCode).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it('still exits 1 when a blocking violation accompanies a warning', async () => {
    const result = await runAll([warning, failing]);
    expect(result.exitCode).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.invariant).toBe('fail');
  });

  it('runs all invariants even when one fails (no fail-fast)', async () => {
    const result = await runAll([failing, passing]);
    expect(result.results).toHaveLength(2);
  });

  it('converts thrown plugin errors into grouped violations', async () => {
    const result = await runAll([throwing, passing]);
    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.failed[0]?.invariant).toBe('throws');
    expect(result.failed[0]?.violations[0]?.message).toContain('boom');
  });

  it('formats per-invariant timing for successful runs', async () => {
    const text = formatResults({
      exitCode: 0,
      failed: [],
      results: [
        { invariant: 'rule-conflicts', violations: [], durationMs: 1 },
        { invariant: 'boundaries', violations: [], durationMs: 400 },
      ],
      totalMs: 401,
    });

    expect(text.stdout).toContain('rule-conflicts: 1ms');
    expect(text.stdout).toContain('boundaries: 400ms');
  });

  it('renders warnings to stderr while keeping the pass line on stdout', () => {
    const text = formatResults({
      exitCode: 0,
      failed: [],
      results: [
        {
          invariant: 'rule-conflicts',
          violations: [{ file: 'README.md', message: 'soft drift', severity: 'warn' }],
          durationMs: 1,
        },
      ],
      totalMs: 1,
    });

    expect(text.stdout).toContain('✓ 1 invariants passed');
    expect(text.stderr).toContain('⚠ rule-conflicts (1 warning)');
    expect(text.stderr).toContain('README.md — soft drift');
  });
});
