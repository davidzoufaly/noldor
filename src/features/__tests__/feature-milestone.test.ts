import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeatureFrontmatterSchema, type FeatureFrontmatter } from '../feature-schema.js';
import { validateMilestoneRef } from '../validate-features.js';

// @tests: bootstrap-immunity-for-self-gating-features, feature-md-links-overhaul, framework-milestones-support-poc-mvp-100

const BASE = {
  area: 'test',
  category: 'Tooling',
  name: 'X',
  packages: ['@acme/web'],
  phase: 'in-progress' as const,
  'noldor-tier': 'specs-only' as const,
  links: { code: [], tests: [], docs: [] },
};

describe('FeatureFrontmatterSchema milestone field', () => {
  it('accepts an optional milestone slug', () => {
    const r = FeatureFrontmatterSchema.safeParse({ ...BASE, milestone: 'mvp' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.milestone).toBe('mvp');
  });

  it('accepts an FD with no milestone field', () => {
    expect(FeatureFrontmatterSchema.safeParse(BASE).success).toBe(true);
  });

  it('still rejects an unknown sibling key (.strict holds)', () => {
    expect(FeatureFrontmatterSchema.safeParse({ ...BASE, milstone: 'typo' }).success).toBe(false);
  });
});

describe('validateMilestoneRef', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'milestone-ref-'));
    await mkdir(join(repo, 'docs/milestones'), { recursive: true });
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const fm = (milestone?: string): FeatureFrontmatter =>
    FeatureFrontmatterSchema.parse({ ...BASE, ...(milestone ? { milestone } : {}) });

  it('passes when the field is absent', () => {
    expect(validateMilestoneRef(fm(), repo)).toEqual([]);
  });

  it('passes when docs/milestones/<slug>.md exists', async () => {
    await writeFile(join(repo, 'docs/milestones/mvp.md'), '---\nname: mvp\nstatus: active\n---\n');
    expect(validateMilestoneRef(fm('mvp'), repo)).toEqual([]);
  });

  it('errors on a dangling milestone reference', () => {
    const errs = validateMilestoneRef(fm('ghost'), repo);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/milestone: "ghost" does not resolve/);
  });
});
