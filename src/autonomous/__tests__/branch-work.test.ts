// @tests: autonomous-queue-drain-runner
import { describe, expect, it } from 'vitest';
import { branchHasUnshippedWork } from '../drain-io.js';
import type { GitRunner } from '../salvage.js';

/**
 * Scripted runner keyed on the ref of each `rev-list --count origin/main..<ref>`.
 * A missing key answers `ok: false` — git's behaviour for a ref that does not resolve,
 * which must read as "no work here", never as an error that aborts a drain.
 */
function runner(counts: Record<string, string>): GitRunner {
  return (cmd, args) => {
    expect(cmd).toBe('git'); // must never reach `gh` — that is the closed-PR probe's job
    const ref = (args.at(-1) ?? '').replace('origin/main..', '');
    const stdout = counts[ref];
    return stdout === undefined ? { ok: false, stdout: '' } : { ok: true, stdout };
  };
}

describe('branchHasUnshippedWork', () => {
  it('local branch ahead → finishable', () => {
    expect(branchHasUnshippedWork(runner({ 'fast/a': '2' }), 'a', 'fast/a')).toBe(true);
  });

  it('pushed but no PR (remote ahead, local branch gone) → finishable', () => {
    expect(branchHasUnshippedWork(runner({ 'origin/fast/a': '3' }), 'a', 'fast/a')).toBe(true);
  });

  it('neither ref resolves → nothing to finish', () => {
    expect(branchHasUnshippedWork(runner({}), 'a', 'fast/a')).toBe(false);
  });

  it('branch exists but is level with origin/main → nothing to finish', () => {
    expect(
      branchHasUnshippedWork(runner({ 'fast/a': '0', 'origin/fast/a': '0' }), 'a', 'fast/a'),
    ).toBe(false);
  });

  it('unparseable count reads as no work rather than NaN-truthy', () => {
    expect(branchHasUnshippedWork(runner({ 'fast/a': 'not-a-number' }), 'a', 'fast/a')).toBe(false);
  });
});
