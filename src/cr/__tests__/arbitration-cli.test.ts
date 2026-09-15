// @tests: specs-cr-gate-multi-reviewer
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arbitrationPath, arbitrationRecordSchema, recordDigest } from '../arbitration.js';
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
  try {
    const stdout = execFileSync('node', [BIN, 'cr', 'arbitration', ...args], {
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
    // Every other readiness reason is satisfied, so the kind is provably the
    // only thing holding it: a code record in the same state exits 0.
    expect(r.stderr).not.toContain('no disposition');
    expect(r.stderr).not.toContain('bound to tree');
  });

  it('exits 1 on a record with no arbitrable blockers, which cannot be filled', () => {
    // `buildSkeleton` drops integrity blockers, so an aggregate that went red on
    // those alone writes this — and no disposition can ever make it filled.
    writeRecord({ blockers: [] });
    const r = run('digest', '--slug', 'slug', '--kind', 'code');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no arbitrable blockers');
  });
});
