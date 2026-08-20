// @tests: acceptance-verify-lane, autonomous-queue-drain-runner, consumer-contract-ci-and-headless-gate-e2e-harness, continuous-drain-daemon-and-escalation-inbox, drain-startup-reconciliation-of-a-prior-dead-run, parallel-drain, plan-runner
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

  it('leaves selection undefined when neither --size nor --only is given', () => {
    expect(parseArgs([]).selection).toBeUndefined();
  });

  it('upper-cases --size into the selection set', () => {
    expect(parseArgs(['--size', 'xs,s']).selection?.sizes).toEqual(new Set(['XS', 'S']));
  });

  it('reads --only as a slug set', () => {
    expect(parseArgs(['--only', 'a-slug, b-slug']).selection?.only).toEqual(
      new Set(['a-slug', 'b-slug']),
    );
  });

  it('rejects an unknown --size rather than selecting nothing', () => {
    expect(() => parseArgs(['--size', 'XS,tiny'])).toThrow(/--size must be one of/);
  });

  it('rejects a --size the roadmap source can never ship', () => {
    expect(() => parseArgs(['--size', 'M,L'])).toThrow(/can never ship on --source roadmap/);
  });

  it('accepts a mixed --size as long as one size is fast-track', () => {
    expect(parseArgs(['--size', 'XS,M']).selection?.sizes).toEqual(new Set(['XS', 'M']));
  });

  it('rejects an empty --size / --only value', () => {
    expect(() => parseArgs(['--size', ''])).toThrow(/non-empty list/);
    expect(() => parseArgs(['--only', ','])).toThrow(/non-empty list/);
  });

  it('rejects narrowing on a non-roadmap source instead of silently no-opping', () => {
    expect(() => parseArgs(['--source', 'plans', '--size', 'XS'])).toThrow(/roadmap only/);
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

  it('assertConfig is indifferent to onBlockers — both values are headless-safe', () => {
    // `prompt` merely makes `cr autofix` decline, after which onFailure: abort
    // behaves exactly as before, so adding this to the precondition set would
    // break every existing drain config for no safety gain.
    for (const onBlockers of ['prompt', 'auto-fix'] as const) {
      expect(() =>
        assertConfig({
          autonomous: {
            onFailure: 'abort',
            skipLanePicker: true,
            requireHumanPrApproval: false,
            onBlockers,
          },
        }),
      ).not.toThrow();
    }
  });

  it('missing-block error shows the headless-safe block to add', () => {
    expect(() => assertConfig({})).toThrow(/skipLanePicker.*true[\s\S]*onFailure.*abort/);
  });
});
