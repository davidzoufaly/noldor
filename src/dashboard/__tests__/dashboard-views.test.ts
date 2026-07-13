// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, dynamic-fd-changelog, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering

import { describe, expect, it } from 'vitest';

import { escapeHtml, renderLayout } from '../layout.js';
import {
  ageBucket,
  parseMultiParam,
  plainTextPreview,
  renderBacklog,
  renderChipRow,
  renderFeatureDetail,
  renderFeatures,
  renderGaps,
  renderHotZones,
  renderMilestoneBanner,
  renderOverview,
  renderRoadmap,
  renderVelocity,
  renderVision,
  renderWipAge,
  sortEntries,
  toggleMultiParam,
} from '../views.js';

import type {
  ActiveMilestonePayload,
  FeatureRecord,
  HotZoneRow,
  RoadmapEntry,
  Vision,
  WipAgeRow,
} from '../data.js';
import type { BacklogEntry } from '../../utils/parse-blocks.js';

describe('escapeHtml', () => {
  it('escapes &, <, >, ", \'', () => {
    expect(escapeHtml(`<script>alert("x")&'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderLayout', () => {
  it('returns a full HTML document with title and body', () => {
    const html = renderLayout({ title: 'Hello', body: '<p>world</p>', activeNav: '/' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Hello</title>');
    expect(html).toContain('<p>world</p>');
  });

  it('marks the active nav link with aria-current="page"', () => {
    const html = renderLayout({ title: 'Roadmap', body: '', activeNav: '/roadmap' });
    expect(html).toContain('aria-current="page"');
  });

  it('escapes the title', () => {
    const html = renderLayout({ title: '<script>', body: '', activeNav: null });
    expect(html).toContain('<title>&lt;script&gt;</title>');
  });
});

const sampleCounts = {
  features: {
    total: 2,
    byPhase: { done: 1, 'in-progress': 1 },
    byCategory: { Tooling: 2 },
    byArea: { tooling: 2 },
  },
  roadmap: { total: 1 },
  backlog: 3,
  skills: 7,
  scripts: 36,
  gaps: 0,
};

const sampleKpis = {
  project: sampleCounts,
  activity: {
    commits7d: 5,
    commits30d: 22,
    commits90d: 60,
    lastReleaseDaysAgo: 3,
    activeBranches: 2,
  },
  health: {
    staleWip: 1,
    dirtyWorktrees: 0,
    behindWorktrees: 1,
    warnings: 2,
  },
};

const sampleVision: Vision = {
  frontmatter: {
    'current-milestone': 'public-release',
  },
  bodyHtml: '<h2>North Star</h2>',
};

const sampleActiveMilestone: ActiveMilestonePayload = {
  slug: 'public-release',
  name: 'public-release',
  description: 'Public release — agent-first 3D builder',
  bodyHtml: '<p>milestone body</p>',
};

const sampleInProgressFeature: FeatureRecord = {
  slug: 'foo-feature',
  frontmatter: {
    name: 'Foo',
    phase: 'in-progress',
    area: 'tooling',
    category: 'Tooling',
    packages: ['scripts'],
    deps: [],
    links: { code: [], docs: [], tests: [] },
    'noldor-tier': 'specs-only',
  },
  bodyMarkdown: '',
};

describe('renderOverview', () => {
  it('shows three KPI sections with counter strips', () => {
    const html = renderOverview(
      sampleKpis,
      [sampleInProgressFeature],
      [],
      sampleVision,
      sampleActiveMilestone,
    );
    expect(html).toContain('Project');
    expect(html).toContain('Activity');
    expect(html).toContain('Health');
    expect(html).toContain('class="kpi-section"');
    expect(html).toContain('In progress');
    expect(html).toContain('Foo');
    expect(html).toContain('href="/features/foo-feature"');
  });

  it('renders project counters from the counts bundle', () => {
    const html = renderOverview(sampleKpis, [], [], sampleVision, sampleActiveMilestone);
    expect(html).toContain('>1/2</div><div class="l">features done');
    expect(html).toContain('>1</div><div class="l">in progress');
    expect(html).toContain('>3</div><div class="l">backlog');
  });

  it('renders activity counters including 30d and 90d windows', () => {
    const html = renderOverview(sampleKpis, [], [], sampleVision, sampleActiveMilestone);
    expect(html).toContain('>5</div><div class="l">commits 7d');
    expect(html).toContain('>22</div><div class="l">commits 30d');
    expect(html).toContain('>60</div><div class="l">commits 90d');
    expect(html).toContain('>3</div><div class="l">days since release');
    expect(html).toContain('>2</div><div class="l">active branches');
  });

  it('renders health counters for stale WIP and worktree drift', () => {
    const html = renderOverview(sampleKpis, [], [], sampleVision, sampleActiveMilestone);
    expect(html).toContain('>1</div><div class="l">stale WIP (≥14d)');
    expect(html).toContain('>0</div><div class="l">dirty worktrees');
    expect(html).toContain('>1</div><div class="l">behind worktrees');
    expect(html).toContain('>2</div><div class="l">worktree warnings');
  });

  it('shows an em-dash when lastReleaseDaysAgo is null', () => {
    const html = renderOverview(
      { ...sampleKpis, activity: { ...sampleKpis.activity, lastReleaseDaysAgo: null } },
      [],
      [],
      sampleVision,
      sampleActiveMilestone,
    );
    expect(html).toContain('>—</div><div class="l">days since release');
  });

  it('includes the milestone banner from the vision payload', () => {
    const html = renderOverview(sampleKpis, [], [], sampleVision, sampleActiveMilestone);
    expect(html).toContain('milestone-banner');
    expect(html).toContain('public-release');
    expect(html).toContain('Public release — agent-first 3D builder');
  });
});

describe('renderRoadmap', () => {
  const populated: RoadmapEntry[] = [
    {
      name: 'Live Feature',
      slug: 'live-feature',
      area: 'tooling',
      type: 'feat',
      since: '2026-05-04',
      id: 'Q-0042',
      body: 'Live feature description paragraph.',
    },
    {
      name: 'Magic Link',
      slug: 'magic-link',
      area: 'web',
      type: 'feat',
      category: 'Identity & Accounts',
      since: '2026-05-02',
      body: 'Email magic-link login at MVP.',
    },
    {
      name: 'Some Bug',
      slug: 'some-bug',
      area: 'web',
      type: 'fix',
      category: 'Bugs',
      since: '2026-05-05',
      body: 'Fix paragraph.',
    },
    {
      name: 'Edge Beveling',
      slug: 'edge-beveling',
      area: 'engine',
      body: 'No metadata.',
    },
  ];
  const noFilters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renders an empty state with zero count when the roadmap is empty', async () => {
    const html = await renderRoadmap([], noFilters);
    expect(html).toContain('0 of 0');
    expect(html).toContain('class="empty"');
    expect(html).not.toContain('<table>');
  });

  it('shows empty state with (0 of N) when filters mask every entry', async () => {
    const html = await renderRoadmap(populated, {
      area: 'nonexistent-area',
      type: '',
      category: '',
      size: [],
      impact: [],
      sort: '',
    });
    expect(html).toContain(`(0 of ${populated.length})`);
    expect(html).toContain('class="empty"');
    expect(html).not.toContain('<table>');
  });

  it('renders one flat table with one row per entry', async () => {
    const html = await renderRoadmap(populated, noFilters);
    expect(html).toContain(`(${populated.length} of ${populated.length})`);
    // Count rows in <tbody> — should equal input length.
    const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
    expect(tbody).not.toBeNull();
    const rowCount = (tbody?.[1] ?? '').match(/<tr/g)?.length ?? 0;
    expect(rowCount).toBe(populated.length);
    // Exactly one table on the page.
    expect((html.match(/<table[ >]/g) ?? []).length).toBe(1);
    // No bucket headings.
    expect(html).not.toContain('<h2>Now');
    expect(html).not.toContain('<h2>Next');
    expect(html).not.toContain('<h2>Later');
    // Entry content is present.
    expect(html).toContain('Live Feature');
    expect(html).toContain('Live feature description paragraph.');
    expect(html).toContain('Magic Link');
    expect(html).toContain('Identity &amp; Accounts');
    expect(html).toContain('class="badge type-feat">feat</span>');
    expect(html).toContain('Edge Beveling');
    expect(html).toContain('No metadata.');
  });

  it('renders the entry ID under the name, omitting it when absent', async () => {
    const html = await renderRoadmap(populated, noFilters);
    expect(html).toContain('<strong>Live Feature</strong><span class="entry-id">Q-0042</span>');
    // Entries without an ID render the bare name — no empty entry-id span.
    expect(html).toContain('<strong>Edge Beveling</strong></td>');
  });

  it('renders area + type + category filter forms', async () => {
    const html = await renderRoadmap(populated, noFilters);
    expect(html).toContain('name="area"');
    expect(html).toContain('name="type"');
    expect(html).toContain('name="category"');
  });

  it('respects the area filter across the flat list', async () => {
    const html = await renderRoadmap(populated, {
      area: 'web',
      type: '',
      category: '',
      size: [],
      impact: [],
      sort: '',
    });
    expect(html).toContain(`(2 of ${populated.length})`);
    expect(html).toContain('Magic Link');
    expect(html).toContain('Some Bug');
    expect(html).not.toContain('Live Feature');
    expect(html).not.toContain('Edge Beveling');
  });

  it('respects the type filter', async () => {
    const html = await renderRoadmap(populated, {
      area: '',
      type: 'fix',
      category: '',
      size: [],
      impact: [],
      sort: '',
    });
    expect(html).toContain(`(1 of ${populated.length})`);
    expect(html).toContain('Some Bug');
    expect(html).not.toContain('Magic Link');
  });

  it('respects the category filter', async () => {
    const html = await renderRoadmap(populated, {
      area: '',
      type: '',
      category: 'Identity & Accounts',
      size: [],
      impact: [],
      sort: '',
    });
    expect(html).toContain(`(1 of ${populated.length})`);
    expect(html).toContain('Magic Link');
    expect(html).not.toContain('Some Bug');
  });

  it('preserves the active filter selection in the form', async () => {
    const html = await renderRoadmap(populated, {
      area: 'web',
      type: 'fix',
      category: 'Bugs',
      size: [],
      impact: [],
      sort: '',
    });
    expect(html).toContain('<option value="web" selected');
    expect(html).toContain('<option value="fix" selected');
    expect(html).toContain('<option value="Bugs" selected');
  });

  it('falls back to em-dash when type/since/category absent', async () => {
    const html = await renderRoadmap(
      [{ name: 'Edge Beveling', slug: 'edge-beveling', area: 'engine', body: 'No metadata.' }],
      noFilters,
    );
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it('escapes HTML in metadata fields and raw HTML in markdown body', async () => {
    const html = await renderRoadmap(
      [
        {
          name: '<script>x</script>',
          slug: 'xss-attempt',
          area: 'tooling',
          body: '<script>alert(1)</script>\n\n**bold** and `code`',
        },
      ],
      noFilters,
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  const richPopulated: RoadmapEntry[] = [
    {
      name: 'High-XL',
      slug: 'high-xl',
      area: 'web',
      size: 'XL',
      impact: 'critical',
      since: '2026-05-10',
      body: 'b',
    },
    {
      name: 'Low-XS',
      slug: 'low-xs',
      area: 'tooling',
      size: 'XS',
      impact: 'low',
      since: '2026-05-01',
      body: 'b',
    },
    { name: 'No-meta', slug: 'no-meta', area: 'engine', body: 'b' },
  ];
  const noMulti = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renders size + impact chip rows alongside existing selects', async () => {
    const html = await renderRoadmap(richPopulated, noMulti);
    expect(html).toContain('chip-row');
    expect(html).toContain('>XS<');
    expect(html).toContain('>XL<');
    expect(html).toContain('>critical<');
    expect(html).toContain('>low<');
  });

  it('filters by selected size chips (intersect logic per param)', async () => {
    const html = await renderRoadmap(richPopulated, { ...noMulti, size: ['XS'] });
    expect(html).toContain(`(1 of ${richPopulated.length})`);
    expect(html).toContain('Low-XS');
    expect(html).not.toContain('High-XL');
  });

  it('filters by selected impact chips and ANDs across params', async () => {
    const html = await renderRoadmap(richPopulated, {
      ...noMulti,
      size: ['XS'],
      impact: ['critical'],
    });
    expect(html).toContain(`(0 of ${richPopulated.length})`);
  });

  it('treats entry as match when size filter is empty', async () => {
    const html = await renderRoadmap(richPopulated, { ...noMulti, impact: ['low'] });
    expect(html).toContain('Low-XS');
    expect(html).not.toContain('No-meta');
    expect(html).not.toContain('High-XL');
  });

  it('sorts by size-desc when sort=size-desc', async () => {
    const html = await renderRoadmap(richPopulated, { ...noMulti, sort: 'size-desc' });
    const xlIdx = html.indexOf('High-XL');
    const xsIdx = html.indexOf('Low-XS');
    expect(xlIdx).toBeGreaterThan(-1);
    expect(xsIdx).toBeGreaterThan(-1);
    expect(xlIdx).toBeLessThan(xsIdx);
  });

  it('exposes a reset link in the chip area', async () => {
    const html = await renderRoadmap(richPopulated, { ...noMulti, size: ['XS'] });
    expect(html).toMatch(/<a[^>]*class="reset"[^>]*href="\?"[^>]*>Reset</);
  });

  // Task 1 — size + impact columns. The fields already exist on RoadmapEntry
  // and feed the chip filters + sort modes; this asserts they also surface
  // as visible table columns so users can scan size/impact alongside name/area.
  it('renders Size and Impact columns in the thead between Type and Since', async () => {
    const html = await renderRoadmap(richPopulated, noMulti);
    expect(html).toContain('<th>Size</th>');
    expect(html).toContain('<th>Impact</th>');
    const typeIdx = html.indexOf('<th>Type</th>');
    const sizeIdx = html.indexOf('<th>Size</th>');
    const impactIdx = html.indexOf('<th>Impact</th>');
    const sinceIdx = html.indexOf('<th>Since</th>');
    expect(typeIdx).toBeLessThan(sizeIdx);
    expect(sizeIdx).toBeLessThan(impactIdx);
    expect(impactIdx).toBeLessThan(sinceIdx);
  });

  it('renders size + impact cells per row, em-dash when missing', async () => {
    const html = await renderRoadmap(richPopulated, noMulti);
    expect(html).toMatch(/<td>XL<\/td>\s*<td>critical<\/td>/);
    expect(html).toMatch(/<td>XS<\/td>\s*<td>low<\/td>/);
    // No-meta row has size/impact undefined → both render em-dash.
    expect(html).toMatch(/<td>—<\/td>\s*<td>—<\/td>/);
  });
});

describe('renderBacklog', () => {
  const sampleEntries = [
    {
      name: 'Sample Feat',
      slug: 'sample-feat',
      area: 'tooling',
      type: 'feat',
      since: '2026-05-04',
      id: 'Q-0007',
      description: 'A reasonably long description of why this matters.',
    },
    {
      name: 'Sample Fix',
      slug: 'sample-fix',
      area: 'web',
      type: 'fix',
      since: '2026-05-05',
      description: 'Bug paragraph.',
    },
  ];

  const noFiltersB = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renders area + type filter forms', async () => {
    const html = await renderBacklog([], noFiltersB);
    expect(html).toContain('<form');
    expect(html).toContain('name="area"');
    expect(html).toContain('name="type"');
  });

  it('renders a row per entry with name, area, type badge, since, description', async () => {
    const html = await renderBacklog(sampleEntries, noFiltersB);
    expect(html).toMatch(/<table[ >]/);
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('Sample Feat');
    expect(html).toContain('tooling');
    expect(html).toContain('class="badge type-feat">feat</span>');
    expect(html).toContain('2026-05-04');
    expect(html).toContain('A reasonably long description of why this matters.');
    expect(html).toContain('<strong>Sample Feat</strong><span class="entry-id">Q-0007</span>');
    // Entry without an ID renders the bare name.
    expect(html).toContain('<strong>Sample Fix</strong></td>');
  });

  it('respects type filter', async () => {
    const html = await renderBacklog(sampleEntries, { ...noFiltersB, type: 'fix' });
    expect(html).toContain('Sample Fix');
    expect(html).not.toContain('Sample Feat');
    expect(html).toContain('Backlog (1 of 2)');
  });

  it('shows em-dash when type or since is missing', async () => {
    const html = await renderBacklog(
      [{ name: 'Untyped', slug: 'untyped', area: 'tooling', description: 'No metadata' }],
      noFiltersB,
    );
    expect(html).toContain('Untyped');
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it('escapes HTML in metadata fields and renders description as trusted markdown', async () => {
    const html = await renderBacklog(
      [
        {
          name: '<script>x</script>',
          slug: 'scriptxscript',
          area: 'tooling',
          type: 'feat',
          description: '**bold** and `code`',
        },
      ],
      noFiltersB,
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  const richBacklog = [
    {
      name: 'B-High',
      slug: 'b-high',
      area: 'web',
      size: 'L',
      impact: 'high',
      since: '2026-05-10',
      description: 'd',
    },
    {
      name: 'B-Low',
      slug: 'b-low',
      area: 'tooling',
      size: 'S',
      impact: 'low',
      since: '2026-04-01',
      description: 'd',
    },
  ];
  const noBmulti = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renders size + impact chips on /backlog', async () => {
    const html = await renderBacklog(richBacklog, noBmulti);
    expect(html).toContain('chip-row');
    expect(html).toContain('>S<');
    expect(html).toContain('>L<');
  });

  it('filters by impact chip', async () => {
    const html = await renderBacklog(richBacklog, { ...noBmulti, impact: ['low'] });
    expect(html).toContain('B-Low');
    expect(html).not.toContain('B-High');
    expect(html).toContain('Backlog (1 of 2)');
  });

  it('sorts by impact-desc', async () => {
    const html = await renderBacklog(richBacklog, { ...noBmulti, sort: 'impact-desc' });
    expect(html.indexOf('B-High')).toBeLessThan(html.indexOf('B-Low'));
  });

  it('exposes a reset link on /backlog', async () => {
    const html = await renderBacklog(richBacklog, { ...noBmulti, size: ['S'] });
    expect(html).toMatch(/<a[^>]*class="reset"[^>]*href="\?"[^>]*>Reset</);
  });

  // Age buckets — entries grouped by `since:` age (pure frontmatter math),
  // young → old, undated last; empty buckets are skipped.
  const bucketNow = new Date('2026-06-10T00:00:00Z');
  const agedBacklog = [
    { name: 'Fresh', slug: 'fresh', area: 'web', since: '2026-06-01', description: 'd' },
    { name: 'Aging', slug: 'aging', area: 'web', since: '2026-04-15', description: 'd' },
    { name: 'Stale', slug: 'stale', area: 'web', since: '2026-01-01', description: 'd' },
    { name: 'Dateless', slug: 'dateless', area: 'web', description: 'd' },
  ];

  it('groups entries into age-bucket sections with per-bucket counts', async () => {
    const html = await renderBacklog(agedBacklog, noBmulti, { rawHash: 'h', now: bucketNow });
    expect(html).toContain('0–30 days (1)');
    expect(html).toContain('30–90 days (1)');
    expect(html).toContain('90+ days (1)');
    expect(html).toContain('No date (1)');
    // Young → old → undated section order; rows live in their bucket.
    const order = [
      '0–30 days',
      'Fresh',
      '30–90 days',
      'Aging',
      '90+ days',
      'Stale',
      'No date',
      'Dateless',
    ];
    const idx = order.map((s) => html.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('skips empty age buckets and keeps data-section on every bucket table', async () => {
    const html = await renderBacklog([agedBacklog[0]!, agedBacklog[2]!], noBmulti, {
      rawHash: 'h',
      now: bucketNow,
    });
    expect(html).not.toContain('30–90 days');
    expect(html).not.toContain('No date');
    expect(html.match(/<table data-section="backlog" data-etag="h">/g)).toHaveLength(2);
  });

  it('applies filters across buckets while the h1 keeps the global count', async () => {
    const html = await renderBacklog(
      agedBacklog.map((e, i) => ({ ...e, size: i === 0 ? 'S' : 'L' })),
      { ...noBmulti, size: ['S'] },
      { rawHash: 'h', now: bucketNow },
    );
    expect(html).toContain('Backlog (1 of 4)');
    expect(html).toContain('0–30 days (1)');
    expect(html).not.toContain('90+ days');
  });
  // Task 2 — Category column derived from `area` via areaToCategory helper.
  // Backlog source markdown has no `- category:` bullet; the dashboard
  // surfaces the derived category so demote/promote decisions don't
  // require opening the source block.
  it('renders a Category column header and Category filter dropdown', async () => {
    const html = await renderBacklog(
      [
        {
          name: 'Sample Feat',
          slug: 'sample-feat',
          area: 'tooling',
          type: 'feat',
          category: 'Tooling',
          description: 'A description.',
        },
      ],
      { area: '', type: '', category: '', size: [], impact: [], sort: '' },
    );
    expect(html).toContain('<th>Category</th>');
    expect(html).toContain('name="category"');
    // Each row carries a <td> with the category text.
    expect(html).toMatch(/<td>Tooling<\/td>/);
  });

  it('respects the category filter on /backlog', async () => {
    const html = await renderBacklog(
      [
        {
          name: 'Web Entry',
          slug: 'web-entry',
          area: 'web',
          category: 'Tooling',
          description: 'd',
        },
        {
          name: 'Engine Entry',
          slug: 'engine-entry',
          area: 'engine',
          category: 'Core',
          description: 'd',
        },
      ],
      { area: '', type: '', category: 'Tooling', size: [], impact: [], sort: '' },
    );
    expect(html).toContain('Web Entry');
    expect(html).not.toContain('Engine Entry');
    expect(html).toContain('Backlog (1 of 2)');
  });

  // Task 1 — size + impact columns on /backlog (mirrors /roadmap).
  it('renders Size and Impact columns in the thead between Type and Since', async () => {
    const html = await renderBacklog(richBacklog, noBmulti);
    expect(html).toContain('<th>Size</th>');
    expect(html).toContain('<th>Impact</th>');
    const typeIdx = html.indexOf('<th>Type</th>');
    const sizeIdx = html.indexOf('<th>Size</th>');
    const impactIdx = html.indexOf('<th>Impact</th>');
    const sinceIdx = html.indexOf('<th>Since</th>');
    expect(typeIdx).toBeLessThan(sizeIdx);
    expect(sizeIdx).toBeLessThan(impactIdx);
    expect(impactIdx).toBeLessThan(sinceIdx);
  });

  it('renders size + impact cells per row, em-dash when missing', async () => {
    const html = await renderBacklog(richBacklog, noBmulti);
    expect(html).toMatch(/<td>L<\/td>\s*<td>high<\/td>/);
    expect(html).toMatch(/<td>S<\/td>\s*<td>low<\/td>/);
    const htmlNoMeta = await renderBacklog(
      [{ name: 'Untyped', slug: 'untyped', area: 'tooling', description: 'No metadata' }],
      noBmulti,
    );
    expect(htmlNoMeta).toMatch(/<td>—<\/td>\s*<td>—<\/td>/);
  });

  // Regression guard: multiple `<input name="size">` elements would emit
  // `?size=X&size=Y` on form submit, but `URLSearchParams.get('size')` only
  // returns the first — silently dropping selections. Pin the single-input
  // encoding so a future refactor can't slip back to the broken pattern.
  it('emits at most one hidden input per multi-select param on /backlog', async () => {
    const html = await renderBacklog(richBacklog, {
      ...noBmulti,
      size: ['S', 'L'],
      impact: ['low', 'high'],
    });
    expect((html.match(/<input[^>]*name="size"/g) ?? []).length).toBeLessThanOrEqual(1);
    expect((html.match(/<input[^>]*name="impact"/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe('ageBucket', () => {
  const now = new Date('2026-06-10T00:00:00Z');

  it('buckets by age with inclusive young-side boundaries', () => {
    expect(ageBucket('2026-06-09', now)).toBe('0-30d');
    expect(ageBucket('2026-05-11', now)).toBe('0-30d'); // exactly 30 days
    expect(ageBucket('2026-05-10', now)).toBe('30-90d'); // 31 days
    expect(ageBucket('2026-03-12', now)).toBe('30-90d'); // exactly 90 days
    expect(ageBucket('2026-03-11', now)).toBe('90d+'); // 91 days
  });

  it('clamps future dates to 0-30d', () => {
    expect(ageBucket('2026-07-01', now)).toBe('0-30d');
  });

  it('routes missing or unparseable dates to undated', () => {
    expect(ageBucket(undefined, now)).toBe('undated');
    expect(ageBucket('not-a-date', now)).toBe('undated');
  });
});

describe('renderFeatures', () => {
  it('renders rows for each feature with a drill-down link', () => {
    const html = renderFeatures(
      [
        {
          slug: 'foo',
          frontmatter: {
            name: 'Foo',
            phase: 'in-progress',
            area: 'tooling',
            category: 'Tooling',
            packages: ['scripts'],
            deps: [],
            links: { code: [], docs: [], tests: [] },
            'noldor-tier': 'specs-only' as const,
          },
          bodyMarkdown: '',
        },
      ],
      { phase: '', category: '', area: '', updated: '', sort: '' },
    );
    expect(html).toContain('href="/features/foo"');
    expect(html).toContain('Foo');
  });

  const featureFixture = (slug: string, name: string, introduced?: string) => ({
    slug,
    frontmatter: {
      name,
      phase: 'done' as const,
      area: 'tooling',
      category: 'Tooling',
      packages: ['scripts'],
      deps: [],
      links: { code: [], docs: [], tests: [] },
      'noldor-tier': 'specs-only' as const,
      ...(introduced ? { introduced } : {}),
    },
    bodyMarkdown: '',
  });

  it('offers git last-commit sort options in the dropdown', () => {
    const html = renderFeatures([featureFixture('foo', 'Foo')], {
      phase: '',
      category: '',
      area: '',
      updated: '',
      sort: '',
    });
    expect(html).toContain('value="git-updated-desc"');
    expect(html).toContain('value="git-updated-asc"');
  });

  it('sorts by git last-commit date desc, missing timestamps last', () => {
    const html = renderFeatures(
      [
        featureFixture('older', 'Older'),
        featureFixture('undated', 'Undated'),
        featureFixture('newer', 'Newer'),
      ],
      { phase: '', category: '', area: '', updated: '', sort: 'git-updated-desc' },
      new Map([
        ['older', '2026-01-05T10:00:00+02:00'],
        ['newer', '2026-06-01T10:00:00+02:00'],
      ]),
    );
    const pos = (slug: string) => html.indexOf(`href="/features/${slug}"`);
    expect(pos('newer')).toBeGreaterThan(-1);
    expect(pos('newer')).toBeLessThan(pos('older'));
    expect(pos('older')).toBeLessThan(pos('undated'));
  });

  it('sorts by git last-commit date asc, missing timestamps last', () => {
    const html = renderFeatures(
      [
        featureFixture('undated', 'Undated'),
        featureFixture('newer', 'Newer'),
        featureFixture('older', 'Older'),
      ],
      { phase: '', category: '', area: '', updated: '', sort: 'git-updated-asc' },
      new Map([
        ['older', '2026-01-05T10:00:00+02:00'],
        ['newer', '2026-06-01T10:00:00+02:00'],
      ]),
    );
    const pos = (slug: string) => html.indexOf(`href="/features/${slug}"`);
    expect(pos('older')).toBeLessThan(pos('newer'));
    expect(pos('newer')).toBeLessThan(pos('undated'));
  });

  it('renders the missing-introduced checkbox, unchecked by default', () => {
    const html = renderFeatures([featureFixture('foo', 'Foo')], {
      phase: '',
      category: '',
      area: '',
      updated: '',
      sort: '',
    });
    expect(html).toContain('name="missing-introduced"');
    expect(html).not.toContain('name="missing-introduced" value="1" checked');
  });

  it('filters to features missing introduced when the checkbox is on', () => {
    const html = renderFeatures(
      [featureFixture('shipped', 'Shipped', '0.4.0'), featureFixture('unmarked', 'Unmarked')],
      { phase: '', category: '', area: '', updated: '', sort: '', missingIntroduced: true },
    );
    expect(html).toContain('href="/features/unmarked"');
    expect(html).not.toContain('href="/features/shipped"');
    expect(html).toContain('checked');
    expect(html).toContain('Features (1 of 2)');
  });

  it('keeps features with introduced visible when the checkbox is off', () => {
    const html = renderFeatures(
      [featureFixture('shipped', 'Shipped', '0.4.0'), featureFixture('unmarked', 'Unmarked')],
      { phase: '', category: '', area: '', updated: '', sort: '' },
    );
    expect(html).toContain('href="/features/shipped"');
    expect(html).toContain('href="/features/unmarked"');
  });
});

describe('renderGaps', () => {
  it('renders empty state when no gaps', () => {
    const html = renderGaps([], { category: '' });
    expect(html).toContain('class="empty"');
  });
});

describe('renderVelocity', () => {
  it('renders counter strip without an active-worktrees counter', () => {
    const html = renderVelocity({
      commits: { last7d: 0, last30d: 0, last90d: 0 },
      commitsByType: {},
      commitsByScope: {},
      releases: [],
      lastReleaseDaysAgo: null,
      activeBranches: 0,
      activeWorktrees: 0,
      topAuthors30d: [],
    });
    expect(html).toContain('counter');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('active worktrees');
  });
});

describe('renderFeatureDetail', () => {
  const baseDetail = {
    slug: 'foo',
    frontmatter: {
      name: 'Foo',
      phase: 'in-progress' as const,
      area: 'tooling',
      category: 'Tooling' as const,
      packages: ['scripts'],
      deps: [],
      'noldor-tier': 'specs-only' as const,
      links: {
        code: ['scripts/foo.ts'],
        docs: [],
        commits: ['a1b2c3d4e5f6'],
        tests: ['scripts/__tests__/foo.test.ts'],
      },
    },
    bodyMarkdown: '## Hello\n\nWorld.',
    bodyHtml: '<h2>Hello</h2>\n<p>World.</p>',
    changelog: { unreleased: [], perVersion: new Map() },
  };

  it('renders frontmatter as a table and body html', () => {
    const html = renderFeatureDetail(baseDetail);
    expect(html).toContain('<h1>Foo</h1>');
    expect(html).toContain('<th>phase</th>');
    expect(html).toContain('in-progress');
    expect(html).toContain('<h2>Hello</h2>');
  });

  it('escapes script tags injected via frontmatter name', () => {
    const detail = {
      ...baseDetail,
      frontmatter: { ...baseDetail.frontmatter, name: '<script>alert(1)</script>' },
    };
    const html = renderFeatureDetail(detail);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  // Commit/code/test/doc links now live in the FD body's auto-generated
  // `## Resources` block, populated by `pnpm sync:fd-resources`. See
  // `src/sync/__tests__/sync-fd-resources.test.ts`.
});

describe('renderHotZones', () => {
  const sampleRow: HotZoneRow = {
    rank: 1,
    path: 'packages/noldor/src/dashboard/data.ts',
    changeCount: 7,
    insertions: 412,
    deletions: 89,
    authors: ['David Zoufaly'],
    lastCommitDate: '2026-05-04',
    lastCommitSubject: 'feat(scripts): something',
    lastCommitHash: 'abc1234',
    featureSlugs: ['project-tracking-dashboard'],
  };

  it('renders an empty state when there are no rows', () => {
    const html = renderHotZones([], { days: 30, limit: 10 });
    expect(html).toContain('class="empty"');
    expect(html).toContain('No matching commits');
  });

  it('renders the heading with limit and days', () => {
    const html = renderHotZones([sampleRow], { days: 7, limit: 5 });
    expect(html).toContain('Hot zones (top 5, last 7 days)');
  });

  it('renders the row with rank, path link, change count, authors, feature link, last commit', () => {
    const html = renderHotZones([sampleRow], { days: 30, limit: 10 });
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('https://github.com/');
    expect(html).toContain('blob/main/packages/noldor/src/dashboard/data.ts');
    expect(html).toContain('<code>packages/noldor/src/dashboard/data.ts</code>');
    expect(html).toContain('<td>7</td>');
    expect(html).toContain('David Zoufaly');
    expect(html).toContain('href="/features/project-tracking-dashboard"');
    expect(html).toContain('<time>2026-05-04</time>');
    expect(html).toContain('<code>abc1234</code>');
  });

  it('renders an em-dash when featureSlugs is empty', () => {
    const orphan: HotZoneRow = { ...sampleRow, featureSlugs: [] };
    const html = renderHotZones([orphan], { days: 30, limit: 10 });
    expect(html).toMatch(/<td>—<\/td>/);
  });

  it('renders the lines-changed column with insertions and deletions', () => {
    const html = renderHotZones([sampleRow], { days: 30, limit: 10 });
    expect(html).toContain('<th>Lines (+/−)</th>');
    expect(html).toContain('<td>+412 / −89</td>');
  });

  it('preserves filter state in the form', () => {
    const html = renderHotZones([sampleRow], { days: 7, limit: 25 });
    expect(html).toContain('<option value="7" selected');
    expect(html).toContain('value="25"');
  });

  it('escapes HTML in dynamic fields', () => {
    const xss: HotZoneRow = {
      ...sampleRow,
      lastCommitSubject: '<script>alert(1)</script>',
    };
    const html = renderHotZones([xss], { days: 30, limit: 10 });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('encodes special characters in path within href and escapes them in code text', () => {
    const row: HotZoneRow = { ...sampleRow, path: 'src/foo bar/<test>.ts' };
    const html = renderHotZones([row], { days: 30, limit: 10 });
    expect(html).toContain('foo%20bar/%3Ctest%3E.ts');
    expect(html).toContain('&lt;test&gt;');
  });
});

describe('renderWipAge', () => {
  const fresh: WipAgeRow = {
    slug: 'fresh-feat',
    name: 'Fresh Feat',
    area: 'tooling',
    ageDays: 2,
    bucket: 'fresh',
    firstCommitTimestamp: 1_700_000_000,
  };
  const aging: WipAgeRow = {
    slug: 'aging-feat',
    name: 'Aging Feat',
    area: 'web',
    ageDays: 9,
    bucket: 'aging',
    firstCommitTimestamp: 1_700_000_000,
  };
  const stale: WipAgeRow = {
    slug: 'stale-feat',
    name: 'Stale Feat',
    area: 'engine',
    ageDays: 21,
    bucket: 'stale',
    firstCommitTimestamp: 1_700_000_000,
  };

  it('renders an empty state when no rows', () => {
    const html = renderWipAge([]);
    expect(html).toContain('No features in progress');
    expect(html).toContain('class="empty"');
  });

  it('renders bucket counters reflecting input distribution', () => {
    const html = renderWipAge([fresh, aging, stale, stale]);
    expect(html).toContain('>4</div><div class="l">in progress');
    expect(html).toContain('>1</div><div class="l">fresh');
    expect(html).toContain('>1</div><div class="l">aging');
    expect(html).toContain('>2</div><div class="l">stale');
  });

  it('links the row to the feature detail page', () => {
    const html = renderWipAge([fresh]);
    expect(html).toContain('href="/features/fresh-feat"');
    expect(html).toContain('Fresh Feat');
  });

  it('marks the stale row with class="row-stale"', () => {
    const html = renderWipAge([stale, fresh]);
    const segments = html.split('<tr').slice(1);
    const staleSeg = segments.find((s) => s.includes('Stale Feat')) ?? '';
    const freshSeg = segments.find((s) => s.includes('Fresh Feat')) ?? '';
    expect(staleSeg).toContain('class="row-stale"');
    expect(freshSeg).not.toContain('class="row-stale"');
  });

  it('renders bucket badges per row', () => {
    const html = renderWipAge([fresh, aging, stale]);
    expect(html).toContain('<span class="badge fresh">fresh</span>');
    expect(html).toContain('<span class="badge aging">aging</span>');
    expect(html).toContain('<span class="badge stale">stale</span>');
  });

  it('escapes HTML in dynamic fields', () => {
    const xss: WipAgeRow = { ...fresh, name: '<script>x</script>' };
    const html = renderWipAge([xss]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

const visionWithActiveMilestone: Vision = {
  frontmatter: { 'current-milestone': 'public-release' },
  bodyHtml: '<p>body</p>',
};

const visionWithoutMilestone: Vision = {
  frontmatter: {},
  bodyHtml: '<p>body</p>',
};

const activeMilestone: ActiveMilestonePayload = {
  slug: 'public-release',
  name: 'public-release',
  description: 'a description',
  bodyHtml: '<p>m body</p>',
};

describe('renderMilestoneBanner', () => {
  it('renders the active milestone name + description when both present', () => {
    const html = renderMilestoneBanner(visionWithActiveMilestone, activeMilestone);
    expect(html).toContain('public-release');
    expect(html).toContain('a description');
  });

  it('returns empty string when current-milestone is absent', () => {
    expect(renderMilestoneBanner(visionWithoutMilestone, null)).toBe('');
  });

  it('renders warning when slug is set but milestone file is missing', () => {
    const html = renderMilestoneBanner(visionWithActiveMilestone, null);
    expect(html).toContain('not found');
    expect(html).toContain('pnpm validate:milestones');
  });

  it('renders the read-vision link when milestone resolved', () => {
    const html = renderMilestoneBanner(visionWithActiveMilestone, activeMilestone);
    expect(html).toContain('milestone-banner');
    expect(html).toContain('href="/vision"');
  });

  it('escapes HTML in milestone name and description', () => {
    const xss: ActiveMilestonePayload = {
      ...activeMilestone,
      name: '<script>x</script>',
      description: '<b>evil</b>',
    };
    const html = renderMilestoneBanner(visionWithActiveMilestone, xss);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderVision', () => {
  const vision: Vision = {
    frontmatter: {
      'current-milestone': 'public-release',
    },
    bodyHtml: '<h2>North Star</h2><p>body</p>',
  };

  const resolvedMilestone: ActiveMilestonePayload = {
    slug: 'public-release',
    name: 'public-release',
    description: 'a description',
    bodyHtml: '<p>m body</p>',
  };

  it('renders frontmatter table + body section when milestone resolved', () => {
    const html = renderVision(vision, resolvedMilestone);
    expect(html).not.toContain('<h1>Vision</h1>');
    expect(html).not.toContain('<h2>Body</h2>');
    expect(html).toContain('<th>current milestone</th>');
    expect(html).toContain('<td>public-release</td>');
    expect(html).toContain('North Star');
  });

  it('renders description row when milestone has a description', () => {
    const html = renderVision(vision, resolvedMilestone);
    expect(html).toContain('<th>description</th>');
    expect(html).toContain('<td>a description</td>');
  });

  it('passes the rendered body HTML through verbatim', () => {
    const html = renderVision(vision, resolvedMilestone);
    expect(html).toContain('<h2>North Star</h2><p>body</p>');
  });

  it('renders empty table when no active milestone', () => {
    const noMilestoneVision: Vision = { frontmatter: {}, bodyHtml: '<p>body</p>' };
    const html = renderVision(noMilestoneVision, null);
    expect(html).not.toContain('<table>');
    expect(html).toContain('<p>body</p>');
  });

  it('renders empty table when slug is set but milestone is null', () => {
    const html = renderVision(vision, null);
    expect(html).not.toContain('<table>');
    expect(html).toContain('<h2>North Star</h2>');
  });
});

describe('parseMultiParam', () => {
  it('returns empty array for empty / missing input', () => {
    expect(parseMultiParam('')).toEqual([]);
    expect(parseMultiParam(undefined)).toEqual([]);
  });
  it('splits comma-separated values and trims whitespace', () => {
    expect(parseMultiParam('XS,S, M')).toEqual(['XS', 'S', 'M']);
  });
  it('drops empty segments', () => {
    expect(parseMultiParam('XS,,S,')).toEqual(['XS', 'S']);
  });
});

describe('toggleMultiParam', () => {
  it('adds a value not present', () => {
    expect(toggleMultiParam(['XS'], 'S')).toEqual(['XS', 'S']);
  });
  it('removes a value already present', () => {
    expect(toggleMultiParam(['XS', 'S'], 'XS')).toEqual(['S']);
  });
  it('handles empty input', () => {
    expect(toggleMultiParam([], 'XS')).toEqual(['XS']);
  });
});

describe('renderChipRow', () => {
  it('renders one chip per value with toggle hrefs', () => {
    const html = renderChipRow({
      label: 'Size',
      param: 'size',
      values: ['XS', 'S', 'M'],
      selected: ['S'],
      otherParams: new URLSearchParams(''),
    });
    expect(html).toContain('Size');
    // Each value is a chip
    expect(html).toContain('>XS<');
    expect(html).toContain('>S<');
    expect(html).toContain('>M<');
    // Selected chip carries the `selected` class marker
    expect(html).toMatch(/class="chip selected"[^>]*>S</);
    expect(html).toMatch(/class="chip"[^>]*>XS</);
    // Href toggles size on click: clicking XS while only S is selected → ?size=S,XS
    expect(html).toContain('?size=S%2CXS');
    // Clicking the already-selected S → ?size= (empty list serializes to omission)
    expect(html).toMatch(/href="\?"[^>]*>S</);
  });

  it('preserves other URL params on chip hrefs', () => {
    const html = renderChipRow({
      label: 'Impact',
      param: 'impact',
      values: ['high', 'critical'],
      selected: [],
      otherParams: new URLSearchParams('area=tooling&type=feat'),
    });
    expect(html).toContain('area=tooling');
    expect(html).toContain('type=feat');
    expect(html).toContain('impact=high');
  });
});

describe('renderRoadmap drag attrs', () => {
  const fixture: RoadmapEntry[] = [
    {
      name: 'Alpha',
      slug: 'alpha',
      area: 'tooling',
      type: 'feat',
      body: 'Alpha body.',
      category: 'Noldor Framework',
      size: 'S',
      impact: 'high',
    },
    {
      name: 'Beta',
      slug: 'beta',
      area: 'tooling',
      type: 'feat',
      body: 'Beta body.',
      category: 'Noldor Framework',
      size: 'M',
      impact: 'med',
    },
  ];

  it('emits data-slug, data-etag, data-drag-enabled when filters empty + sort=priority', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: '',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: 'priority',
      },
      { rawHash: 'abc123', dragEnabled: true },
    );
    expect(html).toContain('data-section="roadmap"');
    expect(html).toContain('data-etag="abc123"');
    expect(html).toContain('data-drag-enabled="true"');
    expect(html).toContain('data-slug="alpha"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('class="move-chip"');
    expect(html).toContain('data-action="demote"');
    expect(html).toContain('Demote');
  });

  it('sets data-drag-enabled=false under a non-priority sort', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: '',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: 'name-asc',
      },
      { rawHash: 'abc123', dragEnabled: false },
    );
    expect(html).toContain('data-drag-enabled="false"');
    expect(html).toContain('draggable="false"');
  });

  it('sets data-drag-enabled=false when any filter is set', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: 'tooling',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: 'priority',
      },
      { rawHash: 'abc123', dragEnabled: false },
    );
    expect(html).toContain('data-drag-enabled="false"');
  });

  it('uses file-order (identity) sort when sort=priority', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: '',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: 'priority',
      },
      { rawHash: 'abc123', dragEnabled: true },
    );
    expect(html.indexOf('Alpha')).toBeLessThan(html.indexOf('Beta'));
  });

  it('emits Priority as the first sort option, selected when sort empty', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: '',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: '',
      },
      { rawHash: 'abc123', dragEnabled: true },
    );
    // The Priority option appears before the name-asc option in the rendered markup.
    const sortSelectMatch = /<select name="sort"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    expect(sortSelectMatch).not.toBeNull();
    const opts = sortSelectMatch?.[1] ?? '';
    expect(opts.indexOf('Priority')).toBeLessThan(opts.indexOf('Name A'));
    expect(opts).toMatch(/<option value="priority"\s+selected>Priority<\/option>/);
  });

  it('escapes rawHash in data-etag', async () => {
    const html = await renderRoadmap(
      fixture,
      {
        area: '',
        type: '',
        category: '',
        size: [],
        impact: [],
        sort: 'priority',
      },
      { rawHash: 'a"b<c', dragEnabled: false },
    );
    expect(html).toContain('data-etag="a&quot;b&lt;c"');
  });
});

describe('renderBacklog drag removal', () => {
  it('emits data-section, data-etag, Promote button but no drag-handle column or row drag attrs', async () => {
    const html = await renderBacklog(
      [{ name: 'Charlie', slug: 'charlie', area: 'web', type: 'feat', description: 'Body C.' }],
      { area: '', type: '', category: '', size: [], impact: [], sort: 'priority' },
      { rawHash: 'def456' },
    );
    expect(html).toContain('data-section="backlog"');
    expect(html).toContain('data-etag="def456"');
    expect(html).toContain('data-slug="charlie"');
    expect(html).toContain('class="move-chip"');
    expect(html).toContain('data-action="promote"');
    expect(html).toContain('Promote');
    expect(html).not.toContain('class="drag-col"');
    expect(html).not.toMatch(/class="drag-handle[\s"]/);
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('draggable="false"');
    expect(html).not.toContain('data-drag-enabled');
  });
});

describe('sortEntries', () => {
  const sample = [
    { name: 'Alpha', size: 'M', impact: 'high', since: '2026-05-01', area: 'web', type: 'feat' },
    { name: 'Bravo', size: 'XS', impact: 'low', since: '2026-05-10', area: 'tooling', type: 'fix' },
    {
      name: 'Charlie',
      size: 'XL',
      impact: 'critical',
      since: '2026-04-20',
      area: 'engine',
      type: 'feat',
    },
    {
      name: 'Delta',
      size: undefined,
      impact: undefined,
      since: undefined,
      area: 'docs',
      type: undefined,
    },
  ];

  it('defaults to name-asc when sort mode is empty', () => {
    const sorted = sortEntries(sample, '').map((e) => e.name);
    expect(sorted).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('orders size-asc as XS < S < M < L < XL with undefined last', () => {
    const sorted = sortEntries(sample, 'size-asc').map((e) => e.name);
    expect(sorted).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });

  it('orders impact-desc as critical > high > med > low with undefined last', () => {
    const sorted = sortEntries(sample, 'impact-desc').map((e) => e.name);
    expect(sorted).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
  });

  it('orders since-desc newest first, undefined last', () => {
    const sorted = sortEntries(sample, 'since-desc').map((e) => e.name);
    expect(sorted).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);
  });

  it('falls back to name-asc for unknown sort key', () => {
    const sorted = sortEntries(sample, 'gibberish').map((e) => e.name);
    expect(sorted).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });
});

describe('plainTextPreview', () => {
  // Task 4 — preview text feeds the CSS line-clamp inside the description
  // cell. Markdown blocks (lists, code, headings) cannot live inside a
  // single line-clamped element because `-webkit-line-clamp` requires a
  // single block-formatting context with text children. This helper
  // flattens markdown to a single plain-text string so the clamp can
  // honour the 6-line cap deterministically.
  it('flattens a single paragraph to its text content', () => {
    expect(plainTextPreview('Hello world.')).toBe('Hello world.');
  });

  it('joins multiple paragraphs with spaces', () => {
    expect(plainTextPreview('First paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph. Second paragraph.',
    );
  });

  it('strips markdown heading markers', () => {
    expect(plainTextPreview('# Heading\n\nBody text.')).toBe('Heading Body text.');
  });

  it('flattens list bullets to comma-joined text', () => {
    expect(plainTextPreview('- one\n- two\n- three')).toBe('one, two, three');
  });

  it('removes fenced code blocks (block-level cannot be inline-flattened)', () => {
    const md = 'Before code.\n\n```ts\nconst x = 1;\n```\n\nAfter code.';
    const out = plainTextPreview(md);
    expect(out).toContain('Before code.');
    expect(out).toContain('After code.');
    expect(out).not.toContain('```');
    expect(out).not.toContain('const x = 1;');
  });

  it('strips inline code markers but keeps the text', () => {
    expect(plainTextPreview('Use `pnpm dashboard` to start.')).toBe('Use pnpm dashboard to start.');
  });

  it('strips bold and italic markers', () => {
    expect(plainTextPreview('**bold** and *italic* and _underline_.')).toBe(
      'bold and italic and underline.',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(plainTextPreview('')).toBe('');
    expect(plainTextPreview('   \n\n   ')).toBe('');
  });
});

describe('renderRoadmap description clamp', () => {
  // Task 4 — three-part description cell: toggle button, plain-text
  // preview span (CSS line-clamp:6), full markdown body div hidden by
  // default. The toggle uses aria-expanded so screen readers announce
  // state changes; aria-controls points at the full-body div's id so
  // assistive tech can find the disclosure target.
  const fixture: RoadmapEntry[] = [
    {
      name: 'Long Entry',
      slug: 'long-entry',
      area: 'tooling',
      body: '# Heading\n\nParagraph **one** with more detail.\n\n- item a\n- item b',
    },
  ];
  const noFilters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renders a toggle button, clamped preview span, and full-body div with linked id', async () => {
    const html = await renderRoadmap(fixture, noFilters);
    expect(html).toMatch(/<button[^>]*class="description-toggle"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/aria-controls="desc-long-entry"/);
    expect(html).toContain('class="description--clamped"');
    expect(html).toMatch(/<div[^>]*id="desc-long-entry"[^>]*class="body description-full"/);
  });

  it('preview span contains the plain-text flattening, not raw markdown', async () => {
    const html = await renderRoadmap(fixture, noFilters);
    // The clamped span carries the flattened heading/paragraph/list text.
    expect(html).toMatch(/class="description--clamped">Heading[\s\S]*?item a, item b/);
    // The full body div renders the markdown to HTML (list <ul>).
    expect(html).toMatch(/class="body description-full"[^>]*>[\s\S]*?<ul>/);
  });
});

// Task 5 helpers — pinned at module scope so oxlint's
// `consistent-function-scoping` rule is happy.
function selectsInFiltersForm(html: string): string[] {
  const form = /<form class="filters" method="get">([\s\S]*?)<\/form>/.exec(html);
  if (!form) return [];
  return form[1].match(/<select[^>]*>/g) ?? [];
}

function filterFormHasSubmitButton(html: string): boolean {
  const form = /<form class="filters" method="get">([\s\S]*?)<\/form>/.exec(html);
  if (!form) return false;
  return /<button[^>]*type="submit"[^>]*>/.test(form[1]);
}

describe('filter forms: apply-on-change consistency (Task 5)', () => {
  // Task 5 — every dashboard filter dropdown applies immediately via
  // onchange="this.form.submit()" so users don't have to hunt for a
  // separate Apply/Filter button. Drop the explicit submit button and
  // wire onchange across every <select> in each filter form for /roadmap,
  // /backlog, /features, /gaps, /docs. Pin via regex so a future refactor
  // can't reintroduce a stray button or unbound dropdown.
  const noBacklogFilters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };
  const noRoadmapFilters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('renderRoadmap: no Apply button + every <select> carries onchange auto-submit', async () => {
    const html = await renderRoadmap(
      [{ name: 'X', slug: 'x', area: 'tooling', body: 'b' }],
      noRoadmapFilters,
    );
    expect(filterFormHasSubmitButton(html)).toBe(false);
    const selects = selectsInFiltersForm(html);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s).toMatch(/onchange="this\.form\.submit\(\)"/);
    }
  });

  it('renderBacklog: no Apply button + every <select> carries onchange auto-submit', async () => {
    const html = await renderBacklog(
      [{ name: 'X', slug: 'x', area: 'tooling', description: 'b' }],
      noBacklogFilters,
    );
    expect(filterFormHasSubmitButton(html)).toBe(false);
    const selects = selectsInFiltersForm(html);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s).toMatch(/onchange="this\.form\.submit\(\)"/);
    }
  });

  it('renderFeatures: no Filter button + every <select> carries onchange auto-submit', () => {
    const html = renderFeatures(
      [
        {
          slug: 'foo',
          frontmatter: {
            name: 'Foo',
            phase: 'in-progress',
            area: 'tooling',
            category: 'Tooling',
            packages: ['scripts'],
            deps: [],
            links: { code: [], docs: [], tests: [] },
            'noldor-tier': 'specs-only',
          },
          bodyMarkdown: '',
        },
      ],
      { phase: '', category: '', area: '', updated: '', sort: '' },
    );
    expect(filterFormHasSubmitButton(html)).toBe(false);
    const selects = selectsInFiltersForm(html);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s).toMatch(/onchange="this\.form\.submit\(\)"/);
    }
  });

  it('renderGaps: no Filter button + every <select> carries onchange auto-submit', () => {
    const html = renderGaps([{ itemId: 'foo', category: 'docs', message: 'm' }], { category: '' });
    expect(filterFormHasSubmitButton(html)).toBe(false);
    const selects = selectsInFiltersForm(html);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s).toMatch(/onchange="this\.form\.submit\(\)"/);
    }
  });
});

describe('renderBacklog description clamp', () => {
  it('renders a toggle button + clamped preview + full-body div on /backlog', async () => {
    const html = await renderBacklog(
      [
        {
          name: 'Backlog Entry',
          slug: 'backlog-entry',
          area: 'web',
          category: 'Tooling',
          description: 'A longer description with **markdown** formatting.',
        },
      ],
      { area: '', type: '', category: '', size: [], impact: [], sort: '' },
    );
    expect(html).toMatch(/<button[^>]*class="description-toggle"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/aria-controls="desc-backlog-entry"/);
    expect(html).toContain('class="description--clamped"');
    expect(html).toMatch(/<div[^>]*id="desc-backlog-entry"[^>]*class="body description-full"/);
  });
});

describe('description-toggle placement', () => {
  const filters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };

  it('roadmap renders the toggle AFTER the description body', async () => {
    const entries = [
      {
        slug: 'x',
        name: 'X',
        area: 'a',
        body: 'long body that should clamp\n\nmore content here so the test exercises both nodes',
        category: 'cat',
        type: 'feat',
        size: 'M',
        impact: 'high',
        since: '2026-05-01',
      },
    ];
    const html = await renderRoadmap(entries, filters, { rawHash: 'h', dragEnabled: true });
    const cellMatch = /<td class="description">([\s\S]*?)<\/td>/.exec(html);
    expect(cellMatch).toBeTruthy();
    const cell = cellMatch![1];
    const togglePos = cell.indexOf('class="description-toggle"');
    const fullBodyPos = cell.indexOf('class="body description-full"');
    expect(togglePos).toBeGreaterThan(fullBodyPos);
  });

  it('backlog renders the toggle AFTER the description body', async () => {
    const entries = [
      {
        slug: 'x',
        name: 'X',
        area: 'a',
        type: 'feat',
        since: '2026-05-01',
        description: 'long description that may clamp\n\nmore content',
        category: 'cat',
        size: 'M',
        impact: 'high',
      },
    ];
    const html = await renderBacklog(entries, filters, { rawHash: 'h' });
    const cellMatch = /<td class="description">([\s\S]*?)<\/td>/.exec(html);
    expect(cellMatch).toBeTruthy();
    const cell = cellMatch![1];
    const togglePos = cell.indexOf('class="description-toggle"');
    const fullBodyPos = cell.indexOf('class="body description-full"');
    expect(togglePos).toBeGreaterThan(fullBodyPos);
  });
});

describe('roadmap/backlog row actions', () => {
  const noFilters = { area: '', type: '', category: '', size: [], impact: [], sort: '' };
  const roadmapEntries: RoadmapEntry[] = [
    { name: 'Alpha', slug: 'alpha', area: 'web', type: 'feat', since: '2026-06-01', body: 'A.' },
  ];
  const backlogEntries: BacklogEntry[] = [
    {
      name: 'Charlie',
      slug: 'charlie',
      area: 'web',
      type: 'feat',
      since: '2026-06-01',
      description: 'C.',
    },
  ];

  it('renames the roadmap action column header to "Actions"', async () => {
    const html = await renderRoadmap(roadmapEntries, noFilters, {
      rawHash: 'abc',
      dragEnabled: false,
    });
    expect(html).toContain('<th class="action-col">Actions</th>');
    expect(html).not.toContain('<th class="action-col">Action</th>');
  });

  it('renames the backlog action column header to "Actions"', async () => {
    const html = await renderBacklog(backlogEntries, noFilters, {
      rawHash: 'abc',
      now: new Date('2026-06-13'),
    });
    expect(html).toContain('<th class="action-col">Actions</th>');
    expect(html).not.toContain('<th class="action-col">Action</th>');
  });

  it('renders a Remove button on each roadmap row (section=roadmap)', async () => {
    const html = await renderRoadmap(roadmapEntries, noFilters, {
      rawHash: 'abc',
      dragEnabled: false,
    });
    expect(html).toContain(
      'class="remove-chip" data-action="remove" data-section="roadmap" data-slug="alpha"',
    );
  });

  it('renders a Remove button on each backlog row (section=backlog)', async () => {
    const html = await renderBacklog(backlogEntries, noFilters, {
      rawHash: 'abc',
      now: new Date('2026-06-13'),
    });
    expect(html).toContain(
      'class="remove-chip" data-action="remove" data-section="backlog" data-slug="charlie"',
    );
  });

  it('renders Top and Bottom move buttons on each roadmap row', async () => {
    const html = await renderRoadmap(roadmapEntries, noFilters, {
      rawHash: 'deadbeef',
      dragEnabled: false,
    });
    expect(html).toContain('class="move-chip" data-action="move-top" data-slug="alpha"');
    expect(html).toContain('class="move-chip" data-action="move-bottom" data-slug="alpha"');
    // Chip order in the actions cell: Top, Bottom, Demote, Remove.
    const cellMatch = /<td class="actions">([\s\S]*?)<\/td>/.exec(html);
    expect(cellMatch).toBeTruthy();
    const cell = cellMatch![1];
    expect(cell.indexOf('data-action="move-top"')).toBeLessThan(
      cell.indexOf('data-action="move-bottom"'),
    );
    expect(cell.indexOf('data-action="move-bottom"')).toBeLessThan(
      cell.indexOf('data-action="demote"'),
    );
    expect(cell.indexOf('data-action="demote"')).toBeLessThan(cell.indexOf('data-action="remove"'));
  });

  it('renders no global add-entry forms (replaced by per-entry Top/Bottom buttons)', async () => {
    const html = await renderRoadmap(roadmapEntries, noFilters, {
      rawHash: 'deadbeef',
      dragEnabled: false,
    });
    expect(html).not.toContain('add-entry');
    const emptyHtml = await renderRoadmap([], noFilters, { rawHash: 'feed', dragEnabled: false });
    expect(emptyHtml).not.toContain('add-entry');
    expect(emptyHtml).not.toContain('<table');
  });
});
