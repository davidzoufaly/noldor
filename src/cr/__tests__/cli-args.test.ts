// @tests: noldor
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../cli-args.js';

describe('parseCliArgs', () => {
  it('no args → gate lane', () => {
    expect(parseCliArgs([])).toEqual({
      lane: { kind: 'gate' },
      paths: [],
      rerun: false,
      dryRun: false,
    });
  });

  it('--rerun → gate lane with rerun flag', () => {
    expect(parseCliArgs(['--rerun'])).toMatchObject({ lane: { kind: 'gate' }, rerun: true });
  });

  it('--dry-run → ad-hoc with dryRun flag (no trailer write)', () => {
    expect(parseCliArgs(['--dry-run'])).toMatchObject({ lane: { kind: 'gate' }, dryRun: true });
  });

  it('--working → working lane', () => {
    expect(parseCliArgs(['--working'])).toMatchObject({ lane: { kind: 'working' } });
  });

  it('positional sha → sha lane', () => {
    expect(parseCliArgs(['abc123'])).toEqual({
      lane: { kind: 'sha', sha: 'abc123' },
      paths: [],
      rerun: false,
      dryRun: false,
    });
  });

  it('positional <from>..<to> → range lane', () => {
    expect(parseCliArgs(['v1.2.0..HEAD'])).toEqual({
      lane: { kind: 'range', from: 'v1.2.0', to: 'HEAD' },
      paths: [],
      rerun: false,
      dryRun: false,
    });
  });

  it('--paths splits comma-separated values', () => {
    expect(parseCliArgs(['--paths', 'a.ts,b.ts'])).toMatchObject({ paths: ['a.ts', 'b.ts'] });
  });

  it('rejects --rerun + --dry-run as mutually exclusive', () => {
    expect(() => parseCliArgs(['--rerun', '--dry-run'])).toThrow(/mutually exclusive/);
  });

  it('throws on unknown flag (does not silently classify as sha)', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow(/Unknown argument/);
  });
});
