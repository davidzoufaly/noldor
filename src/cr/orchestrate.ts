import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import { DEFAULT_CR_LANES, loadConfig } from './config.js';
import type { NoldorConfig } from './config.js';
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { LaneInput, LaneResult } from './lane-types.js';
import type { OrchestrateArgs } from './orchestrate-args.js';
import { runManual } from './lanes/manual.js';
import { codexSupportsBaseSha, runCodex } from './lanes/codex.js';
import { runSubagent } from './lanes/subagent.js';
import { promptSelect } from './prompt-stdin.js';
import { amendSubagentReceipt } from './amend-receipt.js';

// Hand-rolled promise wrapper around execFile (NOT promisify) — keeps parity
// with deep-review-spawn.ts where vitest replaces execFile directly and would
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
// `standalone` is intentionally absent: it is no longer an orchestrate lane
// (escalate-only deep-review spawn; the run() entry rejects it explicitly).
const LANES: Record<Exclude<Lane, 'standalone'>, (input: LaneInput) => Promise<LaneResult>> = {
  manual: runManual,
  codex: runCodex,
  subagent: runSubagent,
};

export function resolveLanes(
  args: { slug: string; kind: ArtifactKind; lanes?: Lane[]; autonomous?: boolean },
  cfg: NoldorConfig | null,
): Lane[] {
  // 1. Explicit --lanes always wins.
  if (args.lanes && args.lanes.length > 0) return args.lanes;
  // 2. Autonomous / skipLanePicker path: configured crLanes.<kind> when present,
  //    else the built-in autonomous-safe default (subagent). Never throws — a
  //    missing crLanes block is no longer a hard error.
  if (args.autonomous || cfg?.autonomous?.skipLanePicker) {
    const configured = cfg?.crLanes?.[args.kind];
    return configured && configured.length > 0 ? configured : DEFAULT_CR_LANES[args.kind];
  }
  // 3. Interactive mode, no CLI flag: empty signals the /gate skill to prompt.
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
    try {
      await readFile(path, 'utf8');
      exists = true;
    } catch {}
    if (!exists) {
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
  syntheticOks: Lane[];
  exitCode: number;
}

export async function run(opts: RunOpts): Promise<RunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = await loadConfig(join(cwd, '.noldor', 'config.json')).catch(() => null);
  const requested = resolveLanes(opts.args, cfg);
  if (requested.includes('standalone')) {
    throw new Error(
      "lane 'standalone' is no longer an orchestrate lane — deep review spawns via 'noldor cr escalate' (spawn-deep-review)",
    );
  }
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
  // Delta short-circuit: empty diff + baseSha + !fullReview => synthetic OK for
  // EVERY lane. Re-reviewing an unchanged artifact is wasteful.
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

  const lanesRun: Lane[] = [...syntheticOks];

  // Pre-cache the codex --base-sha probe result for all-settled batch
  const codexBaseShaSupport = effective.includes('codex') ? await codexSupportsBaseSha() : false;

  const settled = await Promise.allSettled(
    effective.map((l) => {
      if (l === 'codex') return runCodex(input, { supportsBaseSha: codexBaseShaSupport });
      // standalone can't reach here — run() rejects it at entry.
      return LANES[l as Exclude<Lane, 'standalone'>](input);
    }),
  );

  for (let i = 0; i < effective.length; i++) {
    if (settled[i].status === 'fulfilled') lanesRun.push(effective[i]);
  }

  // Exit code: 0 only if all sync lanes ok.
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

  return { lanesRun, syntheticOks, exitCode };
}

// CLI entry — wired up in Task 5.4
if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseArgs } = await import('./orchestrate-args.js');
  const args = parseArgs(process.argv);
  const r = await run({ args });
  console.log(`lanes run: ${r.lanesRun.join(', ')}`);
  if (r.syntheticOks.length)
    console.log(`synthetic OK (empty delta): ${r.syntheticOks.join(', ')}`);
  process.exit(r.exitCode);
}
