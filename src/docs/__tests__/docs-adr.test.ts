// @tests: architecture-decision-record-surface
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { nextAdrNumber, parseAdrFrontmatter } from '../adr-schema.js';
import { createAdr } from '../adr-new.js';
import { checkAdr } from '../docs-adr.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'adr-test-'));
  cleanups.push(dir);
  return dir;
}

async function writeRecord(repo: string, name: string, content: string): Promise<void> {
  await mkdir(join(repo, 'docs', 'adr'), { recursive: true });
  await writeFile(join(repo, 'docs', 'adr', name), content, 'utf8');
}

const VALID = `---
status: accepted
date: 2026-08-19
---

# A Decision

Body.
`;

describe('checkAdr', () => {
  it('reports absent for a missing folder and for one with no records', async () => {
    const repo = await makeRepo();
    expect((await checkAdr(repo)).status).toBe('absent');

    await writeRecord(repo, 'README.md', '# notes\n');
    // A stray README is not a record, so the repo has not opted in (AC5).
    expect((await checkAdr(repo)).status).toBe('absent');
  });

  it('flags a non-conforming filename once a record exists', async () => {
    const repo = await makeRepo();
    await writeRecord(repo, '0001-first.md', VALID);
    await writeRecord(repo, 'notes.md', '# notes\n');
    const report = await checkAdr(repo);
    expect(report.status).toBe('invalid');
    expect(report.findings[0]?.rule).toBe('bad-filename');
  });

  it('passes a valid folder', async () => {
    const repo = await makeRepo();
    await writeRecord(repo, '0001-first.md', VALID);
    const report = await checkAdr(repo);
    expect(report.status).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('flags duplicate numbers on both records', async () => {
    const repo = await makeRepo();
    await writeRecord(repo, '0001-first.md', VALID);
    await writeRecord(repo, '0001-second.md', VALID);
    const report = await checkAdr(repo);
    expect(report.findings.filter((f) => f.rule === 'dup-number')).toHaveLength(2);
  });

  it('flags bad frontmatter, bad status and bad date', async () => {
    const repo = await makeRepo();
    await writeRecord(repo, '0001-a.md', '---\nstatus: [\n---\nbody\n');
    await writeRecord(repo, '0002-b.md', '---\nstatus: rejected\ndate: 2026-08-19\n---\n');
    await writeRecord(repo, '0003-c.md', '---\nstatus: accepted\ndate: 2026-02-31\n---\n');
    const report = await checkAdr(repo);
    expect(report.status).toBe('invalid');
    expect(report.findings.map((f) => f.rule)).toEqual([
      'bad-frontmatter',
      'bad-frontmatter',
      'bad-frontmatter',
    ]);
  });

  it('enforces the supersede chain in both directions', async () => {
    const repo = await makeRepo();
    // superseded with no pointer
    await writeRecord(repo, '0001-a.md', '---\nstatus: superseded\ndate: 2026-01-01\n---\nx\n');
    // accepted carrying a stray pointer
    await writeRecord(
      repo,
      '0002-b.md',
      "---\nstatus: accepted\ndate: 2026-01-01\nsuperseded-by: '0001'\n---\nx\n",
    );
    // pointer at a number that does not exist
    await writeRecord(
      repo,
      '0003-c.md',
      "---\nstatus: superseded\ndate: 2026-01-01\nsuperseded-by: '0099'\n---\nx\n",
    );
    // supersedes a record that is not superseded
    await writeRecord(
      repo,
      '0004-d.md',
      "---\nstatus: accepted\ndate: 2026-01-01\nsupersedes: '0002'\n---\nx\n",
    );
    const report = await checkAdr(repo);
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain('missing-superseded-by');
    expect(rules).toContain('stray-superseded-by');
    expect(rules).toContain('dangling-superseded-by');
    expect(rules).toContain('bad-supersedes');
  });

  it('accepts a complete supersede pair', async () => {
    const repo = await makeRepo();
    await writeRecord(
      repo,
      '0001-old.md',
      "---\nstatus: superseded\ndate: 2026-01-01\nsuperseded-by: '0002'\n---\nx\n",
    );
    await writeRecord(
      repo,
      '0002-new.md',
      "---\nstatus: accepted\ndate: 2026-01-02\nsupersedes: '0001'\n---\ny\n",
    );
    expect((await checkAdr(repo)).status).toBe('ok');
  });

  it('yields unreadable, not a throw, when the folder is a file', async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'adr'), 'not a directory', 'utf8');
    const report = await checkAdr(repo);
    expect(report.status).toBe('invalid');
    expect(report.findings[0]?.rule).toBe('unreadable');
  });
});

describe('adr-schema helpers', () => {
  it('mints max+1 zero-padded, ignoring non-records', () => {
    expect(nextAdrNumber([])).toBe('0001');
    expect(nextAdrNumber(['0001-a.md', '0007-b.md', 'README.md'])).toBe('0008');
  });

  it('normalizes YAML-bare numbers and dates', () => {
    const parsed = parseAdrFrontmatter(
      '---\nstatus: superseded\ndate: 2026-08-19\nsuperseded-by: 0002\n---\nx\n',
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.date).toBe('2026-08-19');
      expect(parsed.data['superseded-by']).toBe('0002');
    }
  });
});

describe('createAdr', () => {
  it('creates the folder and first record, then mints the next number', async () => {
    const repo = await makeRepo();
    const first = await createAdr({ cwd: repo, slug: 'first-call', date: '2026-08-19' });
    expect(first.success).toBe(true);
    if (first.success) expect(first.file.endsWith('0001-first-call.md')).toBe(true);

    const second = await createAdr({ cwd: repo, slug: 'second', date: '2026-08-19' });
    if (second.success) expect(second.file.endsWith('0002-second.md')).toBe(true);
    expect((await checkAdr(repo)).status).toBe('ok');
  });

  it('supersedes: flips the target, links both directions, folder stays valid', async () => {
    const repo = await makeRepo();
    await createAdr({ cwd: repo, slug: 'old-way', date: '2026-08-19' });
    const result = await createAdr({
      cwd: repo,
      slug: 'new-way',
      date: '2026-08-19',
      supersedes: '0001',
    });
    expect(result.success).toBe(true);
    const report = await checkAdr(repo);
    expect(report.status).toBe('ok');
  });

  it('refuses a missing or already-superseded target and a bad slug', async () => {
    const repo = await makeRepo();
    expect((await createAdr({ cwd: repo, slug: 'Bad Slug', date: '2026-08-19' })).success).toBe(
      false,
    );
    expect(
      (await createAdr({ cwd: repo, slug: 'x', date: '2026-08-19', supersedes: '0009' })).success,
    ).toBe(false);

    await createAdr({ cwd: repo, slug: 'old', date: '2026-08-19' });
    await createAdr({ cwd: repo, slug: 'mid', date: '2026-08-19', supersedes: '0001' });
    const again = await createAdr({ cwd: repo, slug: 'x', date: '2026-08-19', supersedes: '0001' });
    expect(again.success).toBe(false);
  });
});
