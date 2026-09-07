// @tests: state-file-fail-open-hardening
import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonState, writeJsonState } from '../state-file.js';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'sf-'));

describe('writeJsonState', () => {
  it('creates the missing parent directory chain before writing', () => {
    const target = join(scratch(), 'a', 'b', 'state.json');
    expect(existsSync(target)).toBe(false);

    writeJsonState(target, { n: 1 });

    expect(existsSync(target)).toBe(true);
  });

  it('writes pretty-printed JSON with a trailing newline', () => {
    const target = join(scratch(), 'state.json');

    writeJsonState(target, { b: 2, a: [1] });

    expect(readFileSync(target, 'utf8')).toBe('{\n  "b": 2,\n  "a": [\n    1\n  ]\n}\n');
  });

  it('round-trips through readJsonState', () => {
    const target = join(scratch(), 'nested', 'state.json');
    const value = { slug: 'x', count: 3, nested: { ok: true } };

    writeJsonState(target, value);

    expect(readJsonState<typeof value>(target)).toEqual(value);
  });

  it('replaces the previous contents rather than appending', () => {
    const target = join(scratch(), 'state.json');
    writeFileSync(target, '{"stale":"much longer previous content"}\n', 'utf8');

    writeJsonState(target, { fresh: 1 });

    expect(readFileSync(target, 'utf8')).toBe('{\n  "fresh": 1\n}\n');
  });

  it('leaves no .tmp sibling behind on success', () => {
    const dir = scratch();
    const target = join(dir, 'state.json');

    writeJsonState(target, { n: 1 });

    expect(readdirSync(dir).filter((f) => f.includes('.tmp.'))).toEqual([]);
  });
});
