import { describe, expect, it } from 'vitest';
import { runAgentRulesGuard } from '../agent-rules-guard';

function hookInput(toolName: string, toolInput: unknown): string {
  return JSON.stringify({ tool_name: toolName, tool_input: toolInput });
}

describe('agent rules guard', () => {
  it('passes when tool_name is not Agent', () => {
    const stdin = hookInput('Bash', { command: 'ls' });
    expect(runAgentRulesGuard({ stdin }).ok).toBe(true);
  });

  it('passes when Agent prompt references engineering-principles.md', () => {
    const stdin = hookInput('Agent', {
      description: 'do thing',
      prompt:
        'Implement X. Follow engineering principles in docs/noldor/engineering-principles.md and project overlays in .claude/engineering-rules.md.',
    });
    expect(runAgentRulesGuard({ stdin }).ok).toBe(true);
  });

  it('blocks Agent prompt missing the engineering-principles reference', () => {
    const stdin = hookInput('Agent', {
      description: 'do thing',
      prompt: 'Implement X without referencing the rules file.',
    });
    const r = runAgentRulesGuard({ stdin });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/engineering-principles\.md/);
    expect(r.reason).toMatch(/Subagent guidance/);
  });

  it('passes when stdin is malformed JSON (does not block on infra)', () => {
    expect(runAgentRulesGuard({ stdin: 'not json at all' }).ok).toBe(true);
  });

  it('passes when tool_input lacks a prompt field (other validators will surface it)', () => {
    const stdin = hookInput('Agent', { description: 'no prompt' });
    expect(runAgentRulesGuard({ stdin }).ok).toBe(true);
  });

  it('blocks Agent prompt that only mentions engineering-rules.md without principles file', () => {
    const stdin = hookInput('Agent', {
      description: 'partial',
      prompt: 'Follow the overlays in .claude/engineering-rules.md.',
    });
    expect(runAgentRulesGuard({ stdin }).ok).toBe(false);
  });
});
