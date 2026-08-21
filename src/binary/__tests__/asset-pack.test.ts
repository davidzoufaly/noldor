// @tests: single-static-binary-distribution
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER_NAME, buildPack, extractAssets, readPack, type PackFile } from '../asset-pack.js';

const files: PackFile[] = [
  { path: 'templates/lefthook.yml', mode: 0o644, data: Buffer.from('hooks: {}\n') },
  { path: 'package.json', mode: 0o644, data: Buffer.from('{"version":"9.9.9"}') },
  { path: 'dist/cr/cr-record.schema.json', mode: 0o644, data: Buffer.from('{}') },
];

describe('pack round-trip', () => {
  it('writes and reads back every entry byte-identically', () => {
    const pack = buildPack('9.9.9', files);
    const { pkgVersion, entries } = readPack(pack);
    expect(pkgVersion).toBe('9.9.9');
    expect(entries.map((e) => e.path).sort()).toEqual(files.map((f) => f.path).sort());
    for (const f of files) {
      const e = entries.find((x) => x.path === f.path);
      expect(e).toBeDefined();
      expect(e?.data.equals(f.data)).toBe(true);
      expect(e?.mode).toBe(f.mode);
    }
  });
});

describe('rejection table (spec Unit 1 format rules)', () => {
  const build = (over: Partial<PackFile>) =>
    buildPack('9.9.9', [{ path: 'a.txt', mode: 0o644, data: Buffer.from('x'), ...over }]);

  it('writer rejects absolute paths', () => {
    expect(() => build({ path: '/etc/passwd' })).toThrow(/absolute/);
  });
  it('writer rejects .. segments', () => {
    expect(() => build({ path: '../escape' })).toThrow(/\.\./);
  });
  it('writer rejects duplicates', () => {
    expect(() =>
      buildPack('9.9.9', [
        { path: 'a.txt', mode: 0o644, data: Buffer.from('x') },
        { path: 'a.txt', mode: 0o644, data: Buffer.from('y') },
      ]),
    ).toThrow(/duplicate/);
  });
  it('writer rejects modes other than 0o644/0o755', () => {
    expect(() => build({ mode: 0o777 })).toThrow(/mode/);
  });
  it('reader rejects bad magic', () => {
    const pack = buildPack('9.9.9', files);
    pack.write('XXXX', 0, 'ascii');
    expect(() => readPack(pack)).toThrow(/magic/);
  });
  it('reader rejects unknown format version', () => {
    const pack = buildPack('9.9.9', files);
    pack.writeUInt32LE(99, 4);
    expect(() => readPack(pack)).toThrow(/format version/);
  });
  it('reader rejects out-of-bounds entries', () => {
    const pack = buildPack('9.9.9', [{ path: 'a.txt', mode: 0o644, data: Buffer.from('x') }]);
    const indexLen = pack.readUInt32LE(8);
    const idx = JSON.parse(pack.subarray(12, 12 + indexLen).toString('utf8')) as {
      pkgVersion: string;
      entries: Array<{ path: string; offset: number; size: number; mode: number }>;
    };
    const first = idx.entries[0];
    expect(first).toBeDefined();
    if (first) first.size = 10_000;
    const newIdx = Buffer.from(JSON.stringify(idx), 'utf8');
    const head = Buffer.from(pack.subarray(0, 8));
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(newIdx.length, 0);
    expect(() =>
      readPack(Buffer.concat([head, lenBuf, newIdx, pack.subarray(12 + indexLen)])),
    ).toThrow(/bounds/);
  });
});

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'npak-test-'));
}

describe('extractAssets', () => {
  const packOf = (text: string) =>
    buildPack('9.9.9', [
      { path: 'templates/a.txt', mode: 0o644, data: Buffer.from(text) },
      { path: 'bin/tool', mode: 0o755, data: Buffer.from('#!/bin/sh\n') },
    ]);

  it('extracts, writes the digest marker, and reports extracted=true', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('one'));
    const dest = join(base, 'pkg');
    const r = extractAssets(packPath, dest);
    expect(r.extracted).toBe(true);
    expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('one');
    expect(statSync(join(dest, 'bin/tool')).mode & 0o755).toBe(0o755);
    expect(existsSync(join(dest, MARKER_NAME))).toBe(true);
  });

  it('accepts a Buffer pack source (the embedded-bytes path)', () => {
    const base = tmpBase();
    const dest = join(base, 'pkg');
    const r = extractAssets(packOf('bytes'), dest);
    expect(r.extracted).toBe(true);
    expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('bytes');
  });

  it('is a no-op on a digest-matching cache hit', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('one'));
    const dest = join(base, 'pkg');
    extractAssets(packPath, dest);
    const r2 = extractAssets(packPath, dest);
    expect(r2.extracted).toBe(false);
  });

  it('re-extracts over a markerless (stale) dest by renaming it aside', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('fresh'));
    const dest = join(base, 'pkg');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'junk.txt'), 'stale');
    const r = extractAssets(packPath, dest);
    expect(r.extracted).toBe(true);
    expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('fresh');
    expect(existsSync(join(dest, 'junk.txt'))).toBe(false);
  });

  it('accepts a concurrent winner: publish rename loses, digest re-verify wins', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('one'));
    const dest = join(base, 'pkg');
    extractAssets(packPath, dest); // "the other process" already published
    // Stateful mock: the FIRST marker read (the pre-check) misses so the
    // extract path runs; the publish rename then loses the race; the
    // SECOND marker read (re-verify) sees the real winner.
    let markerReads = 0;
    const racingFs = {
      readFileSync: ((...args: Parameters<typeof readFileSync>) => {
        if (String(args[0]).endsWith(MARKER_NAME) && markerReads++ === 0) {
          const err = new Error('miss') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return readFileSync(...args);
      }) as typeof readFileSync,
      renameSync: (from: string, to: string) => {
        if (to === dest) {
          const err = new Error('exists') as NodeJS.ErrnoException;
          err.code = 'ENOTEMPTY';
          throw err;
        }
        const err = new Error('gone') as NodeJS.ErrnoException;
        err.code = 'ENOENT'; // aside-rename: the winner already moved dest
        throw err;
      },
    };
    const r = extractAssets(packPath, dest, racingFs);
    expect(r.extracted).toBe(false);
    expect(markerReads).toBeGreaterThan(1); // the re-verify branch actually ran
  });

  it('treats a lost aside-rename (ENOENT) as a race, not a failure', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('one'));
    const dest = join(base, 'pkg');
    mkdirSync(dest, { recursive: true }); // stale markerless dest
    const asideLoser = {
      renameSync: (from: string, to: string) => {
        if (to.includes('.stale-')) {
          const err = new Error('gone') as NodeJS.ErrnoException;
          err.code = 'ENOENT'; // another process moved dest aside first
          throw err;
        }
        return renameSync(from, to);
      },
    };
    const r = extractAssets(packPath, dest, asideLoser);
    expect(r.extracted).toBe(true); // our publish still landed on the vacated name
    expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('one');
  });

  it('propagates non-race failures with the attempted path', () => {
    const base = tmpBase();
    const packPath = join(base, 'assets.pack');
    writeFileSync(packPath, packOf('one'));
    const dest = join(base, 'pkg2');
    const failingFs = {
      renameSync: () => {
        const err = new Error('denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    expect(() => extractAssets(packPath, dest, failingFs)).toThrow(/pkg2/);
  });
});
