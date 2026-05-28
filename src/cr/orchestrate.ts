import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import { loadConfig } from './config.js';
import type { NoldorConfig } from './config.js';
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { LaneInput, LaneResult } from './lane-types.js';
import type { OrchestrateArgs } from './orchestrate-args.js';
import { runManual } from './lanes/manual.js';
import { codexSupportsBaseSha, runCodex } from './lanes/codex.js';
import { runSubagent } from './lanes/subagent.js';
import { multiterminalDepDone, runStandalone } from './lanes/standalone.js';
import { promptSelect } from './prompt-stdin.js';
import { amendSubagentReceipt } from './amend-receipt.js';

// Hand-rolled promise wrapper around execFile (NOT promisify) — keeps parity
// with lanes/standalone.ts where vitest replaces execFile directly and would
// lose promisify's custom-promisified symbol.
function execAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) rejectP(err);
      else resolveP({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Uniform lane dispatch — codex's optional 2nd arg is supplied separately in
// the allSettled batch below, so this record only needs the 1-arg shape.
const LANES: Record<Lane, (input: LaneInput) => Promise<LaneResult>> = {
  manual: runManual,
  codex: runCodex,
  subagent: runSubagent,
  standalone: runStandalone,
};

export function resolveLanes(
  args: { slug: string; kind: ArtifactKind; lanes?: Lane[]; autonomous?: boolean },
  cfg: NoldorConfig | null,
): Lane[] {
  if (args.lanes && args.lanes.length > 0) return args.lanes;
  if (cfg?.autonomous?.skipLanePicker && cfg.crLanes?.[args.kind]?.length) {
    return cfg.crLanes[args.kind]!;
  }
  if (args.autonomous) {
    throw new Error('autonomous CR requires .noldor/config.json crLanes.<kind> non-empty');
  }
  return [];
}

async function isEmptyDiffDefault(
  repoRoot: string,
  baseSha: string,
  headSha: string,
  artifact: string,
): Promise<boolean> {
  try {
    await execAsync('git', ['diff', '--quiet', `${baseSha}..${headSha}`, '--', artifact], {
      cwd: repoRoot,
    });
    return true; // exit 0 = no diff
  } catch {
    return false; // exit 1 = diff present
  }
}

async function writeSyntheticOk(input: LaneInput, lane: Lane): Promise<LaneResult> {
  const sinkPath = join(
    input.repoRoot,
    '.noldor',
    'cr',
    `${input.slug}-${input.kind}-${lane}.json`,
  );
  const now = new Date().toISOString();
  const payload: LaneFindings = {
    lane,
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers: [],
    suggestions: [],
    summary: 'no changes since prior run',
    startedAt: now,
    finishedAt: now,
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
  };
  await writeJsonAtomic(sinkPath, payload);
  return { lane, sinkPath, ok: true };
}

interface GuardCtx {
  slug: string;
  kind: ArtifactKind;
  cwd: string;
}

interface GuardOpts {
  autonomous?: boolean;
}

export async function guardLaneOverwrite(
  lanes: Lane[],
  ctx: GuardCtx,
  opts: GuardOpts = {},
): Promise<Lane[]> {
  const keep: Lane[] = [];
  for (const lane of lanes) {
    const path = join(ctx.cwd, '.noldor', 'cr', `${ctx.slug}-${ctx.kind}-${lane}.json`);
    let exists = false;
    let finishedAtUnset = false;
    try {
      const raw = await readFile(path, 'utf8');
      exists = true;
      finishedAtUnset = !(JSON.parse(raw) as { finishedAt?: string }).finishedAt;
    } catch {}
    if (!exists) {
      keep.push(lane);
      continue;
    }
    if (lane === 'standalone' && finishedAtUnset) {
      // Handled by guardStandaloneInProgress (Task 5.6). Pass through.
      keep.push(lane);
      continue;
    }
    const choice = opts.autonomous
      ? ('archive' as const)
      : await promptSelect({
          message: `${lane} sink already exists for ${ctx.slug}-${ctx.kind}; overwrite?`,
          choices: [
            { name: 'overwrite', value: 'overwrite' as const },
            { name: 'archive-and-overwrite', value: 'archive' as const },
            { name: 'keep-and-skip', value: 'skip' as const },
          ],
        });
    if (choice === 'skip') continue;
    if (choice === 'archive') {
      const archDir = join(ctx.cwd, '.noldor', 'cr', 'archive');
      await mkdir(archDir, { recursive: true });
      const ts = Date.now();
      await copyFile(path, join(archDir, `${ts}-${ctx.slug}-${ctx.kind}-${lane}.json`));
    }
    keep.push(lane);
  }
  return keep;
}

export type StandaloneGuardOutcome = 'proceed' | 'skip-spawn' | 'drop-lane';

export async function guardStandaloneInProgress(
  ctx: GuardCtx,
  opts: GuardOpts = {},
): Promise<StandaloneGuardOutcome> {
  const path = join(ctx.cwd, '.noldor', 'cr', `${ctx.slug}-${ctx.kind}-standalone.json`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return 'proceed';
  }
  let parsed: { finishedAt?: string } | undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'proceed';
  }
  if (parsed?.finishedAt) return 'proceed';

  if (opts.autonomous) return 'drop-lane';

  const choice = await promptSelect({
    message: `standalone for ${ctx.slug}-${ctx.kind} is in-progress (no finishedAt); choose:`,
    choices: [
      { name: 'wait — re-aggregate without spawning', value: 'wait' as const },
      {
        name: 'kill-and-respawn — close existing iTerm2 first, then respawn',
        value: 'kill-and-respawn' as const,
      },
      {
        name: 'continue-without-lane — drop standalone from this run',
        value: 'continue-without-lane' as const,
      },
    ],
  });
  if (choice === 'wait') return 'skip-spawn';
  if (choice === 'continue-without-lane') return 'drop-lane';
  return 'proceed';
}

export interface RunOpts {
  args: OrchestrateArgs;
  cwd?: string;
  isEmptyDiff?: (
    repoRoot: string,
    baseSha: string,
    headSha: string,
    artifact: string,
  ) => Promise<boolean>;
}

export interface RunResult {
  lanesRun: Lane[];
  lanesSkippedPreDep: Lane[];
  syntheticOks: Lane[];
  exitCode: number;
}

export async function run(opts: RunOpts): Promise<RunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = await loadConfig(join(cwd, '.noldor', 'config.json')).catch(() => null);
  const requested = resolveLanes(opts.args, cfg);
  await mkdir(join(cwd, '.noldor', 'cr'), { recursive: true });

  // `artifactSha` is the SHA of the artifact's tip commit (HEAD by default).
  // CRITICAL: do NOT default it to `baseSha` — that would make every delta
  // run trivially empty-diff and short-circuit regardless of actual changes.
  // When git is unavailable (e.g. unit test tmpdir), fall back to empty string;
  // lanes that need a real sha will validate downstream.
  const headSha =
    opts.args.headSha ??
    (await execAsync('git', ['rev-parse', 'HEAD'], { cwd })
      .then((r) => r.stdout.trim())
      .catch(() => ''));
  const input: LaneInput = {
    slug: opts.args.slug,
    artifact: opts.args.artifact,
    kind: opts.args.kind,
    fdPath: `docs/features/${opts.args.slug}.md`,
    artifactSha: headSha,
    repoRoot: cwd,
    ...(opts.args.baseSha ? { baseSha: opts.args.baseSha } : {}),
    ...(opts.args.fullReview ? { fullReview: true } : {}),
  };

  // Pre-dep probes
  const lanesSkippedPreDep: Lane[] = [];
  let effective = [...requested];
  effective = await guardLaneOverwrite(
    effective,
    {
      slug: opts.args.slug,
      kind: opts.args.kind,
      cwd,
    },
    { autonomous: opts.args.autonomous },
  );
  if (effective.includes('standalone')) {
    const depDone = await multiterminalDepDone({ cwd });
    if (!depDone) {
      lanesSkippedPreDep.push('standalone');
      effective = effective.filter((l) => l !== 'standalone');
    }
  }

  // Delta short-circuit: empty diff + baseSha + !fullReview => synthetic OK for
  // EVERY lane including standalone (Decision §4). Spawning iTerm2 +
  // --max-thinking to re-read an unchanged artifact is wasteful.
  const isEmptyDiff = opts.isEmptyDiff ?? isEmptyDiffDefault;
  const syntheticOks: Lane[] = [];
  if (input.baseSha && !input.fullReview) {
    const empty = await isEmptyDiff(cwd, input.baseSha, input.artifactSha, input.artifact);
    if (empty) {
      for (const l of effective) {
        await writeSyntheticOk(input, l);
        syntheticOks.push(l);
      }
      effective = [];
    }
  }

  // Standalone first (fire-and-continue) — only when not short-circuited above
  const lanesRun: Lane[] = [...syntheticOks];
  if (effective.includes('standalone')) {
    const outcome = await guardStandaloneInProgress(
      {
        slug: opts.args.slug,
        kind: opts.args.kind,
        cwd,
      },
      { autonomous: opts.args.autonomous },
    );
    if (outcome === 'drop-lane' || outcome === 'skip-spawn') {
      effective = effective.filter((l) => l !== 'standalone');
    }
  }
  if (effective.includes('standalone')) {
    try {
      await runStandalone(input);
      lanesRun.push('standalone');
    } catch (err) {
      console.error(`standalone lane failed: ${(err as Error).message}`);
    }
    effective = effective.filter((l) => l !== 'standalone');
  }

  // Pre-cache the codex --base-sha probe result for all-settled batch
  const codexBaseShaSupport = effective.includes('codex') ? await codexSupportsBaseSha() : false;

  const settled = await Promise.allSettled(
    effective.map((l) => {
      if (l === 'codex') return runCodex(input, { supportsBaseSha: codexBaseShaSupport });
      return LANES[l](input);
    }),
  );

  for (let i = 0; i < effective.length; i++) {
    if (settled[i].status === 'fulfilled') lanesRun.push(effective[i]);
  }

  // Exit code: 0 only if all sync lanes ok. Standalone async => doesn't affect.
  let exitCode = 0;
  for (let i = 0; i < effective.length; i++) {
    const r = settled[i];
    if (r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as LaneResult).ok)) {
      exitCode = 1;
    }
  }

  // Step-4 receipt: code-stage subagent lane went clean → amend tip commit so
  // the pre-push hook can validate `Noldor-Reviewed-Subagent: <tree>` against
  // HEAD^{tree}. Skip for spec/plan stages (those don't reach pre-push) and
  // skip when any lane was red.
  if (exitCode === 0 && opts.args.kind === 'code' && lanesRun.includes('subagent')) {
    try {
      amendSubagentReceipt({ cwd });
    } catch (err) {
      console.error(`receipt amend failed: ${(err as Error).message}`);
      exitCode = 1;
    }
  }

  return { lanesRun, lanesSkippedPreDep, syntheticOks, exitCode };
}

// CLI entry — wired up in Task 5.4
if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseArgs } = await import('./orchestrate-args.js');
  const args = parseArgs(process.argv);
  const r = await run({ args });
  console.log(`lanes run: ${r.lanesRun.join(', ')}`);
  if (r.syntheticOks.length)
    console.log(`synthetic OK (empty delta): ${r.syntheticOks.join(', ')}`);
  if (r.lanesSkippedPreDep.length)
    console.log(`skipped (pre-dep): ${r.lanesSkippedPreDep.join(', ')}`);
  process.exit(r.exitCode);
}
