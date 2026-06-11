// @tests: project-tracking-dashboard

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSkill, loadSkills, setDocRootsOverride } from '../data.js';
import { renderSkillPage, renderSkillsIndex } from '../views.js';

// The skills surface reads .claude/skills/<name>/SKILL.md from the doc root.
// Tests run against a temp fixture tree via setDocRootsOverride so they are
// independent of which skills the live repo happens to carry.
describe('skills surface (fixture)', () => {
  let fixtureRoot: string;
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'skillsurf-'));
    const base = join(fixtureRoot, '.claude', 'skills');
    await mkdir(join(base, 'gate'), { recursive: true });
    await mkdir(join(base, 'triage'), { recursive: true });
    await mkdir(join(base, 'no-skill-md'), { recursive: true });
    await writeFile(
      join(base, 'gate', 'SKILL.md'),
      [
        '---',
        'name: gate',
        'description: Single mandatory entry for any code change.',
        '---',
        '',
        '# /gate',
        '',
        'Step prose with a [framework link](../../../docs/noldor/lifecycle.md).',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(base, 'triage', 'SKILL.md'),
      [
        '---',
        'name: triage',
        'description: Bulk-triage raw ideas.',
        '---',
        '',
        '# /triage',
        '',
      ].join('\n'),
    );
    setDocRootsOverride(fixtureRoot);
  });
  afterAll(async () => {
    setDocRootsOverride(undefined);
    await rm(fixtureRoot, { force: true, recursive: true });
  });

  describe('loadSkills', () => {
    it('returns one entry per skill dir carrying a SKILL.md, alphabetical', async () => {
      const skills = await loadSkills();
      expect(skills.map((s) => s.slug)).toEqual(['gate', 'triage']);
    });

    it('skips directories without a SKILL.md', async () => {
      const skills = await loadSkills();
      expect(skills.map((s) => s.slug)).not.toContain('no-skill-md');
    });

    it('exposes frontmatter name and description', async () => {
      const skills = await loadSkills();
      const gate = skills.find((s) => s.slug === 'gate');
      expect(gate?.name).toBe('gate');
      expect(gate?.description).toBe('Single mandatory entry for any code change.');
    });
  });

  describe('renderSkillsIndex', () => {
    it('renders one row per skill with trigger link to /skills/<slug>', async () => {
      const html = renderSkillsIndex(await loadSkills());
      expect(html).toContain('<h1>Skills</h1>');
      expect(html).toContain('href="/skills/gate"');
      expect(html).toContain('/gate');
      expect(html).toContain('Single mandatory entry for any code change.');
    });

    it('cross-links the skill-catalog framework page', async () => {
      const html = renderSkillsIndex(await loadSkills());
      expect(html).toContain('href="/framework/skill-catalog"');
    });
  });

  describe('loadSkill', () => {
    it('returns null for an unknown slug', async () => {
      expect(await loadSkill('definitely-not-a-skill')).toBeNull();
    });

    it('returns rendered HTML body for a real skill', async () => {
      const skill = await loadSkill('gate');
      expect(skill).not.toBeNull();
      expect(skill!.bodyHtml).toContain('<h1');
    });

    it('rewrites relative framework links to /framework routes', async () => {
      const skill = await loadSkill('gate');
      expect(skill!.bodyHtml).toContain('href="/framework/lifecycle"');
    });
  });

  describe('renderSkillPage', () => {
    it('wraps body in .body, shows back link and catalog cross-link', async () => {
      const skill = await loadSkill('gate');
      const html = renderSkillPage(skill!);
      expect(html).toContain('class="body"');
      expect(html).toContain('href="/skills"');
      expect(html).toContain('href="/framework/skill-catalog"');
      expect(html).toContain('<code>.claude/skills/gate/SKILL.md</code>');
    });
  });
});

describe('skills surface (live repo)', () => {
  it('loads the project-local skills including gate', async () => {
    const skills = await loadSkills();
    expect(skills.length).toBeGreaterThanOrEqual(8);
    expect(skills.map((s) => s.slug)).toContain('gate');
  });
});

describe('dashboard nav and overview wiring', () => {
  it('renders the Skills nav link', async () => {
    const { renderLayout } = await import('../layout.js');
    expect(renderLayout({ title: 't', body: '', activeNav: null })).toContain('href="/skills"');
  });

  it('links the overview skills counter to /skills', async () => {
    const { renderOverview } = await import('../views.js');
    const kpis = {
      project: {
        features: { total: 0, byPhase: { done: 0, 'in-progress': 0 }, byCategory: {}, byArea: {} },
        roadmap: { total: 0 },
        backlog: 0,
        skills: 9,
        scripts: 0,
        gaps: 0,
      },
      activity: {
        commits7d: 0,
        commits30d: 0,
        commits90d: 0,
        lastReleaseDaysAgo: null,
        activeBranches: 0,
      },
      health: { staleWip: 0, dirtyWorktrees: 0, behindWorktrees: 0, warnings: 0 },
    };
    const html = renderOverview(kpis, [], [], { frontmatter: {}, bodyHtml: '' } as never, null);
    expect(html).toContain('<a class="counter-link" href="/skills">');
  });
});
