// @tests: acceptance-verify-lane, noldor
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

  it('--plan <path> → plan review invocation', () => {
    expect(parseCliArgs(['--plan', 'docs/plan.md'])).toMatchObject({
      review: { kind: 'plan', artifact: 'docs/plan.md', fullReview: false },
    });
  });

  it('--spec <path> → spec review invocation', () => {
    expect(parseCliArgs(['--spec', 'docs/spec.md'])).toMatchObject({
      review: { kind: 'spec', artifact: 'docs/spec.md', fullReview: false },
    });
  });

  it('--slug populates the review slug', () => {
    expect(parseCliArgs(['--plan', 'p.md', '--slug', 'my-feat'])).toMatchObject({
      review: { kind: 'plan', artifact: 'p.md', slug: 'my-feat' },
    });
  });

  it('--base-sha populates the review baseSha', () => {
    expect(parseCliArgs(['--plan', 'p.md', '--base-sha', 'abc123'])).toMatchObject({
      review: { kind: 'plan', artifact: 'p.md', baseSha: 'abc123' },
    });
  });

  it('--full-review sets fullReview true', () => {
    expect(parseCliArgs(['--plan', 'p.md', '--full-review'])).toMatchObject({
      review: { kind: 'plan', artifact: 'p.md', fullReview: true },
    });
  });

  it('--help → help invocation', () => {
    expect(parseCliArgs(['--help'])).toMatchObject({ help: true });
  });

  it('--plan without a value throws', () => {
    expect(() => parseCliArgs(['--plan'])).toThrow(/--plan requires/);
  });

  it('--spec without a value throws', () => {
    expect(() => parseCliArgs(['--spec'])).toThrow(/--spec requires/);
  });

  it('rejects --plan + --spec as mutually exclusive', () => {
    expect(() => parseCliArgs(['--plan', 'p.md', '--spec', 's.md'])).toThrow(/mutually exclusive/);
  });

  it('code-lane invocations carry no review/help keys', () => {
    expect(parseCliArgs([])).not.toHaveProperty('review');
    expect(parseCliArgs(['--working'])).not.toHaveProperty('review');
  });
});
