// @tests: pendev-ui-design-phase

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  approvalPath,
  approvalRelPath,
  parseApprovalBytes,
  readApproval,
  writeApproval,
  type DesignApprovalRecord,
} from '../design-approval.js';
import {
  main as verdictMain,
  parseVerdictArgs,
  resolveFeaturePen,
} from '../design-approval-cli.js';

const PEN = '2026-08-30-my-feature.pen';

const APPROVED: DesignApprovalRecord = {
  outcome: 'approved',
  at: '2026-08-30T00:00:00.000Z',
  penBlob: 'a'.repeat(40),
  surfaces: ['app'],
};

const dirs: string[] = [];
function tempRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-design-approval-test-'));
  dirs.push(cwd);
  return cwd;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('design-approval / record round-trip', () => {
  it('writes and reads back an approved record', () => {
    const cwd = tempRepo();
    const written = writeApproval(cwd, PEN, APPROVED);
    expect(written.ok).toBe(true);
    expect(readApproval(cwd, PEN)).toEqual(APPROVED);
  });

  it('writes and reads back a waived record, penBlob included', () => {
    const cwd = tempRepo();
    const waived: DesignApprovalRecord = {
      outcome: 'waived',
      at: '2026-08-30T00:00:00.000Z',
      penBlob: 'b'.repeat(40),
      reason: 'bridge down at the verdict',
    };
    expect(writeApproval(cwd, PEN, waived).ok).toBe(true);
    expect(readApproval(cwd, PEN)).toEqual(waived);
  });

  it('overwrites an existing record for the same stem (the stale remedy)', () => {
    const cwd = tempRepo();
    writeApproval(cwd, PEN, APPROVED);
    const revised = { ...APPROVED, penBlob: 'c'.repeat(40) };
    expect(writeApproval(cwd, PEN, revised).ok).toBe(true);
    expect(readApproval(cwd, PEN)).toEqual(revised);
  });

  it('keeps two same-key different-date designs on two distinct records', () => {
    const cwd = tempRepo();
    writeApproval(cwd, '2026-08-29-my-feature.pen', APPROVED);
    const second = { ...APPROVED, penBlob: 'd'.repeat(40) };
    writeApproval(cwd, '2026-08-30-my-feature.pen', second);
    expect(readApproval(cwd, '2026-08-29-my-feature.pen')).toEqual(APPROVED);
    expect(readApproval(cwd, '2026-08-30-my-feature.pen')).toEqual(second);
  });

  it('reads null for an absent record', () => {
    expect(readApproval(tempRepo(), PEN)).toBeNull();
  });
});

describe('design-approval / parse policy', () => {
  it('rejects an unknown field — writer and reader must agree (.strict())', () => {
    expect(parseApprovalBytes(JSON.stringify({ ...APPROVED, extra: 1 }))).toBeNull();
  });

  it('rejects an empty surfaces list and a surfaces on the waived member', () => {
    expect(parseApprovalBytes(JSON.stringify({ ...APPROVED, surfaces: [] }))).toBeNull();
    expect(
      parseApprovalBytes(
        JSON.stringify({
          outcome: 'waived',
          at: 'x',
          penBlob: 'a'.repeat(40),
          reason: 'r',
          surfaces: ['app'],
        }),
      ),
    ).toBeNull();
  });

  it('rejects a non-oid penBlob and unparseable bytes', () => {
    expect(parseApprovalBytes(JSON.stringify({ ...APPROVED, penBlob: 'short' }))).toBeNull();
    expect(parseApprovalBytes('{ not json')).toBeNull();
  });

  it('accepts a sha256-width oid', () => {
    expect(parseApprovalBytes(JSON.stringify({ ...APPROVED, penBlob: 'e'.repeat(64) }))).toEqual({
      ...APPROVED,
      penBlob: 'e'.repeat(64),
    });
  });
});

describe('design-approval / path containment', () => {
  it('contains by construction: directories are stripped before the stem is slugged', () => {
    const built = approvalPath(tempRepo(), '../../etc/passwd.pen');
    // basename() removes the traversal; what remains is a plain stem, so the
    // record lands INSIDE .noldor/design-approval/ regardless of the input dirs.
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.path).toContain('/.noldor/design-approval/passwd.json');
  });

  it('refuses a stem that survives basename but fails the slug grammar', () => {
    // basename('...pen', '.pen') === '..' — the one dot-shape basename keeps.
    expect(approvalPath(tempRepo(), '...pen').ok).toBe(false);
  });

  it('derives the record rel path from the pen basename', () => {
    expect(approvalRelPath(PEN)).toBe('.noldor/design-approval/2026-08-30-my-feature.json');
  });
});

// ---------------------------------------------------------------------------
// CLI

function gitRepo(): string {
  const cwd = tempRepo();
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, 'docs', 'design', 'ui', 'baseline'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'ui', 'archive'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), 'PEN-BYTES\n');
  return cwd;
}

describe('design verdict CLI / argv boundary', () => {
  it.each([
    [[], '--pen is required'],
    [['--pen', 'x.pen'], 'exactly one of --approve / --waive'],
    [['--pen', 'x.pen', '--approve', '--waive'], 'exactly one of --approve / --waive'],
    [['--pen', 'x.pen', '--approve'], 'at least one --surface'],
    [['--pen', 'x.pen', '--approve', '--surface', 'app', '--reason', 'r'], '--reason belongs'],
    [['--pen', 'x.pen', '--waive'], '--waive requires --reason'],
    [['--pen', 'x.pen', '--waive', '--reason', 'r', '--surface', 'app'], '--surface belongs'],
    [['--pen', 'x.pen', '--waive', '--reason', 'r', '--reservation', 't'], '--reservation belongs'],
    [['--pen', 'x.pen', '--approve', '--surface', 'app', '--bogus'], "unknown argument '--bogus'"],
  ])('refuses %j', (argv, message) => {
    const parsed = parseVerdictArgs(argv as string[]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it('deduplicates repeated surfaces', () => {
    const parsed = parseVerdictArgs([
      '--pen',
      'x.pen',
      '--approve',
      '--surface',
      'app',
      '--surface',
      'app',
    ]);
    expect(parsed).toMatchObject({ ok: true, mode: { outcome: 'approved', surfaces: ['app'] } });
  });
});

describe('design verdict CLI / --pen containment', () => {
  it('refuses a path outside docs/design/ui/', () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'stray.pen'), 'x\n');
    const r = resolveFeaturePen(cwd, 'stray.pen');
    expect(r.ok).toBe(false);
  });

  it('refuses a baseline .pen and a traversal that resolves outside the root', () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'docs', 'design', 'ui', 'baseline', 'app.pen'), 'x\n');
    expect(resolveFeaturePen(cwd, 'docs/design/ui/baseline/app.pen').ok).toBe(false);
    expect(resolveFeaturePen(cwd, 'docs/design/ui/../../../etc/passwd').ok).toBe(false);
  });

  it('refuses a symlink escaping the design root', () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'outside.pen'), 'x\n');
    symlinkSync(join(cwd, 'outside.pen'), join(cwd, 'docs', 'design', 'ui', 'link.pen'));
    expect(resolveFeaturePen(cwd, 'docs/design/ui/link.pen').ok).toBe(false);
  });

  it('accepts a feature .pen and an archived .pen (re-verdict after the flip commit)', () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'docs', 'design', 'ui', 'archive', PEN), 'x\n');
    expect(resolveFeaturePen(cwd, `docs/design/ui/${PEN}`).ok).toBe(true);
    expect(resolveFeaturePen(cwd, `docs/design/ui/archive/${PEN}`).ok).toBe(true);
  });
});

describe('design verdict CLI / end to end', () => {
  it('writes an approved record blob-bound to the pen on disk', async () => {
    const cwd = gitRepo();
    const code = await verdictMain(
      ['--pen', `docs/design/ui/${PEN}`, '--approve', '--surface', 'app'],
      { cwd, now: () => '2026-08-30T00:00:00.000Z' },
    );
    expect(code).toBe(0);
    const record = JSON.parse(
      readFileSync(join(cwd, '.noldor', 'design-approval', '2026-08-30-my-feature.json'), 'utf8'),
    ) as DesignApprovalRecord;
    const expected = execFileSync(
      'git',
      ['hash-object', '--path', `docs/design/ui/${PEN}`, '--', `docs/design/ui/${PEN}`],
      { cwd, encoding: 'utf8' },
    ).trim();
    expect(record).toMatchObject({ outcome: 'approved', penBlob: expected, surfaces: ['app'] });
  });

  it('writes a waived record with its reason', async () => {
    const cwd = gitRepo();
    const code = await verdictMain(
      ['--pen', `docs/design/ui/${PEN}`, '--waive', '--reason', 'bridge down'],
      { cwd, now: () => '2026-08-30T00:00:00.000Z' },
    );
    expect(code).toBe(0);
    expect(readApproval(cwd, PEN)).toMatchObject({ outcome: 'waived', reason: 'bridge down' });
  });

  it('records the reservation on approve-with-reservations', async () => {
    const cwd = gitRepo();
    await verdictMain(
      [
        '--pen',
        `docs/design/ui/${PEN}`,
        '--approve',
        '--surface',
        'app',
        '--reservation',
        'spacing',
      ],
      { cwd },
    );
    expect(readApproval(cwd, PEN)).toMatchObject({ reservation: 'spacing' });
  });

  it('exits 2 writing nothing on an unkeyable filename', async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'docs', 'design', 'ui', 'undated.pen'), 'x\n');
    const code = await verdictMain(
      ['--pen', 'docs/design/ui/undated.pen', '--approve', '--surface', 'app'],
      { cwd },
    );
    expect(code).toBe(2);
    expect(readApproval(cwd, 'undated.pen')).toBeNull();
  });

  it('exits 2 on a missing file', async () => {
    const cwd = gitRepo();
    const code = await verdictMain(
      ['--pen', 'docs/design/ui/2026-08-30-nope.pen', '--approve', '--surface', 'app'],
      { cwd },
    );
    expect(code).toBe(2);
  });
});

describe('design-approval / tracked by omission', () => {
  it('is matched by no .gitignore rule — the record can reach main', () => {
    // Asserted against the REPO'S OWN .gitignore, not a fixture: the guarantee
    // is about this repository's ignore rules, and `git check-ignore` is the
    // authority on how git reads them.
    const out = (() => {
      try {
        return execFileSync(
          'git',
          ['check-ignore', '-q', '.noldor/design-approval/2026-08-30-x.json'],
          { encoding: 'utf8' },
        );
      } catch (err) {
        // exit 1 = not ignored, which is the pass; anything else rethrows.
        const status = (err as { status?: number }).status;
        if (status === 1) return null;
        throw err;
      }
    })();
    expect(out).toBeNull();
  });
});
