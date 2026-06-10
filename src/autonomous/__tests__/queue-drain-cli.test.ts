import { describe, expect, it } from 'vitest';
import { parseArgs, assertConfig } from '../queue-drain.js';

describe('queue-drain CLI helpers', () => {
  it('parses flags with defaults', () => {
    const a = parseArgs([]);
    expect(a.maxFeatures).toBe(20);
    expect(a.maxRetries).toBe(2);
    expect(a.maxSpawns).toBe(20 * 3);
    expect(a.dryRun).toBe(false);
  });

  it('reads explicit flag values', () => {
    const a = parseArgs(['--max-features', '5', '--max-retries', '1', '--dry-run', '--json']);
    expect(a.maxFeatures).toBe(5);
    expect(a.maxRetries).toBe(1);
    expect(a.dryRun).toBe(true);
    expect(a.json).toBe(true);
  });

  it('rejects non-positive --max-features', () => {
    expect(() => parseArgs(['--max-features', '0'])).toThrow(/positive integer/);
  });

  it('defaults --source to roadmap', () => {
    expect(parseArgs([]).source).toBe('roadmap');
  });

  it('reads --source plans', () => {
    expect(parseArgs(['--source', 'plans']).source).toBe('plans');
  });

  it('rejects an invalid --source', () => {
    expect(() => parseArgs(['--source', 'bogus'])).toThrow(/source/);
  });

  it('defaults --concurrency to 1', () => {
    expect(parseArgs([]).concurrency).toBe(1);
  });

  it('reads --concurrency 3', () => {
    expect(parseArgs(['--concurrency', '3']).concurrency).toBe(3);
  });

  it('rejects a non-positive --concurrency', () => {
    expect(() => parseArgs(['--concurrency', '0'])).toThrow(/positive integer/);
  });

  it('assertConfig passes the headless precondition set', () => {
    expect(() =>
      assertConfig({
        autonomous: { onFailure: 'abort', skipLanePicker: true, requireHumanPrApproval: false },
      }),
    ).not.toThrow();
  });

  it('assertConfig rejects onFailure != abort, naming the key', () => {
    expect(() =>
      assertConfig({
        autonomous: { onFailure: 'prompt', skipLanePicker: true, requireHumanPrApproval: false },
      }),
    ).toThrow(/onFailure/);
  });

  it('assertConfig rejects a missing autonomous block', () => {
    expect(() => assertConfig({})).toThrow(/autonomous/);
  });
});
