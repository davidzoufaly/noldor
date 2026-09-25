// @tests: cr-re-round-cap-enforcement-and-oscillation-detector, unvalidated-slug-path-traversal-across-cli-entry-points
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Slug } from '../../core/slug.js';
import {
  captureCitations,
  decisionsPath,
  gitTreeReader,
  readDecisions,
  settledTrailerValue,
  stillHolds,
  updateDecisions,
  upsertDecision,
} from '../decisions.js';
import type { Decision } from '../decisions.js';
import type { Finding } from '../findings-schema.js';

const SLUG = 'x' as Slug;
const SESSION = '2026-09-23T12:00:00.000Z';

let cwd: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitFile(path: string, text: string): string {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
  git('add', '-A');
  git('commit', '-q', '-m', `write ${path}`, '--no-verify');
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'decisions-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  file: 'docs/x.md',
  severity: 'high',
  message: 'the fallback hides a failure',
  ...over,
});

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: 'id-1',
  finding: finding(),
  lanes: ['reviewer'],
  disposition: 'rejected',
  reason: 'intentional',
  round: 1,
  ...over,
});

function writeStore(body: unknown): void {
  const path = decisionsPath(cwd, SLUG, 'code');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

describe('readDecisions / updateDecisions — session scoping', () => {
  it('reads nothing when no store exists', async () => {
    expect(await readDecisions(cwd, SLUG, 'code', SESSION)).toEqual({ ok: true, decisions: [] });
  });

  it('writes a decision and reads it back in the same session', async () => {
    const w = await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision()),
    );
    expect(w.ok).toBe(true);
    expect(await readDecisions(cwd, SLUG, 'code', SESSION)).toEqual({
      ok: true,
      decisions: [decision()],
    });
  });

  it('reads nothing from a store another session wrote, and the first write replaces it', async () => {
    writeStore({
      version: 1,
      slug: 'x',
      kind: 'code',
      sessionStartedAt: 'older',
      decisions: [decision()],
    });
    expect(await readDecisions(cwd, SLUG, 'code', SESSION)).toEqual({ ok: true, decisions: [] });
    await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision({ id: 'id-2' })),
    );
    const stored = JSON.parse(readFileSync(decisionsPath(cwd, SLUG, 'code'), 'utf8'));
    expect(stored.sessionStartedAt).toBe(SESSION);
    expect(stored.decisions.map((d: Decision) => d.id)).toEqual(['id-2']);
  });

  it('with no session, reads nothing and writes nothing, even over a store written under the empty key', async () => {
    writeStore({
      version: 1,
      slug: 'x',
      kind: 'code',
      sessionStartedAt: '',
      decisions: [decision()],
    });
    expect(await readDecisions(cwd, SLUG, 'code', '')).toEqual({ ok: true, decisions: [] });
    rmSync(decisionsPath(cwd, SLUG, 'code'));
    const w = await updateDecisions(cwd, SLUG, 'code', '', (cur) =>
      upsertDecision(cur, decision()),
    );
    expect(w.ok).toBe(false);
    expect(existsSync(decisionsPath(cwd, SLUG, 'code'))).toBe(false);
  });

  it('reports a store it cannot parse, and refuses to overwrite it', async () => {
    writeStore('{not json');
    const r = await readDecisions(cwd, SLUG, 'code', SESSION);
    expect(r.ok).toBe(false);
    const w = await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision()),
    );
    expect(w.ok).toBe(false);
    expect(readFileSync(decisionsPath(cwd, SLUG, 'code'), 'utf8')).toBe('{not json');
  });

  it('reads a store carrying a key this version does not know as unusable, and never rewrites it', async () => {
    const newer = JSON.stringify({
      version: 1,
      slug: 'x',
      kind: 'code',
      sessionStartedAt: SESSION,
      decisions: [{ ...decision(), addedLater: 'kept by a newer version' }],
    });
    writeStore(newer);
    expect((await readDecisions(cwd, SLUG, 'code', SESSION)).ok).toBe(false);
    const w = await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision({ id: 'id-2' })),
    );
    expect(w.ok).toBe(false);
    expect(readFileSync(decisionsPath(cwd, SLUG, 'code'), 'utf8')).toBe(newer);
  });

  it.each([
    ['in the stored finding', { finding: { ...finding(), addedLater: 'x' } }],
    [
      'in a stored finding location',
      { finding: finding({ locations: [{ file: 'a.ts', line: 1, col: 3 } as never] }) },
    ],
    ['in a citation', { cites: [{ file: 'a.ts', line: 1, text: 't', hash: 'h' } as never] }],
  ])('reads a store with an unknown key %s as unusable', async (_where, over) => {
    writeStore({
      version: 1,
      slug: 'x',
      kind: 'code',
      sessionStartedAt: SESSION,
      decisions: [{ ...decision(), ...over }],
    });
    expect((await readDecisions(cwd, SLUG, 'code', SESSION)).ok).toBe(false);
  });

  it('re-reads before writing, so an earlier write in the session survives a later one', async () => {
    await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision({ id: 'a' })),
    );
    await updateDecisions(cwd, SLUG, 'code', SESSION, (cur) =>
      upsertDecision(cur, decision({ id: 'b' })),
    );
    const r = await readDecisions(cwd, SLUG, 'code', SESSION);
    expect(r.ok && r.decisions.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('upsertDecision', () => {
  it('replaces the decision for the same id and keeps the others', () => {
    const out = upsertDecision(
      [decision({ id: 'a' }), decision({ id: 'b' })],
      decision({ id: 'a', disposition: 'accepted', reason: 'changed my mind' }),
    );
    expect(out.map((d) => [d.id, d.disposition])).toEqual([
      ['b', 'rejected'],
      ['a', 'accepted'],
    ]);
  });
});

describe('captureCitations', () => {
  const FILE = 'line 1\nline 2\nline 3\nline 4\n';

  it('stores the text of each cited span, from locations or from a codex file and line', async () => {
    const head = commitFile('src/a.ts', FILE);
    const read = gitTreeReader(cwd);
    const reviewer = finding({ locations: [{ file: 'src/a.ts', line: 2, endLine: 3 }] });
    const codex = finding({ file: 'src/a.ts', line: 4 });
    expect(await captureCitations(reviewer, head, read)).toEqual({
      ok: true,
      cites: [{ file: 'src/a.ts', line: 2, endLine: 3, text: 'line 2\nline 3' }],
    });
    expect(await captureCitations(codex, head, read)).toEqual({
      ok: true,
      cites: [{ file: 'src/a.ts', line: 4, text: 'line 4' }],
    });
  });

  it.each([
    ['a location with no line', { locations: [{ file: 'src/a.ts' }] }],
    ['a file the head does not have', { file: 'src/gone.ts', line: 1 }],
    ['an absolute path', { file: '/etc/hosts', line: 1 }],
    ['a path that climbs out of the tree', { file: '../outside.ts', line: 1 }],
    ['a finding with no location at all', {}],
    ['a span past the end of the file', { file: 'src/a.ts', line: 40 }],
  ])('adds no citation for %s', async (_shape, over) => {
    const head = commitFile('src/a.ts', FILE);
    expect(await captureCitations(finding(over), head, gitTreeReader(cwd))).toEqual({
      ok: true,
      cites: [],
    });
  });

  it('keeps the citable locations when another location of the same finding is not', async () => {
    const head = commitFile('src/a.ts', FILE);
    const f = finding({
      locations: [
        { file: 'src/a.ts' },
        { file: 'src/gone.ts', line: 1 },
        { file: 'src/a.ts', line: 1 },
      ],
    });
    expect(await captureCitations(f, head, gitTreeReader(cwd))).toEqual({
      ok: true,
      cites: [{ file: 'src/a.ts', line: 1, text: 'line 1' }],
    });
  });

  it('reports a head git cannot read', async () => {
    commitFile('src/a.ts', FILE);
    const r = await captureCitations(
      finding({ file: 'src/a.ts', line: 1 }),
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      gitTreeReader(cwd),
    );
    expect(r.ok).toBe(false);
  });
});

describe('stillHolds', () => {
  const cited = (cites: Decision['cites']): Decision => decision({ cites });

  it('holds while the cited text is still in its file, even after lines shift above it', async () => {
    commitFile('src/a.ts', 'a\nb\nc\n');
    const moved = commitFile('src/a.ts', 'new line\na\nb\nc\n');
    const d = cited([{ file: 'src/a.ts', line: 2, endLine: 3, text: 'b\nc' }]);
    expect(await stillHolds(d, moved, gitTreeReader(cwd))).toBe(true);
  });

  it('no longer holds once a cited line gains text, although the old text is still inside it', async () => {
    commitFile('src/a.ts', 'a\nline 2\nc\n');
    const d = cited([{ file: 'src/a.ts', line: 2, text: 'line 2' }]);
    const grown = commitFile('src/a.ts', 'a\nline 2 — edited\nc\n');
    expect(await stillHolds(d, grown, gitTreeReader(cwd))).toBe(false);
  });

  it('holds for a cited line that is the first or the last line of the file', async () => {
    const head = commitFile('src/a.ts', 'first\nmiddle\nlast');
    const read = gitTreeReader(cwd);
    expect(
      await stillHolds(cited([{ file: 'src/a.ts', line: 1, text: 'first' }]), head, read),
    ).toBe(true);
    expect(await stillHolds(cited([{ file: 'src/a.ts', line: 3, text: 'last' }]), head, read)).toBe(
      true,
    );
  });

  it('no longer holds once the cited text is edited, or its file is deleted', async () => {
    commitFile('src/a.ts', 'a\nb\nc\n');
    const d = cited([{ file: 'src/a.ts', line: 2, text: 'b' }]);
    const edited = commitFile('src/a.ts', 'a\nB\nc\n');
    expect(await stillHolds(d, edited, gitTreeReader(cwd))).toBe(false);
    git('rm', '-q', 'src/a.ts');
    git('commit', '-q', '-m', 'rm', '--no-verify');
    expect(await stillHolds(d, git('rev-parse', 'HEAD'), gitTreeReader(cwd))).toBe(false);
  });

  it('holds for the series when the ruling cites nothing', async () => {
    const head = commitFile('src/a.ts', 'a\n');
    expect(await stillHolds(cited(undefined), head, gitTreeReader(cwd))).toBe(true);
    expect(await stillHolds(cited([]), head, gitTreeReader(cwd))).toBe(true);
  });

  it('does not hold when git cannot read the head, so nothing is suppressed', async () => {
    commitFile('src/a.ts', 'a\nb\n');
    const d = cited([{ file: 'src/a.ts', line: 1, text: 'a' }]);
    expect(
      await stillHolds(d, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', gitTreeReader(cwd)),
    ).toBe(false);
  });
});

describe('settledTrailerValue', () => {
  it('names the kind, the disposition, the id prefix and the note on one line', () => {
    const d = decision({
      id: '1a2b3c4d5e6f7a8b9c0d',
      reason: 'the fallback is intentional;\n  see the cut marker',
    });
    expect(settledTrailerValue('code', d)).toBe(
      'code rejected 1a2b3c4d5e6f — the fallback is intentional; see the cut marker',
    );
  });

  it('cuts the note to 120 characters and leaves out an empty one', () => {
    const long = settledTrailerValue(
      'spec',
      decision({ id: 'abcdef0123456789', reason: 'n'.repeat(200) }),
    );
    expect(long).toBe(`spec rejected abcdef012345 — ${'n'.repeat(120)}`);
    expect(settledTrailerValue('plan', decision({ id: 'abcdef0123456789', reason: '  ' }))).toBe(
      'plan rejected abcdef012345',
    );
  });
});
