// @tests: dashboard-roadmap-drag-drop, outcome-telemetry-and-effectiveness-metrics, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRoadmap } from '../../utils/parse-blocks.js';

import * as atomicModule from '../api/atomic.js';
import { atomicWriteFile } from '../api/atomic.js';
import {
  buildRoadmapBlock,
  handleAdd,
  handleDemote,
  handleMove,
  handlePromote,
  handleRemove,
} from '../api/blocks.js';

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

describe(buildRoadmapBlock, () => {
  it('emits a schema-C H3 block with bullets in canonical order', () => {
    const block = buildRoadmapBlock({
      name: 'New Thing',
      area: 'web',
      since: '2026-06-13',
      type: 'feat',
      size: 'S',
      impact: 'low',
      description: 'Does a thing.',
    });
    expect(block).toBe(
      `### New Thing\n\n- area: web\n- type: feat\n- since: 2026-06-13\n- size: S\n- impact: low\n\nDoes a thing.\n`,
    );
  });

  it('omits optional bullets and body when absent', () => {
    expect(buildRoadmapBlock({ name: 'Bare', area: 'core', since: '2026-06-13' })).toBe(
      `### Bare\n\n- area: core\n- since: 2026-06-13\n`,
    );
  });
});

describe(handleRemove, () => {
  let dir: string;
  let roadmapPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-remove-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the block and returns 200 + new etag', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleRemove({ path: roadmapPath, ifMatch: hash, slug: 'alpha' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.etag).toMatch(/^[a-f0-9]{64}$/);
    const after = readFileSync(roadmapPath, 'utf8');
    expect(after).not.toContain('Body A.');
    expect(after).toContain('Body B.');
  });

  it('returns 404 for an unknown slug', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleRemove({ path: roadmapPath, ifMatch: hash, slug: 'nope' });
    expect(result.status).toBe(404);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('returns 412 on If-Match mismatch (no write)', async () => {
    const result = await handleRemove({ path: roadmapPath, ifMatch: 'stale', slug: 'alpha' });
    expect(result.status).toBe(412);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('returns 400 for an invalid slug shape', async () => {
    const hash = createHash('sha256').update(ROADMAP_FIX).digest('hex');
    const result = await handleRemove({ path: roadmapPath, ifMatch: hash, slug: 'Bad Slug' });
    expect(result.status).toBe(400);
  });
});

describe(handleAdd, () => {
  let dir: string;
  let roadmapPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-add-test-'));
    roadmapPath = join(dir, 'roadmap.md');
    writeFileSync(roadmapPath, ROADMAP_FIX);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const hash = (): string =>
    createHash('sha256').update(readFileSync(roadmapPath, 'utf8')).digest('hex');

  it('adds an entry at the top (before the first existing entry)', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: 'Top One', area: 'web', since: '2026-06-13' },
    });
    expect(result.status).toBe(200);
    const after = readFileSync(roadmapPath, 'utf8');
    expect(after).toContain('### Top One');
    expect(after.indexOf('### Top One')).toBeLessThan(after.indexOf('### Alpha'));
  });

  it('adds an entry at the bottom (after the last existing entry)', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'bottom',
      fields: { name: 'Bottom One', area: 'web', since: '2026-06-13' },
    });
    expect(result.status).toBe(200);
    const after = readFileSync(roadmapPath, 'utf8');
    expect(after).toContain('### Bottom One');
    expect(after.indexOf('### Bottom One')).toBeGreaterThan(after.indexOf('Beta body.'));
  });

  it('returns 400 on a blank name', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: '   ', area: 'web', since: '2026-06-13' },
    });
    expect(result.status).toBe(400);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('returns 400 on an invalid area token', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: 'X', area: 'not valid', since: '2026-06-13' },
    });
    expect(result.status).toBe(400);
  });

  it('returns 400 on a malformed since', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: 'X', area: 'web', since: 'yesterday' },
    });
    expect(result.status).toBe(400);
  });

  it('returns 412 on If-Match mismatch (no write)', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: 'stale',
      position: 'top',
      fields: { name: 'X', area: 'web', since: '2026-06-13' },
    });
    expect(result.status).toBe(412);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('returns 400 when the description contains a code fence (no roadmap corruption)', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: 'X', area: 'web', since: '2026-06-13', description: 'before\n```js\ncode' },
    });
    expect(result.status).toBe(400);
    // File untouched — the existing entries must still parse intact.
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('returns 400 when the description contains a line-start heading', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: {
        name: 'X',
        area: 'web',
        since: '2026-06-13',
        description: '### Injected\n- area: x',
      },
    });
    expect(result.status).toBe(400);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('allows inline backticks and mid-line hashes in the description', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: {
        name: 'X',
        area: 'web',
        since: '2026-06-13',
        description: 'Use `foo()` and support C# too.',
      },
    });
    expect(result.status).toBe(200);
    // The roadmap still parses to exactly the original entries + the new one.
    expect(parseRoadmap(readFileSync(roadmapPath, 'utf8')).length).toBe(3);
  });

  it('returns 400 when the name begins with a heading marker', async () => {
    const result = await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: '#### Sneaky', area: 'web', since: '2026-06-13' },
    });
    expect(result.status).toBe(400);
    expect(readFileSync(roadmapPath, 'utf8')).toBe(ROADMAP_FIX);
  });

  it('round-trips through the parser — the added entry is parseable', async () => {
    await handleAdd({
      path: roadmapPath,
      ifMatch: hash(),
      position: 'top',
      fields: { name: 'Parseable Entry', area: 'web', since: '2026-06-13', type: 'feat' },
    });
    const after = readFileSync(roadmapPath, 'utf8');
    const entries = parseRoadmap(after);
    expect(entries.some((e) => e.slug === 'parseable-entry')).toBe(true);
  });
});
