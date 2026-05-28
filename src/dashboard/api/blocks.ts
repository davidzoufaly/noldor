import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { insertBlock, moveBlock, removeBlock } from '../../utils/write-blocks.js';

import { atomicWriteFile } from './atomic.js';

/**
 * Shape of every dashboard HTTP write response. `etag` is present on 200
 * (within-list: single SHA-256; cross-section: `r:b` combined). `error` is
 * present on non-2xx.
 */
export interface ApiResult {
  status: number;
  body: { ok: boolean; etag?: string; error?: string };
}

const SLUG_RE = /^[a-z0-9-]+$/;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Reorder one block within `path` to `targetIndex` (0-based among same-section
 * entries). The caller supplies `ifMatch = sha256(currentFileContents)`;
 * mismatch returns 412 to surface a concurrent edit before we clobber.
 *
 * Status codes: 200 on write; 400 on bad slug or out-of-range targetIndex;
 * 404 if slug isn't present; 412 on If-Match miss; bubbles other writer
 * errors as 5xx via the caller's try/catch.
 */
export async function handleMove(args: {
  path: string;
  ifMatch: string | undefined;
  body: { slug?: unknown; targetIndex?: unknown };
}): Promise<ApiResult> {
  const { path, ifMatch, body } = args;

  if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug)) {
    return { status: 400, body: { ok: false, error: 'invalid slug' } };
  }
  if (typeof body.targetIndex !== 'number' || !Number.isInteger(body.targetIndex)) {
    return { status: 400, body: { ok: false, error: 'invalid targetIndex' } };
  }

  const raw = await readFile(path, 'utf8');
  const currentHash = sha256(raw);

  if (ifMatch === undefined || ifMatch !== currentHash) {
    return { status: 412, body: { ok: false, error: 'etag mismatch' } };
  }

  let next: string;
  try {
    next = moveBlock(raw, body.slug, body.targetIndex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/.test(msg)) return { status: 404, body: { ok: false, error: msg } };
    if (/range/.test(msg)) return { status: 400, body: { ok: false, error: msg } };
    throw err;
  }

  await atomicWriteFile(path, next);
  return { status: 200, body: { ok: true, etag: sha256(next) } };
}

/**
 * Cross-section move from backlog to roadmap. Combined If-Match is
 * `sha256(roadmap):sha256(backlog)`. On 200 we return the new combined ETag.
 *
 * Atomicity: per-file tmp+rename, but the pair is sequential. See
 * `crossSection` below — if the second write fails, we log a recovery hint
 * and return 500 (spec §2).
 */
export async function handlePromote(args: {
  roadmapPath: string;
  backlogPath: string;
  ifMatch: string | undefined;
  slug: string;
}): Promise<ApiResult> {
  return crossSection({ source: 'backlog', ...args });
}

/**
 * Cross-section move from roadmap to backlog. Mirror of `handlePromote`.
 */
export async function handleDemote(args: {
  roadmapPath: string;
  backlogPath: string;
  ifMatch: string | undefined;
  slug: string;
}): Promise<ApiResult> {
  return crossSection({ source: 'roadmap', ...args });
}

async function crossSection(args: {
  source: 'roadmap' | 'backlog';
  roadmapPath: string;
  backlogPath: string;
  ifMatch: string | undefined;
  slug: string;
}): Promise<ApiResult> {
  const { source, roadmapPath, backlogPath, ifMatch, slug } = args;

  if (!SLUG_RE.test(slug)) {
    return { status: 400, body: { ok: false, error: 'invalid slug' } };
  }

  const [roadmapRaw, backlogRaw] = await Promise.all([
    readFile(roadmapPath, 'utf8'),
    readFile(backlogPath, 'utf8'),
  ]);
  const rHash = sha256(roadmapRaw);
  const bHash = sha256(backlogRaw);
  const expected = `${rHash}:${bHash}`;

  if (ifMatch === undefined || ifMatch !== expected) {
    return { status: 412, body: { ok: false, error: 'etag mismatch' } };
  }

  const sourceRaw = source === 'roadmap' ? roadmapRaw : backlogRaw;
  const destRaw = source === 'roadmap' ? backlogRaw : roadmapRaw;
  const sourcePath = source === 'roadmap' ? roadmapPath : backlogPath;
  const destPath = source === 'roadmap' ? backlogPath : roadmapPath;

  let removed: { newRaw: string; removedBlock: string };
  try {
    removed = removeBlock(sourceRaw, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/.test(msg)) return { status: 404, body: { ok: false, error: msg } };
    throw err;
  }

  let newDest: string;
  try {
    newDest = insertBlock(destRaw, removed.removedBlock, 0, 3);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { ok: false, error: msg } };
  }

  // Sequential per-file atomic writes (spec §2). If the second write fails,
  // the source is already updated — we log a recovery hint so the operator
  // can `git restore` to recover, then return 500.
  try {
    await atomicWriteFile(sourcePath, removed.newRaw);
  } catch (err) {
    console.error('[api/blocks] source write failed', {
      phase: 'source-rename',
      sourcePath,
      slug,
      err,
    });
    return { status: 500, body: { ok: false, error: 'source write failed' } };
  }
  try {
    await atomicWriteFile(destPath, newDest);
  } catch (err) {
    console.error('[api/blocks] destination write failed AFTER source moved', {
      phase: 'destination-rename',
      sourcePath,
      destPath,
      slug,
      err,
      hint: 'run `git restore docs/roadmap.md docs/backlog.md` to revert',
    });
    return {
      status: 500,
      body: { ok: false, error: 'destination write failed; source already moved' },
    };
  }

  const newRHash = source === 'roadmap' ? sha256(removed.newRaw) : sha256(newDest);
  const newBHash = source === 'backlog' ? sha256(removed.newRaw) : sha256(newDest);
  return { status: 200, body: { ok: true, etag: `${newRHash}:${newBHash}` } };
}
