import { describe, expect, it } from 'vitest';
import { parseWatchArgs, resolve130 } from '../watch.js';

describe('parseWatchArgs', () => {
  it('defaults: interval from config fallback, max-features 1, daemon mode', () => {
    const a = parseWatchArgs([], 30);
    expect(a).toEqual({
      intervalMinutes: 30,
      maxFeatures: 1,
      maxRetries: 2,
      timeoutMs: 30 * 60 * 1000,
      once: false,
      json: false,
      dryRun: false,
    });
  });

  it('parses flags and prefers --interval over config', () => {
    const a = parseWatchArgs(
      [
        '--interval',
        '5',
        '--max-features',
        '2',
        '--once',
        '--json',
        '--dry-run',
        '--max-retries',
        '1',
        '--iteration-timeout',
        '60000',
      ],
      30,
    );
    expect(a).toEqual({
      intervalMinutes: 5,
      maxFeatures: 2,
      maxRetries: 1,
      timeoutMs: 60000,
      once: true,
      json: true,
      dryRun: true,
    });
  });

  it('throws on a non-positive integer flag', () => {
    expect(() => parseWatchArgs(['--interval', '0'], 30)).toThrow('--interval');
  });
});

describe('resolve130', () => {
  it('sigint wins, then pause, then stop', () => {
    expect(resolve130({ sigint: true, pauseExists: true })).toBe('sigint');
    expect(resolve130({ sigint: false, pauseExists: true })).toBe('paused');
    expect(resolve130({ sigint: false, pauseExists: false })).toBe('stopped');
  });
});
