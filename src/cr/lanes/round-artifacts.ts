// @tests: ui-design-review-lane
// The evidence-directory swap both booting design lanes need: stage, move the
// prior round ASIDE, move the new set in — a failure between the renames still
// leaves ONE complete set. Lifted out of `render-compare.ts` for `geometry-compare`.

import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';

/** One evidence file: a name inside the round directory and its bytes. */
export interface RoundArtifact {
  name: string;
  body: string | Buffer;
}

/** The swap's outcome: a failure is a detail for the sink, never a throw. */
export type SwapResult = { ok: true } | { ok: false; detail: string };

/**
 * Replace `<root>/<slug>` with `artifacts`. noldor:cut — an EMPTY list keeps the
 * prior round (arbitrated between two render-compare review rounds): files are
 * only read through the sink that references them, and an empty round's sink
 * references none. noldor:cut — a hard crash exactly between the renames can
 * leave `<root>/<slug>` absent with the trash intact; closing that needs an
 * atomic directory exchange Node lacks. Absent-but-recoverable beats mixed.
 */
export async function swapRoundArtifacts(
  root: string,
  slug: string,
  artifacts: readonly RoundArtifact[],
  unique: string = `${slug}-${process.pid}-${Date.now()}`,
): Promise<SwapResult> {
  if (artifacts.length === 0) return { ok: true };
  const finalDir = join(root, slug);
  const tmpDir = join(root, `.tmp-${unique}`);
  const trashDir = join(root, `.trash-${unique}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    for (const a of artifacts) await writeFile(join(tmpDir, a.name), a.body);
    try {
      await rename(finalDir, trashDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await rename(tmpDir, finalDir);
    } catch (err) {
      await rename(trashDir, finalDir).catch(() => {
        /* no prior round to restore */
      });
      throw err;
    }
    await rm(trashDir, { recursive: true, force: true }).catch(() => {
      /* stale trash is disk cost only; the fresh set is already in place */
    });
    return { ok: true };
  } catch (err) {
    // Never remove finalDir: it holds a complete set (prior, or just restored).
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* best-effort */
    });
    // trashDir may be the ONLY surviving set — remove it only when finalDir exists.
    if (existsSync(finalDir)) {
      await rm(trashDir, { recursive: true, force: true }).catch(() => {
        /* best-effort */
      });
    }
    return { ok: false, detail: errMessage(err) };
  }
}
