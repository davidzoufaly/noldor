// @tests: howto-index-pipeline
import { howtoFrontmatterSchema } from '../howto-schema.js';

describe('howtoFrontmatterSchema', () => {
  const base = {
    category: 'Modeling' as const,
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

  it('rejects category outside the enum', () => {
    const bad = { ...base, category: 'Frontend' as unknown as 'Modeling' };
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

  it('accepts every category in the enum', () => {
    for (const category of [
      'Modeling',
      'Editor',
      'Agents',
      'Distribution',
      'Docs',
      'Tooling',
      'Other',
    ] as const) {
      expect(howtoFrontmatterSchema.safeParse({ ...base, category }).success).toBeTruthy();
    }
  });
});
