import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonAtomic } from '../atomic-write.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aw-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
  it('writes the file via temp-then-rename', async () => {
    const target = join(dir, 'out.json');
    await writeJsonAtomic(target, { hello: 'world' });
    const contents = JSON.parse(await readFile(target, 'utf8'));
    expect(contents).toEqual({ hello: 'world' });
  });
  it('leaves no .tmp residue on success', async () => {
    const target = join(dir, 'out.json');
    await writeJsonAtomic(target, { a: 1 });
    const entries = await readdir(dir);
    expect(entries).toEqual(['out.json']);
  });
  it('overwrites existing file', async () => {
    const target = join(dir, 'out.json');
    await writeJsonAtomic(target, { v: 1 });
    await writeJsonAtomic(target, { v: 2 });
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ v: 2 });
  });
  it('handles two concurrent writers to the same sink without corruption', async () => {
    const target = join(dir, 'race.json');
    await Promise.all([
      writeJsonAtomic(target, { writer: 1, payload: 'a'.repeat(1000) }),
      writeJsonAtomic(target, { writer: 2, payload: 'b'.repeat(1000) }),
    ]);
    const final = JSON.parse(await readFile(target, 'utf8'));
    expect([1, 2]).toContain(final.writer);
    expect(final.payload).toMatch(/^(a+|b+)$/);
    const entries = await readdir(dir);
    expect(entries).toEqual(['race.json']); // no tmp residue
  });
});
