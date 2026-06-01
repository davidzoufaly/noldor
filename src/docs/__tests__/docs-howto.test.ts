// @tests: howto-index-pipeline
import { renderHowToIndex } from '../docs-howto.js';

import type { Howto } from '../docs-howto.js';

function baseHowto(overrides: Partial<Howto>): Howto {
  return {
    frontmatter: { category: 'Core', title: 'How to combine shapes' },
    oneLiner: '',
    slug: 'combine-shapes',
    ...overrides,
  };
}

describe(renderHowToIndex, () => {
  it('emits the generated header and section title', () => {
    const md = renderHowToIndex([baseHowto({})]);
    expect(md).toContain('<!-- generated: do-not-edit -->');
    expect(md).toContain('# How-to Guides');
  });

  it('groups how-tos by category in configured order', () => {
    // Default categories order: Core, Tooling, Other.
    const md = renderHowToIndex([
      baseHowto({
        frontmatter: { category: 'Other', title: 'How to export data' },
        slug: 'export-data',
      }),
      baseHowto({
        frontmatter: { category: 'Core', title: 'How to combine shapes' },
        slug: 'combine-shapes',
      }),
      baseHowto({
        frontmatter: { category: 'Tooling', title: 'How to run the linter' },
        slug: 'run-linter',
      }),
    ]);
    const coreIdx = md.indexOf('## Core');
    const toolingIdx = md.indexOf('## Tooling');
    const otherIdx = md.indexOf('## Other');
    expect(coreIdx).toBeGreaterThan(-1);
    expect(coreIdx).toBeLessThan(toolingIdx);
    expect(toolingIdx).toBeLessThan(otherIdx);
  });

  it('drops empty categories', () => {
    const md = renderHowToIndex([
      baseHowto({
        frontmatter: { category: 'Core', title: 'How to combine shapes' },
      }),
    ]);
    expect(md).not.toContain('## Tooling');
    expect(md).not.toContain('## Other');
  });

  it('sorts guides alphabetically within a category by title', () => {
    const md = renderHowToIndex([
      baseHowto({
        frontmatter: { category: 'Core', title: 'How to taper a cone' },
        slug: 'taper-cone',
      }),
      baseHowto({
        frontmatter: { category: 'Core', title: 'How to combine shapes' },
        slug: 'combine-shapes',
      }),
    ]);
    const combineIdx = md.indexOf('How to combine shapes');
    const taperIdx = md.indexOf('How to taper a cone');
    expect(combineIdx).toBeLessThan(taperIdx);
  });

  it('renders bullets with one-liner when present', () => {
    const md = renderHowToIndex([
      baseHowto({
        oneLiner: 'Use union, subtract, intersect to build complex parts.',
      }),
    ]);
    expect(md).toContain(
      '- [How to combine shapes](combine-shapes.md) — Use union, subtract, intersect to build complex parts.',
    );
  });

  it('renders bullets without suffix when one-liner is empty', () => {
    const md = renderHowToIndex([baseHowto({ oneLiner: '' })]);
    expect(md).toContain('- [How to combine shapes](combine-shapes.md)');
    expect(md).not.toContain('— ');
  });

  it('renders a placeholder when no how-tos are present', () => {
    const md = renderHowToIndex([]);
    expect(md).toContain('<!-- generated: do-not-edit -->');
    expect(md).toContain('# How-to Guides');
    expect(md).toContain('_No how-to guides yet._');
  });
});
