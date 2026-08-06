import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import { DEFAULT_CR_LANES, loadConfig, resolveReviewProfile } from '../core/config.js';
import type { NoldorConfig } from '../core/config.js';
import {
  LEGACY_BY_CANONICAL,
  REVIEWER_MANDATORY_KINDS,
  withMandatoryReviewer,
} from '../core/lanes.js';
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { LaneInput, LaneResult } from './lane-types.js';
import type { OrchestrateArgs } from './orchestrate-args.js';
import { runManual } from './lanes/manual.js';
import { codexSupportsBaseSha, runCodex } from './lanes/codex.js';
import { runSubagent } from './lanes/subagent.js';
import { runVerify } from './lanes/verify.js';
import { promptSelect } from '../core/prompt-stdin.js';
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
  reviewer: runSubagent,
  verifier: runVerify,
};

export function resolveLanes(
  args: { slug: string; kind: ArtifactKind; lanes?: Lane[]; autonomous?: boolean },
  cfg: NoldorConfig | null,
): Lane[] {
  // Every resolved set passes through withMandatoryReviewer: on spec/plan the
  // `reviewer` lane is always-on, so neither an operator's lane pick nor a
  // configured crLanes block can ship an unreviewed artifact.
  // 1. Explicit --lanes always wins.
  if (args.lanes && args.lanes.length > 0) return withMandatoryReviewer(args.kind, args.lanes);
  // 2. Autonomous / skipLanePicker path: configured crLanes.<kind> when present,
  //    else the built-in autonomous-safe default (subagent). Never throws — a
  //    missing crLanes block is no longer a hard error.
  if (args.autonomous || cfg?.autonomous?.skipLanePicker) {
    const configured = cfg?.crLanes?.[args.kind];
    return withMandatoryReviewer(
      args.kind,
      configured && configured.length > 0 ? configured : DEFAULT_CR_LANES[args.kind],
    );
  }
  // 3. Interactive mode, no CLI flag: empty signals the /noldor-gate skill to prompt.
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

/** Canonical sink path + any legacy-named path a pre-0.7.0 run may have written. */
function sinkCandidatePaths(cwd: string, slug: string, kind: ArtifactKind, lane: Lane): string[] {
  const names = [lane, ...(lane in LEGACY_BY_CANONICAL ? [LEGACY_BY_CANONICAL[lane]] : [])];
  return names.map((n) => join(cwd, '.noldor', 'cr', `${slug}-${kind}-${n}.json`));
}

/**
 * Path of the first sink that exists for `lane` — canonical first, then any
 * legacy-named one (pre-0.7.0) — or `null` when the lane has no prior run.
 * Probes with `stat` rather than reading: an existence test shouldn't load the
 * file, and a path that exists but isn't a regular file is not a prior run.
 */
async function findExistingSink(
  cwd: string,
  slug: string,
  kind: ArtifactKind,
  lane: Lane,
): Promise<string | null> {
  for (const candidate of sinkCandidatePaths(cwd, slug, kind, lane)) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

/**
 * True when `lane` has a prior sink that recorded no blockers. Anything else —
 * no sink, unreadable/corrupt sink, or a sink carrying blockers — is false, so
 * callers gate the delta short-circuit on a review that actually went green
 * instead of on the mere presence of a file. Applies to every lane and every
 * artifact kind: a lane-specific exemption would let a red round be cleared by
 * a no-op re-run.
 */
async function priorRunWasGreen(
  cwd: string,
  slug: string,
  kind: ArtifactKind,
  lane: Lane,
): Promise<boolean> {
  const path = await findExistingSink(cwd, slug, kind, lane);
  if (path === null) return false;
  try {
    const prior = JSON.parse(await readFile(path, 'utf8')) as { blockers?: unknown[] };
    // `blockers` carries `.default([])` in the sink schema, so an absent key is
    // a green record, not a malformed one (see findings-schema.ts).
    const blockers = prior.blockers ?? [];
    return Array.isArray(blockers) && blockers.length === 0;
  } catch {
    return false;
  }
}

export async function guardLaneOverwrite(
  lanes: Lane[],
  ctx: GuardCtx,
  opts: GuardOpts = {},
): Promise<Lane[]> {
  const keep: Lane[] = [];
  for (const lane of lanes) {
    const path = await findExistingSink(ctx.cwd, ctx.slug, ctx.kind, lane);
    if (path === null) {
      keep.push(lane);
      continue;
    }
    // `keep-and-skip` drops the lane from `effective`, and the exit code only
    // inspects lanes that ran — so offering it for a mandatory reviewer lane
    // would let a stale (or red) prior sink stand in for the review the kind
    // requires. The mandatory lane gets overwrite / archive-and-overwrite only.
    const unskippable = lane === 'reviewer' && REVIEWER_MANDATORY_KINDS.includes(ctx.kind);
    const choices: Array<{ name: string; value: 'overwrite' | 'archive' | 'skip' }> = [
      { name: 'overwrite', value: 'overwrite' },
      { name: 'archive-and-overwrite', value: 'archive' },
    ];
    if (!unskippable) choices.push({ name: 'keep-and-skip', value: 'skip' });
    const choice = opts.autonomous
      ? ('archive' as const)
      : await promptSelect({
          message: unskippable
            ? `reviewer sink already exists for ${ctx.slug}-${ctx.kind}; overwrite? (reviewer is mandatory for ${ctx.kind} — it cannot be skipped)`
            : `${lane} sink already exists for ${ctx.slug}-${ctx.kind}; overwrite?`,
          choices,
        });
    // A `skip` for an unskippable lane is ignored rather than honored — the
    // invariant must not depend on the prompt having withheld the choice.
    if (choice === 'skip' && !unskippable) continue;
    if (choice === 'archive') {
      // Best-effort: an unreadable prior sink (EACCES) must not turn a lane that
      // was about to run into a rejected orchestrate call. Losing the archive
      // copy costs history, not correctness — the lane still re-reviews below.
      try {
        const archDir = join(ctx.cwd, '.noldor', 'cr', 'archive');
        await mkdir(archDir, { recursive: true });
        const ts = Date.now();
        await copyFile(path, join(archDir, `${ts}-${ctx.slug}-${ctx.kind}-${lane}.json`));
      } catch (err) {
        console.error(`could not archive prior ${lane} sink: ${(err as Error).message}`);
      }
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
  const reviewProfile = resolveReviewProfile(cfg, opts.args.profile);
  const requested = resolveLanes(opts.args, cfg);
  if (requested.includes('standalone')) {
    throw new Error(
      "lane 'standalone' is no longer an orchestrate lane — deep review spawns via 'noldor cr escalate' (spawn-deep-review)",
    );
  }
  if (requested.includes('verifier') && opts.args.kind !== 'code') {
    throw new Error(
      "lane 'verifier' is code-only — remove it from --lanes / crLanes for spec/plan artifacts",
    );
  }
  // Visibility for the mandatory-reviewer union: an operator pick or a crLanes
  // block that omitted `reviewer` on a spec/plan silently gains it, so say so
  // rather than letting the run differ from what was asked for. Announced only
  // once the lane set is past the rejections above, so a run that throws never
  // claims to have added a lane it will not run.
  const picked =
    opts.args.lanes && opts.args.lanes.length > 0
      ? opts.args.lanes
      : (cfg?.crLanes?.[opts.args.kind] ?? []);
  if (picked.length > 0 && !picked.includes('reviewer') && requested.includes('reviewer')) {
    console.error(
      `lane 'reviewer' is mandatory for ${opts.args.kind} artifacts — added to the requested lanes`,
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
    reviewProfile,
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
  // every lane whose prior run went green. Re-reviewing an unchanged artifact is
  // wasteful; synthesizing a pass for a lane that never went green is a lie.
  const isEmptyDiff = opts.isEmptyDiff ?? isEmptyDiffDefault;
  const syntheticOks: Lane[] = [];
  let fullReviewOverride = false;
  if (input.baseSha && !input.fullReview) {
    const empty = await isEmptyDiff(cwd, input.baseSha, input.artifactSha, input.artifact);
    if (empty) {
      const stillToRun: Lane[] = [];
      for (const l of effective) {
        // "No changes since prior run" presupposes a prior run that went green.
        // A lane with no sink was never reviewed at all, and one with a red sink
        // has blockers nobody addressed — synthesizing a pass in either case
        // hands the artifact a receipt it never earned. Gated for EVERY lane and
        // EVERY kind: while only the spec/plan `reviewer` lane was guarded, an
        // unaddressed red on `manual` / `codex` / `verifier` — or on any
        // `code`-kind lane, which is the one that amends the push receipt — was
        // overwritten by `blockers: []` on the next no-op re-run.
        if (!(await priorRunWasGreen(cwd, opts.args.slug, opts.args.kind, l))) {
          stillToRun.push(l);
          continue;
        }
        await writeSyntheticOk(input, l);
        syntheticOks.push(l);
      }
      effective = stillToRun;
      // Those lanes run with the artifact diff known-empty, so the delta prompt
      // would put nothing in front of the reviewer. Give them the whole
      // artifact instead — a review of zero content is worse than no review,
      // since it writes a green sink.
      if (stillToRun.length > 0) fullReviewOverride = true;
    }
  }

  const lanesRun: Lane[] = [...syntheticOks];

  // Pre-cache the codex --base-sha probe result for all-settled batch
  const codexBaseShaSupport = effective.includes('codex') ? await codexSupportsBaseSha() : false;

  // Every lane surviving a `fullReviewOverride` round is there for the same
  // reason — its prior run wasn't green — and each faces the same known-empty
  // artifact diff, so widening the whole batch is right rather than merely safe.
  let dispatchInput = input;
  if (fullReviewOverride) {
    dispatchInput = { ...input, fullReview: true };
    delete dispatchInput.baseSha;
  }

  const settled = await Promise.allSettled(
    effective.map((l) => {
      if (l === 'codex') return runCodex(dispatchInput, { supportsBaseSha: codexBaseShaSupport });
      // standalone can't reach here — run() rejects it at entry.
      return LANES[l as Exclude<Lane, 'standalone'>](dispatchInput);
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
  if (exitCode === 0 && opts.args.kind === 'code' && lanesRun.includes('reviewer')) {
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
