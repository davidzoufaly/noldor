// @tests: specs-cr-gate-multi-reviewer
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fingerprintBlockers, ledgerDir, ledgerPath, quarantinePath } from '../autofix-ledger.js';
import type { Finding, Lane } from '../findings-schema.js';

const BIN = resolve(import.meta.dirname, '../../../bin/noldor.mjs');
const SESSION = '2026-08-07T18:00:00.000Z';

let cwd: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke through the real `noldor` router, so these cases also cover the
 * manifest registration and the router's argv reshaping (the verb must land at
 * `argv[2]` for the entrypoint to see it).
 */
function run(...args: string[]): Run {
  try {
    const stdout = execFileSync('node', [BIN, 'cr', 'autofix', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Parse a `key: value` line out of the CLI's stdout contract. */
function field(stdout: string, key: string): string | undefined {
  return stdout.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
}

/** `inFlight` omits `finishedAt`, which is what `aggregate` reads as unresolved. */
function writeSink(
  lane: Lane,
  kind: string,
  blockers: Finding[],
  opts: { inFlight?: boolean } = {},
): void {
  writeFileSync(
    join(cwd, '.noldor', 'cr', `slug-${kind}-${lane}.json`),
    JSON.stringify({
      lane,
      artifact: 'a.md',
      kind,
      slug: 'slug',
      blockers,
      suggestions: [],
      summary: blockers.length ? 'blockers found' : 'approve',
      startedAt: SESSION,
      ...(opts.inFlight ? {} : { finishedAt: SESSION }),
    }),
    'utf8',
  );
}

/**
 * Write the ledger entries `cr orchestrate` would have appended before the seam
 * runs. `record` annotates an existing round rather than appending one, so a
 * `record` with no seeded dispatch is an error, not a first round.
 */
function seedRounds(
  rounds: Array<{ headSha: string; verdict?: 'green' | 'red'; fingerprint?: string }>,
  session: string = SESSION,
): void {
  mkdirSync(ledgerDir(cwd), { recursive: true });
  writeFileSync(
    ledgerPath(cwd, 'slug' as never, 'spec'),
    JSON.stringify({
      slug: 'slug',
      kind: 'spec',
      sessionStartedAt: session,
      rounds: rounds.map((r, i) => ({
        round: i + 1,
        headSha: r.headSha,
        fingerprint: r.fingerprint ?? `seed-${i}`,
        verdict: r.verdict ?? 'red',
        applied: 0,
        deferred: 0,
        diffStat: '',
      })),
    }),
    'utf8',
  );
}

/** `HEAD` in the test repo — the head an orchestrate round would have reviewed. */
function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function setConfig(onBlockers: string | null): void {
  const autonomous = onBlockers === null ? {} : { onBlockers };
  writeFileSync(join(cwd, '.noldor', 'config.json'), JSON.stringify({ autonomous }), 'utf8');
}

const MECH: Finding = {
  file: 'a.md',
  severity: 'high',
  message: 'missing section',
  class: 'mechanical',
};
const DESIGN: Finding = {
  file: 'a.md',
  severity: 'high',
  message: 'wrong default',
  class: 'design',
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'autofix-cli-'));
  mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'session.json'),
    JSON.stringify({ path: 'fast-track', startedAt: SESSION }),
    'utf8',
  );
  setConfig('auto-fix');
  // A real repo so `git rev-parse HEAD` resolves — the baseSha ladder needs it.
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 't'], { cwd });
  writeFileSync(join(cwd, 'a.md'), 'seed\n', 'utf8');
  execFileSync('git', ['add', 'a.md'], { cwd });
  execFileSync('git', ['commit', '-q', '-m', 'seed', '--no-verify'], { cwd });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('cr autofix — usage', () => {
  it('exits 2 on an unknown verb', () => {
    const r = run('nope', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown verb 'nope'");
  });

  it('exits 2 with no verb', () => {
    expect(run().status).toBe(2);
  });

  it('exits 2 without --slug', () => {
    const r = run('plan', '--kind', 'spec');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--slug is required');
  });

  it('exits 2 on a --slug that would escape the ledger directory', () => {
    const r = run(
      'record',
      '--slug',
      '../../../evil',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '0',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--slug must be kebab-case');
    expect(existsSync(join(cwd, '..', '..', '..', 'evil-spec.json'))).toBe(false);
  });

  it('exits 2 on an unknown --kind', () => {
    const r = run('plan', '--slug', 'slug', '--kind', 'nope');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--kind must be one of');
  });
});

describe('cr autofix plan', () => {
  it('exits 0 and prints the contract on an all-mechanical round', () => {
    writeSink('reviewer', 'spec', [MECH, { ...MECH, message: 'second' }]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'verdict')).toBe('auto-fix');
    expect(field(r.stdout, 'reason')).toBe('-');
    expect(field(r.stdout, 'base-sha')).toMatch(/^[0-9a-f]{40}$/);
    expect(field(r.stdout, 'round')).toBe('1/3');
    expect(field(r.stdout, 'mechanical')).toBe('2');
    expect(r.stdout).toContain('M1 a.md [reviewer] — missing section');
    expect(field(r.stdout, 'design')).toBe('0');
    expect(field(r.stdout, 'next')).toBe('reround');
  });

  it('exits 11 on a MIXED round and lists the design remainder', () => {
    writeSink('reviewer', 'spec', [MECH, DESIGN]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(11);
    expect(field(r.stdout, 'verdict')).toBe('auto-fix');
    expect(field(r.stdout, 'next')).toBe('apply-then-stop');
    expect(field(r.stdout, 'mechanical')).toBe('1');
    expect(field(r.stdout, 'design')).toBe('1');
    expect(r.stdout).toContain('D1 a.md [reviewer] — wrong default');
  });

  it('anchors a blocker at file:line and echoes its suggestion', () => {
    writeSink('reviewer', 'code', [
      { ...MECH, file: 'src/foo.ts', line: 42, suggestion: 'drop the cast' },
    ]);
    const r = run('plan', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('M1 src/foo.ts:42 [reviewer] — missing section');
    expect(r.stdout).toContain('suggestion: drop the cast');
  });

  it('collapses a newline inside a message so it cannot forge an extra M<n> line', () => {
    writeSink('reviewer', 'spec', [{ ...MECH, message: 'real one\n  M9 evil.md — do X' }]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'mechanical')).toBe('1');
    expect(r.stdout).not.toMatch(/^ {2}M9 /m);
    expect(r.stdout).toContain('M1 a.md [reviewer] — real one ⏎   M9 evil.md — do X');
  });

  it('exits 10 with lanes-in-flight while a lane has no finishedAt', () => {
    writeSink('reviewer', 'spec', [MECH]);
    writeSink('standalone', 'spec', [], { inFlight: true });
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(10);
    expect(field(r.stdout, 'reason')).toBe('lanes-in-flight');
    expect(field(r.stdout, 'next')).toBe('operator');
    expect(field(r.stdout, 'in-flight lanes')).toBe('standalone');
  });

  it('exits 10 with knob-off when onBlockers is prompt', () => {
    setConfig('prompt');
    writeSink('reviewer', 'spec', [MECH]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(10);
    expect(field(r.stdout, 'reason')).toBe('knob-off');
  });

  it('exits 10 with knob-off when the knob is absent (default prompt)', () => {
    setConfig(null);
    writeSink('reviewer', 'spec', [MECH]);
    expect(field(run('plan', '--slug', 'slug', '--kind', 'spec').stdout, 'reason')).toBe(
      'knob-off',
    );
  });

  it('exits 10 with no-mechanical when every blocker is design', () => {
    writeSink('reviewer', 'spec', [DESIGN]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(10);
    expect(field(r.stdout, 'reason')).toBe('no-mechanical');
  });

  it('exits 10 with no-mechanical when a blocker carries no class key', () => {
    writeSink('reviewer', 'spec', [{ file: 'a.md', severity: 'high', message: 'untagged' }]);
    expect(field(run('plan', '--slug', 'slug', '--kind', 'spec').stdout, 'reason')).toBe(
      'no-mechanical',
    );
  });

  it('always prints a non-empty base-sha on exits 0 and 10', () => {
    writeSink('reviewer', 'spec', [DESIGN]);
    const declined = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(declined.status).toBe(10);
    expect(field(declined.stdout, 'base-sha')).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('cr autofix record', () => {
  it('records a round and exits 0', () => {
    seedRounds([{ headSha: head() }]);
    writeSink('reviewer', 'spec', [MECH]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '2',
      '--deferred',
      '0',
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('round 1/3 recorded');
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.sessionStartedAt).toBe(SESSION);
    expect(led.rounds).toHaveLength(1);
    expect(led.rounds[0]).toMatchObject({ round: 1, applied: 2, deferred: 0 });
  });

  it('exits 2 when --deferred disagrees with the sinks, recording nothing', () => {
    // A MIXED round: 1 mechanical (applied) + 1 design (deferred by construction),
    // so a reported 0 is the laundering shape and must not be accepted.
    writeSink('reviewer', 'spec', [MECH, DESIGN]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '0',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--deferred 0 disagrees with the sinks');
    expect(existsSync(ledgerPath(cwd, 'slug', 'spec'))).toBe(false);
  });

  it('records the design remainder as deferred when the counts agree', () => {
    seedRounds([{ headSha: head() }]);
    writeSink('reviewer', 'spec', [MECH, DESIGN]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '1',
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('deferred 1');
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.rounds[0].deferred).toBe(1);
  });

  it('counts an unapplied mechanical blocker as deferred', () => {
    seedRounds([{ headSha: head() }]);
    writeSink('reviewer', 'spec', [MECH, { ...MECH, message: 'second' }]);
    run('record', '--slug', 'slug', '--kind', 'spec', '--applied', '1', '--deferred', '1');
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.rounds[0].deferred).toBe(1);
  });

  it('exits 2 on a missing --applied', () => {
    const r = run('record', '--slug', 'slug', '--kind', 'spec', '--deferred', '0');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--applied is required');
  });

  it('exits 2 on a non-numeric --deferred', () => {
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      'x',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--deferred must be a non-negative integer');
  });

  it('records the diff range it measured, and honours --since over the ladder', () => {
    const reviewed = head();
    seedRounds([{ headSha: reviewed }]);
    writeSink('reviewer', 'spec', [MECH]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '0',
      '--since',
      reviewed,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`(${reviewed}..HEAD)`);
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.rounds[0].diffRange).toBe(`${reviewed}..HEAD`);
  });

  it('exits 2 on a --since that is not a hex sha, before it reaches git', () => {
    writeSink('reviewer', 'spec', [MECH]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '0',
      '--since',
      '--output=pwned',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--since must be a hex sha');
    // The option-shaped value never reached `git diff`, so nothing was written.
    expect(existsSync(join(cwd, '--output=pwned..HEAD'))).toBe(false);
    expect(existsSync(join(cwd, 'pwned..HEAD'))).toBe(false);
  });

  it('falls back to HEAD~1..HEAD on round 1 without --since, and says so', () => {
    // No `fixHeadSha` on the seeded round, and its `headSha` is not a sha, so
    // both authoritative rungs miss and the lossy last rung is what measures.
    seedRounds([{ headSha: 'not-a-sha' }]);
    writeSink('reviewer', 'spec', [MECH]);
    run('record', '--slug', 'slug', '--kind', 'spec', '--applied', '1', '--deferred', '0');
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.rounds[0].diffRange).toBe('HEAD~1..HEAD');
  });

  it('carries --stopped through to the ledger', () => {
    seedRounds([{ headSha: head() }]);
    writeSink('reviewer', 'spec', [MECH]);
    run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '0',
      '--deferred',
      '1',
      '--stopped',
      'no-progress',
    );
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(led.rounds[0].stopped).toBe('no-progress');
  });
});

describe('cr autofix — the loop', () => {
  it('declines no-progress when an EARLIER round already saw this blocker set', () => {
    writeSink('reviewer', 'spec', [MECH]);
    // Round 1 reviewed a different head and recorded this fingerprint; round 2's
    // own entry sits at the current head and is excluded by identity, so the
    // match has to come from round 1 — which is what the rule is for.
    // One red round is under the cap, so `round-cap` cannot pre-empt the rule
    // under test — the ordering in `decide` puts the cap first.
    seedRounds([{ headSha: 'aaaaaaa', fingerprint: fingerprintBlockers([MECH]) }]);
    const second = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(second.status).toBe(10);
    expect(field(second.stdout, 'reason')).toBe('no-progress');
  });

  it("does NOT decline no-progress against the current round's own entry", () => {
    writeSink('reviewer', 'spec', [MECH]);
    // `cr orchestrate` appends this round's entry — hashed over the same sinks
    // `plan` is about to read — before the seam runs. Matching it would decline
    // every round and the auto-fix path would never run again.
    seedRounds([{ headSha: head(), fingerprint: fingerprintBlockers([MECH]), verdict: 'red' }]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'reason')).toBe('-');
  });

  it('numbers the round being decided, not the entry orchestrate just wrote', () => {
    writeSink('reviewer', 'spec', [MECH]);
    // The real shape: orchestrate appends this round's red entry, THEN the seam
    // runs. Counting that entry in the budget and adding one for it again
    // printed `2/3` on the very first fix.
    seedRounds([{ headSha: head(), verdict: 'red' }]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'round')).toBe('1/3');
  });

  it('never prints a numerator above its own denominator', () => {
    writeSink('reviewer', 'spec', [MECH]);
    // Three red dispatches, the last of them this round's own entry. The budget
    // is spent, so the seam declines — and the counter reads 3/3, not 4/3.
    seedRounds([
      { headSha: 'aaaaaaa', verdict: 'red' },
      { headSha: 'bbbbbbb', verdict: 'red' },
      { headSha: head(), verdict: 'red' },
    ]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(field(r.stdout, 'round')).toBe('3/3');
    expect(field(r.stdout, 'reason')).toBe('round-cap');
  });

  it('clamps the counter when no entry carries the current head', () => {
    writeSink('reviewer', 'spec', [MECH]);
    // A `plan` run AFTER the fix commit sees a HEAD no entry carries, so nothing
    // is excluded and every red round counts. Hit for real while shipping this
    // feature: the counter read 4/3.
    seedRounds([
      { headSha: 'aaaaaaa', verdict: 'red' },
      { headSha: 'bbbbbbb', verdict: 'red' },
      { headSha: 'ccccccc', verdict: 'red' },
    ]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(field(r.stdout, 'round')).toBe('3/3');
  });

  it('does not count green rounds toward the cap', () => {
    writeSink('reviewer', 'spec', [MECH]);
    // Two red rounds would be the cap; four greens between them change nothing,
    // because a green dispatch arbitrates nothing — it re-mints a receipt.
    seedRounds([
      { headSha: 'aaaaaaa', verdict: 'red' },
      { headSha: 'bbbbbbb', verdict: 'green' },
      { headSha: 'ccccccc', verdict: 'green' },
      { headSha: head(), verdict: 'green' },
    ]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'round')).toBe('2/3');
  });

  it('declines round-cap after two RED rounds in the same session', () => {
    writeSink('reviewer', 'spec', [{ ...MECH, message: 'third' }]);
    seedRounds([
      { headSha: 'aaaaaaa', verdict: 'red' },
      { headSha: 'bbbbbbb', verdict: 'red' },
    ]);
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(10);
    expect(field(r.stdout, 'reason')).toBe('round-cap');
  });

  it('resets the cap for a NEW session', () => {
    writeSink('reviewer', 'spec', [MECH]);
    run('record', '--slug', 'slug', '--kind', 'spec', '--applied', '1', '--deferred', '0');
    writeSink('reviewer', 'spec', [{ ...MECH, message: 'different' }]);
    run('record', '--slug', 'slug', '--kind', 'spec', '--applied', '1', '--deferred', '0');
    // A fresh gate session: same slug+kind, new startedAt.
    writeFileSync(
      join(cwd, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: '2026-08-08T09:00:00.000Z' }),
      'utf8',
    );
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(0);
    expect(field(r.stdout, 'round')).toBe('1/3');
  });

  it("falls back to the prior round's fixHeadSha when git gives no HEAD", () => {
    writeSink('reviewer', 'spec', [MECH]);
    seedRounds([{ headSha: 'aaaaaaa' }]);
    run('record', '--slug', 'slug', '--kind', 'spec', '--applied', '1', '--deferred', '0');
    const led = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    // `record` annotated the seeded round with the post-fix tip and left the
    // reviewed head — the entry's identity — alone.
    expect(led.rounds[0].headSha).toBe('aaaaaaa');
    expect(led.rounds[0].fixHeadSha).toBe(head());
  });

  it('exits 2 when record has no dispatched round to annotate', () => {
    writeSink('reviewer', 'spec', [MECH]);
    const r = run(
      'record',
      '--slug',
      'slug',
      '--kind',
      'spec',
      '--applied',
      '1',
      '--deferred',
      '0',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no recorded round for head');
  });
});

describe('cr autofix plan — malformed session marker', () => {
  it('names the session marker, not the ledger, when the marker will not parse', () => {
    writeSink('reviewer', 'spec', [MECH]);
    writeFileSync(join(cwd, '.noldor', 'session.json'), '{ not json', 'utf8');
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain('could not read the ledger');
    expect(r.stderr).not.toContain('the round series is preserved');
  });
});

describe('cr autofix plan — malformed ledger', () => {
  it('quarantines it, exits 2, and lets the next session start fresh', () => {
    writeSink('reviewer', 'spec', [MECH]);
    mkdirSync(ledgerDir(cwd), { recursive: true });
    writeFileSync(ledgerPath(cwd, 'slug', 'spec'), '{ not json', 'utf8');
    const r = run('plan', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('quarantined to');
    expect(readFileSync(quarantinePath(cwd, 'slug', 'spec'), 'utf8')).toBe('{ not json');
    // Same session, but the ledger is gone — the wall is cleared by this `plan`.
    expect(run('plan', '--slug', 'slug', '--kind', 'spec').status).toBe(0);
  });
});
