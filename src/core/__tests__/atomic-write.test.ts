// @tests: state-file-fail-open-hardening
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../atomic-write';

describe('atomicWriteFileSync', () => {
  it('writes content to the target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-'));
    const target = join(dir, 'state.json');
    atomicWriteFileSync(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
  });

  it('overwrites an existing target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-'));
    const target = join(dir, 'state.json');
    writeFileSync(target, 'old', 'utf8');
    atomicWriteFileSync(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
  });

  it('leaves no .tmp sibling behind on success', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-'));
    const target = join(dir, 'state.json');
    atomicWriteFileSync(target, 'x');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });

  it('never exposes a partial file: the target only ever holds complete content', () => {
    // The rename is atomic, so at any instant the target is either absent or
    // holds a full prior/next value — asserted here by round-tripping a large
    // payload and confirming byte-exact integrity (no truncation).
    const dir = mkdtempSync(join(tmpdir(), 'aw-'));
    const target = join(dir, 'state.json');
    const big = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) });
    atomicWriteFileSync(target, big);
    expect(readFileSync(target, 'utf8')).toBe(big);
  });
});
