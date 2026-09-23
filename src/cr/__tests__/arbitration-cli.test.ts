// @tests: specs-cr-gate-multi-reviewer, cr-re-round-cap-enforcement-and-oscillation-detector
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arbitrationPath, arbitrationRecordSchema, recordDigest } from '../arbitration.js';
import { decisionsPath } from '../decisions.js';
import { fingerprintBlocker } from '../fingerprint.js';
import type { Slug } from '../../core/slug.js';

const BIN = resolve(import.meta.dirname, '../../../bin/noldor.mjs');

let cwd: string;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke through the real `noldor` router, so these cases also cover the
 * manifest registration and the router's argv reshaping — the verb has to land
 * where the entrypoint looks for it.
 */
function run(...args: string[]): Run {
  return runEnv({}, ...args);
}

function runEnv(env: Record<string, string>, ...args: string[]): Run {
  try {
    const stdout = execFileSync('node', [BIN, 'cr', 'arbitration', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NOLDOR_DRAIN: '', ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function headTree(): string {
  return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
}

/** The skeleton `cr orchestrate` writes at a cap refusal, bound to this tree. */
function writeRecord(over: Record<string, unknown> = {}): void {
  const path = arbitrationPath(cwd, 'slug' as Slug, 'code');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      slug: 'slug',
      kind: 'code',
      boundTree: headTree(),
      rounds: [{ round: 1, verdict: 'red', headSha: 'abc1234' }],
      blockers: [
        { id: 'b1', severity: 'high', message: 'wrong default', lanes: ['reviewer'] },
        { id: 'b2', severity: 'med', message: 'naming', lanes: ['codex'] },
      ],
      signals: [],
      dispositions: [],
      ...over,
    }),
    'utf8',
  );
}

function readRecord() {
  return arbitrationRecordSchema.parse(
    JSON.parse(readFileSync(arbitrationPath(cwd, 'slug' as Slug, 'code'), 'utf8')),
  );
}

/** Parse a `key: value` line out of the CLI's stdout contract. */
function field(stdout: string, key: string): string | undefined {
  return stdout.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'arbitration-cli-'));
  // A real repo: the record binds to `HEAD^{tree}` and the CLI reports a
  // mismatch, so a fixture with no tree would test a different branch.
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

describe('cr arbitration — usage', () => {
  it('exits 2 on an unknown verb and names the two it has', () => {
    const r = run('nope', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown verb 'nope'");
    expect(r.stderr).toContain('expected dispose or digest');
  });

  it('lists the closed disposition vocabulary, which no other surface prints', () => {
    writeRecord();
    const r = run('dispose', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(2);
    for (const d of ['accepted', 'rejected', 'deferred']) expect(r.stderr).toContain(d);
  });

  it('refuses a slug that would escape the arbitration directory', () => {
    writeRecord();
    const r = run('digest', '--slug', '../../../etc', '--kind', 'code');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('kebab-case');
  });

  it('refuses an unknown kind', () => {
    const r = run('digest', '--slug', 'slug', '--kind', 'sepc');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--kind must be one of spec|plan|code');
  });

  it('points at orchestrate when no record exists', () => {
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no usable arbitration record');
    expect(r.stderr).toContain('cr orchestrate');
  });
});

describe('cr arbitration dispose', () => {
  it('writes the disposition and its note into the record on disk', () => {
    writeRecord();
    const r = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      'b1',
      '--disposition',
      'rejected',
      '--note',
      'the reviewer misread the default',
    );
    expect(r.status).toBe(0);
    expect(readRecord().dispositions).toEqual([
      {
        blockerId: 'b1',
        disposition: 'rejected',
        note: 'the reviewer misread the default',
      },
    ]);
  });

  it('reports what is still undisposed, then that nothing is', () => {
    writeRecord();
    const first = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      'b1',
      '--disposition',
      'accepted',
    );
    expect(first.stdout).toContain('1 still undisposed: b2');
    const second = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      'b2',
      '--disposition',
      'deferred',
    );
    expect(second.stdout).toContain('all 2 blockers disposed');
    expect(readRecord().dispositions).toHaveLength(2);
  });

  it('leaves a re-disposed record parseable, with the second answer winning', () => {
    // An appending writer would produce two entries for `b1`, which the schema
    // rejects — so this asserts the record still reads back, not just its shape.
    writeRecord();
    for (const d of ['accepted', 'rejected']) {
      const r = run(
        'dispose',
        '--slug',
        'slug',
        '--kind',
        'code',
        '--blocker',
        'b1',
        '--disposition',
        d,
      );
      expect(r.status).toBe(0);
    }
    expect(readRecord().dispositions).toEqual([{ blockerId: 'b1', disposition: 'rejected' }]);
  });

  it('refuses an unknown blocker id and names the ones it has', () => {
    writeRecord();
    const r = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      'b9',
      '--disposition',
      'accepted',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('b9 names no blocker');
    expect(r.stderr).toContain('b1, b2');
    expect(readRecord().dispositions).toEqual([]);
  });

  it('refuses a disposition outside the vocabulary without writing', () => {
    writeRecord();
    const r = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      'b1',
      '--disposition',
      'shrug',
    );
    expect(r.status).toBe(2);
    expect(readRecord().dispositions).toEqual([]);
  });
});

describe('cr arbitration digest', () => {
  function disposeBoth(): void {
    for (const id of ['b1', 'b2']) {
      run(
        'dispose',
        '--slug',
        'slug',
        '--kind',
        'code',
        '--blocker',
        id,
        '--disposition',
        'accepted',
      );
    }
  }

  it('prints the digest the guard re-derives, plus the trailer that names it', () => {
    writeRecord();
    disposeBoth();
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(0);
    // Independent of how the CLI computed it: re-derived from the file on disk.
    expect(field(r.stdout, 'digest')).toBe(recordDigest(readRecord()));
    expect(r.stdout).toContain(
      `--trailer "Noldor-Path-Override: cr-arbitration ${recordDigest(readRecord())} —`,
    );
  });

  it('exits 1 while a blocker carries no disposition, naming it', () => {
    writeRecord();
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('b1, b2');
    // The digest still prints: "what does this record digest to right now" is
    // the question the command exists for, ready or not.
    expect(field(r.stdout, 'digest')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('exits 1 when the record is bound to a tree HEAD has moved past', () => {
    writeRecord({ boundTree: 'f'.repeat(40) });
    disposeBoth();
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bound to tree fffffff');
  });

  it('exits 1 on a filled spec record, because no reader validates that digest', () => {
    // `noldor-enforce-arbitration.ts` builds its record path with a hardcoded
    // `'code'`, so a spec digest in the trailer is compared against the CODE
    // record — a refusal where one exists, and unchecked where none does.
    // Exit 0 here would be the one lie this command exists to prevent.
    const path = arbitrationPath(cwd, 'slug' as Slug, 'spec');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        slug: 'slug',
        kind: 'spec',
        boundTree: headTree(),
        rounds: [{ round: 1, verdict: 'red', headSha: 'abc1234' }],
        blockers: [{ id: 'b1', severity: 'high', message: 'scope drift', lanes: ['reviewer'] }],
        signals: [],
        dispositions: [{ blockerId: 'b1', disposition: 'accepted', note: 'deliberate' }],
      }),
      'utf8',
    );
    const r = run('digest', '--slug', 'slug', '--kind', 'spec');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pre-push validates the code record only');
    // Self-closing: this reason can never be cleared for a spec record, so
    // unlike the others it has to name where the close actually happens or the
    // cap banner walks a spec-stage operator to a dead end.
    expect(r.stderr).toContain('The close happens at `--kind code`');
    // And it does not oversell the spec record: the guard's ledger fallback is
    // governed by the same hardcoded `'code'`, so filling this one feeds no gate.
    expect(r.stderr).toContain('which no gate reads');
    // Every other readiness reason is satisfied, so the kind is provably the
    // only thing holding it: a code record in the same state exits 0.
    expect(r.stderr).not.toContain('no disposition');
    expect(r.stderr).not.toContain('bound to tree');
  });

  it('exits 1 on a record with no arbitrable blockers, naming the lane re-run as the way out', () => {
    // `buildSkeleton` drops integrity blockers, so an aggregate that went red on
    // those alone writes this — and no disposition can ever make it filled, so
    // the reason has to point somewhere other than `dispose`.
    writeRecord({ blockers: [] });
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('integrity blockers alone');
    expect(r.stderr).toContain('re-run the lane');
  });
});

describe('cr arbitration dispose — a ruling before the cap (Q-0261)', () => {
  const blocker = {
    file: 'src/a.ts',
    severity: 'high' as const,
    message: 'the fallback hides a failure',
    locations: [{ file: 'src/a.ts', line: 2 }],
  };
  const ID = fingerprintBlocker(blocker);

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  }

  /** A reviewed round: the cited file committed, its head stamped, the reviewer's sink on disk. */
  function reviewedRound(blockers: unknown[] = [blocker]): string {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'line 1\nline 2\nline 3\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'code', '--no-verify');
    const head = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, '.noldor', 'cr', 'expected'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'cr', 'expected', 'slug-code.json'),
      JSON.stringify({ slug: 'slug', kind: 'code', lanes: ['reviewer'], headSha: head }),
    );
    writeFileSync(
      join(cwd, '.noldor', 'cr', 'slug-code-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'src/a.ts',
        kind: 'code',
        slug: 'slug',
        blockers,
        suggestions: [],
        summary: 'blockers found',
        startedAt: '2026-09-23T00:00:00.000Z',
      }),
    );
    writeFileSync(
      join(cwd, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
    );
    return head;
  }

  const store = (): { decisions: Array<Record<string, any>> } | null => {
    const path = decisionsPath(cwd, 'slug' as Slug, 'code');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  };

  const disposeArgs = (...extra: string[]): string[] => [
    'dispose',
    '--slug',
    'slug',
    '--kind',
    'code',
    '--blocker',
    ID,
    '--disposition',
    'rejected',
    '--note',
    'the fallback is intentional',
    ...extra,
  ];

  it('records the ruling on a standing blocker, with the lines it cites, and exits 0', () => {
    reviewedRound();
    const r = run(...disposeArgs());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`recorded ${ID}: rejected`);
    const d = store()!.decisions;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      id: ID,
      disposition: 'rejected',
      reason: 'the fallback is intentional',
      lanes: ['reviewer'],
      cites: [{ file: 'src/a.ts', line: 2, text: 'line 2' }],
    });
  });

  it('lists the standing blockers and their ids when --blocker is missing or unknown, recording nothing', () => {
    reviewedRound();
    for (const args of [
      ['dispose', '--slug', 'slug', '--kind', 'code'],
      [
        'dispose',
        '--slug',
        'slug',
        '--kind',
        'code',
        '--blocker',
        'nope',
        '--disposition',
        'rejected',
        '--note',
        'x',
      ],
    ]) {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(ID);
      expect(r.stderr).toContain('the fallback hides a failure');
    }
    expect(store()).toBeNull();
  });

  it('refuses without a note, under a drain child, with no session marker, or with no reviewed head', () => {
    reviewedRound();
    expect(run(...disposeArgs().slice(0, -2)).status).toBe(2);
    expect(runEnv({ NOLDOR_DRAIN: '1' }, ...disposeArgs()).status).toBe(2);
    rmSync(join(cwd, '.noldor', 'session.json'));
    expect(run(...disposeArgs()).status).toBe(2);
    writeFileSync(
      join(cwd, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
    );
    rmSync(join(cwd, '.noldor', 'cr', 'expected', 'slug-code.json'));
    expect(run(...disposeArgs()).status).toBe(2);
    expect(store()).toBeNull();
  });

  it('never takes a ruling on a lane failure blocker', () => {
    const failure = { file: '<reviewer>', severity: 'high', message: 'subagent lane errored: x' };
    reviewedRound([failure]);
    const r = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      fingerprintBlocker(failure as never),
      '--disposition',
      'rejected',
      '--note',
      'x',
    );
    expect(r.status).toBe(2);
    expect(store()).toBeNull();
  });

  it('changes an earlier ruling whose finding no longer stands, keeping what it cites', () => {
    reviewedRound();
    expect(run(...disposeArgs()).status).toBe(0);
    reviewedRound([]);
    const r = run(
      'dispose',
      '--slug',
      'slug',
      '--kind',
      'code',
      '--blocker',
      ID,
      '--disposition',
      'accepted',
      '--note',
      'the debt is taken',
    );
    expect(r.status).toBe(0);
    expect(store()!.decisions).toEqual([
      expect.objectContaining({
        id: ID,
        disposition: 'accepted',
        reason: 'the debt is taken',
        cites: [{ file: 'src/a.ts', line: 2, text: 'line 2' }],
      }),
    ]);
  });

  it('at the cap, fills the record and records the same ruling', () => {
    reviewedRound();
    writeRecord({
      blockers: [{ id: ID, severity: 'high', message: blocker.message, lanes: ['reviewer'] }],
    });
    const r = run(...disposeArgs());
    expect(r.status).toBe(0);
    expect(readRecord().dispositions).toEqual([
      { blockerId: ID, disposition: 'rejected', note: 'the fallback is intentional' },
    ]);
    expect(store()!.decisions.map((d) => d.id)).toEqual([ID]);
  });

  it('at the cap under a drain child, fills the record but keeps no ruling', () => {
    reviewedRound();
    writeRecord({
      blockers: [{ id: ID, severity: 'high', message: blocker.message, lanes: ['reviewer'] }],
    });
    const r = runEnv({ NOLDOR_DRAIN: '1' }, ...disposeArgs());
    expect(r.status).toBe(0);
    expect(readRecord().dispositions).toHaveLength(1);
    expect(store()).toBeNull();
  });

  it('a record left for another tree does not take a ruling made before the cap', () => {
    reviewedRound();
    writeRecord({ boundTree: 'another-tree' });
    const r = run(...disposeArgs());
    expect(r.status).toBe(0);
    expect(readRecord().dispositions).toEqual([]);
    expect(store()!.decisions.map((d) => d.id)).toEqual([ID]);
  });
});
