// @tests: rules-cascade-v1
import { describe, expect, it } from 'vitest';
import { resolveRules } from '../resolve.js';
import type { Rule } from '../types.js';

function rule(p: Partial<Rule> & { id: string }): Rule {
  return { appliesTo: [], stage: [], enforce: false, links: [], body: '', ...p };
}

const broad = rule({ id: 'broad', appliesTo: ['src/**/*.ts'], stage: ['code'] });
const narrow = rule({ id: 'narrow', appliesTo: ['src/rules/*.ts'], stage: ['code'] });
const enforced = rule({ id: 'enf', appliesTo: ['src/**/*.ts'], stage: ['code'], enforce: true });
const stageOnly = rule({ id: 'review-rule', stage: ['review'] });
const anyStage = rule({ id: 'any', appliesTo: ['**/*.md'] });

describe('resolveRules', () => {
  it('matches glob rules for a file at the given stage', () => {
    const { injected } = resolveRules([broad, enforced], { file: 'src/x.ts', stage: 'code' });
    expect(injected.map((r) => r.id)).toContain('broad');
  });

  it('excludes rules whose stage does not match', () => {
    const { injected } = resolveRules([broad], { file: 'src/x.ts', stage: 'release' });
    expect(injected).toHaveLength(0);
  });

  it('treats empty rule.stage as any-stage', () => {
    const { injected } = resolveRules([anyStage], { file: 'README.md', stage: 'release' });
    expect(injected.map((r) => r.id)).toEqual(['any']);
  });

  it('orders by specificity: narrower glob first', () => {
    const { injected } = resolveRules([broad, narrow], { file: 'src/rules/a.ts', stage: 'code' });
    expect(injected.map((r) => r.id)).toEqual(['narrow', 'broad']);
  });

  it('partitions enforce:true into the enforce bucket', () => {
    const { injected, enforce } = resolveRules([broad, enforced], {
      file: 'src/x.ts',
      stage: 'code',
    });
    expect(injected.map((r) => r.id)).toEqual(['broad']);
    expect(enforce.map((r) => r.id)).toEqual(['enf']);
  });

  it('stage-only query (no file) returns stage-level rules without globs', () => {
    const { injected } = resolveRules([stageOnly, broad], { stage: 'review' });
    expect(injected.map((r) => r.id)).toEqual(['review-rule']);
  });
});
