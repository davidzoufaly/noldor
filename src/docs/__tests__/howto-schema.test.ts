// @tests: howto-index-pipeline
import { howtoFrontmatterSchema } from '../howto-schema.js';

describe('howtoFrontmatterSchema', () => {
  const base = {
    category: 'Core' as const,
    title: 'How to combine shapes with booleans',
  };

  it('accepts a valid how-to frontmatter', () => {
    expect(howtoFrontmatterSchema.safeParse(base).success).toBeTruthy();
  });

  it('rejects title that does not start with "How to "', () => {
    const bad = { ...base, title: 'Combine shapes with booleans' };
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects title with capitalized "How To"', () => {
    const bad = { ...base, title: 'How To combine shapes' };
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('accepts any non-empty category string (membership enforced where the index is generated)', () => {
    expect(
      howtoFrontmatterSchema.safeParse({ ...base, category: 'Frontend' }).success,
    ).toBeTruthy();
  });

  it('rejects an empty category', () => {
    const bad = { ...base, category: '' };
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects missing title', () => {
    const bad: Record<string, unknown> = { ...base };
    delete bad.title;
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects missing category', () => {
    const bad: Record<string, unknown> = { ...base };
    delete bad.category;
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects unknown top-level fields (strict mode)', () => {
    const bad = { ...base, slug: 'combine-shapes-with-booleans' };
    expect(howtoFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('accepts arbitrary project categories', () => {
    for (const category of ['Core', 'Tooling', 'Other', 'Editor', 'Billing'] as const) {
      expect(howtoFrontmatterSchema.safeParse({ ...base, category }).success).toBeTruthy();
    }
  });
});
