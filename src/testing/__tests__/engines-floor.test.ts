// @tests: registry-distribution-for-the-noldor-package
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, deliberately untyped: it must run on below-floor Node before tsx loads
import { checkNodeFloor, minMajor } from '../../../bin/engines-check.mjs';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

describe('package engines floor', () => {
  it('declares the Node and pnpm floors the README promises', () => {
    expect(pkg.engines?.node).toBe('>=24');
    expect(pkg.engines?.pnpm).toBe('>=9');
  });

  it('ships the engines field in the packed package (bin + package.json are in files/implicit)', () => {
    // bin/ is in files[], so engines-check.mjs rides the pack alongside the entry it guards
    expect(pkg.files).toContain('bin');
  });
});

describe('minMajor', () => {
  it('reads the floor out of a >=NN range', () => {
    expect(minMajor('>=20')).toBe(20);
    expect(minMajor('>=9')).toBe(9);
  });

  it('returns null for a range it cannot read', () => {
    expect(minMajor('lts/*')).toBeNull();
    expect(minMajor('')).toBeNull();
  });
});

describe('checkNodeFloor', () => {
  it('rejects a below-floor Node with a deterministic message', () => {
    const message = checkNodeFloor('>=20', '18.19.0');
    expect(message).toContain('requires Node >=20');
    expect(message).toContain('18.19.0');
  });

  it('accepts the floor itself and anything above', () => {
    expect(checkNodeFloor('>=20', '20.0.0')).toBeNull();
    expect(checkNodeFloor('>=20', '22.5.1')).toBeNull();
  });

  it('never blocks on an unreadable range or version', () => {
    expect(checkNodeFloor('lts/*', '18.19.0')).toBeNull();
    expect(checkNodeFloor('>=20', 'garbage')).toBeNull();
  });

  it('rejects the running Node only when below the declared floor', () => {
    // live-runtime sanity: the suite itself runs at or above the floor
    expect(checkNodeFloor(pkg.engines.node, process.versions.node)).toBeNull();
  });
});
