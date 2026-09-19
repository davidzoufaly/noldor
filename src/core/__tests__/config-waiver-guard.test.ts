// @tests: noldor, gate-flow-rework
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSUMER_CONFIG_PATH,
  RETROACTIVE_WAIVER_KEYS,
  retroactiveWaiverRefusal,
  retroactiveWaiversTouched,
} from '../config-waiver-guard.js';

const EXEMPT = { sha: 'abc1234', reason: 'historical squash, reviewed out of band' };

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ consumer: { name: 'x' }, ...overrides });
}

describe('retroactiveWaiversTouched — the keys it must report', () => {
  it('reports an appended CR-gate exemption', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [] } }),
        config({ release: { crGateExemptCommits: [EXEMPT] } }),
      ),
    ).toEqual(['release.crGateExemptCommits']);
  });

  it('reports an appended gate-compliance exemption', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: {} }),
        config({ release: { gateComplianceExemptCommits: [EXEMPT] } }),
      ),
    ).toEqual(['release.gateComplianceExemptCommits']);
  });

  // Not an append but a floor: moving it forward retires every finding below it.
  it('reports a moved gate-compliance since-floor', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { gateComplianceSince: 'aaaaaaa' } }),
        config({ release: { gateComplianceSince: 'bbbbbbb' } }),
      ),
    ).toEqual(['release.gateComplianceSince']);
  });

  // The count knob silences the same audit wholesale that `expected` silences
  // one SHA at a time, so it belongs on the list with it.
  it('reports a raised override-audit threshold', () => {
    expect(
      retroactiveWaiversTouched(
        config({ garden: { overrideAudit: { threshold: 5 } } }),
        config({ garden: { overrideAudit: { threshold: 999 } } }),
      ),
    ).toEqual(['garden.overrideAudit.threshold']);
  });

  it('reports an appended override-audit expectation', () => {
    expect(
      retroactiveWaiversTouched(
        config({ garden: { overrideAudit: { expected: [] } } }),
        config({
          garden: { overrideAudit: { expected: [{ note: 'expected', shaPrefix: 'abc1234' }] } },
        }),
      ),
    ).toEqual(['garden.overrideAudit.expected']);
  });

  it('reports a removed waiver, not only an added one', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [EXEMPT] } }),
        config({ release: {} }),
      ),
    ).toEqual(['release.crGateExemptCommits']);
  });

  // A re-order decides which exemption matches a SHA first, so it is a change.
  it('reports a reordered exemption list', () => {
    const second = { sha: 'def5678', reason: 'second entry, twenty chars plus' };
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [EXEMPT, second] } }),
        config({ release: { crGateExemptCommits: [second, EXEMPT] } }),
      ),
    ).toEqual(['release.crGateExemptCommits']);
  });

  it('reports every key at once when both blocks move', () => {
    expect(
      retroactiveWaiversTouched(
        config(),
        config({
          release: {
            crGateExemptCommits: [EXEMPT],
            gateComplianceExemptCommits: [EXEMPT],
            gateComplianceSince: 'aaaaaaa',
          },
          garden: {
            overrideAudit: { expected: [{ note: 'n', shaPrefix: 'abc1234' }], threshold: 999 },
          },
        }),
      ),
    ).toEqual([...RETROACTIVE_WAIVER_KEYS]);
  });

  // Fail-closed: unparseable text cannot be shown to leave the lists alone, so
  // committing invalid JSON must not be a way around the guard.
  it('reports every key when either side is not JSON', () => {
    expect(retroactiveWaiversTouched(config(), '{ not json')).toEqual([...RETROACTIVE_WAIVER_KEYS]);
    expect(retroactiveWaiversTouched('{ not json', config())).toEqual([...RETROACTIVE_WAIVER_KEYS]);
  });
});

describe('retroactiveWaiversTouched — the edits it must stay quiet on', () => {
  it('stays quiet on the uiCapture declaration the gate remedy asks for', () => {
    expect(
      retroactiveWaiversTouched(
        config({ consumer: { name: 'x', uiPaths: ['src/**'] } }),
        config({
          consumer: { name: 'x', uiPaths: ['src/**'], uiCapture: { app: { command: 'pnpm cap' } } },
        }),
      ),
    ).toEqual([]);
  });

  it('stays quiet on forward-looking knobs in the same blocks', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [EXEMPT] }, clones: { thresholdPct: 8 } }),
        config({ release: { crGateExemptCommits: [EXEMPT] }, clones: { thresholdPct: 9 } }),
      ),
    ).toEqual([]);
  });

  it('stays quiet when a crLanes block changes beside an untouched waiver list', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [EXEMPT] }, crLanes: { code: ['reviewer'] } }),
        config({
          release: { crGateExemptCommits: [EXEMPT] },
          crLanes: { code: ['reviewer', 'codex'] },
        }),
      ),
    ).toEqual([]);
  });

  // First-adoption commit: no file on the HEAD side, and a scaffold that
  // declares no waivers is not an edit to one.
  it('stays quiet when the file is newly added without waivers', () => {
    expect(
      retroactiveWaiversTouched(null, config({ release: { publish: { enabled: true } } })),
    ).toEqual([]);
  });

  // The list keys are `z.array(...).default([])`, so an absent list and an
  // empty one are the same config — hand-writing `[]` into a scaffold moves
  // nothing and must not be refused for a key the commit did not touch.
  it('stays quiet when an absent waiver list is written out as empty', () => {
    expect(
      retroactiveWaiversTouched(null, config({ release: { crGateExemptCommits: [] } })),
    ).toEqual([]);
    expect(
      retroactiveWaiversTouched(config(), config({ release: { crGateExemptCommits: [] } })),
    ).toEqual([]);
    expect(
      retroactiveWaiversTouched(
        config({ garden: { overrideAudit: {} } }),
        config({ garden: { overrideAudit: { expected: [] } } }),
      ),
    ).toEqual([]);
  });

  // The collapse must not swallow a real removal: emptying a populated list
  // retires nothing but changes which SHAs the gate waves through.
  it('still reports a populated list emptied out', () => {
    expect(
      retroactiveWaiversTouched(
        config({ release: { crGateExemptCommits: [EXEMPT] } }),
        config({ release: { crGateExemptCommits: [] } }),
      ),
    ).toEqual(['release.crGateExemptCommits']);
  });

  it('reports the key when a newly added file arrives carrying a waiver', () => {
    expect(
      retroactiveWaiversTouched(null, config({ release: { crGateExemptCommits: [EXEMPT] } })),
    ).toEqual(['release.crGateExemptCommits']);
  });

  it('stays quiet on an unchanged file', () => {
    const same = config({ release: { crGateExemptCommits: [EXEMPT] } });
    expect(retroactiveWaiversTouched(same, same)).toEqual([]);
  });
});

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nwg-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  return dir;
}

function commitConfig(dir: string, text: string): void {
  writeFileSync(join(dir, CONSUMER_CONFIG_PATH), text);
  execFileSync('git', ['add', CONSUMER_CONFIG_PATH], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'seed'], { cwd: dir });
}

function stageConfig(dir: string, text: string): void {
  writeFileSync(join(dir, CONSUMER_CONFIG_PATH), text);
  execFileSync('git', ['add', CONSUMER_CONFIG_PATH], { cwd: dir });
}

describe('retroactiveWaiverRefusal', () => {
  it('returns null when the config is not staged at all', () => {
    const dir = setupRepo();
    commitConfig(dir, config({ release: { crGateExemptCommits: [EXEMPT] } }));
    expect(retroactiveWaiverRefusal(dir, ['docs/foo.md'])).toBeNull();
  });

  it('returns null for a staged config that leaves the waivers alone', () => {
    const dir = setupRepo();
    commitConfig(dir, config({ release: { crGateExemptCommits: [EXEMPT] } }));
    stageConfig(
      dir,
      config({ release: { crGateExemptCommits: [EXEMPT] }, clones: { minLines: 6 } }),
    );
    expect(retroactiveWaiverRefusal(dir, [CONSUMER_CONFIG_PATH])).toBeNull();
  });

  it('names the moved key in the refusal', () => {
    const dir = setupRepo();
    commitConfig(dir, config({ release: { crGateExemptCommits: [] } }));
    stageConfig(dir, config({ release: { crGateExemptCommits: [EXEMPT] } }));
    const reason = retroactiveWaiverRefusal(dir, [CONSUMER_CONFIG_PATH]);
    expect(reason).toContain('release.crGateExemptCommits');
    expect(reason).toContain('fast-track');
  });

  // The commit is made of the index, so a worktree edit the operator has not
  // staged must not decide the verdict in either direction.
  it('reads the index, not the worktree', () => {
    const dir = setupRepo();
    commitConfig(dir, config({ release: { crGateExemptCommits: [] } }));
    stageConfig(dir, config({ release: { crGateExemptCommits: [] }, clones: { minLines: 6 } }));
    // Unstaged waiver edit sitting in the worktree on top of a clean index.
    writeFileSync(
      join(dir, CONSUMER_CONFIG_PATH),
      config({ release: { crGateExemptCommits: [EXEMPT] } }),
    );
    expect(retroactiveWaiverRefusal(dir, [CONSUMER_CONFIG_PATH])).toBeNull();
  });

  it('names the key on a first-adoption commit that arrives carrying a waiver', () => {
    const dir = setupRepo();
    execFileSync('git', ['commit', '-q', '--no-verify', '--allow-empty', '-m', 'root'], {
      cwd: dir,
    });
    stageConfig(dir, config({ release: { crGateExemptCommits: [EXEMPT] } }));
    expect(retroactiveWaiverRefusal(dir, [CONSUMER_CONFIG_PATH])).toContain(
      'release.crGateExemptCommits',
    );
  });
});
