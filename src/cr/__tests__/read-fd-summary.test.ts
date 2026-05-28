import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFdSummary } from '../read-fd-summary.js';

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
