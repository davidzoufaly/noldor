// @tests: pendev-ui-design-phase

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
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

// ---------------------------------------------------------------------------
// CLI

const SPEC = '2026-08-30-my-feature-design.md';
const PAGES = ['BASE:app: rest', 'FINAL:app: rest', 'FINAL:app: empty'];
const NOW = '2026-08-30T00:00:00.000Z';

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
  writeFileSync(join(cwd, 'docs', 'design', 'specs', SPEC), '# Spec\n\nThe card is withheld.\n');
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

  it('names a failed diff as a failed diff, not as missing text', async () => {
    const cwd = gitRepo();
    await run(cwd, approveArgv());
    appendFileSync(join(cwd, specRel), 'A change.\n');
    // A `git` on PATH that fails only `git diff`, passing everything else to
    // the real binary — the subprocess edge, faked at the edge.
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const bin = join(tempRepo(), 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nif [ "$1" = diff ]; then echo diff-broke >&2; exit 2; fi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath ?? ''}`;
    try {
      const { code, out } = await run(cwd, check);
      expect(code).toBe(1);
      expect(out).toContain('diff-broke');
      expect(out).not.toContain('object store');
    } finally {
      process.env.PATH = savedPath;
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
