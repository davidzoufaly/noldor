// @tests: pendev-ui-design-phase
// `noldor design capture` — run each surface's consumer-declared capture
// command and write its receipt ONLY when the command exits 0.
//
// The framework wraps the capture rather than shipping a bare
// `capture-receipt` CLI for the consumer's own script to call on success. The
// defect this feature exists to remove is a signal that silently did not
// happen; leaving the receipt write to the consumer reproduces that class one
// level up, where a forgotten call — or one placed in a `finally` — restores
// the false-fresh with no diagnostic. Owning the exit-code branch here is what
// makes "receipt advanced" and "capture succeeded" the same thing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
import { loadUiConfig } from '../core/consumer-config.js';
import type { UiCaptureRecipe } from '../core/consumer-config.js';
import { UI_BASELINE_DIR as BASELINE_DIR } from '../core/design-artifact-names.js';
import { runCapture } from '../core/run-capture.js';
import type { CaptureResult } from '../core/run-capture.js';
import { IMPLICIT_SURFACE } from '../core/ui-predicate.js';
import { blobIdOfWorktreeFile, receiptRelPath, writeReceipt } from './ui-capture.js';

/** One surface's outcome, so the aggregate exit code is derived, not maintained. */
export interface SurfaceCaptureOutcome {
  surface: string;
  ok: boolean;
  detail: string;
}

/**
 * Every UI surface this repo has, whether or not it declares a capture command.
 * Derived from the same `uiSurfaces`-else-implicit-`app` rule the freshness
 * evaluator uses, so a surface cannot be UI-bearing for one and invisible to
 * the other.
 */
export function declaredSurfaces(ui: {
  uiPaths?: string[];
  uiSurfaces?: Record<string, string[]>;
}): string[] {
  if ((ui.uiPaths ?? []).length === 0) return [];
  return ui.uiSurfaces === undefined
    ? [IMPLICIT_SURFACE]
    : Object.keys(ui.uiSurfaces).sort((a, b) => a.localeCompare(b));
}

/** Injected so tests drive real behaviour without spawning a shell. */
export type CaptureRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<CaptureResult>;

/**
 * Run one surface's capture and, on exit 0, write its receipt. A timeout, a
 * non-zero exit and a spawn error are all the same thing to this function — a
 * failed capture — and all three leave the receipt untouched.
 */
export async function captureSurface(
  cwd: string,
  surface: string,
  recipe: UiCaptureRecipe,
  run: CaptureRunner,
  now: () => string,
  vouchOnly = false,
): Promise<SurfaceCaptureOutcome> {
  // `--vouch-only` exists for the gate's sanctioned baseline write-back
  // (Step 4, `NOLDOR_ALLOW_PEN_WRITE=1`), which pencil-edits the baseline by
  // hand. That edit changes the blob, so the surface mints `stale` — and
  // re-running the consumer's capture command to clear it would overwrite the
  // very edit that was just made. Vouching for what is on disk is the only
  // move that keeps a hand write-back and a green check compatible.
  const result = vouchOnly
    ? { code: 0, timedOut: false, stderrTail: '' }
    : await run(recipe.command, cwd, recipe.timeoutMs);
  if (result.timedOut) {
    return {
      surface,
      ok: false,
      detail: `capture timed out after ${recipe.timeoutMs}ms — receipt unchanged${result.stderrTail ? `\n    ${result.stderrTail}` : ''}`,
    };
  }
  if (result.code !== 0) {
    return {
      surface,
      ok: false,
      detail: `capture exited ${result.code} — receipt unchanged${result.stderrTail ? `\n    ${result.stderrTail}` : ''}`,
    };
  }
  const baseline = join(cwd, BASELINE_DIR, `${surface}.pen`);
  if (!existsSync(baseline)) {
    // Exit 0 having produced no baseline is a broken capture command, not a
    // success: vouching for a file that is not there would be the false-fresh
    // in a new costume.
    return {
      surface,
      ok: false,
      detail: `capture exited 0 but ${BASELINE_DIR}/${surface}.pen does not exist — receipt unchanged`,
    };
  }
  const rel = `${BASELINE_DIR}/${surface}.pen`;
  const blob = blobIdOfWorktreeFile(cwd, rel);
  if (blob === null) {
    // No id means no binding proof, and a receipt without one would vouch for a
    // baseline nothing can check. Refuse rather than write a weaker receipt.
    return {
      surface,
      ok: false,
      detail: `could not compute a git object id for ${rel} — receipt unchanged`,
    };
  }
  const written = writeReceipt(cwd, surface, {
    capturedAt: now(),
    baselineBlob: blob,
    command: vouchOnly ? `${recipe.command} (vouched by hand, not re-run)` : recipe.command,
  });
  if (!written.ok) return { surface, ok: false, detail: written.message };
  return {
    surface,
    ok: true,
    detail: `${vouchOnly ? 'vouched for the baseline on disk' : 'captured'} — wrote ${receiptRelPath(surface)}`,
  };
}

export interface CaptureDeps {
  run: CaptureRunner;
  now: () => string;
}

export async function main(
  argv: string[],
  cwd: string = process.cwd(),
  deps: CaptureDeps = { run: runCapture, now: () => new Date().toISOString() },
): Promise<number> {
  const flag = optionalFlag(argv, '--surface', 'design capture');
  if (!flag.ok) {
    console.error(flag.error);
    return 2;
  }
  const vouchOnly = argv.includes('--vouch-only');
  const ui = loadUiConfig(cwd);
  if (ui === null) {
    console.error('design capture: no consumer config');
    return 2;
  }
  const capture = ui.uiCapture ?? {};
  const surfaces = declaredSurfaces(ui);
  if (surfaces.length === 0) {
    console.error('design capture: no uiPaths configured — nothing is UI-bearing');
    return 2;
  }

  // Resolution happens BEFORE any path is built: `--surface` reaches the
  // filesystem only as a key that is already declared, so an unknown name
  // cannot address a file at all.
  if (flag.value !== undefined && !Object.hasOwn(capture, flag.value)) {
    console.error(
      surfaces.includes(flag.value)
        ? `design capture: surface '${flag.value}' declares no consumer.uiCapture command`
        : `no surface named '${flag.value}'`,
    );
    return 2;
  }

  const targets = flag.value !== undefined ? [flag.value] : surfaces;
  const undeclared = targets.filter((s) => !Object.hasOwn(capture, s));
  const outcomes: SurfaceCaptureOutcome[] = [];
  // Sequential on purpose: two captures of the same app race the same ports and
  // the same build output. Each success writes its own file as it happens, so a
  // failure part-way leaves the surfaces that worked vouched for.
  for (const surface of targets) {
    const recipe = capture[surface];
    if (recipe === undefined) continue;
    const outcome = await captureSurface(cwd, surface, recipe, deps.run, deps.now, vouchOnly);
    outcomes.push(outcome);
    console.log(`${outcome.surface}: ${outcome.ok ? 'ok' : 'FAILED'} — ${outcome.detail}`);
  }

  for (const surface of undeclared) {
    console.error(`${surface}: no consumer.uiCapture command declared — cannot vouch for it`);
  }

  const failed = outcomes.filter((o) => !o.ok).length;
  // An all-surfaces run that captured two of three must not come back green:
  // a partial pass reported as success is how a surface silently keeps a
  // baseline nobody has verified.
  const bad = failed + undeclared.length;
  console.log(
    bad === 0
      ? `captured ${outcomes.length} surface(s) — commit the baselines with their receipts under .noldor/ui-capture/`
      : `${bad} surface(s) not vouched for`,
  );
  return bad === 0 ? 0 : 1;
}

runIfDirect('ui-capture-cli', 'design capture', async () => main(process.argv.slice(2)));
