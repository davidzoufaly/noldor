// @tests: acceptance-verify-lane, continuous-drain-daemon-and-escalation-inbox, specs-cr-gate-multi-reviewer
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autonomousConfigSchema,
  loadConfig,
  loadConfigSync,
  noldorConfigSchema,
  resolveSessionTtlHours,
  DEFAULT_SESSION_TTL_HOURS,
} from '../config.js';

describe('agents block', () => {
  it('parses an agents block and leaves it optional', () => {
    const parsed = noldorConfigSchema.parse({
      agents: { default: 'claude', roles: { reviewer: { runner: 'codex' } } },
    });
    expect(parsed.agents?.roles.reviewer?.runner).toBe('codex');
    expect(noldorConfigSchema.parse({}).agents).toBeUndefined();
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cfg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns null when file is absent', async () => {
    expect(await loadConfig(join(dir, 'absent.json'))).toBeNull();
  });
  it('parses a valid config', async () => {
    const path = join(dir, 'config.json');
    await writeFile(
      path,
      JSON.stringify({
        crLanes: { spec: ['subagent'], plan: ['subagent', 'manual'], code: ['subagent'] },
        autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
      }),
      'utf8',
    );
    const cfg = await loadConfig(path);
    expect(cfg?.crLanes?.spec).toEqual(['subagent']);
    expect(cfg?.autonomous?.onFailure).toBe('prompt');
  });
  it('applies defaults to autonomous when partially set', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ autonomous: {} }), 'utf8');
    const cfg = await loadConfig(path);
    expect(cfg?.autonomous?.skipLanePicker).toBe(false);
    expect(cfg?.autonomous?.onFailure).toBe('prompt');
  });
  it('rejects invalid lane in crLanes', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ crLanes: { spec: ['bogus'] } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
  it('rejects empty crLanes array', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ crLanes: { spec: [] } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
  it('parses the optional gate.sessionTtlHours block', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 6 } }), 'utf8');
    const cfg = await loadConfig(path);
    expect(cfg?.gate?.sessionTtlHours).toBe(6);
  });
  it('rejects a non-positive gate.sessionTtlHours', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 0 } }), 'utf8');
    await expect(loadConfig(path)).rejects.toThrow();
  });
});

describe('loadConfigSync', () => {
  it('returns null when file is absent', () => {
    expect(loadConfigSync(join(dir, 'absent.json'))).toBeNull();
  });
  it('parses a valid config synchronously', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: 12 } }), 'utf8');
    expect(loadConfigSync(path)?.gate?.sessionTtlHours).toBe(12);
  });
  it('throws on a malformed config (strict, mirrors loadConfig)', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ gate: { sessionTtlHours: -1 } }), 'utf8');
    expect(() => loadConfigSync(path)).toThrow();
  });
});

describe('resolveSessionTtlHours', () => {
  it('returns the configured value when gate.sessionTtlHours is set', () => {
    expect(resolveSessionTtlHours({ gate: { sessionTtlHours: 6 } })).toBe(6);
  });
  it('falls back to the default when the gate block is absent', () => {
    expect(resolveSessionTtlHours({})).toBe(DEFAULT_SESSION_TTL_HOURS);
  });
  it('falls back to the default when config is null', () => {
    expect(resolveSessionTtlHours(null)).toBe(DEFAULT_SESSION_TTL_HOURS);
  });
  it('DEFAULT_SESSION_TTL_HOURS is 24', () => {
    expect(DEFAULT_SESSION_TTL_HOURS).toBe(24);
  });
});

describe('autonomous.watch rails schema', () => {
  it('defaults interval/caps and accepts notifyCommand', () => {
    const parsed = autonomousConfigSchema.parse({ watch: {} });
    expect(parsed.watch).toEqual({
      intervalMinutes: 30,
      maxFeaturesPerDay: 10,
      maxConsecutiveFailures: 3,
    });
    const withCmd = autonomousConfigSchema.parse({ watch: { notifyCommand: 'true' } });
    expect(withCmd.watch?.notifyCommand).toBe('true');
  });

  it('keeps watch optional and rejects non-positive rails', () => {
    expect(autonomousConfigSchema.parse({}).watch).toBeUndefined();
    expect(() => autonomousConfigSchema.parse({ watch: { intervalMinutes: 0 } })).toThrow();
  });
});

describe('verifyMode', () => {
  it('defaults to advisory', () => {
    expect(autonomousConfigSchema.parse({}).verifyMode).toBe('advisory');
  });

  it('accepts blocking', () => {
    expect(autonomousConfigSchema.parse({ verifyMode: 'blocking' }).verifyMode).toBe('blocking');
  });
});

import { resolveReviewProfile } from '../config.js';

describe('resolveReviewProfile', () => {
  it('returns the built-in default when config is null', () => {
    expect(resolveReviewProfile(null)).toEqual({
      effort: 'med',
      dimensions: ['correctness', 'security', 'reuse', 'simplification', 'efficiency', 'altitude'],
    });
  });

  it('returns the built-in fast-track profile by name', () => {
    expect(resolveReviewProfile(null, 'fast-track')).toEqual({
      effort: 'low',
      dimensions: ['correctness', 'security'],
    });
  });

  it('falls back to default for an unknown name', () => {
    expect(resolveReviewProfile(null, 'bogus').effort).toBe('med');
  });

  it('lets config override a built-in profile name', () => {
    const cfg = {
      crReview: { profiles: { 'fast-track': { effort: 'high', dimensions: ['correctness'] } } },
    } as const;
    expect(resolveReviewProfile(cfg, 'fast-track')).toEqual({
      effort: 'high',
      dimensions: ['correctness'],
    });
  });
});

describe('release.crGateExemptCommits block', () => {
  it('parses a valid exemption list', () => {
    const parsed = noldorConfigSchema.parse({
      release: {
        crGateExemptCommits: [
          {
            sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
            reason: 'pre-rollout-marker CI chore (#117)',
          },
        ],
      },
    });
    expect(parsed.release?.crGateExemptCommits).toHaveLength(1);
    expect(parsed.release?.crGateExemptCommits[0]?.sha).toBe(
      '19a74a10e8e844e021b08fe616992eae1b56f977',
    );
  });

  it('keeps release optional and defaults crGateExemptCommits to []', () => {
    expect(noldorConfigSchema.parse({}).release).toBeUndefined();
    expect(noldorConfigSchema.parse({ release: {} }).release?.crGateExemptCommits).toEqual([]);
  });

  it('rejects a SHA prefix shorter than 7 hex chars', () => {
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: '19a74a', reason: 'too short' }] },
      }),
    ).toThrow();
  });

  it('rejects a non-hex SHA and an empty reason', () => {
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: 'ZZZZZZZZ', reason: 'x' }] },
      }),
    ).toThrow();
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: '19a74a10e8', reason: '' }] },
      }),
    ).toThrow();
  });

  it('strips unknown keys (zod non-strict) so config-schema growth stays compatible', () => {
    const parsed = noldorConfigSchema.parse({
      release: { crGateExemptCommits: [], futureKnob: true },
      unknownTopLevel: 1,
    } as Record<string, unknown>);
    expect(parsed.release?.crGateExemptCommits).toEqual([]);
    expect('futureKnob' in (parsed.release ?? {})).toBe(false);
  });
});

describe('release.publish block', () => {
  it('defaults enabled=false, npmjs registry, latest dist-tag, provenance off', () => {
    const parsed = noldorConfigSchema.parse({ release: { publish: {} } });
    expect(parsed.release?.publish).toEqual({
      enabled: false,
      registry: 'https://registry.npmjs.org',
      distTag: 'latest',
      provenance: false,
    });
  });

  it('stays absent when not configured (no synthesized block)', () => {
    expect(noldorConfigSchema.parse({ release: {} }).release?.publish).toBeUndefined();
  });

  it('parses an opt-in block and fills the other defaults', () => {
    const parsed = noldorConfigSchema.parse({ release: { publish: { enabled: true } } });
    expect(parsed.release?.publish?.enabled).toBe(true);
    expect(parsed.release?.publish?.registry).toBe('https://registry.npmjs.org');
    expect(parsed.release?.publish?.distTag).toBe('latest');
    expect(parsed.release?.publish?.provenance).toBe(false);
  });

  it('parses the provenance opt-in (public-repo-only attestation knob)', () => {
    const parsed = noldorConfigSchema.parse({
      release: { publish: { enabled: true, provenance: true } },
    });
    expect(parsed.release?.publish?.provenance).toBe(true);
  });

  it('rejects a non-URL registry', () => {
    expect(() =>
      noldorConfigSchema.parse({ release: { publish: { registry: 'not-a-url' } } }),
    ).toThrow();
  });
});

describe('garden.overrideAudit block', () => {
  it('parses expected rules and an optional threshold', () => {
    const parsed = noldorConfigSchema.parse({
      garden: {
        overrideAudit: {
          threshold: 5,
          expected: [
            {
              reasonIncludes: 'cr-red override acceptance-verify-lane',
              note: 'operator-accepted residual risk, 2026-06',
            },
            { shaPrefix: 'ec7bf0b7c52', note: 'same acknowledgment, keyed by SHA' },
          ],
        },
      },
    });
    expect(parsed.garden?.overrideAudit?.threshold).toBe(5);
    expect(parsed.garden?.overrideAudit?.expected).toHaveLength(2);
  });

  it('keeps garden optional and defaults expected to []', () => {
    expect(noldorConfigSchema.parse({}).garden).toBeUndefined();
    expect(
      noldorConfigSchema.parse({ garden: { overrideAudit: {} } }).garden?.overrideAudit?.expected,
    ).toEqual([]);
  });

  it('rejects a rule with neither shaPrefix nor reasonIncludes', () => {
    expect(() =>
      noldorConfigSchema.parse({
        garden: { overrideAudit: { expected: [{ note: 'matches nothing' }] } },
      }),
    ).toThrow();
  });

  it('rejects a non-positive threshold and a rule without a note', () => {
    expect(() =>
      noldorConfigSchema.parse({ garden: { overrideAudit: { threshold: 0 } } }),
    ).toThrow();
    expect(() =>
      noldorConfigSchema.parse({
        garden: { overrideAudit: { expected: [{ reasonIncludes: 'x' }] } },
      }),
    ).toThrow();
  });
});
