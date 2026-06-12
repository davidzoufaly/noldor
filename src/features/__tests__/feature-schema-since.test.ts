// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { FeatureFrontmatterSchema } from '../feature-schema';

const BASE = {
  area: 'tooling',
  category: 'Tooling',
  links: { code: [], docs: [], tests: [] },
  name: 'X',
  packages: ['scripts'],
  phase: 'in-progress',
  'noldor-tier': 'full',
};

describe('since frontmatter field', () => {
  it('accepts an ISO date', () => {
    const r = FeatureFrontmatterSchema.safeParse({ ...BASE, since: '2026-06-11' });
    expect(r.success).toBe(true);
  });
  it('rejects a non-date string', () => {
    const r = FeatureFrontmatterSchema.safeParse({ ...BASE, since: 'yesterday' });
    expect(r.success).toBe(false);
  });
  it('stays optional', () => {
    expect(FeatureFrontmatterSchema.safeParse(BASE).success).toBe(true);
  });
  it('coerces YAML Date objects to yyyy-mm-dd (unquoted dates parse as Date)', () => {
    const r = FeatureFrontmatterSchema.safeParse({
      ...BASE,
      since: new Date('2026-06-11T00:00:00.000Z'),
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.since).toBe('2026-06-11');
  });
});
