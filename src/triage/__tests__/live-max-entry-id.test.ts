// @tests: stable-entry-ids-for-roadmap-backlog
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { liveMaxEntryId } from '../live-max-entry-id.js';

describe(liveMaxEntryId, () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noldor-livemax-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const writeDoc = (rel: string, body: string): void => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body, 'utf8');
  };

  const entry = (name: string, id: string): string =>
    `### ${name}\n\n- id: ${id}\n- area: tooling\n- type: feat\n\nBody.\n`;

  it('returns 0 for a repo with no queue docs at all', () => {
    expect(liveMaxEntryId(root)).toBe(0);
  });

  it('takes the max across roadmap and backlog', () => {
    writeDoc('docs/roadmap.md', `# Roadmap\n\n${entry('A', 'Q-0007')}`);
    writeDoc('docs/backlog.md', `# Backlog\n\n${entry('B', 'Q-0153')}`);
    expect(liveMaxEntryId(root)).toBe(153);
  });

  it('counts feature-MD entry-id frontmatter', () => {
    writeDoc('docs/features/shipped.md', `---\nentry-id: Q-0400\nphase: done\n---\n\nbody\n`);
    expect(liveMaxEntryId(root)).toBe(400);
  });

  it('counts retired IDs — a retired entry still owns its number', () => {
    writeDoc(
      '.noldor/retired-entry-ids.json',
      `${JSON.stringify({ 'Q-0333': { slug: 'gone' } }, null, 2)}\n`,
    );
    expect(liveMaxEntryId(root)).toBe(333);
  });

  it('ignores non-conforming ids rather than throwing', () => {
    writeDoc('docs/roadmap.md', `# Roadmap\n\n${entry('A', 'not-an-id')}${entry('B', 'Q-0012')}`);
    expect(liveMaxEntryId(root)).toBe(12);
  });

  it('does not cap the width at four digits', () => {
    writeDoc('docs/roadmap.md', `# Roadmap\n\n${entry('A', 'Q-12345')}`);
    expect(liveMaxEntryId(root)).toBe(12345);
  });
});
