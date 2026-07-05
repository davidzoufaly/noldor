// @tests: stable-entry-ids-for-roadmap-backlog
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ENTRY_ID_RE,
  formatEntryId,
  mintEntryIds,
  resolveEntryRef,
  stampMissingIds,
} from '../entry-id.js';

describe(formatEntryId, () => {
  it('zero-pads to four digits', () => {
    expect(formatEntryId(1)).toBe('Q-0001');
    expect(formatEntryId(42)).toBe('Q-0042');
  });

  it('grows width past 9999 without breaking the format regex', () => {
    expect(formatEntryId(12345)).toBe('Q-12345');
    expect(ENTRY_ID_RE.test(formatEntryId(12345))).toBe(true);
  });
});

describe(mintEntryIds, () => {
  let dir: string;
  let counter: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-eid-'));
    counter = join(dir, 'id-counter.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts at Q-0001 when the counter file is missing and persists the bump', () => {
    expect(mintEntryIds(3, counter)).toEqual(['Q-0001', 'Q-0002', 'Q-0003']);
    expect(JSON.parse(readFileSync(counter, 'utf8'))).toEqual({ next: 4 });
  });

  it('resumes from the persisted counter', () => {
    writeFileSync(counter, JSON.stringify({ next: 10 }));
    expect(mintEntryIds(2, counter)).toEqual(['Q-0010', 'Q-0011']);
    expect(JSON.parse(readFileSync(counter, 'utf8'))).toEqual({ next: 12 });
  });

  it('throws on a corrupt counter rather than silently resetting', () => {
    writeFileSync(counter, JSON.stringify({ next: 'oops' }));
    expect(() => mintEntryIds(1, counter)).toThrow(/corrupt counter/);
  });

  it('rejects a non-positive count', () => {
    expect(() => mintEntryIds(0, counter)).toThrow();
  });
});

describe(stampMissingIds, () => {
  const roadmap = `# Roadmap

### Category

#### Entry A

- area: tooling
- type: feat

Body A.

#### Entry B

- id: Q-0099
- area: tooling
- type: fix

Body B.
`;

  it('stamps id-less entries as the first bullet, skips categories and already-stamped blocks', () => {
    let n = 0;
    const seq = ['Q-0001', 'Q-0002'];
    const { text, minted } = stampMissingIds(roadmap, () => seq[n++]!);
    expect(minted).toBe(1); // only Entry A needs one
    expect(text).toContain('#### Entry A\n\n- id: Q-0001\n- area: tooling');
    // Entry B keeps its existing id; category got none.
    expect(text).toContain('- id: Q-0099');
    expect(text).not.toContain('### Category\n\n- id');
  });

  it('is idempotent — a second pass over stamped output mints nothing', () => {
    const first = stampMissingIds(roadmap, () => 'Q-0001').text;
    const second = stampMissingIds(first, () => 'Q-9999');
    expect(second.minted).toBe(0);
    expect(second.text).toBe(first);
  });
});

describe(resolveEntryRef, () => {
  let featuresDir: string;
  beforeEach(() => {
    featuresDir = mkdtempSync(join(tmpdir(), 'noldor-fd-'));
  });
  afterEach(() => rmSync(featuresDir, { recursive: true, force: true }));

  const roadmapRaw = `# Roadmap

#### On Roadmap

- id: Q-0001
- area: tooling
- type: feat

Body.
`;
  const backlogRaw = `# Backlog

### On Backlog

- id: Q-0002
- area: tooling

Body.
`;

  it('returns a slug ref unchanged', () => {
    expect(resolveEntryRef('some-slug', { roadmapRaw, backlogRaw, featuresDir })).toBe('some-slug');
  });

  it('resolves an id to its roadmap entry slug', () => {
    expect(resolveEntryRef('Q-0001', { roadmapRaw, backlogRaw, featuresDir })).toBe('on-roadmap');
  });

  it('resolves an id to its backlog entry slug', () => {
    expect(resolveEntryRef('Q-0002', { roadmapRaw, backlogRaw, featuresDir })).toBe('on-backlog');
  });

  it('resolves an id via feature-MD entry-id frontmatter to the file stem', () => {
    writeFileSync(
      join(featuresDir, 'shipped-thing.md'),
      `---\nentry-id: Q-0500\nphase: done\n---\n\nbody\n`,
    );
    expect(resolveEntryRef('Q-0500', { roadmapRaw, backlogRaw, featuresDir })).toBe(
      'shipped-thing',
    );
  });

  it('returns an unknown id unchanged (treated as unshipped downstream)', () => {
    expect(resolveEntryRef('Q-9999', { roadmapRaw, backlogRaw, featuresDir })).toBe('Q-9999');
  });

  it('tolerates a missing features directory', () => {
    const gone = join(featuresDir, 'nope');
    expect(existsSync(gone)).toBe(false);
    expect(resolveEntryRef('Q-0001', { roadmapRaw, backlogRaw, featuresDir: gone })).toBe(
      'on-roadmap',
    );
  });
});
