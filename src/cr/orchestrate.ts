import { execFile } from 'node:child_process';
import { readFileNoFollowAsync } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import { writeExpectedLanes } from './expected-lanes.js';
import { aggregate, describeStale } from './aggregate.js';
import {
  AUTOFIX_ROUND_CAP,
  appendRound,
  fingerprintBlocker,
  fingerprintBlockers,
  hasClosingRound,
  headMatches,
  readLedger,
  roundLabel,
  redRounds,
  roundVerdict,
  sessionKey,
} from './autofix-ledger.js';
import type { AutofixLedger, AutofixRound } from './autofix-ledger.js';
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
import { ruleR1, ruleR2, ruleR3 } from './reflag.js';
import type { RuleBlocker } from './reflag.js';
import { markerScopes, scanSource } from './cut-scan.js';
import {
  INTEGRITY_ONLY_DIAGNOSIS,
  arbitrationPath,
  arbitrationRecordSchema,
  integrityOnlyRemedy,
  isIntegrityOnly,
  priorRecordStands,
} from './arbitration.js';
import type { ArbitrationRecord } from './arbitration.js';
import {
  SETTLED_TRAILER,
  gitTreeReader,
  readDecisions,
  settledTrailerValue,
  stillHolds,
  updateDecisions,
  upsertDecision,
} from './decisions.js';
import type { Decision } from './decisions.js';
import type { CutScope } from './cut-scan.js';
import { artifactKindSchema, laneFindingsSchema } from './findings-schema.js';
import type { ArtifactKind, Finding, Lane, LaneFindings } from './findings-schema.js';
import type { DecidedFinding, LaneInput, LaneResult, PriorReview } from './lane-types.js';
import { REFUTED_TRAILER, judgeRound, refutedTrailerValue } from './judge.js';
import type { Demotion, JudgeRoundResult, JudgedLane } from './judge.js';
import { isLaneFailureBlocker, PRIOR_AWARE_LANES } from './re-round.js';
import { laneSinkPath } from './filename.js';
import type { OrchestrateArgs } from './orchestrate-args.js';
import { runManual } from './lanes/manual.js';
import { runCodex } from './lanes/codex.js';
import { runRenderCompare } from './lanes/render-compare.js';
import { runSubagent } from './lanes/subagent.js';
import { runUiReview } from './lanes/ui-review.js';
import { runVerify } from './lanes/verify.js';
import { promptSelect } from '../core/prompt-stdin.js';
import { amendSubagentReceipt } from './amend-receipt.js';
import { isEntrypoint } from '../core/cli-entry.js';

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
  'ui-reviewer': runUiReview,
  'render-compare': runRenderCompare,
};

/**
 * Lanes whose review object is NOT the `--artifact` path, so the empty-artifact-diff
 * short-circuit below cannot speak for them. `ui-reviewer` reviews the UI diff
 * against a design file, and at code stage `--artifact` is only a label; worse, an
 * advisory `cannot-review` sink carries no blockers, so `priorSinkIsGreen` reads it
 * green and a synthetic OK would overwrite it with a payload carrying no `verdict`
 * at all — a lane that compared nothing then reads as reviewed.
 */
const NO_DELTA_SHORTCIRCUIT: ReadonlySet<Lane> = new Set<Lane>(['ui-reviewer', 'render-compare']);

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
  // 1. Explicit --lanes always wins — it is the one way to narrow a single run
  //    below the configured posture (e.g. leave the verifier out of a change
  //    with no runtime surface).
  if (args.lanes && args.lanes.length > 0) return mandatory(args.lanes);
  // 2. Configured crLanes.<kind> when present, else the built-in autonomous-safe
  //    default. Taken on the autonomous / skipLanePicker path, and always at code
  //    stage: the gate's Step 4 has no lane multi-select, so an empty return there
  //    told the controller nothing it could act on — the skill hardcoded
  //    `--lanes reviewer` instead and under-ran a configured verifier. Never
  //    throws — a missing crLanes block is no longer a hard error.
  if (args.kind === 'code' || args.autonomous || cfg?.autonomous?.skipLanePicker) {
    const configured = cfg?.crLanes?.[args.kind];
    return mandatory(
      configured && configured.length > 0 ? configured : DEFAULT_CR_LANES[args.kind],
    );
  }
  // 3. Interactive spec/plan, no CLI flag: empty signals the /noldor-gate skill to prompt.
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

/**
 * The fork point of `baseSha` and `headSha`. Every lane reviews `<base>..<head>`, a two-tree
 * comparison: once `--base-sha origin/main` has moved past the branch's fork point, that range
 * also carries main's newer commits, reversed, and a reviewer files blockers against code the
 * branch never touched (Q-0265). Resolved once here so every lane — and the empty-diff check —
 * sees only the branch's own change. A base already on the branch (a delta re-round) is its own
 * merge-base, so this changes nothing there. Falls back to `baseSha` when git cannot answer.
 */
async function resolveMergeBaseDefault(
  repoRoot: string,
  baseSha: string,
  headSha: string,
): Promise<string> {
  if (headSha === '') return baseSha;
  try {
    const r = await execAsync('git', ['merge-base', baseSha, headSha], { cwd: repoRoot });
    return r.stdout.trim() || baseSha;
  } catch {
    return baseSha;
  }
}

/**
 * Where a spec/plan round starts when the caller passed no `--base-sha`: the fork point of the
 * branch from `origin/main`. The lanes' own fallback, `<head>~1..<head>`, is the last commit
 * only — and `noldor-spec` commits the spec's ADR after the spec, so on Q-0263 a first round
 * would have reviewed the ADR and no spec at all (Q-0267). `undefined` when git cannot answer
 * (no `origin/main`, no repo), which keeps that old fallback.
 */
async function resolveBranchBaseDefault(
  repoRoot: string,
  headSha: string,
): Promise<string | undefined> {
  if (headSha === '') return undefined;
  try {
    const r = await execAsync('git', ['merge-base', 'origin/main', headSha], { cwd: repoRoot });
    return r.stdout.trim() || undefined;
  } catch {
    return undefined;
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
  slug: Slug;
  kind: ArtifactKind;
  cwd: string;
  /** True when this round mandates the codex lane (see codexIsMandatory). */
  codexMandatory?: boolean;
}

interface GuardOpts {
  autonomous?: boolean;
}

/** Canonical sink path + any legacy-named path a pre-0.7.0 run may have written. */
function sinkCandidatePaths(cwd: string, slug: Slug, kind: ArtifactKind, lane: Lane): string[] {
  const names = [lane, ...(lane in LEGACY_BY_CANONICAL ? [LEGACY_BY_CANONICAL[lane]] : [])];
  // This is a probe list, so a refused candidate is simply not a candidate —
  // a path the guard will not build is one no run can have written.
  return names
    .map((n) => laneSinkPath(cwd, slug, kind, n))
    .filter((r) => r.ok)
    .map((r) => r.path);
}

/**
 * Path of the first sink that exists for `lane` — canonical first, then any
 * legacy-named one (pre-0.7.0) — or `null` when the lane has no prior run.
 * Probes with `stat` rather than reading: an existence test shouldn't load the
 * file, and a path that exists but isn't a regular file is not a prior run.
 */
async function findExistingSink(
  cwd: string,
  slug: Slug,
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
/**
 * What a prior-sink read found. `unusable` is its own case (Q-0260): a sink that exists but
 * cannot be read, does not parse, or fails `laneFindingsSchema` is not a first round, and a
 * prior-aware lane must not run as though it were one.
 */
export type PriorSinkRead =
  | { kind: 'absent' }
  | { kind: 'unusable'; path: string; detail: string }
  | { kind: 'found'; sink: LaneFindings };

async function readPriorSinkDefault(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  lane: Lane,
): Promise<PriorSinkRead> {
  const path = await findExistingSink(cwd, slug, kind, lane);
  if (path === null) return { kind: 'absent' };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFileNoFollowAsync(path));
  } catch (err) {
    return { kind: 'unusable', path, detail: (err as Error).message };
  }
  const parsed = laneFindingsSchema.safeParse(raw);
  return parsed.success
    ? { kind: 'found', sink: parsed.data }
    : { kind: 'unusable', path, detail: `schema mismatch: ${parsed.error.message}` };
}

export type ReadPriorSink = typeof readPriorSinkDefault;

/**
 * True when the prior round actually went green. No sink, an unusable sink, or
 * a sink carrying blockers is false, so callers gate the delta short-circuit
 * on a review that went green instead of on the mere presence of a file.
 * Applies to every lane and every artifact kind: a lane-specific exemption
 * would let a red round be cleared by a no-op re-run.
 */
function priorSinkIsGreen(read: PriorSinkRead): boolean {
  return read.kind === 'found' && read.sink.blockers.length === 0;
}

/** Why a round with an unusable prior-aware sink was refused, and the two ways out. */
function renderPriorRefusal(unusable: readonly Extract<PriorSinkRead, { kind: 'unusable' }>[]) {
  return [
    'prior sink unusable — refusing the round, so no re-round runs without the blockers it held:',
    ...unusable.map((u) => `  ${u.path}: ${u.detail}`),
    "Repair the file, or remove it to start that lane's series over (it then runs as a first round).",
  ].join('\n');
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
  resolveMergeBase?: (repoRoot: string, baseSha: string, headSha: string) => Promise<string>;
  resolveBranchBase?: (repoRoot: string, headSha: string) => Promise<string | undefined>;
}

export interface RunResult {
  lanesRun: Lane[];
  syntheticOks: Lane[];
  exitCode: number;
}

/** Orchestrate refused to dispatch because the round budget is spent. */
export const EXIT_ROUND_CAP = 3;

/** Orchestrate refused to dispatch because a prior-aware lane's prior sink is unusable. */
export const EXIT_PRIOR_UNUSABLE = 4;

/**
 * Why a past-the-cap dispatch was refused — the two refusals differ in what
 * closes them, so {@link renderCapRefusal} must be able to tell them apart.
 *
 * `head-unchanged` is provisional: the last round was red and nothing has been
 * committed since, so a fix commit plus a re-run still earns the closing round.
 * `closing-round-spent` is terminal: that dispatch is gone for the series, no
 * commit re-arms it, and arbitration is the sole close. One banner advising
 * "commit the remaining fixes and re-review" for both described a path that
 * does not exist in the second case (Q-0226).
 */
export type CapRefusal = 'head-unchanged' | 'closing-round-spent';

/**
 * Why this dispatch is refused (`null` when it is not), and whether it is the
 * one closing round.
 *
 * Under the cap, everything dispatches. Past it, in order:
 *
 * 1. A spent RED closing round refuses everything, permanently for the series.
 * 2. Otherwise, a GREEN last round dispatches — the pair is re-minting a
 *    receipt a later commit stripped, not arbitrating, and refusing there would
 *    forbid retrying a failed mint at the same head.
 * 3. Otherwise the last round was red, so an unchanged `HEAD` refuses (nothing
 *    was fixed) and a changed one IS the closing round: the receipt shape on
 *    record — red final round, fix, one dispatch that finds nothing — needs
 *    exactly one more pass or the session is wedged with no receipt and no way
 *    to earn one.
 *
 * The bound this leaves is narrower than "every dispatch needs a commit": a
 * green round can be retried at the same head. What it does bound is
 * arbitration — the run that comes back red past the cap is marked, and after
 * that nothing dispatches at all.
 *
 * The refusal is returned as a REASON rather than as a boolean beside one,
 * because the banner and the dispatch gate must never disagree about which case
 * they are in: two fields would have to be kept in step at every return.
 */
export function capVerdict(
  ledger: AutofixLedger | null,
  sessionStartedAt: string,
  headSha: string,
): { refusal: CapRefusal | null; closingRound: boolean } {
  const rounds = ledger?.rounds ?? [];
  if (redRounds(rounds) <= AUTOFIX_ROUND_CAP) return { refusal: null, closingRound: false };
  // A SPENT closing round is terminal, and that is checked before anything else.
  // It is a property of the series, not of its last entry: two overlapping runs
  // can both dispatch before either appends, and if the red one records the
  // sentinel while the green one lands after it, a last-entry test would read
  // green and reopen a session the contract says is closed.
  if (hasClosingRound(ledger, sessionStartedAt))
    return { refusal: 'closing-round-spent', closingRound: false };
  const last = rounds.at(-1);
  // A green last round means the pair is not mid-arbitration: it is re-minting a
  // receipt that a later commit stripped. Refusing there would forbid retrying a
  // failed mint at the same head — the very thing "green rounds are free" is for
  // — so the head test below engages only while the last round was RED.
  if (last && roundVerdict(last) === 'green') return { refusal: null, closingRound: false };
  // `headMatches`, not `===`: the ledger's own identity is prefix-aware, so an
  // exact comparison here would read an abbreviated form of an unchanged head as
  // a change and grant a closing round nobody earned.
  if (headMatches(last?.headSha ?? '', headSha))
    return { refusal: 'head-unchanged', closingRound: false };
  return { refusal: null, closingRound: true };
}

/**
 * R1's history input: one blocker-id list per prior round, or `undefined`.
 *
 * `undefined` whenever ANY round in the series predates the `blockerIds` field.
 * Partial history is worse than none here: R1 would report a genuinely repeated
 * blocker as new because the round that first filed it recorded no ids, and a
 * false "clear" from a detector is exactly the reading the three-arm outcome
 * exists to prevent.
 */
export function priorBlockerIds(
  rounds: readonly AutofixRound[],
): readonly (readonly string[])[] | undefined {
  const lists = rounds.map((r) => r.blockerIds);
  return lists.every((l) => l !== undefined)
    ? (lists as readonly (readonly string[])[])
    : undefined;
}

/**
 * Lines this series ADDED **to files that already existed**, per file, in
 * current coordinates — R3's input.
 *
 * The window is `firstHeadSha..HEAD` — the commits landed AFTER the series'
 * first reviewed head — because that is exactly the question R3 asks: "did a
 * prior round touch this line?". Including `firstHeadSha` itself (the older
 * `firstHeadSha^..HEAD`) answers a different one: on the first round the caller
 * has no ledger and passes this round's own head, so the window became that
 * commit's own change and every located finding in an edited file read as a
 * contradiction with a round that had not happened yet (Q-0220). Excluding it
 * also makes the empty-ledger case an empty range rather than one relying on
 * the pre-existence filter below to stay quiet, and keeps a root commit as
 * first head from failing the guard outright — `<root>^` does not resolve.
 *
 * The pre-existence filter is what keeps R3 a signal rather than noise. R3 asks
 * whether a blocker sits on a line the series introduced, which distinguishes
 * something only where the series EDITED code that was already there. On a
 * series that adds files, every line in them is one the series introduced, so
 * every located finding fires: PR #437 drew nine undifferentiated R3 signals,
 * and nine signals that separate nothing are worse than none — they train the
 * operator to skim past R3 on the runs where it would catch a real
 * repair-the-last-repair loop. `--diff-filter=ad` drops the added files (and,
 * as before, the deleted ones) so a file born inside the series contributes no
 * introduced lines at all. Files that existed at the base keep firing, whether
 * they arrive as `M`, a detected rename, or a typechange — the filter EXCLUDES
 * rather than allow-lists, so a status git adds later stays covered.
 *
 * The fast-forward guard is the whole reason this returns `undefined` rather
 * than an empty map. The cumulative range is a tree diff and nothing inside it
 * distinguishes this series' commits from anyone else's: an amend-only rewrite
 * is harmless, but a rebase onto a moved `origin/main` puts every
 * upstream-added line inside `firstHeadSha..HEAD`, and R3 would then fire on
 * any location in a file upstream happened to touch. That range does not FAIL,
 * so an error path would never catch it — only the ancestry check does.
 *
 * `git` is the caller's runner rather than a sync `execFileSync` of its
 * own: everything else in this module spawns git through `execAsync`, and a
 * second, synchronous runner would be a parallel seam for tests to drift apart
 * on.
 */
export async function resolveIntroducedLines(
  firstHeadSha: string,
  git: (args: string[]) => Promise<string>,
): Promise<Map<string, Set<number>> | undefined> {
  if (firstHeadSha === '') return undefined;
  let diff: string;
  try {
    await git(['merge-base', '--is-ancestor', firstHeadSha, 'HEAD']);
    diff = await git(['diff', '--unified=0', '--diff-filter=ad', '-M', firstHeadSha, 'HEAD']);
  } catch {
    return undefined;
  }
  const out = new Map<string, Set<number>>();
  let file = '';
  let next = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (file !== '' && line.startsWith('+') && !line.startsWith('+++')) {
      const set = out.get(file) ?? new Set<number>();
      set.add(next);
      out.set(file, set);
      next += 1;
    }
  }
  return out;
}

/**
 * Run every re-flag rule and render both halves: the lines a human reads and
 * the records the ledger stores.
 *
 * Split out of the round-recording block so the rendering is testable without a
 * dispatch, rather than living in the middle of `run()`.
 *
 * The rule ORDER in the array below is what fixes the printed order, which the
 * tests pin: R1, R2, R3. R2's own two inputs come LAST in the parameter list
 * even though it prints second, so widening the seam changed no call site's
 * argument order.
 *
 * An `omitted` rule produces BOTH a line and a record. Dropping either would
 * turn "could not tell" back into silence — the failure the three-arm outcome
 * exists to prevent, one layer up.
 *
 * A `fired` result carrying its own `omitted` reason renders both, for the same
 * reason: a rule that found one thing and could not look at another has two
 * things to say, and printing only the first is the silence again.
 */
export function runReflagRules(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
  scopesByFile: ReadonlyMap<string, readonly CutScope[]>,
  unscannable: ReadonlyMap<string, string>,
): { lines: string[]; signals: Record<string, unknown>[] } {
  const results = [
    ruleR1(blockers, priorRounds),
    ruleR2(blockers, scopesByFile, unscannable),
    ruleR3(blockers, introducedByFile),
  ];
  const lines: string[] = [];
  const signals: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.outcome === 'fired') {
      for (const s of r.signals) {
        lines.push(`[${s.rule}] ${s.message}`);
        signals.push({ ...s });
      }
      if (r.omitted !== undefined) {
        lines.push(`[omitted] ${r.omitted}`);
        signals.push({ rule: 'omitted', reason: r.omitted });
      }
    } else if (r.outcome === 'omitted') {
      lines.push(`[omitted] ${r.reason}`);
      signals.push({ rule: 'omitted', reason: r.reason });
    }
  }
  return { lines, signals };
}

/**
 * The arbitration skeleton for a refused round, or `null` when the sinks cannot
 * be trusted to describe it.
 *
 * What orchestrate holds at a cap refusal is only the LEDGER — the refusal
 * returns at the top of `run()` before any dispatch, with `lanesRun: []`, and
 * the ledger stores a blocker-set fingerprint rather than the blockers. So the
 * unresolved blockers are re-read from the pair's current lane sinks, which are
 * still on disk precisely because a refused run writes none.
 *
 * Those sinks are VERIFIED before they are trusted: nothing stops a lane being
 * run standalone between the closing round and the refusal, which would leave
 * sinks describing a different review. Recomputing the set fingerprint and
 * comparing it against the ledger's last round is what catches that, and a
 * mismatch yields `null` rather than a plausible-looking record about the wrong
 * blockers.
 *
 * `sinkBlockers` is the WHOLE aggregate set, integrity blockers included,
 * because that is the set the ledger hashed. Only the arbitrated list drops
 * them: "this verdict cannot be trusted" is not a finding an operator can
 * accept, reject or defer.
 *
 * `idOf` is injected so the identity function is visible to a test without a
 * fixture repo; production passes {@link fingerprintBlocker}.
 */
export function buildSkeleton(
  slug: string,
  kind: ArtifactKind,
  boundTree: string,
  rounds: readonly AutofixRound[],
  sinkBlockers: readonly (Finding & { lane: string; integrity?: true })[],
  idOf: (b: Finding) => string,
  fingerprintOf: (bs: readonly Finding[]) => string = fingerprintBlockers,
): ArbitrationRecord | null {
  const last = rounds.at(-1);
  if (!last) return null;
  if (fingerprintOf(sinkBlockers) !== last.fingerprint) return null;

  const byId = new Map<string, { blocker: Finding; lanes: Set<string> }>();
  for (const b of sinkBlockers) {
    if (b.integrity === true) continue;
    const id = idOf(b);
    const entry = byId.get(id) ?? { blocker: b, lanes: new Set<string>() };
    entry.lanes.add(b.lane);
    byId.set(id, entry);
  }
  return {
    version: 1,
    slug,
    kind,
    boundTree,
    rounds: rounds.map((r) => ({
      round: r.round,
      verdict: roundVerdict(r),
      headSha: r.headSha,
    })),
    blockers: [...byId].map(([id, { blocker, lanes }]) => ({
      id,
      severity: blocker.severity,
      message: blocker.message,
      lanes: [...lanes].sort(),
    })),
    signals: rounds.flatMap((r) => r.signals ?? []),
    dispositions: [],
  };
}

/**
 * Write the skeleton, unless a record for this tree already exists.
 *
 * Re-running orchestrate at the cap refuses again and reaches here again, so
 * an unconditional write would erase dispositions the operator had already
 * filled in. Existing-and-same-tree is left alone; existing-but-bound-to-another
 * tree is replaced, because that record arbitrated different work.
 *
 * Never throws: failing to write an advisory record must not change what a cap
 * refusal does.
 */
export async function writeSkeletonIfAbsent(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  ledger: AutofixLedger | null,
): Promise<void> {
  try {
    const tree = (await execAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd })).stdout.trim();
    const path = arbitrationPath(cwd, slug, kind);
    const existing = await readFileNoFollowAsync(path).catch(() => null);
    if (existing !== null) {
      const prior = arbitrationRecordSchema.safeParse(JSON.parse(existing));
      if (prior.success && priorRecordStands(prior.data, tree)) {
        console.error(`arbitration record already present: ${path}`);
        return;
      }
    }
    // `aggregate` already owns the sink glob and the per-lane blocker list, so
    // this reuses it rather than minting a second reader of the same files.
    const { blockers, stale } = await aggregate(slug, kind, { cwd });
    // A skeleton built from a round the tree has moved past asks the operator to
    // dispose of blockers that may already be fixed, and binds those
    // dispositions to the CURRENT tree — the misleading artifact Q-0211 names.
    //
    // It is still WRITTEN, and loudly qualified instead. Refusing here would
    // wedge the session it is meant to rescue: once `hasClosingRound` is spent
    // `capVerdict` refuses terminally no matter how HEAD moves, and
    // `decideArbitration` accepts neither a bare override nor a record bound to
    // any tree but HEAD's — so with no skeleton for the new tree the push has no
    // exit at all. The advisory record is the last way out, and `cr aggregate` is
    // where staleness gates.
    for (const s of stale) console.error(`arbitrating a stale round — ${describeStale(s)}`);
    const rec = buildSkeleton(slug, kind, tree, ledger?.rounds ?? [], blockers, fingerprintBlocker);
    if (!rec) {
      console.error(
        'arbitration skeleton not written — the lane sinks on disk do not describe the ' +
          'arbitrated round. Re-run the round before arbitrating.',
      );
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeJsonAtomic(path, rec);
    console.error(`arbitration skeleton written: ${path}`);
    for (const line of renderSkeletonExit(rec, slug, kind, stale.length > 0)) console.error(line);
  } catch (err) {
    console.error(`arbitration skeleton not written: ${(err as Error).message}`);
  }
}

/**
 * What to print once the skeleton is on disk — the blockers awaiting a
 * disposition, or the fact that there are none to await.
 *
 * Pure, because the branch it owns is the one the I/O wrapper kept getting
 * wrong: a record whose `blockers` array is empty was announced as
 * "0 unresolved blockers await a disposition" and followed by dispose commands
 * that can never succeed — see {@link INTEGRITY_ONLY_DIAGNOSIS} for why that
 * list is empty and why no disposition fills it.
 *
 * Printed AFTER {@link renderCapRefusal}, whose exit lines are generic — so on
 * an integrity-only round these lines are the last word and say so. This is the
 * FIRST place the operator meets the state; the pre-push guard repeats the same
 * diagnosis from the same constant if they push without acting on it.
 */
export function renderSkeletonExit(
  rec: ArbitrationRecord,
  slug: string,
  kind: ArtifactKind,
  stale: boolean,
): string[] {
  if (isIntegrityOnly(rec))
    return [
      `  NOTHING TO ARBITRATE — ${INTEGRITY_ONLY_DIAGNOSIS}.`,
      '  Ignore the dispose instructions above: there is nothing to accept, reject, or defer, and',
      '  filling this record is not a close pre-push can verify. Instead,',
      `    ${integrityOnlyRemedy(slug, kind)}`,
    ];
  return [
    `  ${rec.blockers.length} unresolved blockers await a disposition:`,
    // The ids, not just the count: they are what `--blocker` takes, and a
    // `fingerprintBlocker` id is not something an operator can derive. The
    // message is reviewer-controlled text, so its newlines are collapsed —
    // otherwise one could forge an extra `    <id>  [high] …` row no lane filed.
    ...rec.blockers.map(
      (b) => `    ${b.id}  [${b.severity}] ${b.message.replace(/\r\n|\r|\n/g, ' ⏎ ')}`,
    ),
    ...(stale
      ? [
          '  CHECK EACH ONE AGAINST THE CODE FIRST — the sinks they came from predate this tree, ' +
            'so some may already be fixed.',
        ]
      : []),
    ...arbitrationExit(slug, kind),
  ];
}

/**
 * How to arbitrate, named once so both refusals cite the SAME commands as
 * {@link writeSkeletonIfAbsent}.
 *
 * The digest matters. Past the cap with the last round red,
 * `decideArbitration` rejects a bare `Noldor-Path-Override: <why>` outright and
 * demands the `cr-arbitration <digest>` form — so the banner's old bare-override
 * line named a close the pre-push hook refuses (Q-0226).
 *
 * The trailer line stays spelled out beneath the commands even though
 * `cr arbitration digest` prints it: an operator who already knows the digest
 * should not have to run a command to be reminded of the form.
 */
function arbitrationExit(slug: string, kind: ArtifactKind): string[] {
  return [
    '  Dispose of every blocker in the arbitration record below, then name its digest:',
    `    pnpm noldor cr arbitration dispose --slug ${slug} --kind ${kind} \\`,
    '      --blocker <id> --disposition <accepted|rejected|deferred> --note "<why>"',
    `    pnpm noldor cr arbitration digest --slug ${slug} --kind ${kind}`,
    '  then commit with the digest it prints:',
    '    git commit --amend --no-edit \\',
    '      --trailer "Noldor-Path-Override: cr-arbitration <digest> — <why>"',
  ];
}

/** The refusal banner: what was spent, and the ways out THIS refusal actually has. */
export function renderCapRefusal(
  ledger: AutofixLedger | null,
  slug: string,
  kind: ArtifactKind,
  refusal: CapRefusal,
): string {
  const rows = (ledger?.rounds ?? []).map(
    (r) =>
      `  ${r.round}  ${roundVerdict(r).padEnd(5)}  ${r.applied} applied, ${r.deferred} deferred  ${r.headSha.slice(0, 7) || '(no sha)'}`,
  );
  const exit =
    refusal === 'head-unchanged'
      ? [
          'HEAD is unchanged since the last round, so nothing new has been written to',
          'review. Two ways to close:',
          '  Commit the remaining fixes and re-run this command — a changed HEAD past',
          '  the cap earns exactly one closing round.',
          ...arbitrationExit(slug, kind),
        ]
      : [
          'The closing round for this series is already SPENT, so the cap is final: no',
          'commit re-arms a dispatch and re-running this command will refuse again.',
          'Arbitration is the only close.',
          ...arbitrationExit(slug, kind),
        ];
  return [
    `red rounds ${roundLabel(redRounds(ledger?.rounds ?? []))} for ${slug} (${kind}) — cap reached`,
    ...rows,
    ...exit,
  ].join('\n');
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
  for (const codeOnly of ['verifier', 'ui-reviewer', 'render-compare'] as const) {
    if (requested.includes(codeOnly) && opts.args.kind !== 'code') {
      throw new Error(
        `lane '${codeOnly}' is code-only — remove it from --lanes / crLanes for spec/plan artifacts`,
      );
    }
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
  // ROUND BUDGET, checked before anything is dispatched — and BEFORE
  // `writeExpectedLanes` below. A refused run dispatches nothing, so recording
  // its lane set would leave `aggregate` reporting a never-dispatched lane as
  // unresolved: the pair would read red permanently, including for the closing
  // round meant to rescue the session. The ledger read fails
  // OPEN in every direction: an unreadable or malformed file leaves the cap
  // inert for this round rather than refusing a round the operator needs, since
  // a missed cap costs one dispatch while a false cap costs the ship.
  const roundKey = sessionKey(cwd);
  let ledger: AutofixLedger | null = null;
  try {
    ledger = await readLedger(cwd, opts.args.slug, opts.args.kind, roundKey);
  } catch (err) {
    console.error(
      `round ledger unreadable — cap not enforced this round: ${(err as Error).message}`,
    );
  }
  // noldor:cut check-then-act, one mutating process per (slug, kind) — the gate runs
  // orchestrate and `cr autofix record` in sequence and parallel drain gives each
  // child its own slug, so concurrent runs on one pair are unsupported rather than
  // impossible. `capVerdict` is defensive about the ledger ORDER such an overlap
  // would produce (a green entry landing after a red closing round), which costs
  // nothing; bounding the overlap itself is the upgrade path — a lock around the
  // read-through-append span, so one commit cannot earn two closing dispatches.
  const cap = capVerdict(ledger, roundKey, headSha);
  if (cap.refusal !== null) {
    console.error(renderCapRefusal(ledger, opts.args.slug, opts.args.kind, cap.refusal));
    await writeSkeletonIfAbsent(cwd, opts.args.slug, opts.args.kind, ledger);
    return { lanesRun: [], syntheticOks: [], exitCode: EXIT_ROUND_CAP };
  }

  // Record the resolved lane set BEFORE dispatch so `aggregate` can report a
  // lane that never wrote its sink as `unresolved` (Q-0100). `requested`, not
  // the post-guard `effective`: a keep-and-skip lane still has its prior sink,
  // and a synthetic-OK lane writes one — only a lane killed mid-run leaves the
  // expectation unmet. Empty set = interactive-mode "prompt the operator"
  // sentinel, not a resolved round — nothing to record.
  // `headSha` rides along so `aggregate` can tell this round's sinks from ones
  // the tree has moved past (Q-0211). It is stamped here, on the record written
  // per DISPATCH, precisely because the cap refusal above returns before this
  // line: a refused run leaves the previous round's stamp in place, which is
  // what makes its sinks read as stale instead of as current.
  // Prior-aware lanes read their prior sink here, once — before the round is recorded, so a
  // refusal leaves the previous round's record intact exactly as the cap refusal does. The
  // overwrite guard below only copies a sink it archives, so this read sees what the lane will
  // inherit. An unusable sink refuses the round: running that lane as a first round would let
  // a delta re-round pass without ever seeing the blockers the file held (Q-0260).
  const readPrior = opts.readPriorSink ?? readPriorSinkDefault;
  const priors = new Map<Lane, PriorSinkRead>();
  for (const l of PRIOR_AWARE_LANES) {
    if (requested.includes(l))
      priors.set(l, await readPrior(cwd, opts.args.slug, opts.args.kind, l));
  }
  const unusable = [...priors.values()].filter(
    (r): r is Extract<PriorSinkRead, { kind: 'unusable' }> => r.kind === 'unusable',
  );
  if (unusable.length > 0) {
    console.error(renderPriorRefusal(unusable));
    return { lanesRun: [], syntheticOks: [], exitCode: EXIT_PRIOR_UNUSABLE };
  }

  if (requested.length > 0) {
    await writeExpectedLanes(cwd, opts.args.slug, opts.args.kind, requested, headSha);
  }

  // Without `--base-sha`, a spec/plan round still reviews the whole branch rather than its last
  // commit. That base only widens the range: the delta short-circuit and the `fixes-in-diff`
  // prior mode below stay keyed on an explicit `--base-sha`, since a fork point is not a fix.
  const baseSha = opts.args.baseSha
    ? await (opts.resolveMergeBase ?? resolveMergeBaseDefault)(cwd, opts.args.baseSha, headSha)
    : opts.args.kind !== 'code' && !opts.args.fullReview
      ? await (opts.resolveBranchBase ?? resolveBranchBaseDefault)(cwd, headSha)
      : undefined;
  const input: LaneInput = {
    slug: opts.args.slug,
    artifact: opts.args.artifact,
    kind: opts.args.kind,
    fdPath: `docs/features/${opts.args.slug}.md`,
    artifactSha: headSha,
    repoRoot: cwd,
    reviewProfile,
    dispatchTimeoutMs: resolveDispatchTimeoutMs(cfg),
    ...(baseSha ? { baseSha } : {}),
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
  // Read-once: a prior-aware lane's single read above feeds both the green check
  // below and the prior-round context attached at dispatch.

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
  let priorMode: PriorReview['mode'] = 'reexamine';
  if (opts.args.baseSha && input.baseSha && !input.fullReview) {
    const empty = await isEmptyDiff(cwd, input.baseSha, input.artifactSha, input.artifact);
    if (empty) {
      const stillToRun: Lane[] = [];
      for (const l of effective) {
        if (NO_DELTA_SHORTCIRCUIT.has(l)) {
          stillToRun.push(l);
          continue;
        }
        // "No changes since prior run" presupposes a prior run that went green.
        // A lane with no sink was never reviewed at all, and one with a red sink
        // has blockers nobody addressed — synthesizing a pass in either case
        // hands the artifact a receipt it never earned. Gated for EVERY lane and
        // EVERY kind: while only the spec/plan `reviewer` lane was guarded, an
        // unaddressed red on `manual` / `codex` / `verifier` — or on any
        // `code`-kind lane, which is the one that amends the push receipt — was
        // overwritten by `blockers: []` on the next no-op re-run.
        const prior = priors.get(l) ?? (await readPrior(cwd, opts.args.slug, opts.args.kind, l));
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
      priorMode = 'fixes-in-diff';
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

  // Prior-round context rides ONLY the prior-aware lanes' input — attached per-lane
  // at the dispatch call, so `manual`/`verifier` and the rest stay unchanged by
  // construction rather than by their ignoring an unknown field. A lane's own
  // failure blocker is never carried: no fix can resolve it (Q-0260). Nor is a
  // finding an operator ruled on while the ruling holds, and every prior-aware
  // lane — one with no priors of its own included — is shown the series'
  // decided findings (Q-0261, docs/adr/0004).
  const decided = await loadDecided(cwd, opts.args.slug, opts.args.kind, roundKey, headSha);
  const held = new Set(decided.filter((d) => d.holds === true).map((d) => d.id));
  const contexts = new Map<Lane, PriorReview>();
  for (const [l, read] of priors) {
    const blockers =
      read.kind === 'found'
        ? read.sink.blockers.filter(
            (b) => !isLaneFailureBlocker(b) && !held.has(fingerprintBlocker(b)),
          )
        : [];
    if (blockers.length > 0 || decided.length > 0)
      contexts.set(l, { blockers, mode: priorMode, ...(decided.length > 0 ? { decided } : {}) });
  }

  // Port contention is real: `verifier` boots the same `verifyCommands` servers
  // this lane boots, and the batch below is concurrent. When both share the
  // round, `render-compare` starts only after the verifier lane RESOLVES —
  // success or failure — with its own pre-boot occupancy check still guarding
  // contention from outside the round (spec R4).
  const launch = (l: Lane): Promise<LaneResult> => {
    const context = contexts.get(l);
    const laneInput =
      context !== undefined ? { ...dispatchInput, priorReview: context } : dispatchInput;
    if (l === 'codex') return runCodex(laneInput);
    // standalone can't reach here — run() rejects it at entry.
    return LANES[l as Exclude<Lane, 'standalone'>](laneInput);
  };
  // Two passes so the pre-dep exists before its dependent chains onto it,
  // regardless of lane order; `promises[i]` stays index-aligned with
  // `effective[i]` for the result mapping below.
  const promises: Promise<LaneResult>[] = Array.from({ length: effective.length });
  let verifierRun: Promise<LaneResult> | undefined;
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] === 'render-compare') continue;
    promises[i] = launch(effective[i]);
    if (effective[i] === 'verifier') verifierRun = promises[i];
  }
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] !== 'render-compare') continue;
    promises[i] =
      verifierRun !== undefined
        ? verifierRun.then(
            () => launch(effective[i]),
            () => launch(effective[i]),
          )
        : launch(effective[i]);
  }
  const settled = await Promise.allSettled(promises);

  for (let i = 0; i < effective.length; i++) {
    if (settled[i].status === 'fulfilled') lanesRun.push(effective[i]);
  }

  // The refutation judge (Q-0262) runs here, before anything reads the round's verdict: the
  // exit code below, the receipt amend and the ledger all see the sinks as it leaves them.
  const judge = await judgeThisRound({
    cwd,
    cfg,
    args: opts.args,
    headSha,
    // The range the lanes were shown: none when they reviewed the whole artifact, whether
    // asked to (`--full-review`) or widened to it by the empty-delta override.
    ...(dispatchInput.baseSha !== undefined && !dispatchInput.fullReview
      ? { baseSha: dispatchInput.baseSha }
      : {}),
    sinks: effective.flatMap((l, i) => {
      const r = settled[i];
      return (l === 'reviewer' || l === 'codex') && r.status === 'fulfilled'
        ? [{ lane: l, sinkPath: (r.value as LaneResult).sinkPath }]
        : [];
    }),
  });

  // Exit code: 0 only if all sync lanes ok.
  let exitCode = 0;
  for (let i = 0; i < effective.length; i++) {
    const r = settled[i];
    const lane = effective[i];
    const judged = lane === 'reviewer' || lane === 'codex' ? judge?.ok[lane] : undefined;
    if (
      r.status === 'rejected' ||
      (r.status === 'fulfilled' && !(judged ?? (r.value as LaneResult).ok))
    ) {
      exitCode = 1;
    }
  }

  // Step-4 receipt: code-stage subagent lane went clean → amend tip commit so
  // the pre-push hook can validate `Noldor-Reviewed-Subagent: <tree>` against
  // HEAD^{tree}. Skip for spec/plan stages (those don't reach pre-push) and
  // skip when any lane was red.
  if (exitCode === 0 && opts.args.kind === 'code' && lanesRun.includes('reviewer')) {
    try {
      // The receipt names every ruling made on the branch (Q-0261): a round that went
      // green on a disposed blocker must not read in git as a clean review. The lines
      // already on the tip are merged in, so a receipt re-minted after the gate's
      // clean-exit cleanup removed the stores, or in a later session, keeps the rulings
      // an earlier round named; a ruling that changed replaces its own line.
      const settledValues = mergeTrailers(
        await tipTrailers(cwd, SETTLED_TRAILER),
        await settledTrailers(cwd, opts.args.slug, roundKey),
        rulingOf,
      );
      // A round the judge turned green must not read in git as a clean review either (Q-0262).
      const refutedValues = mergeTrailers(
        await tipTrailers(cwd, REFUTED_TRAILER),
        await refutedTrailers(cwd, opts.args.slug, opts.args.kind, roundKey, judge?.refuted ?? []),
        refutationOf,
      );
      const also = [
        ...(settledValues.length > 0 ? [{ key: SETTLED_TRAILER, values: settledValues }] : []),
        ...(refutedValues.length > 0 ? [{ key: REFUTED_TRAILER, values: refutedValues }] : []),
      ];
      amendSubagentReceipt({ cwd, ...(also.length > 0 ? { also } : {}) });
    } catch (err) {
      console.error(`receipt amend failed: ${(err as Error).message}`);
      exitCode = 1;
    }
  }

  // Record the round LAST, and for a closing round only after the receipt amend
  // above has succeeded: marking the closing round first would let a crash — or
  // a failed amend — leave a session with neither a receipt nor a permitted
  // retry, which is the wedge the closing round exists to prevent.
  //
  // `verdict` follows this round's aggregate rather than `exitCode`, because the
  // exit code also carries a failed receipt amend, which is not a review finding.
  // A dispatch that throws before here appends nothing and stays retryable, and
  // a failed append is logged without touching the round's own result: the cap
  // then under-counts, the safe direction.
  // A dispatched round always counts. What varies is its verdict, and that comes
  // from what was FILED rather than from `agg.ok`, which is also false when an
  // expected lane merely failed to resolve.
  //
  // Three rules, each closing a hole the others opened:
  //
  //  - A lane that crashed files nothing, so a clean reviewer beside a crashed
  //    codex is GREEN. Reading `agg.ok` there would spend budget on a review
  //    that did not happen and, on a closing round, mark the pair terminal over
  //    a spawn failure.
  //  - A round in which NO lane wrote a sink is RED, not green. Nothing was
  //    reviewed, and green means "reviewed, found nothing" — a no-verdict green
  //    would disarm the cap through the green-last-round exemption and allow
  //    unlimited same-head retries. Recording it red also keeps a chronically
  //    crashing lane from leaving the counter at zero forever.
  //  - An INTEGRITY blocker says the verdict cannot be trusted, so it reds the
  //    round but must never mark it terminal: a single corrupt sink would
  //    otherwise wedge the pair permanently behind the override.
  let recorded: AutofixLedger | null = null;
  try {
    const agg = await aggregate(opts.args.slug, opts.args.kind, { cwd });
    if (effective.length > 0) {
      // Findings from THIS round's lanes only. Sinks are never deleted between
      // rounds — they are copied to `archive/` — so a lane that crashes on round
      // two or later leaves its previous round's sink on disk, complete with
      // `finishedAt`, and `aggregate` parses it as a current result. Attributing
      // those stale blockers to this round decides it by a review that did not
      // happen, and on a closing round that wedges the pair permanently.
      const fresh = agg.blockers.filter((b) => lanesRun.includes(b.lane));
      const integrity = fresh.filter((b) => b.integrity === true);
      const filed = fresh.filter((b) => b.integrity !== true);
      // "Did any lane actually write a readable sink?" — `summaries` carries one
      // entry per sink `aggregate` parsed, so it is the only honest signal.
      // Comparing unresolved against `lanesRun` does not work: a round where the
      // reviewer resolved and one other lane crashed has one of each.
      const nothingResolved = lanesRun.length === 0 || Object.keys(agg.summaries).length === 0;
      const red = filed.length > 0 || integrity.length > 0 || nothingResolved;
      if (agg.unresolved.length > 0) {
        console.error(
          `round counted from the lanes that resolved — ${agg.unresolved.join(', ')} did not`,
        );
      }
      const ruleBlockers: RuleBlocker[] = filed.map((b) => ({
        id: fingerprintBlocker(b),
        severity: b.severity,
        message: b.message,
        ...(b.locations ? { locations: b.locations } : {}),
      }));
      // The series' FIRST reviewed head, not this round's — R3 measures
      // cumulatively. Falls back to this round's head on an empty ledger, which
      // makes the window `HEAD..HEAD`: empty, so a first round has no
      // introduced lines and R3 is clear everywhere. That is the intended
      // reading of a first round, not a degenerate case.
      const firstHead = (ledger?.rounds ?? [])[0]?.headSha ?? headSha;
      // Only the files this round's blockers actually point at get opened.
      const located = [
        ...new Set(ruleBlockers.flatMap((b) => (b.locations ?? []).map((l) => l.file))),
      ];
      const scopesByFile = new Map<string, readonly CutScope[]>();
      // File -> why it could not be examined. The REASON is recorded here
      // rather than invented by the rule: these two branches are different
      // problems, and telling an operator a refused symlink was a brace-depth
      // failure sends them to the wrong place.
      const unscannable = new Map<string, string>();
      for (const f of located) {
        try {
          // readFileNoFollowAsync, not readFile: `f` came from a changed-file
          // match, and a tracked changed path can still be a symlink whose
          // target is outside the checkout.
          const src = await readFileNoFollowAsync(join(cwd, f));
          if (scanSource(src).ok) scopesByFile.set(f, markerScopes(src));
          else unscannable.set(f, 'brace depth did not balance');
        } catch (err) {
          unscannable.set(f, `unreadable: ${(err as Error).message}`);
        }
      }
      const reflag = runReflagRules(
        ruleBlockers,
        priorBlockerIds(ledger?.rounds ?? []),
        await resolveIntroducedLines(
          firstHead,
          async (args) => (await execAsync('git', args, { cwd })).stdout,
        ),
        scopesByFile,
        unscannable,
      );
      // `console.error`, not `console.log`: the round summary already goes to
      // stderr, and stdout carries the `lanes run:` line the gate parses.
      for (const line of reflag.lines) console.error(line);
      recorded = await appendRound(cwd, opts.args.slug, opts.args.kind, roundKey, {
        headSha,
        fingerprint: fingerprintBlockers(agg.blockers),
        blockerIds: ruleBlockers.map((b) => b.id).sort(),
        signals: reflag.signals,
        verdict: red ? 'red' : 'green',
        ...(judge !== null && judge.refuted.length > 0
          ? {
              refuted: judge.refuted.map((d) => ({
                id: fingerprintBlocker(d.finding),
                lane: d.lane,
                why: d.why,
              })),
            }
          : {}),
        applied: 0,
        deferred: 0,
        diffStat: '',
        // Terminal only on a round that actually produced a trusted red verdict.
        // A green closing round leaves the pair open so the `HEAD^{tree}`-bound
        // receipt can still be re-minted; an integrity red or a nothing-resolved
        // red is an infra problem for a human, not an arbitration to lock in.
        // The integrity clause holds even when a real finding rides alongside —
        // one corrupt sink means this round's verdict is not trustworthy, and a
        // untrustworthy round must not be the one that closes the pair.
        ...(cap.closingRound && filed.length > 0 && integrity.length === 0
          ? { closingRound: true }
          : {}),
      });
      // Both counts, side by side: the operator counts dispatches, the cap counts
      // red ones, and printing only the second let "four rounds against a cap of
      // two" read as a bypass when it was two greens and a closing round (Q-0251).
      console.error(
        `round ${recorded.rounds.length} recorded ${red ? 'red' : 'green'} — ` +
          `red rounds ${roundLabel(redRounds(recorded.rounds))} against the cap; green rounds do not count`,
      );
    }
  } catch (err) {
    console.error(`round not recorded — cap will under-count: ${(err as Error).message}`);
  }

  if (effective.length > 0) {
    try {
      await recordFixed(cwd, opts.args.slug, opts.args.kind, roundKey, {
        round: recorded?.rounds.length ?? 0,
        lanesRun,
        readPrior,
      });
    } catch (err) {
      console.error(`fixed findings not recorded: ${(err as Error).message}`);
    }
  }

  return { lanesRun, syntheticOks, exitCode };
}

/**
 * The series' decisions as the lanes see them, each operator ruling marked with whether it still
 * holds at `headSha` (Q-0261). An unreadable store is reported and read as empty, and no ruling
 * holds against an unknown head: both carry blockers rather than suppress them.
 */
async function loadDecided(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  roundKey: string,
  headSha: string,
): Promise<DecidedFinding[]> {
  const read = await readDecisions(cwd, slug, kind, roundKey);
  if (!read.ok) {
    console.error(
      `decision store unreadable — this round honors no ruling: ${read.path}: ${read.detail}`,
    );
    return [];
  }
  const tree = gitTreeReader(cwd);
  const out: DecidedFinding[] = [];
  for (const d of read.decisions) {
    if (d.disposition === 'fixed') out.push(d);
    else out.push({ ...d, holds: headSha !== '' && (await stillHolds(d, headSha, tree)) });
  }
  return out;
}

/**
 * After a round: a `fixed` decision for every prior a prior-aware lane answered resolved, read
 * from the sinks this round wrote, and none left for a finding a lane filed again — that one is
 * standing, not decided, and removal wins when a round does both. A `fixed` decision never
 * replaces an operator ruling. A sessionless run records nothing (`updateDecisions`).
 */
async function recordFixed(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  roundKey: string,
  ctx: { round: number; lanesRun: readonly Lane[]; readPrior: ReadPriorSink },
): Promise<void> {
  if (roundKey === '') return;
  const fixed: Decision[] = [];
  const standing = new Set<string>();
  for (const l of PRIOR_AWARE_LANES) {
    if (!ctx.lanesRun.includes(l)) continue;
    const read = await ctx.readPrior(cwd, slug, kind, l);
    if (read.kind !== 'found') continue;
    for (const b of read.sink.blockers) standing.add(fingerprintBlocker(b));
    for (const r of read.sink.resolved ?? []) {
      fixed.push({
        id: fingerprintBlocker(r.finding),
        finding: r.finding,
        lanes: [l],
        disposition: 'fixed',
        reason: r.why,
        round: ctx.round,
      });
    }
  }
  if (fixed.length === 0 && standing.size === 0) return;
  const w = await updateDecisions(cwd, slug, kind, roundKey, (current) => {
    let next = [...current];
    for (const f of fixed) {
      const existing = next.find((d) => d.id === f.id);
      if (existing !== undefined && existing.disposition !== 'fixed') continue;
      next = upsertDecision(next, f);
    }
    return next.filter((d) => !(d.disposition === 'fixed' && standing.has(d.id)));
  });
  if (!w.ok) console.error(`fixed findings not recorded: ${w.reason}`);
}

/**
 * Run the refutation judge over this round's reviewer and codex sinks (Q-0262), or say why it did
 * not run, and print its `judge:` line. Null when neither lane ran this round. The judge never
 * throws, and every way it can fail leaves the sinks' blockers as the lanes wrote them.
 */
async function judgeThisRound(o: {
  cwd: string;
  cfg: NoldorConfig | null;
  args: OrchestrateArgs;
  headSha: string;
  baseSha?: string;
  sinks: readonly { lane: JudgedLane; sinkPath: string }[];
}): Promise<JudgeRoundResult | null> {
  if (o.sinks.length === 0) return null;
  const skip = (why: string): JudgeRoundResult => ({
    line: `skipped — ${why}`,
    refuted: [],
    ok: {},
  });
  let r: JudgeRoundResult;
  if (o.cfg?.crReview?.judge === false) r = skip('crReview.judge is false');
  // An empty head would make `git show :<file>` read the index instead of a commit.
  else if (o.headSha === '') r = skip('HEAD could not be resolved, so no quote can be checked');
  else {
    try {
      r = await judgeRound({
        repoRoot: o.cwd,
        slug: o.args.slug,
        kind: o.args.kind,
        artifact: o.args.artifact,
        headSha: o.headSha,
        ...(o.baseSha !== undefined ? { baseSha: o.baseSha } : {}),
        sinks: o.sinks,
        // A timeout costs only the judge's own verdict, so it gets a tighter cap than a lane.
        timeoutMs: Math.min(300_000, resolveDispatchTimeoutMs(o.cfg)),
      });
    } catch (err) {
      // judgeRound reports its own failures; this catches a defect in it, and the lanes'
      // verdict stands exactly as they wrote it.
      r = {
        line: `failed — every blocker stands (${(err as Error).message})`,
        refuted: [],
        ok: {},
      };
    }
  }
  console.error(`judge: ${r.line}`);
  return r;
}

/** The values of one trailer family already on the tip commit. */
async function tipTrailers(cwd: string, key: string): Promise<string[]> {
  const { stdout } = await execAsync(
    'git',
    ['log', '-1', `--format=%(trailers:key=${key},valueonly,unfold)`],
    { cwd },
  );
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** A ruling line `<kind> <disposition> <id> — <note>` is identified by its kind and id. */
const rulingOf = (value: string): string => {
  const [kind, , id] = value.split(' ');
  return `${kind} ${id}`;
};
/** A refutation line `<kind> <lane> <id> — <why>` is identified by its kind, lane and id. */
const refutationOf = (value: string): string => value.split(' ').slice(0, 3).join(' ');

/**
 * The tip's lines of one trailer family plus the session's, one per identity: a current line
 * replaces the tip's line with the same identity.
 */
function mergeTrailers(
  onTip: readonly string[],
  current: readonly string[],
  identityOf: (value: string) => string,
): string[] {
  const now = new Set(current.map(identityOf));
  return [...onTip.filter((v) => !now.has(identityOf(v))), ...current];
}

/**
 * One `Noldor-CR-Refuted:` value per refutation of the session (Q-0262), across every artifact
 * kind. The earlier rounds' come from the ledgers and this round's from its judge, because this
 * round reaches the ledger only after the receipt amend. A blocker refuted in several rounds
 * names one line, the latest. An unreadable ledger is reported and names nothing.
 */
async function refutedTrailers(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  roundKey: string,
  current: readonly Demotion[],
): Promise<string[]> {
  const byIdentity = new Map<string, string>();
  const add = (k: ArtifactKind, lane: JudgedLane, id: string, why: string): void => {
    const value = refutedTrailerValue(k, lane, id, why);
    byIdentity.set(refutationOf(value), value);
  };
  for (const k of artifactKindSchema.options) {
    let ledger: AutofixLedger | null;
    try {
      ledger = await readLedger(cwd, slug, k, roundKey);
    } catch (err) {
      console.error(
        `the ${k} round ledger could not be read, so its refutations are not named on the receipt: ${(err as Error).message}`,
      );
      continue;
    }
    for (const round of ledger?.rounds ?? [])
      for (const r of round.refuted ?? []) add(k, r.lane, r.id, r.why);
  }
  for (const d of current) add(kind, d.lane, fingerprintBlocker(d.finding), d.why);
  return [...byIdentity.values()];
}

/** One `Noldor-CR-Settled:` value per operator ruling of the session, across every artifact kind. */
async function settledTrailers(cwd: string, slug: Slug, roundKey: string): Promise<string[]> {
  const values: string[] = [];
  for (const kind of artifactKindSchema.options) {
    const read = await readDecisions(cwd, slug, kind, roundKey);
    if (!read.ok) {
      console.error(
        `the ${kind} decision store could not be read, so its rulings are not named on the receipt: ${read.path}: ${read.detail}`,
      );
      continue;
    }
    for (const d of read.decisions)
      if (d.disposition !== 'fixed') values.push(settledTrailerValue(kind, d));
  }
  return values;
}

// CLI entry — wired up in Task 5.4
if (isEntrypoint(import.meta.url)) {
  const { parseArgs } = await import('./orchestrate-args.js');
  const args = parseArgs(process.argv);
  const r = await run({ args });
  // A refusal dispatched nothing and has already printed why, so an empty
  // `lanes run:` line under it is noise.
  if (r.exitCode !== EXIT_ROUND_CAP && r.exitCode !== EXIT_PRIOR_UNUSABLE) {
    console.log(`lanes run: ${r.lanesRun.join(', ')}`);
    if (r.syntheticOks.length)
      console.log(`synthetic OK (empty delta): ${r.syntheticOks.join(', ')}`);
  }
  process.exit(r.exitCode);
}
