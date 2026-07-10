// @tests: noldor, outcome-telemetry-and-effectiveness-metrics

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GardenReceiptSchema,
  ensureGardenFresh,
  evaluateGardenFreshness,
  readGardenReceipt,
  resolveGardenScanPaths,
  writeGardenReceipt,
} from '../garden-receipt.js';

function writeConfig(cwd: string, scanPaths: string[] | undefined): void {
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  const consumer: Record<string, unknown> = {
    name: 'fixture',
    repoUrl: 'https://example.com/repo',
    lockstepPackages: ['package.json'],
    e2ePrefix: 'e2e/',
    samplesPath: 'samples',
    packagePrefix: '@fixture/',
    pnpmStderrPrefix: 'fixture',
    appPathPrefix: 'src',
  };
  if (scanPaths !== undefined) consumer.scanPaths = scanPaths;
  writeFileSync(join(cwd, '.noldor/config.json'), JSON.stringify({ consumer }), 'utf8');
}

describe(evaluateGardenFreshness, () => {
  it('rejects when no receipt is present', () => {
    const r = evaluateGardenFreshness({ receipt: null, latestSrcTs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No \/noldor-garden receipt/);
  });

  it('rejects when receipt timestamp predates the latest src commit', () => {
    const r = evaluateGardenFreshness({
      receipt: { timestamp: 500, headSha: 'abcdef1' },
      latestSrcTs: 1_000,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/stale/);
  });

  it('accepts when receipt timestamp equals the latest src commit (no commits since)', () => {
    const r = evaluateGardenFreshness({
      receipt: { timestamp: 1_000, headSha: 'abcdef1' },
      latestSrcTs: 1_000,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts when receipt timestamp postdates the latest src commit', () => {
    const r = evaluateGardenFreshness({
      receipt: { timestamp: 2_000, headSha: 'abcdef1' },
      latestSrcTs: 1_000,
    });
    expect(r.ok).toBe(true);
  });
});

describe('garden-receipt read/write round-trip', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'garden-receipt-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when the receipt file does not exist', () => {
    expect(readGardenReceipt(cwd)).toBeNull();
  });

  it('round-trips a written receipt', () => {
    const receipt = {
      headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      timestamp: 1_700_000_000,
    };
    writeGardenReceipt(receipt, cwd);
    expect(readGardenReceipt(cwd)).toStrictEqual(receipt);
  });

  it('creates the `.noldor/` directory if missing', () => {
    writeGardenReceipt({ headSha: 'abc1234abc1234abc1234abc1234abc1234abc12', timestamp: 1 }, cwd);
    expect(existsSync(join(cwd, '.noldor/garden-receipt'))).toBe(true);
  });

  it('rejects a short headSha (must be a full 40-char hex SHA)', () => {
    const parsed = GardenReceiptSchema.safeParse({ headSha: 'abc1234', timestamp: 1 });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-hex headSha', () => {
    const parsed = GardenReceiptSchema.safeParse({
      headSha: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      timestamp: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed JSON via the Zod schema on read', () => {
    mkdirSync(join(cwd, '.noldor'));
    writeFileSync(join(cwd, '.noldor/garden-receipt'), '{ "timestamp": -1 }\n', 'utf8');
    expect(() => readGardenReceipt(cwd)).toThrow();
  });

  it('rejects an unknown field on the receipt schema (strict)', () => {
    const parsed = GardenReceiptSchema.safeParse({
      timestamp: 1,
      headSha: 'abc1234abc1234abc1234abc1234abc1234abc12',
      extra: 'no',
    });
    expect(parsed.success).toBe(false);
  });
});

describe(ensureGardenFresh, () => {
  const ORIGINAL_SKIP = process.env.RELEASE_SKIP_GARDEN_GATE;

  afterEach(() => {
    if (ORIGINAL_SKIP === undefined) delete process.env.RELEASE_SKIP_GARDEN_GATE;
    else process.env.RELEASE_SKIP_GARDEN_GATE = ORIGINAL_SKIP;
  });

  it('short-circuits without throwing when RELEASE_SKIP_GARDEN_GATE=1 (bootstrap bypass)', () => {
    process.env.RELEASE_SKIP_GARDEN_GATE = '1';
    // No receipt present, but bypass means we never read it. Pass a non-repo
    // cwd to prove the function never reads the receipt or spawns git (it
    // only appends the overrides.log breadcrumb, which fails open).
    const tmp = mkdtempSync(join(tmpdir(), 'garden-fresh-bypass-'));
    try {
      expect(() => ensureGardenFresh(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('appends a (release)-tagged overrides.log line when bypassed', () => {
    process.env.RELEASE_SKIP_GARDEN_GATE = '1';
    const tmp = mkdtempSync(join(tmpdir(), 'garden-fresh-bypass-log-'));
    try {
      // appendOverrideLog does not mkdir — the real repo always has .noldor/.
      mkdirSync(join(tmp, '.noldor'), { recursive: true });
      ensureGardenFresh(tmp);
      const log = readFileSync(join(tmp, '.noldor', 'overrides.log'), 'utf8');
      expect(log).toMatch(/\tRELEASE_SKIP_GARDEN_GATE=1\t\(release\)\n$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe(resolveGardenScanPaths, () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'garden-scanpaths-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("derives the consumer config's scanPaths (standalone repo tracks src/, not apps/)", () => {
    writeConfig(cwd, ['src']);
    expect(resolveGardenScanPaths(cwd)).toStrictEqual(['src']);
  });

  it('honours a multi-path monorepo scanPaths verbatim', () => {
    writeConfig(cwd, ['apps', 'packages', 'scripts']);
    expect(resolveGardenScanPaths(cwd)).toStrictEqual(['apps', 'packages', 'scripts']);
  });

  it("falls back to ['src'] when the config declares no scanPaths", () => {
    writeConfig(cwd, []);
    expect(resolveGardenScanPaths(cwd)).toStrictEqual(['src']);
  });

  it("falls back to ['src'] when the config is missing (bootstrap / unit-test cwd)", () => {
    expect(resolveGardenScanPaths(cwd)).toStrictEqual(['src']);
  });
});
