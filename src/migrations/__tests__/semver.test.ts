// @tests: version-aware-upgrade-and-migration-chain
import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver } from '../semver.js';

describe('parseSemver', () => {
  it('parses x.y.z', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
  });
  it('ignores prerelease suffix', () => {
    expect(parseSemver('0.4.0-rc.1')).toEqual([0, 4, 0]);
  });
  it('throws on non-semver', () => {
    expect(() => parseSemver('nope')).toThrow(/not a semver/);
  });
});

describe('compareSemver', () => {
  it('orders by major, minor, patch', () => {
    expect(compareSemver('0.3.0', '0.4.0')).toBe(-1);
    expect(compareSemver('0.4.0', '0.3.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
  });
});
