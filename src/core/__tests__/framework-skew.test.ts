// @tests: version-aware-upgrade-and-migration-chain
import { describe, it, expect } from 'vitest';
import {
  BEHIND_ANCHOR_REMEDY,
  frameworkSkew,
  frameworkSkewDetail,
  isAnchorLagging,
  missingCommandSkewHint,
} from '../framework-skew.js';

describe('isAnchorLagging', () => {
  it('treats an older anchor as lagging', () => {
    expect(isAnchorLagging('1.1.0', '1.2.0')).toBe(true);
  });

  it('treats an absent anchor as lagging (replacing it is the only way out)', () => {
    expect(isAnchorLagging(null, '1.2.0')).toBe(true);
  });

  it('treats an unparseable anchor as lagging', () => {
    expect(isAnchorLagging('not-a-version', '1.2.0')).toBe(true);
  });

  it('does not treat a matching anchor as lagging', () => {
    expect(isAnchorLagging('1.2.0', '1.2.0')).toBe(false);
  });

  it('does not treat an anchor ahead of installed as lagging', () => {
    expect(isAnchorLagging('1.3.0', '1.2.0')).toBe(false);
  });
});

describe('frameworkSkewDetail', () => {
  it('reports no skew when the anchor matches installed', () => {
    expect(frameworkSkewDetail('1.2.0', '1.2.0')).toBeNull();
  });

  it('points a lagging anchor at both halves of the recovery', () => {
    expect(frameworkSkewDetail('1.1.0', '1.2.0')).toBe(
      "anchored 1.1.0 ≠ installed 1.2.0 — run 'noldor upgrade' then 'noldor init --update'",
    );
  });

  it('names `init --update` too, since `upgrade` alone leaves the hook block stale', () => {
    // The consumer whose commits were broken had run the package bump only; the
    // working recovery was both commands, in this order.
    const detail = frameworkSkewDetail('1.1.0', '1.2.0');
    expect(detail).toContain('noldor upgrade');
    expect(detail).toContain('noldor init --update');
    expect(detail?.indexOf('upgrade')).toBeLessThan(detail?.indexOf('init --update') ?? -1);
  });

  it('renders an unset anchor as `(unset)` and still points at the recovery', () => {
    expect(frameworkSkewDetail(null, '1.2.0')).toBe(
      "anchored (unset) ≠ installed 1.2.0 — run 'noldor upgrade' then 'noldor init --update'",
    );
  });

  it('points an unparseable anchor at the recovery', () => {
    expect(frameworkSkewDetail('not-a-version', '1.2.0')).toBe(
      "anchored not-a-version ≠ installed 1.2.0 — run 'noldor upgrade' then 'noldor init --update'",
    );
  });

  it('names the install as behind when the anchor is ahead, without naming a command that cannot help', () => {
    const detail = frameworkSkewDetail('1.3.0', '1.2.0');
    expect(detail).toBe(
      'anchored 1.3.0 is ahead of installed 1.2.0 — the install is behind, not the anchor',
    );
    expect(detail).not.toContain('noldor upgrade');
  });

  it('reports no skew for a v-prefixed anchor that is semver-equal to installed', () => {
    expect(frameworkSkewDetail('v1.2.0', '1.2.0')).toBeNull();
  });

  it('reports no skew for a build-metadata anchor that is semver-equal to installed', () => {
    expect(frameworkSkewDetail('1.2.0+build.7', '1.2.0')).toBeNull();
  });

  it('treats a prerelease anchor below installed as lagging', () => {
    expect(frameworkSkewDetail('1.2.0-rc.1', '1.2.0')).toBe(
      "anchored 1.2.0-rc.1 ≠ installed 1.2.0 — run 'noldor upgrade' then 'noldor init --update'",
    );
  });
});

describe('frameworkSkew', () => {
  it('classifies an older anchor as behind', () => {
    expect(frameworkSkew('1.1.0', '1.2.0')).toBe('anchor-behind');
  });

  it('classifies an unset anchor as behind (replacing it is the only way out)', () => {
    expect(frameworkSkew(null, '1.2.0')).toBe('anchor-behind');
  });

  it('classifies a newer anchor as ahead', () => {
    expect(frameworkSkew('1.3.0', '1.2.0')).toBe('anchor-ahead');
  });

  it('classifies a semver-equal but textually-different anchor as in sync', () => {
    expect(frameworkSkew('v1.2.0', '1.2.0')).toBe('in-sync');
    expect(frameworkSkew('1.2.0+build.7', '1.2.0')).toBe('in-sync');
  });
});

describe('missingCommandSkewHint', () => {
  it('stays silent when the versions agree — an unknown command is then a real typo', () => {
    expect(missingCommandSkewHint('1.2.0', '1.2.0')).toBeNull();
    expect(missingCommandSkewHint('v1.2.0', '1.2.0')).toBeNull();
  });

  it('blames the stale scaffolded hook and names both recovery commands when behind', () => {
    const hint = missingCommandSkewHint('1.3.0', '1.5.0');
    expect(hint).toContain('1.3.0');
    expect(hint).toContain('1.5.0');
    expect(hint).toContain('lefthook/noldor.yml');
    expect(hint).toContain(BEHIND_ANCHOR_REMEDY);
  });

  it('renders an unset anchor without printing `null` at the consumer', () => {
    const hint = missingCommandSkewHint(null, '1.5.0');
    expect(hint).toContain('(unset)');
    expect(hint).not.toContain('null');
  });

  it('points an ahead anchor at the install, never at a command that cannot help', () => {
    const hint = missingCommandSkewHint('1.6.0', '1.5.0');
    expect(hint).toContain('update the installed noldor package');
    expect(hint).not.toContain('noldor upgrade');
  });
});
