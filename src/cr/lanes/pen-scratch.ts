// @tests: ui-design-review-lane
// The pen-integrity mechanism both design lanes share: stage a private scratch
// COPY of the repo's `.pen` (pencil `execute` is the editor's write API, so a
// child never gets a path inside the repo), remember the repo file's hash, and
// answer "did the design change under its own review?" afterwards. One module
// so `ui-reviewer` and `render-compare` cannot drift on the one check that
// invalidates a round in both modes (`pen-modified`).

import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import type { Lane } from '../findings-schema.js';
import { loadLaneMode } from '../lane-mode.js';
import type { LaneMode } from '../lane-mode.js';
import { openLaneSink } from '../lane-sink.js';
import type { LaneSink } from '../lane-sink.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import {
  makeTerminalWriter,
  resolveUiReviewTarget,
  unmappedPathNotes,
} from './ui-design-resolve.js';
import type { ResolvedDesign } from './ui-design-resolve.js';

/** sha256 hex of a file's current bytes. */
export const sha256File = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

/** A staged scratch copy plus everything needed to check integrity later. */
export interface PenScratch {
  /** Private temp dir (mode 0700 via mkdtemp); remove with {@link cleanupPenScratch}. */
  dir: string;
  /** Absolute path of the scratch `.pen` copy handed to children. */
  penPath: string;
  /** Repo file's hash at staging time — the only `pen-modified` reference. */
  hashBefore: string;
  /**
   * Integrity verdict for the repo's design file across the round. A design
   * that became unreadable DURING its own review (deleted, chmod'd) is the
   * mutation class the hash exists to catch, so it reads as changed rather
   * than escaping as an unhandled throw.
   */
  designChanged: () => Promise<{ changed: boolean; detail: string }>;
}

/**
 * Stage the scratch copy, or report why it could not be staged (the caller
 * maps the failure to its `scratch-unavailable` terminal). mkdtemp creates the
 * directory with a unique name and mode 0700, which is what makes concurrent
 * worktree rounds and symlink clobbering non-issues.
 */
export async function stagePenScratch(
  absPenPath: string,
  slug: string,
  prefix: string,
): Promise<{ scratch: PenScratch } | { scratch: null; detail: string }> {
  let dir: string | null = null;
  try {
    const hashBefore = await sha256File(absPenPath);
    dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
    const penPath = join(dir, `${slug}.pen`);
    await copyFile(absPenPath, penPath);
    return {
      scratch: {
        dir,
        penPath,
        hashBefore,
        designChanged: async () => {
          try {
            return { changed: (await sha256File(absPenPath)) !== hashBefore, detail: '' };
          } catch (err) {
            return {
              changed: true,
              detail: `design unreadable after review: ${errMessage(err)}`,
            };
          }
        },
      },
    };
  } catch (err) {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true }).catch((e: unknown) => {
        console.error(`${prefix}: scratch cleanup failed: ${errMessage(e)}`);
      });
    }
    return { scratch: null, detail: `could not stage a design copy: ${errMessage(err)}` };
  }
}

/**
 * Remove the scratch dir, never throwing: losing a tmpdir costs disk, while a
 * cleanup throw after the sink was written would cost the round's honesty.
 */
export async function cleanupPenScratch(dir: string | null, prefix: string): Promise<void> {
  if (dir === null) return;
  await rm(dir, { recursive: true, force: true }).catch((err: unknown) => {
    console.error(`${prefix}: scratch cleanup failed for ${dir}: ${errMessage(err)}`);
  });
}

/** Everything a design lane needs once its round is actually reviewable. */
export interface DesignRoundCtx {
  write: LaneSink['write'];
  writeTerminal: ReturnType<typeof makeTerminalWriter>;
  design: ResolvedDesign;
  /** Config-gap notes to carry on every sink of the round. */
  notes: string[];
  scratch: PenScratch;
}

/**
 * The opening sequence both design lanes share verbatim: open the sink, read
 * the lane's mode knob, resolve the review target, surface the unmapped-paths
 * note, and stage the scratch copy — writing the terminal sink itself whenever
 * any of that ends the round. `done` carries that already-written result;
 * `ready` hands the lane a live round it must finish (and whose scratch dir it
 * must clean up on every exit path).
 */
export async function openDesignReviewRound(
  input: LaneInput,
  lane: Lane,
  modeKey: 'uiReviewMode' | 'renderCompareMode',
  scratchPrefix: string,
): Promise<
  { kind: 'done'; result: LaneResult } | { kind: 'ready'; ctx: DesignRoundCtx; mode: LaneMode }
> {
  const { write } = openLaneSink(input, lane);
  const mode = await loadLaneMode(input.repoRoot, modeKey);
  const writeTerminal = makeTerminalWriter(write, mode, input.artifact);

  const resolution = await resolveUiReviewTarget(input);
  if (resolution.kind === 'terminal') {
    return { kind: 'done', result: await writeTerminal(resolution.at) };
  }
  const { design } = resolution;
  const notes = unmappedPathNotes(design);

  const staged = await stagePenScratch(design.absPath, input.slug, scratchPrefix);
  if (staged.scratch === null) {
    return {
      kind: 'done',
      result: await writeTerminal(
        { verdict: 'cannot-review', reason: 'scratch-unavailable', detail: staged.detail },
        notes,
      ),
    };
  }
  return {
    kind: 'ready',
    ctx: { write, writeTerminal, design, notes, scratch: staged.scratch },
    mode,
  };
}
