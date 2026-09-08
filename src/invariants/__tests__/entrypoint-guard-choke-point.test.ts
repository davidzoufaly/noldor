// @tests: main-module-guard-fails-on-percent-encoded-paths
import { describe, expect, it } from 'vitest';

import { scanSource } from '../entrypoint-guard-choke-point.js';

// Fixtures are assembled from fragments rather than written out. A literal would
// be fine — the scan exempts test trees — but assembling them documents that the
// check is text-based and would otherwise see them.
const META = 'import.meta.url';
const ARGV = 'process.argv[1]';

// A blocking predicate fails in two directions and each is a different defect:
// a false negative lets the swept class regrow, a false positive rejects correct
// code and gets the whole check waived. Both directions get their own table.
describe('scanSource — guards that must be reported', () => {
  it('reports the broken file:// template', () => {
    const v = scanSource('src/hooks/h.ts', `if (${META} === \`file://\${${ARGV}}\`) {}`);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe('src/hooks/h.ts');
    expect(v[0]?.line).toBe(1);
  });

  it('reports the string-concatenation form a template-keyed check would miss', () => {
    expect(scanSource('src/a.ts', `if (${META} === 'file://' + ${ARGV}) {}`)).toHaveLength(1);
  });

  it('reports a fileURLToPath path compare in either operand order', () => {
    expect(scanSource('src/a.ts', `if (fileURLToPath(${META}) === ${ARGV}) {}`)).toHaveLength(1);
    expect(scanSource('src/a.ts', `if (${ARGV} === fileURLToPath(${META})) {}`)).toHaveLength(1);
  });

  it('reports a string-method spelling, not only an operator', () => {
    // The most literal way to reintroduce the swept template, and invisible to a
    // check keyed on equality operators.
    expect(
      scanSource('src/a.ts', `if (${META}.startsWith(\`file://\${${ARGV}}\`)) {}`),
    ).toHaveLength(1);
    expect(scanSource('src/a.ts', `if (${META}.endsWith(${ARGV})) {}`)).toHaveLength(1);
  });

  it('reports a guard whose operator opens the following line', () => {
    // Neither line carries both ingredients on its own.
    expect(scanSource('src/a.ts', `if (${META}\n  === 'file://' + ${ARGV}) {}`)).toHaveLength(1);
  });

  it('reports a guard wrapped across lines in either operand order', () => {
    expect(
      scanSource('src/a.ts', `const m =\n  ${ARGV} ===\n  fileURLToPath(${META});`),
    ).toHaveLength(1);
  });

  it('reports a comparison assigned to a local rather than gated inline', () => {
    expect(
      scanSource('src/a.ts', `const isMain = ${META} === \`file://\${${ARGV}}\`;\nif (isMain) {}`),
    ).toHaveLength(1);
  });

  it('blocks rather than advises', () => {
    const v = scanSource('src/a.ts', `if (${META} === ${ARGV}) {}`);
    expect(v[0]?.severity).toBe('error');
  });
});

describe('scanSource — code that must stay silent', () => {
  it('accepts the sanctioned guard', () => {
    expect(scanSource('src/a.ts', `if (isEntrypoint(${META})) {}`)).toEqual([]);
  });

  it('accepts the sanctioned guard beside an unrelated comparison on argv', () => {
    // The false positive that made an operator-keyed check unusable: this is
    // correct code, and rejecting it would get the whole invariant waived.
    expect(
      scanSource('src/a.ts', `if (isEntrypoint(${META}) && process.argv.length === 2) {}`),
    ).toEqual([]);
  });

  it('accepts non-guard uses of import.meta.url', () => {
    const text = [
      `const here = dirname(fileURLToPath(${META}));`,
      `const asset = new URL('./x.json', ${META});`,
      `const isSource = ${META}.endsWith('.ts');`,
      `const url = ${META};`,
    ].join('\n');
    expect(scanSource('src/a.ts', text)).toEqual([]);
  });

  it('does not fire on a non-guard use near an unrelated argv read', () => {
    // Nothing here derives direct invocation; the two mentions are incidental.
    // This is why the entrypoint ingredient is `argv[1]` and not bare `argv` —
    // matching the latter reported this correct pair.
    const text = `const here = dirname(fileURLToPath(${META}));\nconst n = process.argv.length;`;
    expect(scanSource('src/a.ts', text)).toEqual([]);
  });

  it('ignores prose, in every comment style', () => {
    // The helper's TSDoc, the router's dispatch note and this invariant's own
    // header all discuss both ingredients; a commented-out guard does not run.
    const text = [
      `// if (${META} === \`file://\${${ARGV}}\`) {}`,
      `/* if (${META} === ${ARGV}) {} */`,
      ` * \`${META}\` is a URL while \`${ARGV}\` is a raw path`,
    ].join('\n');
    expect(scanSource('src/a.ts', text)).toEqual([]);
  });

  it('still reports a real guard sitting next to prose about it', () => {
    // The filter must not become a way to hide a guard behind a comment.
    const text = `// gate on the entrypoint, see cli-entry\nif (${META} === ${ARGV}) {}`;
    const v = scanSource('src/a.ts', text);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it('exempts the test trees, which construct these guards on purpose', () => {
    const text = `if (${META} === ${ARGV}) {}`;
    expect(scanSource('src/core/__tests__/a.test.ts', text)).toEqual([]);
    expect(scanSource('src/core/a.test.ts', text)).toEqual([]);
  });

  it('needs no exemption for the helper itself, which names a parameter', () => {
    // Why src/core/cli-entry.ts is deliberately absent from the exemption list:
    // isEntrypoint never mentions import.meta.url, so the scan cannot reach it,
    // and an exemption would bless the one file where a reintroduced hand-rolled
    // guard would do the most damage.
    const text = `export function isEntrypoint(moduleUrl, argv1) {\n  return moduleUrl === pathToFileURL(argv1 ?? '').href;\n}`;
    expect(scanSource('src/core/cli-entry.ts', text)).toEqual([]);
  });
});
