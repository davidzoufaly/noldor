import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractFdAcceptance, readFdSummary } from '../read-fd-summary.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fd-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FD = `---
name: foo
phase: in-progress
---

## Summary

This is the summary.

It spans multiple paragraphs.

## User Story

Not the summary.
`;

describe('readFdSummary', () => {
  it('extracts the Summary section', async () => {
    const path = join(dir, 'fd.md');
    await writeFile(path, FD, 'utf8');
    expect((await readFdSummary(path)).trim()).toBe(
      'This is the summary.\n\nIt spans multiple paragraphs.',
    );
  });
  it('throws on missing Summary section', async () => {
    const path = join(dir, 'no-summary.md');
    await writeFile(path, '---\nname: x\n---\n\n## Other\n\nbody\n', 'utf8');
    await expect(readFdSummary(path)).rejects.toThrow(/Summary/);
  });
  it('throws on missing file', async () => {
    await expect(readFdSummary(join(dir, 'nope.md'))).rejects.toThrow();
  });
});

describe('extractFdAcceptance', () => {
  const write = async (body: string): Promise<string> => {
    const p = join(dir, 'fd-acceptance.md');
    await writeFile(p, body);
    return p;
  };

  it('returns Summary + Usage joined', async () => {
    const p = await write('## Summary\n\nThe what.\n\n## Usage\n\n- run it\n\n## PRs\n');
    await expect(extractFdAcceptance(p)).resolves.toBe('The what.\n\n- run it');
  });

  it('tolerates a missing Usage section', async () => {
    const p = await write('## Summary\n\nOnly summary.\n');
    await expect(extractFdAcceptance(p)).resolves.toBe('Only summary.');
  });

  it('throws when neither section exists', async () => {
    const p = await write('# Title\nno sections\n');
    await expect(extractFdAcceptance(p)).rejects.toThrow(/no ## Summary or ## Usage/);
  });
});
