// @tests: version-aware-upgrade-and-migration-chain
import { describe, it, expect } from 'vitest';
import { frameworkSkewDetail, isAnchorLagging } from '../framework-skew.js';

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

  it('points a lagging anchor at `noldor upgrade`', () => {
    expect(frameworkSkewDetail('1.1.0', '1.2.0')).toBe(
      "anchored 1.1.0 ≠ installed 1.2.0 — run 'noldor upgrade'",
    );
  });

  it('renders an unset anchor as `(unset)` and still points at `noldor upgrade`', () => {
    expect(frameworkSkewDetail(null, '1.2.0')).toBe(
      "anchored (unset) ≠ installed 1.2.0 — run 'noldor upgrade'",
    );
  });

  it('points an unparseable anchor at `noldor upgrade`', () => {
    expect(frameworkSkewDetail('not-a-version', '1.2.0')).toBe(
      "anchored not-a-version ≠ installed 1.2.0 — run 'noldor upgrade'",
    );
  });

  it('names the install as behind when the anchor is ahead, without naming a command that cannot help', () => {
    const detail = frameworkSkewDetail('1.3.0', '1.2.0');
    expect(detail).toBe(
      'anchored 1.3.0 is ahead of installed 1.2.0 — the install is behind, not the anchor',
    );
    expect(detail).not.toContain('noldor upgrade');
  });

  it('treats a prerelease anchor below installed as lagging', () => {
    expect(frameworkSkewDetail('1.2.0-rc.1', '1.2.0')).toBe(
      "anchored 1.2.0-rc.1 ≠ installed 1.2.0 — run 'noldor upgrade'",
    );
  });
});
