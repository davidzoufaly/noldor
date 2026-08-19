import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import { writeExpectedLanes } from './expected-lanes.js';
import {
  DEFAULT_CR_LANES,
  loadConfig,
  resolveDispatchTimeoutMs,
  resolveReviewProfile,
} from '../core/config.js';
import type { NoldorConfig } from '../core/config.js';
import {
  LEGACY_BY_CANONICAL,
  REVIEWER_MANDATORY_KINDS,
  codexIsMandatory,
  withMandatoryCodex,
  withMandatoryReviewer,
} from '../core/lanes.js';
import type { SessionPathSignal } from '../core/lanes.js';
import { readSession } from '../core/session.js';
import { laneFindingsSchema } from './findings-schema.js';
import type { ArtifactKind, Lane, LaneFindings } from './findings-schema.js';
import type { LaneInput, LaneResult, PriorReview } from './lane-types.js';
import { laneSinkPath } from './filename.js';
import type { OrchestrateArgs } from './orchestrate-args.js';
import { runManual } from './lanes/manual.js';
import { runCodex } from './lanes/codex.js';
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
  sessionPath?: SessionPathSignal,
): Lane[] {
  // Every resolved set passes through withMandatoryReviewer: on spec/plan the
  // `reviewer` lane is always-on, so neither an operator's lane pick nor a
  // configured crLanes block can ship an unreviewed artifact. withMandatoryCodex
  // then unions `codex` on spec/code rounds inside M/L/XL sessions (session
  // path is the size band's projection — see core/lanes.ts).
  const mandatory = (lanes: readonly Lane[]): Lane[] =>
    withMandatoryCodex(args.kind, sessionPath, withMandatoryReviewer(args.kind, lanes));
  // 1. Explicit --lanes always wins.
  if (args.lanes && args.lanes.length > 0) return mandatory(args.lanes);
  // 2. Autonomous / skipLanePicker path: configured crLanes.<kind> when present,
  //    else the built-in autonomous-safe default (subagent). Never throws — a
  //    missing crLanes block is no longer a hard error.
  if (args.autonomous || cfg?.autonomous?.skipLanePicker) {
    const configured = cfg?.crLanes?.[args.kind];
    return mandatory(
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
  /** True when this round mandates the codex lane (see codexIsMandatory). */
  codexMandatory?: boolean;
}

interface GuardOpts {
  autonomous?: boolean;
}

/** Canonical sink path + any legacy-named path a pre-0.7.0 run may have written. */
function sinkCandidatePaths(cwd: string, slug: string, kind: ArtifactKind, lane: Lane): string[] {
  const names = [lane, ...(lane in LEGACY_BY_CANONICAL ? [LEGACY_BY_CANONICAL[lane]] : [])];
  return names.map((n) => laneSinkPath(cwd, slug, kind, n));
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
    } catch {
      // candidate path absent — try the next one
    }
  }
  return null;
}

/**
 * The prior round a lane recorded, schema-validated — or `null` when there is
 * no usable one (absent path, fs error, unparseable JSON, zod mismatch). The
 * SINGLE prior-sink read: the delta short-circuit's green check and the
 * reviewer's prior-round context both derive from this result, so one parse
 * policy governs both. Deliberately stricter than the loose read it replaced:
 * a sink zod rejects reads as "not green", so the short-circuit re-reviews
 * instead of minting a synthetic OK from a file it could not validate.
 */
async function readPriorSinkDefault(
  cwd: string,
  slug: string,
  kind: ArtifactKind,
  lane: Lane,
): Promise<LaneFindings | null> {
  const path = await findExistingSink(cwd, slug, kind, lane);
  if (path === null) return null;
  try {
    const parsed = laneFindingsSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ReadPriorSink = typeof readPriorSinkDefault;

/**
 * True when the prior round actually went green. No sink, an invalid sink, or
 * a sink carrying blockers is false, so callers gate the delta short-circuit
 * on a review that went green instead of on the mere presence of a file.
 * Applies to every lane and every artifact kind: a lane-specific exemption
 * would let a red round be cleared by a no-op re-run.
 */
function priorSinkIsGreen(sink: LaneFindings | null): boolean {
  return sink !== null && sink.blockers.length === 0;
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
    const unskippable =
      (lane === 'reviewer' && REVIEWER_MANDATORY_KINDS.includes(ctx.kind)) ||
      (lane === 'codex' && ctx.codexMandatory === true);
    const choices: Array<{ name: string; value: 'overwrite' | 'archive' | 'skip' }> = [
      { name: 'overwrite', value: 'overwrite' },
      { name: 'archive-and-overwrite', value: 'archive' },
    ];
    if (!unskippable) choices.push({ name: 'keep-and-skip', value: 'skip' });
    const choice = opts.autonomous
      ? ('archive' as const)
      : await promptSelect({
          message: unskippable
            ? `${lane} sink already exists for ${ctx.slug}-${ctx.kind}; overwrite? (${lane} is mandatory for ${ctx.kind} — it cannot be skipped)`
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
  /** Injection seam for the prior-sink read (tests assert read counts through it). */
  readPriorSink?: ReadPriorSink;
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
  // readSession only throws when a marker file exists but cannot be parsed —
  // that fails CLOSED ('corrupt-marker' → mandate assumed on): a torn marker
  // in a genuine M/L/XL session must not silently drop the mandated codex lane.
  let sessionPath: SessionPathSignal = null;
  try {
    sessionPath = readSession(cwd)?.path ?? null;
  } catch (err) {
    sessionPath = 'corrupt-marker';
    console.error(
      `session marker unreadable — codex mandate fails closed: ${(err as Error).message}`,
    );
  }
  const requested = resolveLanes(opts.args, cfg, sessionPath);
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
  // Same visibility for the codex union — but not gated on picked.length: the
  // built-in defaults never include codex, so the mandate adds a lane even on
  // the defaults path and that too must be announced.
  if (
    codexIsMandatory(opts.args.kind, sessionPath) &&
    !picked.includes('codex') &&
    requested.includes('codex')
  ) {
    console.error(
      sessionPath === 'corrupt-marker'
        ? `lane 'codex' is mandatory for ${opts.args.kind} artifacts when the session marker is unreadable (fail-closed) — added to the requested lanes`
        : `lane 'codex' is mandatory for ${opts.args.kind} artifacts on ${sessionPath} sessions (entry size M/L/XL) — added to the requested lanes`,
    );
  }
  await mkdir(join(cwd, '.noldor', 'cr'), { recursive: true });

  // Record the resolved lane set BEFORE dispatch so `aggregate` can report a
  // lane that never wrote its sink as `unresolved` (Q-0100). `requested`, not
  // the post-guard `effective`: a keep-and-skip lane still has its prior sink,
  // and a synthetic-OK lane writes one — only a lane killed mid-run leaves the
  // expectation unmet. Empty set = interactive-mode "prompt the operator"
  // sentinel, not a resolved round — nothing to record.
  if (requested.length > 0) {
    await writeExpectedLanes(cwd, opts.args.slug, opts.args.kind, requested);
  }

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
    dispatchTimeoutMs: resolveDispatchTimeoutMs(cfg),
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
      codexMandatory: codexIsMandatory(opts.args.kind, sessionPath),
    },
    { autonomous: opts.args.autonomous },
  );
  // Prior-round reads happen here — after the guard (its archive action is a
  // copyFile, so the sink is still on disk) and before any lane can overwrite
  // its own sink. Read-once: the reviewer's single result feeds both the green
  // check below and the prior-round context attached at dispatch.
  const readPrior = opts.readPriorSink ?? readPriorSinkDefault;
  const reviewerPrior = effective.includes('reviewer')
    ? await readPrior(cwd, opts.args.slug, opts.args.kind, 'reviewer')
    : null;

  // Delta short-circuit: empty diff + baseSha + !fullReview => synthetic OK for
  // every lane whose prior run went green. Re-reviewing an unchanged artifact is
  // wasteful; synthesizing a pass for a lane that never went green is a lie.
  const isEmptyDiff = opts.isEmptyDiff ?? isEmptyDiffDefault;
  const syntheticOks: Lane[] = [];
  let fullReviewOverride = false;
  // `fixes-in-diff` only when the delta branch verified a non-empty diff. Every
  // other shape — fullReviewOverride, explicit --full-review, no baseSha —
  // keeps `reexamine`, which asserts nothing about whether the artifact changed
  // (the safe direction is re-confirmation, never suppression).
  let reviewerMode: PriorReview['mode'] = 'reexamine';
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
        const prior =
          l === 'reviewer'
            ? reviewerPrior
            : await readPrior(cwd, opts.args.slug, opts.args.kind, l);
        if (!priorSinkIsGreen(prior)) {
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
    } else {
      reviewerMode = 'fixes-in-diff';
    }
  }

  const lanesRun: Lane[] = [...syntheticOks];

  // Every lane surviving a `fullReviewOverride` round is there for the same
  // reason — its prior run wasn't green — and each faces the same known-empty
  // artifact diff, so widening the whole batch is right rather than merely safe.
  let dispatchInput = input;
  if (fullReviewOverride) {
    dispatchInput = { ...input, fullReview: true };
    delete dispatchInput.baseSha;
  }

  // Prior-round context rides ONLY the reviewer's input — attached per-lane at
  // the dispatch call, so `manual`/`codex`/`verifier` stay unchanged by
  // construction rather than by their ignoring an unknown field.
  const reviewerContext: PriorReview | undefined =
    reviewerPrior !== null && reviewerPrior.blockers.length > 0
      ? { blockers: reviewerPrior.blockers, mode: reviewerMode }
      : undefined;

  const settled = await Promise.allSettled(
    effective.map((l) => {
      const laneInput =
        l === 'reviewer' && reviewerContext !== undefined
          ? { ...dispatchInput, priorReview: reviewerContext }
          : dispatchInput;
      if (l === 'codex') return runCodex(laneInput);
      // standalone can't reach here — run() rejects it at entry.
      return LANES[l as Exclude<Lane, 'standalone'>](laneInput);
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
