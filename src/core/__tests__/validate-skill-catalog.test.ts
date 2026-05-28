// @tests: noldor
import { describe, expect, it } from 'vitest';

import { diffSkillSets, parseCatalogSlugs } from '../validate-skill-catalog.js';

describe('parseCatalogSlugs', () => {
  it('extracts slugs from `## /<slug>` headings', () => {
    const md = `# Skill Catalog

## /promote

body

## /triage

body

## /garden
`;
    expect(parseCatalogSlugs(md)).toEqual(new Set(['promote', 'triage', 'garden']));
  });

  it('ignores non-skill `## ` headings', () => {
    const md = `## Overview\n\n## /promote\n\n## Notes\n`;
    expect(parseCatalogSlugs(md)).toEqual(new Set(['promote']));
  });

  it('handles hyphenated slugs', () => {
    const md = `## /draft-feature-md\n\n## /release-sweep\n`;
    expect(parseCatalogSlugs(md)).toEqual(new Set(['draft-feature-md', 'release-sweep']));
  });

  it('returns empty set when no headings', () => {
    expect(parseCatalogSlugs('# Skill Catalog\n')).toEqual(new Set());
  });
});

describe('diffSkillSets', () => {
  it('returns empty diff when sets match', () => {
    const a = new Set(['promote', 'triage', 'garden']);
    const b = new Set(['triage', 'garden', 'promote']);
    expect(diffSkillSets(a, b)).toEqual({
      missingFromCatalog: [],
      missingFromSkills: [],
    });
  });

  it('flags skills missing from catalog', () => {
    const skills = new Set(['promote', 'triage', 'new-feature']);
    const catalog = new Set(['promote', 'triage']);
    expect(diffSkillSets(skills, catalog)).toEqual({
      missingFromCatalog: ['new-feature'],
      missingFromSkills: [],
    });
  });

  it('flags catalog entries missing from skills', () => {
    const skills = new Set(['promote', 'triage']);
    const catalog = new Set(['promote', 'triage', 'orphan']);
    expect(diffSkillSets(skills, catalog)).toEqual({
      missingFromCatalog: [],
      missingFromSkills: ['orphan'],
    });
  });

  it('flags both directions when each side has unique entries', () => {
    const skills = new Set(['a', 'b']);
    const catalog = new Set(['b', 'c']);
    expect(diffSkillSets(skills, catalog)).toEqual({
      missingFromCatalog: ['a'],
      missingFromSkills: ['c'],
    });
  });

  it('sorts the diff lists for stable output', () => {
    const skills = new Set(['zeta', 'alpha', 'mu']);
    const catalog = new Set<string>();
    expect(diffSkillSets(skills, catalog)).toEqual({
      missingFromCatalog: ['alpha', 'mu', 'zeta'],
      missingFromSkills: [],
    });
  });
});
