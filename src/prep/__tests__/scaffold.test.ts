// @tests: plan-runner
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { getSectionBody, liftSpecSections, replaceSectionBody, scaffoldFd } from '../scaffold.js';

import type { PrepEntry } from '../types.js';

const entry: PrepEntry = {
  slug: 'foo-bar',
  name: 'Foo Bar',
  size: 'L',
  tier: 'full',
  area: 'tooling',
  parent: 'noldor',
  deps: ['baz'],
  body: 'Does a thing. Touches: `src/foo.ts`',
};

describe('scaffoldFd', () => {
  const md = scaffoldFd(entry, {
    specRel: 'docs/design/specs/2026-06-10-foo-bar-design.md',
    planRel: 'docs/design/plans/2026-06-10-foo-bar.md',
    cwd: process.cwd(),
  });
  const fm = matter(md);
  const data = fm.data as Record<string, any>;

  it('scaffolds phase in-progress + tier', () => {
    expect(data.phase).toBe('in-progress');
    expect(data['noldor-tier']).toBe('full');
    expect(data.name).toBe('Foo Bar');
  });

  it('links spec, plan, and Touches code', () => {
    expect(data.links.spec).toBe('docs/design/specs/2026-06-10-foo-bar-design.md');
    expect(data.links.plan).toBe('docs/design/plans/2026-06-10-foo-bar.md');
    expect(data.links.code).toContain('src/foo.ts');
  });

  it('summary strips Touches; body has prs marker + TODO stubs', () => {
    expect(getSectionBody(fm.content, 'Summary')).toBe('Does a thing.');
    expect(md).toContain('<!-- @prs-since-last-release: foo-bar -->');
    expect(md).toContain('<!-- TODO: As a user');
  });

  it('omits plan link for specs-only', () => {
    const specOnly = scaffoldFd(
      { ...entry, tier: 'specs-only', size: 'M' },
      {
        specRel: 'spec.md',
        planRel: null,
        cwd: process.cwd(),
      },
    );
    expect((matter(specOnly).data as Record<string, any>).links.plan).toBeUndefined();
  });
});

describe('section helpers', () => {
  const md = '# X\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n';

  it('getSectionBody reads a section', () => {
    expect(getSectionBody(md, 'Alpha')).toBe('alpha body');
    expect(getSectionBody(md, 'Missing')).toBeNull();
  });

  it('replaceSectionBody swaps a section body, keeping the heading', () => {
    const out = replaceSectionBody(md, 'Alpha', 'new alpha');
    expect(getSectionBody(out, 'Alpha')).toBe('new alpha');
    expect(getSectionBody(out, 'Beta')).toBe('beta body');
  });

  it('getSectionBody ignores a "## " line inside a fenced code block', () => {
    const fenced = '## Usage\n\nRun it:\n\n```md\n## Example\nhi\n```\n\nDone.\n\n## Next\n\nx\n';
    expect(getSectionBody(fenced, 'Usage')).toBe('Run it:\n\n```md\n## Example\nhi\n```\n\nDone.');
  });

  it('liftSpecSections copies spec User Story + Usage into the FD', () => {
    const fd = scaffoldFd(entry, { specRel: 's', planRel: null, cwd: process.cwd() });
    const spec =
      '# Foo — Design\n\n## User Story\n\nAs a dev, I want X.\n\n## Usage\n\nRun the thing.\n';
    const out = liftSpecSections(spec, fd);
    expect(getSectionBody(out, 'User Story')).toBe('As a dev, I want X.');
    expect(getSectionBody(out, 'Usage')).toBe('Run the thing.');
    expect(out).not.toContain('<!-- TODO: As a user');
  });
});
