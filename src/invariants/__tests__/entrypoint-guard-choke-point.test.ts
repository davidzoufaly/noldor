// @tests: main-module-guard-fails-on-percent-encoded-paths
import { describe, expect, it } from 'vitest';

import { scanSource } from '../entrypoint-guard-choke-point.js';

// Fixtures are assembled from fragments rather than written out. A literal would
// be fine — the scan exempts test trees — but assembling them documents that the
// check is text-based and would otherwise see them.
const META = 'import.meta.url';
const ARGV = 'process.argv[1]';
const GUARD = `isEntrypoint(${META})`;

// A blocking predicate fails in two directions and each is a different defect:
// a false negative lets the swept class regrow, a false positive rejects correct
// code and gets the whole check waived. Both directions get their own table, and
// every widening owes a row to both.
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

  it('reports a string-method spelling, which carries no operator at all', () => {
    expect(
      scanSource('src/a.ts', `if (${META}.startsWith(\`file://\${${ARGV}}\`)) {}`),
    ).toHaveLength(1);
    expect(scanSource('src/a.ts', `if (${META}.endsWith(${ARGV})) {}`)).toHaveLength(1);
  });

  it('reports a bare guard a few lines below a sanctioned one', () => {
    // The hole a window-based check had: one sanctioned call exempted every
    // guard near it. Each line is now judged alone.
    const text = `if (${GUARD}) { run(); }\nconst x = 1;\nif (${META} === \`file://\${${ARGV}}\`) { alsoRun(); }`;
    const v = scanSource('src/a.ts', text);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
  });

  it('reports a bare guard that names the sanctioned call in a trailing comment', () => {
    // Comment tails are not stripped (cutting at `//` would eat `'file://'`),
    // so the exemption counts mentions instead of searching for the text —
    // otherwise pasting this check's own violation message would silence it.
    expect(scanSource('src/a.ts', `if (${META} === ${ARGV}) {} // ${GUARD}`)).toHaveLength(1);
  });

  it('reports a guard behind a closed block-comment prefix', () => {
    // `/*` opens a comment, but `*/` on the same line closes it and what follows
    // executes. Blanking the whole line would hide this guard behind two words.
    expect(scanSource('src/a.ts', `/* entrypoint */ if (${META} === ${ARGV}) {}`)).toHaveLength(1);
  });

  it('reports a comparison assigned to a local rather than gated inline', () => {
    expect(
      scanSource('src/a.ts', `const isMain = ${META} === \`file://\${${ARGV}}\`;\nif (isMain) {}`),
    ).toHaveLength(1);
  });

  it('blocks rather than advises', () => {
    expect(scanSource('src/a.ts', `if (${META} === ${ARGV}) {}`)[0]?.severity).toBe('error');
  });
});

describe('scanSource — code that must stay silent', () => {
  it('accepts the sanctioned guard', () => {
    expect(scanSource('src/a.ts', `if (${GUARD}) {}`)).toEqual([]);
  });

  it('accepts the sanctioned guard beside an unrelated argv read', () => {
    // The false positive that made an operator-keyed check unusable.
    expect(scanSource('src/a.ts', `if (${GUARD} && process.argv.length === 2) {}`)).toEqual([]);
  });

  it('accepts an asset read a couple of lines from an unrelated script-path read', () => {
    // The false positive a window-based check had: neither line derives direct
    // invocation, and refusing this would get the invariant waived.
    const text = `const script = ${ARGV};\nconst n = 1;\nconst asset = new URL('./x.json', ${META});`;
    expect(scanSource('src/a.ts', text)).toEqual([]);
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

  it('ignores prose, in every whole-line comment style', () => {
    const text = [
      `// if (${META} === \`file://\${${ARGV}}\`) {}`,
      `/* if (${META} === ${ARGV}) {}`,
      ` * \`${META}\` is a URL while \`${ARGV}\` is a raw path`,
    ].join('\n');
    expect(scanSource('src/a.ts', text)).toEqual([]);
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

// Pinned so that closing one shows up as a test to update rather than as a
// silent behaviour change. Each is a false negative — the direction that leaves
// a defect for a later pass, rather than refusing correct code today.
describe('scanSource — documented blind spots', () => {
  it('misses a guard wrapped across lines', () => {
    expect(scanSource('src/a.ts', `if (${META}\n  === 'file://' + ${ARGV}) {}`)).toEqual([]);
  });

  it('misses a guard that reaches either ingredient through an alias', () => {
    expect(scanSource('src/a.ts', `const url = ${META};\nif (url === ${ARGV}) {}`)).toEqual([]);
  });

  it('misses a script-path read spelled without an index', () => {
    expect(scanSource('src/a.ts', `if (${META} === process.argv.at(1)) {}`)).toEqual([]);
  });
});
