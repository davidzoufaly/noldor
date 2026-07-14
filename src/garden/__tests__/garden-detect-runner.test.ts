// @tests: framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics
import { describe, it, expect, vi } from 'vitest';
import { runGardenDetectViaCli } from '../garden-detect-runner';

// Helper: simulate CLI stdout that may carry banner/log lines before the JSON.
function pnpmStdout(json: object): string {
  return [
    '> noldor garden detect --json',
    '> tsx src/garden/garden-detect.ts "--json"',
    '',
    JSON.stringify(json),
  ].join('\n');
}

function emptyGarden(extra: Record<string, unknown> = {}): object {
  return {
    stalePlans: [],
    staleSpecs: [],
    unusedBacklog: [],
    contradictions: [],
    sourceDrift: [],
    sddGaps: [],
    invariantViolations: [],
    overrideAudit: { severity: 'OK', count: 0, overrides: [] },
    codexCrOverrideAudit: [],
    tierMismatch: [],
    allowlistDrift: [],
    trailerScopeMismatch: [],
    planWithoutFd: [],
    fdWithoutPlan: [],
    ...extra,
  };
}

describe('runGardenDetectViaCli', () => {
  it('returns exitCode 0 + empty findings on clean detect (real pnpm-wrapped shape)', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: pnpmStdout(emptyGarden()),
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.exitCode).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it('flattens categorical findings into tagged array', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: pnpmStdout(
        emptyGarden({
          stalePlans: [{ path: 'docs/design/plans/x.md', slug: 'x', reason: 'feature-done' }],
          sddGaps: [{ category: 'docs', itemId: 'foo', message: 'bar' }],
        }),
      ),
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.exitCode).toBe(0);
    expect(r.findings).toHaveLength(2);
    expect(r.findings.find((f) => f.kind === 'stalePlans')).toMatchObject({
      kind: 'stalePlans',
      slug: 'x',
    });
    expect(r.findings.find((f) => f.kind === 'sddGaps')).toMatchObject({
      kind: 'sddGaps',
      itemId: 'foo',
    });
  });

  it('surfaces overrideAudit.severity=WARN as a synthetic finding', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: pnpmStdout(
        emptyGarden({ overrideAudit: { severity: 'WARN', count: 12, overrides: [] } }),
      ),
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.findings).toEqual([{ kind: 'overrideAudit', severity: 'WARN' }]);
  });

  it('does NOT surface overrideAudit when severity is OK', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: pnpmStdout(
        emptyGarden({ overrideAudit: { severity: 'OK', count: 0, overrides: [] } }),
      ),
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.findings.find((f) => f.kind === 'overrideAudit')).toBeUndefined();
  });

  it('returns non-zero exitCode on subprocess failure', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 2,
      stdout: '',
      stderr: 'garden-detect: usage error',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.exitCode).toBe(2);
    expect(r.findings).toEqual([]);
  });

  it('returns non-zero exitCode when stdout has no JSON line (banner only)', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: '> noldor garden detect --json\n> tsx src/garden/garden-detect.ts "--json"\n',
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.exitCode).not.toBe(0);
    expect(r.findings).toEqual([]);
  });

  it('returns non-zero exitCode when stdout JSON line is malformed', async () => {
    const spawnMock = vi.fn().mockReturnValue({
      status: 0,
      stdout: '> noldor garden detect --json\n{ broken json\n',
      stderr: '',
    });
    const r = await runGardenDetectViaCli({ cwd: '/tmp/repo', spawnSync: spawnMock as never });
    expect(r.exitCode).not.toBe(0);
    expect(r.findings).toEqual([]);
  });
});
