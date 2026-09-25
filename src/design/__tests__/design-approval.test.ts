// @tests: pendev-ui-design-phase, architecture-design-phase, feature-pen-coverage-from-acceptance-criteria

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approvalRelPath,
  parseApprovalBytes,
  writeApproval,
  type DesignApprovalRecord,
} from '../design-approval.js';

/** Disk read for assertions — production readers take bytes out of git. */
function readBack(repoRoot: string, pen: string): DesignApprovalRecord | null {
  try {
    return parseApprovalBytes(readFileSync(join(repoRoot, approvalRelPath(pen))));
  } catch {
    return null;
  }
}
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
    expect(readBack(cwd, PEN)).toEqual(APPROVED);
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
    expect(readBack(cwd, PEN)).toEqual(waived);
  });

  it('overwrites an existing record for the same stem (the stale remedy)', () => {
    const cwd = tempRepo();
    writeApproval(cwd, PEN, APPROVED);
    const revised = { ...APPROVED, penBlob: 'c'.repeat(40) };
    expect(writeApproval(cwd, PEN, revised).ok).toBe(true);
    expect(readBack(cwd, PEN)).toEqual(revised);
  });

  it('keeps two same-key different-date designs on two distinct records', () => {
    const cwd = tempRepo();
    writeApproval(cwd, '2026-08-29-my-feature.pen', APPROVED);
    const second = { ...APPROVED, penBlob: 'd'.repeat(40) };
    writeApproval(cwd, '2026-08-30-my-feature.pen', second);
    expect(readBack(cwd, '2026-08-29-my-feature.pen')).toEqual(APPROVED);
    expect(readBack(cwd, '2026-08-30-my-feature.pen')).toEqual(second);
  });

  it('reads null for an absent record', () => {
    expect(readBack(tempRepo(), PEN)).toBeNull();
  });
});

describe('design-approval / records by design kind', () => {
  const ARCH = 'docs/design/architecture/2026-08-30-my-feature.pen';
  const ARCH_APPROVED: DesignApprovalRecord = {
    outcome: 'approved',
    at: '2026-08-30T00:00:00.000Z',
    penBlob: 'e'.repeat(40),
    surfaces: ['modules'],
  };

  it('records an architecture design under architecture/, archived or not, and leaves UI paths alone', () => {
    expect(approvalRelPath(ARCH)).toBe(
      '.noldor/design-approval/architecture/2026-08-30-my-feature.json',
    );
    expect(approvalRelPath('docs/design/architecture/archive/2026-08-30-my-feature.pen')).toBe(
      '.noldor/design-approval/architecture/2026-08-30-my-feature.json',
    );
    expect(approvalRelPath(`docs/design/ui/${PEN}`)).toBe(
      '.noldor/design-approval/2026-08-30-my-feature.json',
    );
    expect(approvalRelPath(PEN)).toBe('.noldor/design-approval/2026-08-30-my-feature.json');
  });

  it('keeps a UI record and an architecture record with the same stem apart', () => {
    const cwd = tempRepo();
    expect(writeApproval(cwd, `docs/design/ui/${PEN}`, APPROVED).ok).toBe(true);
    expect(writeApproval(cwd, ARCH, ARCH_APPROVED).ok).toBe(true);
    expect(readBack(cwd, `docs/design/ui/${PEN}`)).toEqual(APPROVED);
    expect(readBack(cwd, ARCH)).toEqual(ARCH_APPROVED);
  });

  it('records a milestone target under architecture/milestones/, keyed by the milestone slug', () => {
    expect(approvalRelPath('docs/design/architecture/milestones/m1.pen')).toBe(
      '.noldor/design-approval/architecture/milestones/m1.json',
    );
  });

  it('parses a record bound to a milestone, and refuses a malformed binding', () => {
    const bound = { ...ARCH_APPROVED, milestone: { slug: 'm1', blob: 'f'.repeat(40) } };
    expect(parseApprovalBytes(JSON.stringify(bound))).toEqual(bound);
    expect(
      parseApprovalBytes(
        JSON.stringify({ ...ARCH_APPROVED, milestone: { slug: 'M 1', blob: 'f'.repeat(40) } }),
      ),
    ).toBeNull();
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

  it('accepts an approved record that binds its pages and its spec', () => {
    const bound = {
      ...APPROVED,
      pages: ['BASE:app: rest', 'FINAL:app: rest'],
      spec: { name: '2026-08-30-my-feature-design.md', blob: 'b'.repeat(40) },
    };
    expect(parseApprovalBytes(JSON.stringify(bound))).toEqual(bound);
  });

  it.each([
    ['a path separator the spec scheme alone would accept', '2026-08-30-a/../../x-design.md'],
    ['a backslash separator', '2026-08-30-a\\..\\x-design.md'],
    ['a dot-dot run', '2026-08-30-a..b-design.md'],
    ['a name outside the spec scheme', 'notes.md'],
  ])('rejects a spec.name with %s', (_, name) => {
    expect(
      parseApprovalBytes(JSON.stringify({ ...APPROVED, spec: { name, blob: 'b'.repeat(40) } })),
    ).toBeNull();
  });

  it('rejects a spec binding with no blob, and a page list on the waived member', () => {
    expect(
      parseApprovalBytes(
        JSON.stringify({ ...APPROVED, spec: { name: '2026-08-30-my-feature-design.md' } }),
      ),
    ).toBeNull();
    expect(
      parseApprovalBytes(
        JSON.stringify({
          outcome: 'waived',
          at: '2026-08-30T00:00:00.000Z',
          penBlob: 'a'.repeat(40),
          reason: 'r',
          pages: ['FINAL:app: rest'],
        }),
      ),
    ).toBeNull();
  });
});

describe('design-approval / path containment', () => {
  it('contains by construction: directories are stripped before the stem is slugged', () => {
    const built = writeApproval(tempRepo(), '../../etc/passwd.pen', APPROVED);
    // basename() removes the traversal; what remains is a plain stem, so the
    // record lands INSIDE .noldor/design-approval/ regardless of the input dirs.
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.path).toContain('/.noldor/design-approval/passwd.json');
  });

  it('refuses a stem that survives basename but fails the slug grammar', () => {
    // basename('...pen', '.pen') === '..' — the one dot-shape basename keeps.
    expect(writeApproval(tempRepo(), '...pen', APPROVED).ok).toBe(false);
  });

  it('derives the record rel path from the pen basename', () => {
    expect(approvalRelPath(PEN)).toBe('.noldor/design-approval/2026-08-30-my-feature.json');
  });
});

describe('design verdict CLI / architecture designs', () => {
  const archRel = `docs/design/architecture/${PEN}`;
  const ARCH_PAGES = ['BASE:modules: as-built', 'FINAL:modules: split cr'];

  function archRepo(): string {
    const cwd = gitRepo();
    mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'archive'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'architecture', PEN), penJson(ARCH_PAGES));
    return cwd;
  }
  const archArgv = (surfaces: readonly string[] = ['modules']): string[] => [
    '--pen',
    archRel,
    '--approve',
    ...surfaces.flatMap((s) => ['--surface', s]),
    '--spec',
    specRel,
    ...ARCH_PAGES.flatMap((p) => ['--editor-page', p]),
  ];

  it('writes the record under architecture/, beside a UI record of the same stem', async () => {
    const cwd = archRepo();
    expect((await run(cwd, approveArgv())).code).toBe(0);
    expect((await run(cwd, archArgv())).code).toBe(0);
    expect(readBack(cwd, archRel)).toMatchObject({
      outcome: 'approved',
      surfaces: ['modules'],
      penBlob: blobOf(cwd, archRel),
    });
    expect(readBack(cwd, penRel)).toMatchObject({ outcome: 'approved', surfaces: ['app'] });
  });

  it('refuses a surface that is not an architecture view, writing nothing', async () => {
    const cwd = archRepo();
    const r = await run(cwd, archArgv(['app']));
    expect(r.code).toBe(2);
    expect(r.err).toContain('not an architecture view');
    expect(readBack(cwd, archRel)).toBeNull();
  });

  it('refuses the architecture baseline', () => {
    const cwd = archRepo();
    writeFileSync(
      join(cwd, 'docs', 'design', 'architecture', 'baseline.pen'),
      penJson(['modules']),
    );
    expect(resolveFeaturePen(cwd, 'docs/design/architecture/baseline.pen').ok).toBe(false);
  });

  it('still finds the record after the design moves into archive/', async () => {
    const cwd = archRepo();
    expect((await run(cwd, archArgv())).code).toBe(0);
    renameSync(join(cwd, archRel), join(cwd, 'docs', 'design', 'architecture', 'archive', PEN));
    const r = await run(cwd, ['--pen', `docs/design/architecture/archive/${PEN}`, '--check']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('current');
  });
});

describe('design verdict CLI / milestone targets', () => {
  const target = 'docs/design/architecture/milestones/m1.pen';
  const PAGES_M = ['BASE:modules: as-built', 'FINAL:modules: split cr'];

  function milestoneRepo(): string {
    const cwd = gitRepo();
    mkdirSync(join(cwd, 'docs', 'design', 'architecture', 'milestones'), { recursive: true });
    mkdirSync(join(cwd, 'docs', 'milestones'), { recursive: true });
    writeFileSync(join(cwd, target), penJson(PAGES_M));
    writeFileSync(
      join(cwd, 'docs', 'milestones', 'm1.md'),
      '---\nname: m1\nstatus: draft\n---\n\n## Gate\n\nShip it.\n',
    );
    return cwd;
  }
  const argv = (bind: string[]): string[] => [
    '--pen',
    target,
    '--approve',
    '--surface',
    'modules',
    ...bind,
    ...PAGES_M.flatMap((p) => ['--editor-page', p]),
  ];

  it('approves a milestone target against its milestone file', async () => {
    const cwd = milestoneRepo();
    expect((await run(cwd, argv(['--milestone', 'm1']))).code).toBe(0);
    expect(readBack(cwd, target)).toMatchObject({
      outcome: 'approved',
      surfaces: ['modules'],
      milestone: { slug: 'm1', blob: blobOf(cwd, 'docs/milestones/m1.md') },
    });
  });

  it('refuses the wrong binding, a foreign slug, a feature design, a missing milestone file, and both flags', async () => {
    const cwd = milestoneRepo();
    const wrong = await run(cwd, argv(['--spec', specRel]));
    expect([wrong.code, wrong.err]).toEqual([2, expect.stringContaining('is a milestone target')]);
    writeFileSync(join(cwd, 'docs', 'milestones', 'm2.md'), '---\nname: m2\nstatus: draft\n---\n');
    const foreign = await run(cwd, argv(['--milestone', 'm2']));
    expect([foreign.code, foreign.err]).toEqual([2, expect.stringContaining('does not own')]);
    const featureArgv = approveArgv().filter(
      (a, i, all) => a !== '--spec' && all[i - 1] !== '--spec',
    );
    const feature = await run(cwd, [...featureArgv, '--milestone', 'm1']);
    expect([feature.code, feature.err]).toEqual([2, expect.stringContaining('does not own')]);
    rmSync(join(cwd, 'docs', 'milestones', 'm1.md'));
    const missing = await run(cwd, argv(['--milestone', 'm1']));
    expect([missing.code, missing.err]).toEqual([
      2,
      expect.stringContaining('no docs/milestones/m1.md'),
    ]);
    expect(parseVerdictArgs(argv(['--milestone', 'm1', '--spec', specRel])).ok).toBe(false);
  });

  it('reports drift once the milestone file changes', async () => {
    const cwd = milestoneRepo();
    await run(cwd, argv(['--milestone', 'm1']));
    expect((await run(cwd, ['--pen', target, '--check'])).code).toBe(0);
    appendFileSync(join(cwd, 'docs', 'milestones', 'm1.md'), 'A later gate.\n');
    const drift = await run(cwd, ['--pen', target, '--check']);
    expect(drift.code).toBe(1);
    expect(drift.out).toContain('docs/milestones/m1.md');
  });

  it('reconfirms a milestone target against its changed milestone file', async () => {
    const cwd = milestoneRepo();
    await run(cwd, argv(['--milestone', 'm1']));
    appendFileSync(join(cwd, 'docs', 'milestones', 'm1.md'), 'A later gate.\n');
    expect((await run(cwd, ['--pen', target, '--reconfirm'])).code).toBe(0);
    expect(readBack(cwd, target)).toMatchObject({
      milestone: { slug: 'm1', blob: blobOf(cwd, 'docs/milestones/m1.md') },
    });
    expect((await run(cwd, ['--pen', target, '--check'])).code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLI

const SPEC = '2026-08-30-my-feature-design.md';
const PAGES = ['BASE:app: rest', 'FINAL:app: rest', 'FINAL:app: empty'];
const NOW = '2026-08-30T00:00:00.000Z';

/** A spec whose `### Design coverage` table declares exactly the `FINAL:` pages of {@link PAGES}. */
const SPEC_TEXT = [
  '# My feature — Design',
  '',
  '## Design',
  '',
  '### Design coverage',
  '',
  '| Page               | Criteria | Shows             |',
  '| ------------------ | -------- | ----------------- |',
  '| `FINAL:app: rest`  | 1        | the card withheld |',
  '| `FINAL:app: empty` | 2        | an empty scene    |',
  '',
  '## Acceptance criteria',
  '',
  '1. The card is withheld.',
  '2. An empty scene reads zero.',
  '',
].join('\n');

/** A `.pen` as the editor saves it: plain JSON whose top-level children are the pages. */
function penJson(pages: readonly unknown[]): string {
  return JSON.stringify({
    version: '2.17',
    children: pages.map((name, i) => ({ id: `p${i}`, type: 'frame', name })),
    variables: {},
  });
}

function gitRepo(): string {
  const cwd = tempRepo();
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(join(cwd, 'docs', 'design', 'ui', 'baseline'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'ui', 'archive'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'specs', 'archive'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), penJson(PAGES));
  writeFileSync(join(cwd, 'docs', 'design', 'specs', SPEC), SPEC_TEXT);
  return cwd;
}

const penRel = `docs/design/ui/${PEN}`;
const specRel = `docs/design/specs/${SPEC}`;

function approveArgv(
  opts: { pages?: readonly string[]; surfaces?: readonly string[]; spec?: string } = {},
): string[] {
  return [
    '--pen',
    penRel,
    '--approve',
    ...(opts.surfaces ?? ['app']).flatMap((s) => ['--surface', s]),
    '--spec',
    opts.spec ?? specRel,
    ...(opts.pages ?? PAGES).flatMap((p) => ['--editor-page', p]),
  ];
}

function blobOf(cwd: string, rel: string): string {
  return execFileSync('git', ['hash-object', '--path', rel, '--', rel], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

/** Run the CLI and keep what it printed: the printed page list is the operator's only view. */
async function run(
  cwd: string,
  argv: string[],
  now = NOW,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err.push(a.join(' '));
  });
  try {
    const code = await verdictMain(argv, { cwd, now: () => now });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
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
    [['--pen', 'x.pen', '--approve', '--surface', 'app', '--spec', 's.md'], '--editor-page'],
    [['--pen', 'x.pen', '--approve', '--surface', 'app', '--editor-page', 'p'], 'requires --spec'],
    [['--pen', 'x.pen', '--check', '--reconfirm'], 'exactly one of'],
    [['--pen', 'x.pen', '--check', '--surface', 'app'], '--surface belongs'],
    [['--pen', 'x.pen', '--reconfirm', '--spec', 's.md'], '--spec belongs'],
    [['--pen', 'x.pen', '--waive', '--reason', 'r', '--editor-page', 'p'], '--editor-page belongs'],
    [['--pen', 'x.pen', '--coverage', '--editor-page', 'p'], '--coverage requires --spec'],
    [['--pen', 'x.pen', '--coverage', '--spec', 's.md'], '--editor-page'],
    [
      ['--pen', 'x.pen', '--coverage', '--spec', 's.md', '--editor-page', 'p', '--surface', 'app'],
      '--surface',
    ],
    [['--pen', 'x.pen', '--coverage', '--check'], 'exactly one of'],
  ])('refuses %j', (argv, message) => {
    const parsed = parseVerdictArgs(argv as string[]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it('deduplicates repeated surfaces', () => {
    const parsed = parseVerdictArgs([...approveArgv({ pages: ['p'] }), '--surface', 'app']);
    expect(parsed).toMatchObject({ ok: true, mode: { verb: 'approve', surfaces: ['app'] } });
  });

  it('keeps repeated editor pages — the page comparison counts duplicates', () => {
    const parsed = parseVerdictArgs(approveArgv({ pages: ['p', 'p'] }));
    expect(parsed).toMatchObject({ ok: true, mode: { verb: 'approve', editorPages: ['p', 'p'] } });
  });

  it('parses --coverage with the spec and the editor pages it judges', () => {
    const argv = ['--pen', 'x.pen', '--coverage', '--spec', 's.md', '--editor-page', 'p'];
    expect(parseVerdictArgs(argv)).toMatchObject({
      ok: true,
      mode: { verb: 'coverage', spec: 's.md', editorPages: ['p'] },
    });
  });

  it('parses the two read-side verbs with --pen alone', () => {
    expect(parseVerdictArgs(['--pen', 'x.pen', '--check'])).toMatchObject({
      ok: true,
      mode: { verb: 'check' },
    });
    expect(parseVerdictArgs(['--pen', 'x.pen', '--reconfirm'])).toMatchObject({
      ok: true,
      mode: { verb: 'reconfirm' },
    });
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

  it('refuses any symlinked --pen — git stages the link, the CLI would record the target', () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'outside.pen'), 'x\n');
    symlinkSync(join(cwd, 'outside.pen'), join(cwd, 'docs', 'design', 'ui', 'link.pen'));
    expect(resolveFeaturePen(cwd, 'docs/design/ui/link.pen').ok).toBe(false);
    // In-tree link to a real feature pen: same refusal — the record would be
    // written under the TARGET's stem while git stages the LINK's stem.
    symlinkSync(
      join(cwd, 'docs', 'design', 'ui', PEN),
      join(cwd, 'docs', 'design', 'ui', '2026-08-30-alias.pen'),
    );
    const r = resolveFeaturePen(cwd, 'docs/design/ui/2026-08-30-alias.pen');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('symlink');
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
    const { code } = await run(cwd, approveArgv());
    expect(code).toBe(0);
    const record = JSON.parse(
      readFileSync(join(cwd, '.noldor', 'design-approval', '2026-08-30-my-feature.json'), 'utf8'),
    ) as DesignApprovalRecord;
    expect(record).toMatchObject({
      outcome: 'approved',
      penBlob: blobOf(cwd, penRel),
      surfaces: ['app'],
    });
  });

  it('writes a waived record with its reason', async () => {
    const cwd = gitRepo();
    const { code } = await run(cwd, ['--pen', penRel, '--waive', '--reason', 'bridge down']);
    expect(code).toBe(0);
    expect(readBack(cwd, PEN)).toMatchObject({ outcome: 'waived', reason: 'bridge down' });
  });

  it('records the reservation on approve-with-reservations', async () => {
    const cwd = gitRepo();
    await run(cwd, [...approveArgv(), '--reservation', 'spacing']);
    expect(readBack(cwd, PEN)).toMatchObject({ reservation: 'spacing' });
  });

  it('exits 2 writing nothing on an unkeyable filename', async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'docs', 'design', 'ui', 'undated.pen'), penJson(PAGES));
    const argv = approveArgv().map((a) => (a === penRel ? 'docs/design/ui/undated.pen' : a));
    expect((await run(cwd, argv)).code).toBe(2);
    expect(readBack(cwd, 'undated.pen')).toBeNull();
  });

  it('exits 2 on a missing file', async () => {
    const cwd = gitRepo();
    const argv = approveArgv().map((a) =>
      a === penRel ? 'docs/design/ui/2026-08-30-nope.pen' : a,
    );
    expect((await run(cwd, argv)).code).toBe(2);
  });
});

describe('design verdict CLI / the page read', () => {
  it('signs the pages it read, in file order, from the very bytes it hashed', async () => {
    const cwd = gitRepo();
    const { code, out } = await run(cwd, approveArgv({ pages: PAGES.toReversed() }));
    expect(code).toBe(0);
    expect(readBack(cwd, PEN)).toMatchObject({ pages: PAGES, penBlob: blobOf(cwd, penRel) });
    for (const page of PAGES) expect(out).toContain(page);
  });

  it('refuses, writing nothing, when the editor holds a page the file on disk lacks', async () => {
    const cwd = gitRepo();
    const { code, err } = await run(cwd, approveArgv({ pages: [...PAGES, 'FINAL:app: focus'] }));
    expect(code).toBe(1);
    expect(readBack(cwd, PEN)).toBeNull();
    expect(err).toContain('FINAL:app: focus');
  });

  it('refuses when the file on disk holds a page the editor does not show', async () => {
    const cwd = gitRepo();
    const { code, err } = await run(cwd, approveArgv({ pages: PAGES.slice(0, 2) }));
    expect(code).toBe(1);
    expect(readBack(cwd, PEN)).toBeNull();
    expect(err).toContain('FINAL:app: empty');
  });

  it('counts duplicates: a page drawn twice must be reported twice', async () => {
    const cwd = gitRepo();
    writeFileSync(
      join(cwd, 'docs', 'design', 'ui', PEN),
      penJson(['FINAL:app: rest', 'FINAL:app: rest']),
    );
    const { code } = await run(cwd, approveArgv({ pages: ['FINAL:app: rest'] }));
    expect(code).toBe(1);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it.each([
    ['is not JSON', 'PEN-BYTES\n'],
    ['has no children array', JSON.stringify({ version: '2.17', variables: {} })],
    ['holds a page with no name', penJson([undefined])],
    ['holds a page with a blank name', penJson(['  '])],
    ['holds a page whose name argv cannot carry', penJson(['--flag-shaped'])],
  ])('exits 2, writing nothing, on a .pen that %s', async (_, bytes) => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), bytes);
    expect((await run(cwd, approveArgv({ pages: ['FINAL:app: rest'] }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });
});

describe('design verdict CLI / surfaces against FINAL pages', () => {
  it('refuses a --surface that owns no FINAL page in the file', async () => {
    const cwd = gitRepo();
    expect((await run(cwd, approveArgv({ surfaces: ['app', 'settings'] }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it('refuses a FINAL page for a surface --surface does not name', async () => {
    const cwd = gitRepo();
    const pages = [...PAGES, 'FINAL:settings: rest'];
    writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), penJson(pages));
    expect((await run(cwd, approveArgv({ pages }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it('refuses a FINAL page that names no surface', async () => {
    const cwd = gitRepo();
    const pages = [...PAGES, 'FINAL:app'];
    writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), penJson(pages));
    expect((await run(cwd, approveArgv({ pages }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });
});

describe('design verdict CLI / spec binding', () => {
  it('binds the spec by name and blob, and keeps that text in the object store', async () => {
    const cwd = gitRepo();
    const { code, out } = await run(cwd, approveArgv());
    expect(code).toBe(0);
    const record = readBack(cwd, PEN);
    expect(record).toMatchObject({ spec: { name: SPEC, blob: blobOf(cwd, specRel) } });
    const blob = record?.outcome === 'approved' ? (record.spec?.blob ?? '') : '';
    expect(() => execFileSync('git', ['cat-file', '-e', blob], { cwd })).not.toThrow();
    expect(out).toContain(SPEC);
  });

  it('accepts a spec already moved to archive/', async () => {
    const cwd = gitRepo();
    renameSync(join(cwd, specRel), join(cwd, 'docs', 'design', 'specs', 'archive', SPEC));
    const { code } = await run(cwd, approveArgv({ spec: `docs/design/specs/archive/${SPEC}` }));
    expect(code).toBe(0);
    expect(readBack(cwd, PEN)).toMatchObject({ spec: { name: SPEC } });
  });

  it.each([
    ['a spec in a nested directory', 'docs/design/specs/sub'],
    ['a spec outside the specs root', 'docs'],
  ])('exits 2 on %s — no later reader would find it', async (_, dir) => {
    const cwd = gitRepo();
    mkdirSync(join(cwd, dir), { recursive: true });
    writeFileSync(join(cwd, dir, SPEC), '# Spec\n');
    expect((await run(cwd, approveArgv({ spec: `${dir}/${SPEC}` }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it('exits 2 on a symlinked spec — git stores the link, not the text it points at', async () => {
    const cwd = gitRepo();
    const link = '2026-08-30-my-feature-alias-design.md';
    symlinkSync(join(cwd, specRel), join(cwd, 'docs', 'design', 'specs', link));
    expect((await run(cwd, approveArgv({ spec: `docs/design/specs/${link}` }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it("exits 2 on another feature's spec", async () => {
    const cwd = gitRepo();
    const other = '2026-08-30-other-feature-design.md';
    writeFileSync(join(cwd, 'docs', 'design', 'specs', other), '# Other\n');
    expect((await run(cwd, approveArgv({ spec: `docs/design/specs/${other}` }))).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });

  it('exits 2 on a spec that does not exist', async () => {
    const cwd = gitRepo();
    rmSync(join(cwd, specRel));
    expect((await run(cwd, approveArgv())).code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
  });
});

describe('design verdict CLI / --check', () => {
  const check = ['--pen', penRel, '--check'];

  it('exits 0 while the spec is still the one the design was approved against', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    expect((await run(cwd, check)).code).toBe(0);
  });

  it('exits 1 and prints the change once the spec moves under the design', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    appendFileSync(join(cwd, specRel), 'The card detaches and hangs below the readout.\n');
    const { code, out } = await run(cwd, check);
    expect(code).toBe(1);
    expect(out).toContain('+The card detaches and hangs below the readout.');
  });

  it('follows the spec into archive/', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    renameSync(join(cwd, specRel), join(cwd, 'docs', 'design', 'specs', 'archive', SPEC));
    expect((await run(cwd, check)).code).toBe(0);
  });

  it('exits 0 for a waived record — nothing was ratified, so nothing can drift', async () => {
    const cwd = gitRepo();
    await run(cwd, ['--pen', penRel, '--waive', '--reason', 'bridge down']);
    expect((await run(cwd, check)).code).toBe(0);
  });

  it('exits 1 without a diff when the approval-time text is not in this clone', async () => {
    const cwd = gitRepo();
    const absent = 'c'.repeat(40);
    writeApproval(cwd, PEN, { ...APPROVED, spec: { name: SPEC, blob: absent } });
    const { code, out } = await run(cwd, check);
    expect(code).toBe(1);
    expect(out).toContain(absent.slice(0, 12));
    expect(out).not.toContain('@@');
  });

  /**
   * Run `--check` over a drifted spec with a `git` on PATH whose `git diff` runs
   * `diffBody` instead, passing everything else to the real binary — the
   * subprocess edge, faked at the edge.
   */
  async function checkWithFakeDiff(diffBody: string): Promise<{ code: number; out: string }> {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    appendFileSync(join(cwd, specRel), 'A change.\n');
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const bin = join(tempRepo(), 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nif [ "$1" = diff ]; then ${diffBody}; fi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath ?? ''}`;
    try {
      return await run(cwd, check);
    } finally {
      process.env.PATH = savedPath;
    }
  }

  it('names a failed diff as a failed diff, not as missing text', async () => {
    const { code, out } = await checkWithFakeDiff('echo diff-broke >&2; exit 2');
    expect(code).toBe(1);
    expect(out).toContain('diff-broke');
    expect(out).not.toContain('object store');
  });

  it('names the signal that killed the diff, not a null exit status', async () => {
    const { code, out } = await checkWithFakeDiff('kill -KILL $$');
    expect(code).toBe(1);
    expect(out).toContain('git diff was killed by SIGKILL');
    expect(out).not.toContain('exited null');
  });

  it('reports a scratch dir it cannot make as a failed diff, not a crash', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    appendFileSync(join(cwd, specRel), 'A change.\n');
    // os.tmpdir() reads TMPDIR on every call, so a missing one fails mkdtempSync.
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = join(cwd, 'no-such-tmp');
    try {
      const { code, out } = await run(cwd, check);
      expect(code).toBe(1);
      expect(out).toContain('could not diff the spec');
      expect(out).toContain('ENOENT');
    } finally {
      process.env.TMPDIR = savedTmp;
    }
  });

  it('reports a record it cannot read as a read failure, not as no record', async () => {
    const cwd = gitRepo();
    mkdirSync(join(cwd, '.noldor', 'design-approval', '2026-08-30-my-feature.json'), {
      recursive: true,
    });
    const { code, err } = await run(cwd, check);
    expect(code).toBe(2);
    expect(err).toContain('EISDIR');
  });

  // Root reads through a mode-000 directory, so the arrangement proves nothing there.
  it.skipIf(process.getuid?.() === 0)(
    'reports a record under an unreadable directory as a read failure, not as no record',
    async () => {
      const cwd = gitRepo();
      await run(cwd, approveArgv());
      const dir = join(cwd, '.noldor', 'design-approval');
      chmodSync(dir, 0o000);
      try {
        const { code, err } = await run(cwd, check);
        expect(code).toBe(2);
        expect(err).toContain('cannot read the record');
        expect(err).toContain('EACCES');
      } finally {
        chmodSync(dir, 0o755);
      }
    },
  );

  it.each([
    ['there is no record', (_cwd: string) => {}],
    ['the record predates spec binding', (cwd: string) => writeApproval(cwd, PEN, APPROVED)],
    [
      'the named spec is gone',
      (cwd: string) => {
        writeApproval(cwd, PEN, { ...APPROVED, spec: { name: SPEC, blob: 'd'.repeat(40) } });
        rmSync(join(cwd, specRel));
      },
    ],
  ])('exits 2 when %s — the approval cannot be checked', async (_, arrange) => {
    const cwd = gitRepo();
    arrange(cwd);
    expect((await run(cwd, check)).code).toBe(2);
  });
});

describe('design verdict CLI / --reconfirm', () => {
  const reconfirm = ['--pen', penRel, '--reconfirm'];

  it('rebinds the changed spec and leaves every other field as it was', async () => {
    const cwd = gitRepo();
    await run(cwd, [...approveArgv(), '--reservation', 'spacing']);
    const before = readBack(cwd, PEN);
    appendFileSync(join(cwd, specRel), 'A wording fix.\n');
    const { code } = await run(cwd, reconfirm, '2026-08-31T00:00:00.000Z');
    expect(code).toBe(0);
    expect(readBack(cwd, PEN)).toEqual({
      ...before,
      at: '2026-08-31T00:00:00.000Z',
      spec: { name: SPEC, blob: blobOf(cwd, specRel) },
    });
    expect((await run(cwd, ['--pen', penRel, '--check'])).code).toBe(0);
  });

  it('refuses, changing nothing, once the design itself has changed', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    const before = readBack(cwd, PEN);
    writeFileSync(join(cwd, 'docs', 'design', 'ui', PEN), penJson([...PAGES, 'FINAL:app: new']));
    appendFileSync(join(cwd, specRel), 'A new state.\n');
    expect((await run(cwd, reconfirm)).code).toBe(2);
    expect(readBack(cwd, PEN)).toEqual(before);
  });

  it.each([
    [
      'a waived record',
      async (cwd: string) => run(cwd, ['--pen', penRel, '--waive', '--reason', 'bridge down']),
    ],
    ['a record that names no spec', async (cwd: string) => writeApproval(cwd, PEN, APPROVED)],
  ])('refuses %s, changing nothing', async (_, arrange) => {
    const cwd = gitRepo();
    await arrange(cwd);
    const before = readBack(cwd, PEN);
    expect((await run(cwd, reconfirm)).code).toBe(2);
    expect(readBack(cwd, PEN)).toEqual(before);
  });
});

describe('design verdict CLI / --approve holds the design to the coverage table', () => {
  const writeSpec = (cwd: string, text: string): void => {
    writeFileSync(join(cwd, specRel), text);
  };

  it.each([
    [
      'the spec has no Design coverage table',
      '# Spec\n\n## Acceptance criteria\n\n1. The card is withheld.\n',
      'no-coverage-table',
    ],
    [
      'the spec has no acceptance criteria',
      SPEC_TEXT.replace(/## Acceptance criteria[\s\S]*$/, ''),
      'no-criteria',
    ],
    ['a criterion is on no row', `${SPEC_TEXT}3. One cut, not two.\n`, 'unaccounted-criterion'],
    [
      'a row is malformed',
      SPEC_TEXT.replace('| `FINAL:app: rest`  |', '| FINAL:app: rest    |'),
      'malformed-row',
    ],
    [
      'the criteria skip a number',
      SPEC_TEXT.replace('2. An empty', '3. An empty'),
      'misnumbered-criteria',
    ],
  ])('exits 2, writing nothing, when %s', async (_, text, code) => {
    const cwd = gitRepo();
    writeSpec(cwd, text);
    const r = await run(cwd, approveArgv());
    expect(r.code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
    expect(r.err).toContain(code);
  });

  it('names the declared page the design lacks and the FINAL page nobody declared', async () => {
    const cwd = gitRepo();
    const pages = ['BASE:app: rest', 'FINAL:app: rest', 'FINAL:app: focus'];
    writeFileSync(join(cwd, penRel), penJson(pages));
    const r = await run(cwd, approveArgv({ pages }));
    expect(r.code).toBe(2);
    expect(readBack(cwd, PEN)).toBeNull();
    expect(r.err).toContain('FINAL:app: empty');
    expect(r.err).toContain('FINAL:app: focus');
  });

  it('approves one surface with three FINAL pages once the table declares all three', async () => {
    const cwd = gitRepo();
    const pages = [...PAGES, 'FINAL:app: error'];
    writeFileSync(join(cwd, penRel), penJson(pages));
    expect((await run(cwd, approveArgv({ pages }))).code).toBe(2);
    writeSpec(
      cwd,
      SPEC_TEXT.replace(
        '| `FINAL:app: empty` | 2        | an empty scene    |',
        '| `FINAL:app: empty` | 2        | an empty scene    |\n| `FINAL:app: error` | 3        | the engine failed |',
      ).replace(
        '2. An empty scene reads zero.',
        '2. An empty scene reads zero.\n3. An error blanks it.',
      ),
    );
    expect((await run(cwd, approveArgv({ pages }))).code).toBe(0);
    expect(readBack(cwd, PEN)).toMatchObject({ outcome: 'approved', pages });
  });

  it('does not check a waiver, nor an architecture design, against the table', async () => {
    const cwd = gitRepo();
    writeSpec(cwd, '# Spec\n\nNo table, no criteria.\n');
    expect((await run(cwd, approveArgv())).code).toBe(2);
    expect((await run(cwd, ['--pen', penRel, '--waive', '--reason', 'bridge down'])).code).toBe(0);
    const archRel = `docs/design/architecture/${PEN}`;
    const archPages = ['BASE:modules: as-built', 'FINAL:modules: split cr'];
    mkdirSync(join(cwd, 'docs', 'design', 'architecture'), { recursive: true });
    writeFileSync(join(cwd, archRel), penJson(archPages));
    const archArgv = [
      '--pen',
      archRel,
      '--approve',
      '--surface',
      'modules',
      '--spec',
      specRel,
      ...archPages.flatMap((p) => ['--editor-page', p]),
    ];
    expect((await run(cwd, archArgv)).code).toBe(0);
  });
});

describe('design verdict CLI / --reconfirm holds the changed spec to the approved pages', () => {
  const reconfirm = ['--pen', penRel, '--reconfirm'];

  it('exits 2, changing nothing, when the changed spec gains a criterion no row accounts for', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    const before = readBack(cwd, PEN);
    appendFileSync(join(cwd, specRel), '3. One cut, not two.\n');
    const r = await run(cwd, reconfirm);
    expect(r.code).toBe(2);
    expect(readBack(cwd, PEN)).toEqual(before);
    expect(r.err).toContain('unaccounted-criterion');
    expect(r.err).toContain('Design coverage');
  });

  it('reads the pages from the unchanged .pen, so a record written before pages existed reconfirms', async () => {
    const cwd = gitRepo();
    writeApproval(cwd, PEN, {
      ...APPROVED,
      penBlob: blobOf(cwd, penRel),
      spec: { name: SPEC, blob: 'e'.repeat(40) },
    });
    appendFileSync(join(cwd, specRel), 'A wording fix.\n');
    expect((await run(cwd, reconfirm)).code).toBe(0);
    expect(readBack(cwd, PEN)).toMatchObject({ spec: { name: SPEC, blob: blobOf(cwd, specRel) } });
    appendFileSync(join(cwd, specRel), '\n3. One cut, not two.\n');
    expect((await run(cwd, reconfirm)).code).toBe(2);
  });
});

describe('design verdict CLI / --coverage', () => {
  const coverageArgv = (pages: readonly string[], spec = specRel): string[] => [
    '--pen',
    penRel,
    '--coverage',
    '--spec',
    spec,
    ...pages.flatMap((p) => ['--editor-page', p]),
  ];
  const recordPath = (cwd: string): string => join(cwd, approvalRelPath(PEN));

  it('exits 0 on a covered design and writes nothing', async () => {
    const cwd = gitRepo();
    expect((await run(cwd, coverageArgv(PAGES))).code).toBe(0);
    expect(existsSync(recordPath(cwd))).toBe(false);
  });

  it('exits 1 listing every gap, and writes nothing', async () => {
    const cwd = gitRepo();
    const r = await run(cwd, coverageArgv(['FINAL:app: rest', 'FINAL:app: focus']));
    expect(r.code).toBe(1);
    expect(r.out).toContain('FINAL:app: empty');
    expect(r.out).toContain('FINAL:app: focus');
    expect(existsSync(recordPath(cwd))).toBe(false);
  });

  it('judges the page names it is given, not the file on disk — the editor may not have saved', async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, penRel), penJson(['FINAL:app: rest']));
    expect((await run(cwd, coverageArgv(PAGES))).code).toBe(0);
    writeFileSync(join(cwd, penRel), penJson(PAGES));
    expect((await run(cwd, coverageArgv(['FINAL:app: rest']))).code).toBe(1);
  });

  it('exits 2 on an architecture design and on another feature’s spec', async () => {
    const cwd = gitRepo();
    const archRel = `docs/design/architecture/${PEN}`;
    mkdirSync(join(cwd, 'docs', 'design', 'architecture'), { recursive: true });
    writeFileSync(join(cwd, archRel), penJson(['FINAL:modules: split cr']));
    const arch = ['--pen', archRel, '--coverage', '--spec', specRel, '--editor-page', 'p'];
    const archRun = await run(cwd, arch);
    expect(archRun.code).toBe(2);
    expect(archRun.err).toContain('architecture');
    const other = '2026-08-30-other-feature-design.md';
    writeFileSync(join(cwd, 'docs', 'design', 'specs', other), SPEC_TEXT);
    const otherRun = await run(cwd, coverageArgv(PAGES, `docs/design/specs/${other}`));
    expect(otherRun.code).toBe(2);
    expect(otherRun.err).toContain("is for 'other-feature'");
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
