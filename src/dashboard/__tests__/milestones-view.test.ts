import { describe, expect, it } from 'vitest';

import { buildMilestoneGroups, type FeatureRecord } from '../data.js';
import { renderMilestones } from '../views.js';
import type { Milestone } from '../../milestones/lib.js';

// @tests: framework-milestones-support-poc-mvp-100

function milestone(slug: string, status: Milestone['frontmatter']['status']): Milestone {
  return { slug, frontmatter: { name: slug, status }, body: '' };
}

function feature(slug: string, phase: 'done' | 'in-progress', milestone?: string): FeatureRecord {
  return {
    slug,
    frontmatter: {
      area: 'test',
      category: 'Tooling',
      deps: [],
      name: slug,
      packages: ['@acme/web'],
      phase,
      'noldor-tier': 'specs-only',
      links: { code: [], tests: [], docs: [] },
      ...(milestone ? { milestone } : {}),
    },
  } as FeatureRecord;
}

describe('buildMilestoneGroups', () => {
  it('groups members, rolls up done/total, orders active → draft → shipped', () => {
    const milestones = [
      milestone('shipped-m', 'shipped'),
      milestone('active-m', 'active'),
      milestone('draft-m', 'draft'),
    ];
    const features = [
      feature('a', 'done', 'active-m'),
      feature('b', 'in-progress', 'active-m'),
      feature('c', 'in-progress', 'shipped-m'),
      feature('orphan', 'done'), // no milestone — omitted
    ];
    const groups = buildMilestoneGroups(milestones, features);
    expect(groups.map((g) => g.slug)).toEqual(['active-m', 'draft-m', 'shipped-m']);
    const active = groups.find((g) => g.slug === 'active-m')!;
    expect(active.total).toBe(2);
    expect(active.doneCount).toBe(1);
    expect(active.incomplete).toBe(false); // active, not shipped
    const shipped = groups.find((g) => g.slug === 'shipped-m')!;
    expect(shipped.incomplete).toBe(true); // shipped + open member
  });

  it('returns empty when no milestones are declared', () => {
    expect(buildMilestoneGroups([], [feature('a', 'done', 'x')])).toEqual([]);
  });
});

describe('renderMilestones', () => {
  it('renders an empty-state when no milestones exist', () => {
    const html = renderMilestones([]);
    expect(html).toContain('No milestones declared');
  });

  it('lists members and flags a shipped-incomplete milestone in warn style', () => {
    const groups = buildMilestoneGroups(
      [milestone('mvp', 'shipped')],
      [feature('open', 'in-progress', 'mvp')],
    );
    const html = renderMilestones(groups);
    expect(html).toContain('milestone-group warn');
    expect(html).toContain('/features/open');
    expect(html).toContain('0/1 done');
  });
});
