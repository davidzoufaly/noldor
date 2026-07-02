// @tests: drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-agent-dispatch-for-research-jobs
import { describe, expect, it } from 'vitest';
import { agentsConfigSchema } from '../types';

describe('agentsConfigSchema', () => {
  it('fills defaults on empty object', () => {
    const cfg = agentsConfigSchema.parse({});
    expect(cfg.default).toBe('claude');
    expect(cfg.roles).toEqual({});
    expect(cfg.versionFloors).toEqual({});
    expect(cfg.targets).toEqual(['claude']);
  });

  it('parses a full block', () => {
    const cfg = agentsConfigSchema.parse({
      default: 'claude',
      roles: {
        reviewer: { runner: 'codex' },
        polish: { runner: 'opencode', model: 'ollama/llama3.2' },
      },
      versionFloors: { opencode: '0.6.0' },
      targets: ['claude', 'codex', 'opencode'],
    });
    expect(cfg.roles.polish?.model).toBe('ollama/llama3.2');
  });

  it('rejects unknown runners and unknown keys', () => {
    expect(() => agentsConfigSchema.parse({ default: 'gemini' })).toThrow();
    expect(() => agentsConfigSchema.parse({ rolez: {} })).toThrow();
    expect(() =>
      agentsConfigSchema.parse({ roles: { reviewer: { runner: 'codex', extra: 1 } } }),
    ).toThrow();
  });
});
