// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { filterTemplatesByAgents } from '../agent-filter';

const FILES = [
  '.claude/skills/gate/SKILL.md',
  '.claude/noldor.md',
  '.opencode/command/gate.md',
  'opencode.json',
  'AGENTS.md',
  'docs/noldor/workflow.md',
  'lefthook/noldor.yml',
];

describe('filterTemplatesByAgents', () => {
  it('claude-only drops opencode + AGENTS.md subtrees', () => {
    expect(filterTemplatesByAgents(FILES, ['claude'])).toEqual([
      '.claude/skills/gate/SKILL.md',
      '.claude/noldor.md',
      'docs/noldor/workflow.md',
      'lefthook/noldor.yml',
    ]);
  });
  it('codex adds AGENTS.md but not .opencode', () => {
    expect(filterTemplatesByAgents(FILES, ['claude', 'codex'])).toContain('AGENTS.md');
    expect(filterTemplatesByAgents(FILES, ['claude', 'codex'])).not.toContain('opencode.json');
  });
  it('opencode adds its subtree and AGENTS.md; dropping claude drops .claude', () => {
    const out = filterTemplatesByAgents(FILES, ['opencode']);
    expect(out).toEqual([
      '.opencode/command/gate.md',
      'opencode.json',
      'AGENTS.md',
      'docs/noldor/workflow.md',
      'lefthook/noldor.yml',
    ]);
  });
});
