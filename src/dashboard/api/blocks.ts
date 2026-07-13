import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { countEntries, insertBlock, moveBlock, removeBlock } from '../../utils/write-blocks.js';

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
// Single-token fields (area / type / size / impact). Permits the kebab/word
// shapes the roadmap uses (`web`, `tooling`, `cross-cutting`) and rejects
// newlines or markdown that would break the bullet structure of an added block.
const TOKEN_RE = /^[\w-]+$/;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Fields for a new roadmap entry. `name` and `area` are required; the rest are
 * optional. `since` is injected by the caller (the server stamps today's date)
 * so this layer stays clock-free and unit-testable.
 */
export interface NewEntryFields {
  name: string;
  area: string;
  since: string;
  type?: string;
  size?: string;
  impact?: string;
  description?: string;
}

/**
 * Build a schema-C roadmap block (H3 heading + `- area:` bullet + optional
 * bullets + optional body) from validated fields. Pure — no IO, no clock.
 * Bullet order mirrors the roadmap convention (area, type, since, size,
 * impact). The trailing newline keeps `insertBlock` splices well-formed.
 */
export function buildRoadmapBlock(fields: NewEntryFields): string {
  const bullets = [`- area: ${fields.area}`];
  if (fields.type) bullets.push(`- type: ${fields.type}`);
  bullets.push(`- since: ${fields.since}`);
  if (fields.size) bullets.push(`- size: ${fields.size}`);
  if (fields.impact) bullets.push(`- impact: ${fields.impact}`);

  const parts = [`### ${fields.name}`, '', ...bullets];
  const body = fields.description?.trim();
  if (body) parts.push('', body);
  return `${parts.join('\n')}\n`;
}

/**
 * Remove one block from `path` by slug. Single-file mutation (no cross-section
 * move) — `ifMatch = sha256(currentFileContents)`, mirroring {@link handleMove}.
 *
 * Status codes: 200 on write; 400 on bad slug; 404 if slug isn't present;
 * 412 on If-Match miss; other writer errors bubble as 5xx via the caller.
 */
export async function handleRemove(args: {
  path: string;
  ifMatch: string | undefined;
  slug: string;
}): Promise<ApiResult> {
  const { path, ifMatch, slug } = args;

  if (!SLUG_RE.test(slug)) {
    return { status: 400, body: { ok: false, error: 'invalid slug' } };
  }

  const raw = await readFile(path, 'utf8');
  const currentHash = sha256(raw);

  if (ifMatch === undefined || ifMatch !== currentHash) {
    return { status: 412, body: { ok: false, error: 'etag mismatch' } };
  }

  let next: string;
  try {
    next = removeBlock(raw, slug).newRaw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/.test(msg)) return { status: 404, body: { ok: false, error: msg } };
    throw err;
  }

  await atomicWriteFile(path, next);
  return { status: 200, body: { ok: true, etag: sha256(next) } };
}

/**
 * Insert a new roadmap entry at the top (`position: 'top'`, index 0 — mirrors
 * {@link handlePromote}) or bottom (`position: 'bottom'`, appended after the
 * last entry) of `path`. Single-file mutation with `ifMatch =
 * sha256(currentFileContents)`.
 *
 * Status codes: 200 on write; 400 on missing/invalid fields or bad position;
 * 412 on If-Match miss; writer errors bubble as 5xx.
 */
export async function handleAdd(args: {
  path: string;
  ifMatch: string | undefined;
  position: 'top' | 'bottom';
  fields: {
    name?: unknown;
    area?: unknown;
    since?: unknown;
    type?: unknown;
    size?: unknown;
    impact?: unknown;
    description?: unknown;
  };
}): Promise<ApiResult> {
  const { path, ifMatch, position, fields } = args;

  if (position !== 'top' && position !== 'bottom') {
    return { status: 400, body: { ok: false, error: 'invalid position' } };
  }

  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  // Reject newlines and a leading `#`: the name becomes the `### <name>`
  // heading line, so a leading hash would render as `### #### name` and parse
  // back with stray hashes. (Mid-string `#` is fine — e.g. "C# support".)
  if (name === '' || name.includes('\n') || name.startsWith('#')) {
    return { status: 400, body: { ok: false, error: 'invalid name' } };
  }
  const area = typeof fields.area === 'string' ? fields.area.trim() : '';
  if (!TOKEN_RE.test(area)) {
    return { status: 400, body: { ok: false, error: 'invalid area' } };
  }
  const since = typeof fields.since === 'string' ? fields.since.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { status: 400, body: { ok: false, error: 'invalid since' } };
  }

  const optional: Record<'type' | 'size' | 'impact', string | undefined> = {
    type: undefined,
    size: undefined,
    impact: undefined,
  };
  for (const key of ['type', 'size', 'impact'] as const) {
    const v = fields[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !TOKEN_RE.test(v.trim())) {
      return { status: 400, body: { ok: false, error: `invalid ${key}` } };
    }
    optional[key] = v.trim();
  }
  // The description lands verbatim in the block body, which is line-structural
  // markdown (schema-C). A line-start heading (`### …`) injects a phantom entry
  // and an unbalanced code fence (```) makes `scanBlocks`/`parseRoadmap` swallow
  // every following entry — silent corruption. Reject both rather than attempt
  // lossy escaping; inline backticks and mid-line `#` remain allowed.
  let description: string | undefined;
  if (typeof fields.description === 'string' && fields.description.trim() !== '') {
    if (/^\s*(#{1,6}\s|```)/m.test(fields.description)) {
      return { status: 400, body: { ok: false, error: 'invalid description' } };
    }
    description = fields.description;
  }

  const raw = await readFile(path, 'utf8');
  const currentHash = sha256(raw);
  if (ifMatch === undefined || ifMatch !== currentHash) {
    return { status: 412, body: { ok: false, error: 'etag mismatch' } };
  }

  const block = buildRoadmapBlock({ name, area, since, description, ...optional });
  const targetIndex = position === 'top' ? 0 : countEntries(raw);
  let next: string;
  try {
    next = insertBlock(raw, block, targetIndex, 3);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { ok: false, error: msg } };
  }

  await atomicWriteFile(path, next);
  return { status: 200, body: { ok: true, etag: sha256(next) } };
}

/**
 * Reorder one block within `path` to `targetIndex` (0-based among same-section
 * entries) or to a named `position` (`'top'` = index 0, `'bottom'` = last
 * index, resolved server-side against the current file so a filtered client
 * view never has to know the total entry count). Exactly one of
 * `targetIndex` / `position` must be present. The caller supplies
 * `ifMatch = sha256(currentFileContents)`; mismatch returns 412 to surface a
 * concurrent edit before we clobber.
 *
 * Status codes: 200 on write; 400 on bad slug, bad position, or
 * out-of-range targetIndex; 404 if slug isn't present; 412 on If-Match miss;
 * bubbles other writer errors as 5xx via the caller's try/catch.
 */
export async function handleMove(args: {
  path: string;
  ifMatch: string | undefined;
  body: { slug?: unknown; targetIndex?: unknown; position?: unknown };
}): Promise<ApiResult> {
  const { path, ifMatch, body } = args;

  if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug)) {
    return { status: 400, body: { ok: false, error: 'invalid slug' } };
  }
  const hasPosition = body.position !== undefined;
  if (hasPosition) {
    if (body.position !== 'top' && body.position !== 'bottom') {
      return { status: 400, body: { ok: false, error: 'invalid position' } };
    }
    if (body.targetIndex !== undefined) {
      return { status: 400, body: { ok: false, error: 'targetIndex and position are exclusive' } };
    }
  } else if (typeof body.targetIndex !== 'number' || !Number.isInteger(body.targetIndex)) {
    return { status: 400, body: { ok: false, error: 'invalid targetIndex' } };
  }

  const raw = await readFile(path, 'utf8');
  const currentHash = sha256(raw);

  if (ifMatch === undefined || ifMatch !== currentHash) {
    return { status: 412, body: { ok: false, error: 'etag mismatch' } };
  }

  const targetIndex = hasPosition
    ? body.position === 'top'
      ? 0
      : Math.max(0, countEntries(raw) - 1)
    : (body.targetIndex as number);

  let next: string;
  try {
    next = moveBlock(raw, body.slug, targetIndex);
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
