// @tests: rules-cascade-v1
import { describe, expect, it } from 'vitest';
import { RuleFrontmatterSchema, frontmatterToRule } from '../types.js';

describe('RuleFrontmatterSchema', () => {
  it('accepts a full glob rule', () => {
    const fm = {
      id: 'ts-no-default-export',
      'applies-to': ['src/**/*.ts'],
      stage: ['code'],
      enforce: false,
      links: ['docs/noldor/testing-principles.md'],
    };
    expect(() => RuleFrontmatterSchema.parse(fm)).not.toThrow();
  });

  it('accepts a stage-level rule with no globs', () => {
    const fm = { id: 'review-checklist', stage: ['review'] };
    const parsed = RuleFrontmatterSchema.parse(fm);
    expect(parsed['applies-to']).toBeUndefined();
  });

  it('rejects a non-kebab id', () => {
    expect(() => RuleFrontmatterSchema.parse({ id: 'Not Kebab' })).toThrow();
  });

  it('frontmatterToRule fills defaults and attaches body', () => {
    const rule = frontmatterToRule({ id: 'a-rule' }, 'Body text.');
    expect(rule).toEqual({
      id: 'a-rule',
      appliesTo: [],
      stage: [],
      enforce: false,
      links: [],
      body: 'Body text.',
    });
  });
});
