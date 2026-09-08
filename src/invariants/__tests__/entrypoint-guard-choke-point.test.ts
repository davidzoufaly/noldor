// @tests: main-module-guard-fails-on-percent-encoded-paths
import { describe, expect, it } from 'vitest';

import { scanSource } from '../entrypoint-guard-choke-point.js';

// Comparisons are assembled from fragments rather than written out, because
// this scan reads `src/**/*.ts` and its exemption covers only the test trees —
// a literal here would be fine, but keeping the fixtures assembled documents
// that the scan is text-based and would see them.
const META = 'import.meta.url';
const EQ = ' === ';

describe('scanSource — the shapes that must be reported', () => {
  it('reports the broken file:// template', () => {
    const v = scanSource('src/hooks/h.ts', `if (${META}${EQ}\`file://\${process.argv[1]}\`) {}`);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe('src/hooks/h.ts');
    expect(v[0]?.line).toBe(1);
  });

  it('reports the string-concatenation form a template-keyed check would miss', () => {
    expect(
      scanSource('src/hooks/h.ts', `if (${META}${EQ}'file://' + process.argv[1]) {}`),
    ).toHaveLength(1);
  });

  it('reports a fileURLToPath path compare in either operand order', () => {
    expect(
      scanSource('src/a.ts', `if (fileURLToPath(${META})${EQ}process.argv[1]) {}`),
    ).toHaveLength(1);
    expect(
      scanSource('src/a.ts', `if (process.argv[1]${EQ}fileURLToPath(${META})) {}`),
    ).toHaveLength(1);
  });

  it('reports a comparison assigned to a local rather than gated inline', () => {
    expect(scanSource('src/a.ts', `const isMain = ${META}${EQ}x;\nif (isMain) {}`)).toHaveLength(1);
  });

  it('reports a comparison wrapped across lines in either operand order', () => {
    expect(scanSource('src/a.ts', `const m =\n  x ===\n  fileURLToPath(${META});`)).toHaveLength(1);
    expect(scanSource('src/a.ts', `if (${META} ===\n  somethingElse) {}`)).toHaveLength(1);
  });

  it('blocks rather than advises', () => {
    const v = scanSource('src/a.ts', `if (${META}${EQ}x) {}`);
    expect(v[0]?.severity).toBe('error');
  });
});

describe('scanSource — the shapes that must stay silent', () => {
  it('accepts the sanctioned guard', () => {
    expect(scanSource('src/a.ts', `if (isEntrypoint(${META})) {}`)).toEqual([]);
  });

  it('accepts non-comparison uses of import.meta.url', () => {
    const text = [
      `const here = dirname(fileURLToPath(${META}));`,
      `const asset = new URL('./x.json', ${META});`,
      `const isSource = ${META}.endsWith('.ts');`,
      `const url = ${META};`,
    ].join('\n');
    expect(scanSource('src/a.ts', text)).toEqual([]);
  });

  it('does not fire on an unrelated comparison near a non-guard use', () => {
    // The reason the continuation check reads only the previous line's trailing
    // operator instead of a window: these two lines are a legitimate pair.
    const text = `const here = dirname(fileURLToPath(${META}));\nif (a === b) {}`;
    expect(scanSource('src/a.ts', text)).toEqual([]);
  });

  it('exempts the test trees, which construct these comparisons on purpose', () => {
    const text = `if (${META}${EQ}x) {}`;
    expect(scanSource('src/core/__tests__/a.test.ts', text)).toEqual([]);
    expect(scanSource('src/core/a.test.ts', text)).toEqual([]);
  });

  it('needs no exemption for the helper itself, which compares a parameter', () => {
    // Why `src/core/cli-entry.ts` is deliberately absent from the exemption
    // list: `isEntrypoint` never names `import.meta.url`, so the scan cannot
    // reach it, and an exemption would bless the one file where a reintroduced
    // hand-rolled guard would do the most damage.
    const text = `export function isEntrypoint(moduleUrl, argv1) {\n  return moduleUrl === pathToFileURL(argv1 ?? '').href;\n}`;
    expect(scanSource('src/core/cli-entry.ts', text)).toEqual([]);
  });
});
