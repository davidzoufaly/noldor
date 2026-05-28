// @tests: noldor

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GardenReceiptSchema,
  ensureGardenFresh,
  evaluateGardenFreshness,
  readGardenReceipt,
  writeGardenReceipt,
} from '../garden-receipt.js';

describe(evaluateGardenFreshness, () => {
  it('rejects when no receipt is present', () => {
    const r = evaluateGardenFreshness({ receipt: null, latestSrcTs: 1_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No \/garden receipt/);
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
    // No receipt present, but bypass means we never read it. Pass a non-repo cwd to
    // prove the function returns before touching the filesystem or spawning git.
    const tmp = mkdtempSync(join(tmpdir(), 'garden-fresh-bypass-'));
    try {
      expect(() => ensureGardenFresh(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
