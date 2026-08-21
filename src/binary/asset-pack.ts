/**
 * Framed asset pack (spec Unit 1): magic NPAK + u32le formatVersion(=1) +
 * u32le indexLength + index JSON + data section. Regular files only, modes
 * 0o644/0o755, relative POSIX paths. Writer and reader are the same module
 * so the format has exactly one implementation.
 */
import { createHash } from 'node:crypto';
import * as realFs from 'node:fs';
import { dirname, join as joinPath } from 'node:path';

const MAGIC = 'NPAK';
const FORMAT_VERSION = 1;
const HEADER_LEN = 12; // 4 magic + 4 version + 4 indexLength

export interface PackFile {
  path: string;
  mode: number;
  data: Buffer;
}

export interface PackEntry {
  path: string;
  mode: number;
  data: Buffer;
}

interface IndexEntry {
  path: string;
  offset: number;
  size: number;
  mode: number;
}

function assertSafePath(path: string): void {
  if (path.startsWith('/')) throw new Error(`pack path must not be absolute: ${path}`);
  if (path.split('/').includes('..')) throw new Error(`pack path must not contain ..: ${path}`);
  if (path === '') throw new Error('pack path must not be empty');
}

function assertMode(mode: number, path: string): void {
  if (mode !== 0o644 && mode !== 0o755) {
    throw new Error(
      `pack entry mode must be 0o644 or 0o755 (got 0o${mode.toString(8)}) for ${path}`,
    );
  }
}

export function buildPack(pkgVersion: string, files: PackFile[]): Buffer {
  const seen = new Set<string>();
  const entries: IndexEntry[] = [];
  const blobs: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    assertSafePath(f.path);
    assertMode(f.mode, f.path);
    if (seen.has(f.path)) throw new Error(`duplicate pack path: ${f.path}`);
    seen.add(f.path);
    entries.push({ path: f.path, offset, size: f.data.length, mode: f.mode });
    blobs.push(f.data);
    offset += f.data.length;
  }
  const index = Buffer.from(JSON.stringify({ pkgVersion, entries }), 'utf8');
  const header = Buffer.alloc(HEADER_LEN);
  header.write(MAGIC, 0, 'ascii');
  header.writeUInt32LE(FORMAT_VERSION, 4);
  header.writeUInt32LE(index.length, 8);
  return Buffer.concat([header, index, ...blobs]);
}

export function readPack(pack: Buffer): { pkgVersion: string; entries: PackEntry[] } {
  if (pack.length < HEADER_LEN) throw new Error('pack truncated: no header');
  if (pack.subarray(0, 4).toString('ascii') !== MAGIC) throw new Error('bad pack magic');
  const version = pack.readUInt32LE(4);
  if (version !== FORMAT_VERSION) throw new Error(`unsupported pack format version ${version}`);
  const indexLen = pack.readUInt32LE(8);
  if (HEADER_LEN + indexLen > pack.length) throw new Error('pack truncated: index out of bounds');
  const raw = JSON.parse(pack.subarray(HEADER_LEN, HEADER_LEN + indexLen).toString('utf8')) as {
    pkgVersion: string;
    entries: IndexEntry[];
  };
  const dataStart = HEADER_LEN + indexLen;
  const dataLen = pack.length - dataStart;
  const seen = new Set<string>();
  const entries: PackEntry[] = raw.entries.map((e) => {
    assertSafePath(e.path);
    assertMode(e.mode, e.path);
    if (seen.has(e.path)) throw new Error(`duplicate pack path: ${e.path}`);
    seen.add(e.path);
    if (
      !Number.isSafeInteger(e.offset) ||
      !Number.isSafeInteger(e.size) ||
      e.offset < 0 ||
      e.size < 0 ||
      e.offset + e.size > dataLen
    ) {
      throw new Error(`pack entry out of bounds: ${e.path}`);
    }
    return {
      path: e.path,
      mode: e.mode,
      data: pack.subarray(dataStart + e.offset, dataStart + e.offset + e.size),
    };
  });
  return { pkgVersion: raw.pkgVersion, entries };
}

export const MARKER_NAME = '.noldor-pack-ok';

/** The fs surface the extractor uses — injectable for failure tests. */
export type ExtractFs = Pick<
  typeof realFs,
  | 'mkdtempSync'
  | 'mkdirSync'
  | 'writeFileSync'
  | 'renameSync'
  | 'readFileSync'
  | 'rmSync'
  | 'existsSync'
>;

function markerDigest(fs: ExtractFs, dest: string): string | null {
  try {
    return (fs.readFileSync(joinPath(dest, MARKER_NAME), 'utf8') as string).trim();
  } catch {
    // Missing/unreadable marker = cache miss; the extract path handles it.
    return null;
  }
}

/**
 * Extract the embedded pack to `dest` (spec Unit 1 protocol): private temp
 * dir + digest marker + single rename publish; stale dests renamed aside,
 * never rm'd in place; rename races resolved by re-verifying the winner's
 * digest. Returns { extracted } — false means a valid cache was reused.
 *
 * `packSource`: a string is a pack file on disk (build/tests); a Buffer is
 * the embedded pack's bytes handed over by the binary entry
 * (Bun.embeddedFiles has no fs path).
 *
 * Boundary contract: filesystem failures (ENOSPC, EACCES) throw an Error
 * carrying the attempted path — the process entry catches once and exits 1;
 * nothing recoverable hides inside.
 */
export function extractAssets(
  packSource: string | Buffer,
  dest: string,
  fsOverride: Partial<ExtractFs> = {},
): { extracted: boolean } {
  const fs: ExtractFs = { ...realFs, ...fsOverride };
  const pack =
    typeof packSource === 'string' ? (fs.readFileSync(packSource) as Buffer) : packSource;
  const digest = createHash('sha256').update(pack).digest('hex');
  if (markerDigest(fs, dest) === digest) return { extracted: false };

  const { entries } = readPack(pack);
  fs.mkdirSync(dirname(dest), { recursive: true });
  const temp = fs.mkdtempSync(`${dest}.tmp-`);
  try {
    for (const e of entries) {
      const target = joinPath(temp, e.path);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.writeFileSync(target, e.data, { mode: e.mode });
    }
    fs.writeFileSync(joinPath(temp, MARKER_NAME), `${digest}\n`);

    if (fs.existsSync(dest)) {
      // Never rm a dir another process may be publishing — rename it aside.
      // A concurrent racer may vacate dest first: its aside-rename winning
      // makes ours throw ENOENT, which is a race signal, not a failure —
      // fall through and try to publish onto the vacated name.
      const aside = `${dest}.stale-${process.pid}`;
      try {
        fs.renameSync(dest, aside);
        fs.renameSync(temp, dest);
        fs.rmSync(aside, { recursive: true, force: true });
        return { extracted: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    fs.renameSync(temp, dest);
    return { extracted: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      // Lost a publish race — accept the winner iff its content matches.
      if (markerDigest(fs, dest) === digest) {
        fs.rmSync(temp, { recursive: true, force: true });
        return { extracted: false };
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
    throw new Error(`asset extraction to ${dest} failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
