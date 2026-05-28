import { applyBump } from '../release-version.js';

describe(applyBump, () => {
  it('bumps major', () => {
    expect(applyBump('0.1.0', 'major')).toBe('1.0.0');
    expect(applyBump('1.2.3', 'major')).toBe('2.0.0');
  });

  it('bumps minor', () => {
    expect(applyBump('0.1.0', 'minor')).toBe('0.2.0');
    expect(applyBump('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps patch', () => {
    expect(applyBump('0.1.0', 'patch')).toBe('0.1.1');
    expect(applyBump('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('throws on invalid semver input', () => {
    expect(() => applyBump('not-a-version', 'patch')).toThrow();
  });
});
