// @tests: make-noldor-agent-agnostic, scaffold-one-agent-rules-file-not-two
import { describe, expect, it } from 'vitest';
import { filterTemplatesByAgents } from '../agent-filter.js';

const FILES = [
  '.claude/skills/gate/SKILL.md',
  '.claude/engineering-rules.md',
  '.opencode/command/gate.md',
  'opencode.json',
  'AGENTS.md',
  'docs/noldor/workflow.md',
  'lefthook/noldor.yml',
];

describe('filterTemplatesByAgents', () => {
  it('claude-only keeps AGENTS.md and drops the opencode subtree', () => {
    expect(filterTemplatesByAgents(FILES, ['claude'])).toEqual([
      '.claude/skills/gate/SKILL.md',
      '.claude/engineering-rules.md',
      'AGENTS.md',
      'docs/noldor/workflow.md',
      'lefthook/noldor.yml',
    ]);
  });
  it('codex-only keeps AGENTS.md and the driver-neutral files, without .claude or .opencode', () => {
    const out = filterTemplatesByAgents(FILES, ['codex']);
    expect(out).toEqual(['AGENTS.md', 'docs/noldor/workflow.md', 'lefthook/noldor.yml']);
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
  it('every target set receives AGENTS.md, including the stub runner', () => {
    for (const targets of [['claude'], ['codex'], ['opencode'], ['stub']] as const) {
      expect(filterTemplatesByAgents(FILES, [...targets])).toContain('AGENTS.md');
    }
  });
});
