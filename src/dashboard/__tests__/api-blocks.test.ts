// @tests: dashboard-roadmap-drag-drop

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as atomicModule from '../api/atomic.js';
import { atomicWriteFile } from '../api/atomic.js';
import { handleDemote, handleMove, handlePromote } from '../api/blocks.js';

describe(atomicWriteFile, () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes content via tmp + rename', async () => {
    const target = join(dir, 'out.md');
    await atomicWriteFile(target, 'hello');
    expect(readFileSync(target, 'utf8')).toBe('hello');
  });

  it('overwrites an existing target file', async () => {
    const target = join(dir, 'out.md');
    writeFileSync(target, 'old');
    await atomicWriteFile(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
  });

  it('bubbles errors when the target directory does not exist', async () => {
    const target = join(dir, 'no-such-dir', 'out.md');
    await expect(atomicWriteFile(target, 'hello')).rejects.toThrow();
  });
});

const ROADMAP_FIX = `# Roadmap

### Alpha

- area: tooling

Body A.

### Beta

- area: tooling

Body B.
`;

const BACKLOG_FIX = `# Backlog

### Charlie

- area: web

Body C.
`;

describe(handleMove, () => {
  let dir: string;
  let roadmapPath: string;
  let backlogPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-blocks-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    backlogPath = join(dir, 'backlog.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
    writeFileSync(backlogPath, BACKLOG_FIX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('moves alpha to position 1; returns 200 + new etag', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: hash,
      body: { slug: 'alpha', targetIndex: 1 },
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.etag).toMatch(/^[a-f0-9]{64}$/);
    const out = readFileSync(roadmapPath, 'utf8');
    expect(out.indexOf('### Beta')).toBeLessThan(out.indexOf('### Alpha'));
  });

  it('returns 412 on If-Match mismatch', async () => {
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: 'wronghash',
      body: { slug: 'alpha', targetIndex: 1 },
    });
    expect(result.status).toBe(412);
  });

  it('returns 412 on missing If-Match', async () => {
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: undefined,
      body: { slug: 'alpha', targetIndex: 1 },
    });
    expect(result.status).toBe(412);
  });

  it('returns 404 on unknown slug', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: hash,
      body: { slug: 'ghost', targetIndex: 0 },
    });
    expect(result.status).toBe(404);
  });

  it('returns 400 on out-of-range targetIndex', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: hash,
      body: { slug: 'alpha', targetIndex: 99 },
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 on invalid slug (regex reject)', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: hash,
      body: { slug: 'BadSlug!', targetIndex: 0 },
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 on non-integer targetIndex', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleMove({
      path: roadmapPath,
      ifMatch: hash,
      body: { slug: 'alpha', targetIndex: 1.5 },
    });
    expect(result.status).toBe(400);
  });
});

describe(handlePromote, () => {
  let dir: string;
  let roadmapPath: string;
  let backlogPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-blocks-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    backlogPath = join(dir, 'backlog.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
    writeFileSync(backlogPath, BACKLOG_FIX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('moves charlie from backlog to top of roadmap', async () => {
    const rHash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const bHash = createHash('sha256').update(BACKLOG_FIX).digest('hex');
    const result = await handlePromote({
      roadmapPath,
      backlogPath,
      ifMatch: `${rHash}:${bHash}`,
      slug: 'charlie',
    });
    expect(result.status).toBe(200);
    const rOut = readFileSync(roadmapPath, 'utf8');
    const bOut = readFileSync(backlogPath, 'utf8');
    expect(rOut).toContain('### Charlie');
    expect(rOut.indexOf('### Charlie')).toBeLessThan(rOut.indexOf('### Alpha'));
    expect(bOut).not.toContain('Body C.');
    expect(result.body.etag).toMatch(/^[a-f0-9]{64}:[a-f0-9]{64}$/);
  });

  it('returns 412 on combined-etag mismatch', async () => {
    const result = await handlePromote({
      roadmapPath,
      backlogPath,
      ifMatch: 'wrong:hash',
      slug: 'charlie',
    });
    expect(result.status).toBe(412);
  });

  it('returns 412 on missing If-Match', async () => {
    const result = await handlePromote({
      roadmapPath,
      backlogPath,
      ifMatch: undefined,
      slug: 'charlie',
    });
    expect(result.status).toBe(412);
  });

  it('returns 404 when slug is missing from backlog', async () => {
    const rHash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const bHash = createHash('sha256').update(BACKLOG_FIX).digest('hex');
    const result = await handlePromote({
      roadmapPath,
      backlogPath,
      ifMatch: `${rHash}:${bHash}`,
      slug: 'ghost',
    });
    expect(result.status).toBe(404);
  });
});

describe(handleDemote, () => {
  let dir: string;
  let roadmapPath: string;
  let backlogPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-blocks-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    backlogPath = join(dir, 'backlog.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
    writeFileSync(backlogPath, BACKLOG_FIX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('moves alpha from roadmap to top of backlog', async () => {
    const rHash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const bHash = createHash('sha256').update(BACKLOG_FIX).digest('hex');
    const result = await handleDemote({
      roadmapPath,
      backlogPath,
      ifMatch: `${rHash}:${bHash}`,
      slug: 'alpha',
    });
    expect(result.status).toBe(200);
    const rOut = readFileSync(roadmapPath, 'utf8');
    const bOut = readFileSync(backlogPath, 'utf8');
    expect(rOut).not.toContain('Body A.');
    expect(bOut).toContain('### Alpha');
    expect(bOut.indexOf('### Alpha')).toBeLessThan(bOut.indexOf('### Charlie'));
  });

  it('returns 412 on combined-etag mismatch', async () => {
    const result = await handleDemote({
      roadmapPath,
      backlogPath,
      ifMatch: 'wrong:hash',
      slug: 'alpha',
    });
    expect(result.status).toBe(412);
  });

  it('returns 404 when slug is missing from roadmap', async () => {
    const rHash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const bHash = createHash('sha256').update(BACKLOG_FIX).digest('hex');
    const result = await handleDemote({
      roadmapPath,
      backlogPath,
      ifMatch: `${rHash}:${bHash}`,
      slug: 'ghost',
    });
    expect(result.status).toBe(404);
  });
});

describe('handlePromote destination-rename failure', () => {
  let dir: string;
  let roadmapPath: string;
  let backlogPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-blocks-fail-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    backlogPath = join(dir, 'backlog.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
    writeFileSync(backlogPath, BACKLOG_FIX);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 500 + structured log when destination rename fails after source write succeeds', async () => {
    const rHash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const bHash = createHash('sha256').update(BACKLOG_FIX).digest('hex');

    // For handlePromote: source = backlog (written first), destination = roadmap
    // (written second). Mock so that the first atomicWriteFile call (backlog)
    // succeeds via the real implementation and the second call (roadmap) throws.
    let callCount = 0;
    const realAtomicWrite = atomicModule.atomicWriteFile;
    const writeSpy = vi
      .spyOn(atomicModule, 'atomicWriteFile')
      .mockImplementation(async (target: string, content: string) => {
        callCount += 1;
        if (callCount === 1) return realAtomicWrite(target, content);
        throw new Error('mock-disk-full');
      });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handlePromote({
      roadmapPath,
      backlogPath,
      ifMatch: `${rHash}:${bHash}`,
      slug: 'charlie',
    });

    expect(result.status).toBe(500);
    // Source (backlog) was successfully written — block removed.
    expect(readFileSync(backlogPath, 'utf8')).not.toContain('Body C.');
    // Destination (roadmap) is unchanged — block NOT inserted.
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
    // Structured log includes the phase identifier.
    const logCall = errSpy.mock.calls.find((args) =>
      args.some(
        (a) =>
          typeof a === 'object' &&
          a !== null &&
          'phase' in (a as object) &&
          (a as { phase?: unknown }).phase === 'destination-rename',
      ),
    );
    expect(logCall).toBeDefined();

    expect(writeSpy).toHaveBeenCalledTimes(2);
  });
});
