// @tests: drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, parallel-agent-dispatch-for-research-jobs
import { describe, expect, it } from 'vitest';
import { agentsConfigSchema } from '../types';
import { checkRunners, compareDotted, referencedRunners } from '../doctor-runners';

describe('compareDotted', () => {
  it('compares numerically per segment', () => {
    expect(compareDotted('0.10.0', '0.6.0')).toBeGreaterThan(0);
    expect(compareDotted('1.0', '1.0.0')).toBe(0);
    expect(compareDotted('0.5.9', '0.6.0')).toBeLessThan(0);
  });
});

describe('referencedRunners', () => {
  it('collects default + role runners, deduped', () => {
    const cfg = agentsConfigSchema.parse({
      default: 'claude',
      roles: { reviewer: { runner: 'codex' }, polish: { runner: 'codex' } },
    });
    expect(referencedRunners(cfg).toSorted()).toEqual(['claude', 'codex']);
  });
  it('defaults to claude only', () => {
    expect(referencedRunners(agentsConfigSchema.parse({}))).toEqual(['claude']);
  });
  it('includes targets so a floored-but-unroled runner is still checked', () => {
    const cfg = agentsConfigSchema.parse({
      targets: ['claude', 'opencode'],
      versionFloors: { opencode: '0.6.0' },
    });
    expect(referencedRunners(cfg).toSorted()).toEqual(['claude', 'opencode']);
  });
});

describe('checkRunners', () => {
  const cfg = agentsConfigSchema.parse({
    default: 'claude',
    roles: { reviewer: { runner: 'opencode' } },
    versionFloors: { opencode: '0.6.0' },
  });
  it('ok / missing / below-floor', () => {
    const probe = (bin: string) =>
      bin === 'claude' ? '2.1.0' : bin === 'opencode' ? '0.5.0' : null;
    const checks = checkRunners(cfg, probe);
    expect(checks).toEqual([
      { runner: 'claude', status: 'ok', detail: '2.1.0' },
      { runner: 'opencode', status: 'below-floor', detail: '0.5.0 < floor 0.6.0' },
    ]);
  });
  it('missing CLI reported', () => {
    const checks = checkRunners(cfg, () => null);
    expect(checks.every((c) => c.status === 'missing')).toBe(true);
  });
});
