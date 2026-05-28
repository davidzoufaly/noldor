import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { z } from 'zod';

/**
 * Stamp on disk attesting that `/garden` ran successfully against a given
 * repo state. Read at release-time by {@link ensureGardenFresh} to refuse
 * publishing when nothing has run a doc-gardening pass since the last
 * tracked-file change. The shape is JSON so future fields (operator, host)
 * can be added without breaking older receipts.
 */
export const GardenReceiptSchema = z
  .object({
    timestamp: z.number().int().positive(),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();
export type GardenReceipt = z.infer<typeof GardenReceiptSchema>;

const FILE = '.noldor/garden-receipt';

export function readGardenReceipt(cwd: string = process.cwd()): GardenReceipt | null {
  const path = join(cwd, FILE);
  if (!existsSync(path)) return null;
  return GardenReceiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeGardenReceipt(receipt: GardenReceipt, cwd: string = process.cwd()): void {
  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FILE), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

interface FreshnessInputs {
  receipt: GardenReceipt | null;
  /** Unix timestamp (seconds) of the most recent tracked-file commit. */
  latestSrcTs: number;
}

interface FreshnessResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pure freshness check — extracted from {@link ensureGardenFresh} so the
 * release flow can be unit-tested without spawning `git log`.
 *
 * @returns `{ ok: true }` when a receipt exists and its timestamp is >= the
 *   most recent tracked-file commit timestamp. Otherwise an error reason
 *   describing what's stale.
 */
export function evaluateGardenFreshness(input: FreshnessInputs): FreshnessResult {
  if (input.receipt === null) {
    return {
      ok: false,
      reason:
        'No /garden receipt found. Run `/garden` (then `pnpm garden:receipt` lands at end-of-flow) before releasing.',
    };
  }
  if (input.receipt.timestamp < input.latestSrcTs) {
    return {
      ok: false,
      reason:
        `Garden receipt is stale: tracked files were committed after the last /garden run. ` +
        `Run /garden again before releasing (receipt @ ${new Date(
          input.receipt.timestamp * 1000,
        ).toISOString()}, latest commit @ ${new Date(input.latestSrcTs * 1000).toISOString()}).`,
    };
  }
  return { ok: true };
}

/**
 * Source paths whose most-recent commit timestamp gates the receipt. Mirrors
 * the `apps/ packages/ scripts/` scope used by `ensureGraphFresh()` in
 * `scripts/release/index.ts` so the two release-time freshness checks track
 * the same "src commit" universe. Scoping is the load-bearing detail —
 * without it, garden's own regen-chain commits would re-stale the receipt
 * the moment they land, forcing operators into a `/garden` loop or routine
 * `RELEASE_SKIP_GARDEN_GATE=1` use.
 */
const GARDEN_SRC_PATHS = ['apps/', 'packages/', 'scripts/'] as const;

/**
 * Release-time gate: refuses to proceed unless `/garden` has been run since
 * the last commit under {@link GARDEN_SRC_PATHS}. Mirrors
 * `ensureGraphFresh()`'s shape.
 *
 * Bypass via `RELEASE_SKIP_GARDEN_GATE=1` for bootstrap commits (commits
 * that predate this gate's existence). The bypass is stdout-loud but has
 * no persistent audit ledger today — operators should treat each usage
 * as exceptional. Persistent override tracking is a candidate follow-up.
 */
export function ensureGardenFresh(cwd: string = process.cwd()): void {
  if (process.env.RELEASE_SKIP_GARDEN_GATE === '1') {
    console.log('→ ensureGardenFresh (SKIPPED via RELEASE_SKIP_GARDEN_GATE=1)');
    return;
  }
  const receipt = readGardenReceipt(cwd);
  const raw = execFileSync('git', ['log', '-1', '--format=%ct', '--', ...GARDEN_SRC_PATHS], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const latestSrcTs = raw.length > 0 ? Number(raw) : 0;
  const result = evaluateGardenFreshness({ receipt, latestSrcTs });
  if (!result.ok) throw new Error(result.reason);
}

async function main(): Promise<void> {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const timestamp = Math.floor(Date.now() / 1000);
  writeGardenReceipt({ headSha, timestamp });
  console.log(
    `Garden receipt stamped: ${headSha.slice(0, 7)} @ ${new Date(timestamp * 1000).toISOString()}`,
  );
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('garden-receipt');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
