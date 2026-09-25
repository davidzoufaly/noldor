// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractFdAcceptance, readFdSummary, stripFdScaffoldStubs } from '../read-fd-summary.js';

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

describe('stripFdScaffoldStubs (Q-0284)', () => {
  it('drops a section holding only a stub and keeps filled sections', () => {
    const fd =
      '## Summary\n\nThe what.\n\n## Diagram\n\n<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or\ntwo on what it shows. -->\n\n## Usage\n\n- run it\n';
    expect(stripFdScaffoldStubs(fd)).toBe('## Summary\n\nThe what.\n\n## Usage\n\n- run it\n');
  });

  it('removes a stub beside real content but keeps the section', () => {
    const fd = '## Usage\n\n<!-- TODO polish -->\n- run it\n';
    expect(stripFdScaffoldStubs(fd)).toBe('## Usage\n\n- run it\n');
  });

  it('drops a trailing stub-only section', () => {
    expect(stripFdScaffoldStubs('## Summary\n\nx\n\n## Usage\n\n<!-- TODO: steps -->\n')).toBe(
      '## Summary\n\nx\n',
    );
  });

  it('keeps a stub quoted inside a code fence, and a fenced heading-shaped line', () => {
    const fd = '## Notes\n\n```md\n## Diagram\n<!-- TODO: stub -->\n```\n';
    expect(stripFdScaffoldStubs(fd)).toBe(fd);
  });

  it('keeps ordinary comments that are not stubs', () => {
    const fd = '## Summary\n\n<!-- keep me -->\n';
    expect(stripFdScaffoldStubs(fd)).toBe(fd);
  });
});
