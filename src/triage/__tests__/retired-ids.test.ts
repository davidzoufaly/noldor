// @tests: stable-entry-ids-for-roadmap-backlog
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRetiredIds, recordRetiredId, retiredRefs } from '../retired-ids.js';

describe('retired-ids map', () => {
  let dir: string;
  let mapPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'retired-ids-'));
    mapPath = join(dir, 'retired-entry-ids.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads an empty map when the file does not exist', () => {
    expect(loadRetiredIds(mapPath)).toEqual({});
  });

  it('records a retired ID and reads it back', () => {
    const recorded = recordRetiredId(
      'Q-0089',
      { slug: 'codex-lane-headless-dispatch-breakage', retiredInto: 'parent-fd' },
      mapPath,
    );
    expect(recorded).toBe(true);
    expect(loadRetiredIds(mapPath)).toEqual({
      'Q-0089': { slug: 'codex-lane-headless-dispatch-breakage', retiredInto: 'parent-fd' },
    });
  });

  it('is idempotent — a re-record keeps the original record and reports false', () => {
    recordRetiredId('Q-0099', { slug: 'original-slug', retiredAt: '2026-08-13' }, mapPath);
    const before = readFileSync(mapPath, 'utf8');
    const recorded = recordRetiredId('Q-0099', { slug: 'other-slug' }, mapPath);
    expect(recorded).toBe(false);
    expect(readFileSync(mapPath, 'utf8')).toBe(before);
  });

  it('accumulates multiple IDs in one map', () => {
    recordRetiredId('Q-0089', { slug: 'a' }, mapPath);
    recordRetiredId('Q-0099', { slug: 'b' }, mapPath);
    expect(Object.keys(loadRetiredIds(mapPath)).sort()).toEqual(['Q-0089', 'Q-0099']);
  });

  it('refuses to record a malformed entry ID (would poison every later load)', () => {
    expect(() => recordRetiredId('not-an-id', { slug: 'x' }, mapPath)).toThrow(
      /malformed entry ID/,
    );
    expect(loadRetiredIds(mapPath)).toEqual({});
  });

  it('throws loudly on a corrupt map (non-object root)', () => {
    writeFileSync(mapPath, '["Q-0089"]\n', 'utf8');
    expect(() => loadRetiredIds(mapPath)).toThrow(/corrupt map/);
  });

  it('throws loudly on a non-ID key', () => {
    writeFileSync(mapPath, JSON.stringify({ 'not-an-id': { slug: 'x' } }), 'utf8');
    expect(() => loadRetiredIds(mapPath)).toThrow(/not a Q-NNNN entry ID/);
  });

  it('throws loudly on a record missing its slug', () => {
    writeFileSync(mapPath, JSON.stringify({ 'Q-0089': {} }), 'utf8');
    expect(() => loadRetiredIds(mapPath)).toThrow(/missing a slug/);
  });
});

describe('split provenance', () => {
  let dir: string;
  let mapPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'retired-ids-split-'));
    mapPath = join(dir, 'retired-entry-ids.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips splitInto alongside the slug', () => {
    recordRetiredId(
      'Q-0108',
      { slug: 'oversize-entry', splitInto: ['slice-a', 'slice-b'], retiredAt: '2026-08-17' },
      mapPath,
    );
    expect(loadRetiredIds(mapPath)['Q-0108']).toStrictEqual({
      slug: 'oversize-entry',
      splitInto: ['slice-a', 'slice-b'],
      retiredAt: '2026-08-17',
    });
  });

  // The recorded ID is what restores blocked-by resolution after a split
  // replaces the source block; splitInto is provenance layered on top, so both
  // reference forms must still resolve.
  it('resolves both ref forms for a split-retired entry', () => {
    recordRetiredId('Q-0108', { slug: 'oversize-entry', splitInto: ['slice-a'] }, mapPath);
    const refs = retiredRefs(loadRetiredIds(mapPath));
    expect(refs.has('Q-0108')).toBe(true);
    expect(refs.has('oversize-entry')).toBe(true);
  });
});
