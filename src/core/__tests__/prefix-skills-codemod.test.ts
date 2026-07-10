import { describe, it, expect } from 'vitest';
import { prefixSkills } from '../prefix-skills-codemod.js';

describe('prefixSkills', () => {
  it('rewrites slash invocations with args and at line start', () => {
    expect(prefixSkills('run /gate --drain foo')).toBe('run /noldor-gate --drain foo');
    expect(prefixSkills('/promote <slug>')).toBe('/noldor-promote <slug>');
    expect(prefixSkills('# /gate')).toBe('# /noldor-gate');
    expect(prefixSkills('## /release-sweep')).toBe('## /noldor-release-sweep');
  });

  it('rewrites SKILL.md frontmatter name and dir paths', () => {
    expect(prefixSkills('name: gate\n')).toBe('name: noldor-gate\n');
    expect(prefixSkills('.claude/skills/refactor/SKILL.md')).toBe(
      '.claude/skills/noldor-refactor/SKILL.md',
    );
  });

  it('rewrites backtick skill-context only', () => {
    expect(prefixSkills('the `garden` skill')).toBe('the `noldor-garden` skill');
    expect(prefixSkills('Skill tool, name `promote`')).toBe('Skill tool, name `noldor-promote`');
  });

  it('does NOT touch homonyms', () => {
    expect(prefixSkills("kind: 'gate'")).toBe("kind: 'gate'");
    expect(prefixSkills('- type: refactor')).toBe('- type: refactor');
    expect(prefixSkills("from '../garden/garden-detect.js'")).toBe(
      "from '../garden/garden-detect.js'",
    );
    expect(prefixSkills("import x from './gate.js'")).toBe("import x from './gate.js'");
    expect(prefixSkills('the `/milestones` page')).toBe('the `/milestones` page');
    expect(prefixSkills('docs/milestones/<slug>.md')).toBe('docs/milestones/<slug>.md');
    expect(prefixSkills('/api/roadmap/promote-from-backlog/')).toBe(
      '/api/roadmap/promote-from-backlog/',
    );
    expect(prefixSkills('/milestone-ish')).toBe('/milestone-ish');
    expect(prefixSkills('features/gate-flow-rework.md')).toBe('features/gate-flow-rework.md');
  });

  it('protects FD slugs that embed a renamed word', () => {
    expect(prefixSkills('portable-gate-entrypoint-for-non-claude-runners')).toBe(
      'portable-gate-entrypoint-for-non-claude-runners',
    );
    expect(prefixSkills('slug: prefix-skills-with-noldor')).toBe('slug: prefix-skills-with-noldor');
  });

  it('is idempotent', () => {
    const once = prefixSkills('/gate\nname: gate\n.claude/skills/gate/');
    expect(prefixSkills(once)).toBe(once);
  });
});
