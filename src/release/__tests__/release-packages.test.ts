import { bumpPackageJson } from '../release-packages.js';

describe(bumpPackageJson, () => {
  it('rewrites version field', () => {
    const input = JSON.stringify(
      { name: '@charuy/engine', private: true, version: '0.1.0' },
      null,
      2,
    );
    const out = bumpPackageJson(input, '0.2.0');
    expect(out).toContain('"version": "0.2.0"');
    expect(out).toContain('"name": "@charuy/engine"');
  });

  it('preserves trailing newline if present', () => {
    const input = `${JSON.stringify({ version: '0.1.0' }, null, 2)}\n`;
    expect(bumpPackageJson(input, '0.2.0').endsWith('\n')).toBeTruthy();
  });

  it('preserves absence of trailing newline', () => {
    const input = JSON.stringify({ version: '0.1.0' }, null, 2);
    expect(bumpPackageJson(input, '0.2.0').endsWith('\n')).toBeFalsy();
  });
});
