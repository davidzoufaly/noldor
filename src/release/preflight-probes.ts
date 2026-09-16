// One probe per release state gate. Each returns a PreflightRow instead of
// throwing, so the aggregate can report every failure in one pass.
//
// Where a pure evaluator already existed it is reused rather than re-derived:
// `evaluateGardenFreshness`, `checkCrGate` and `onlyVolatileSectionsChanged`
// were already report-shaped, and `inspectTreeState` / `evaluateGraphFreshness`
// were extracted from their throwing wrappers for exactly this purpose. No gate
// condition is expressed twice.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfigSync, resolveSessionTtlHours, type NoldorConfig } from '../core/config.js';
import { checkAdr } from '../docs/docs-adr.js';
import { checkArchitecture } from '../docs/docs-architecture.js';
import { checkReadme } from '../docs/readme-content.js';
import { noldorCliCommand } from '../core/noldor-cli.js';
import { isSessionStale, readSession } from '../core/session.js';
import {
  evaluateGardenFreshness,
  latestGardenScanCommitTs,
  readGardenReceipt,
} from '../garden/garden-receipt.js';
import { loadUiConfig } from '../core/consumer-config.js';
import { inspectTreeState, type TreeState } from './clean-tree.js';
import { evaluateGraphFreshness } from './graph-freshness.js';
import { captureRemediation, evaluateUiDesignFreshness } from './ui-design-freshness.js';
import type { UiFreshnessVerdict } from './ui-design-freshness.js';
import { readPkgIdentity } from './release-publish.js';
import { checkCrGate } from './release-cr-gate.js';
import { readReleaseState } from './release-state.js';
import { findPreviousTag } from './release-version.js';
import { onlyVolatileSectionsChanged } from './sdd-report-diff.js';
import { defaultRunCommand, normalizeRunner } from './run-command.js';
import type { RunCommand } from './run-command.js';
import type { PreflightRow, PreflightRowId } from './preflight-types.js';

/**
 * Default per-probe budget.
 *
 * Per PROBE, shared by every command inside it — `gh-auth` makes two sequential
 * calls, and a per-command ceiling let it spend twice this. `runProbe` races
 * the probe body against it, so a caller bounded by its own harness (a vitest
 * test at 10s) can pass something smaller and still get a row back instead of
 * being killed mid-probe.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/** Report order: cheapest local state first, subprocess-backed gates last. */
export const ALL_ROW_IDS: readonly PreflightRowId[] = [
  'session-marker',
  'release-state',
  'branch',
  'tree-clean',
  'origin-sync',
  'gh-auth',
  'graph-freshness',
  'ui-design-freshness',
  'garden-receipt',
  'sdd-report',
  'validate-features',
  'gate-compliance',
  'architecture',
  'adr',
  'readme',
  'cr-gate',
  'npm-name',
];

export interface ProbeContext {
  cwd: string;
  scanPaths: string[];
  nowMs: number;
  /**
   * Memoized `inspectTreeState` — three rows read it, and it runs a `git fetch`.
   * That fetch goes through {@link ProbeContext.runCommand} like every other
   * command, so the memoization bounds how often a pass repeats it and the seam
   * bounds whether it leaves the process at all.
   */
  treeState: () => Promise<TreeState>;
  /** Memoized `findPreviousTag` — `cr-gate` and `npm-name` both need it. */
  previousTag: () => Promise<string>;
  /** Memoized `.noldor/config.json` — three rows read it. */
  config: () => NoldorConfig | null;
  /** The only way out of this process. Already normalized — it never rejects. */
  runCommand: RunCommand;
  /** Budget for ONE probe, shared by every command it runs. */
  budgetMs: number;
}

/**
 * Build a context whose git lookups are memoized for the lifetime of ONE pass.
 *
 * Deliberately per-pass, not per-run: `runPreflight`'s report pass must observe
 * the post-fix tree, so it builds a second context rather than reusing a cache
 * that predates the fast-forward.
 */
export function makeProbeContext(base: {
  cwd: string;
  scanPaths: string[];
  nowMs: number;
  runCommand?: RunCommand;
  budgetMs?: number;
}): ProbeContext {
  let tree: Promise<TreeState> | null = null;
  let tag: Promise<string> | null = null;
  let cfg: { v: NoldorConfig | null } | null = null;
  // Wrapped, not merely defaulted: `RunCommand`'s "resolves rather than
  // rejects" contract cannot be typed (`Promise<never>` satisfies any promise
  // type), so a hand-written fake that throws would otherwise crash the probe
  // into runProbe's generic catch instead of the row the probe meant.
  //
  // Bound to a local so the memoized git lookups below get the SAME normalized
  // runner the probes get. Reading `base.runCommand` there would hand them the
  // raw fake, undoing the wrap for exactly the calls that spawn git.
  const runCommand = normalizeRunner(base.runCommand ?? defaultRunCommand);
  return {
    ...base,
    runCommand,
    budgetMs: base.budgetMs ?? PROBE_TIMEOUT_MS,
    // Both take the context's cwd, not process.cwd(): a probe must evaluate the
    // repo it was handed, or a fixture-backed test silently asserts against the
    // developer's own working tree. They take its runner for the same reason
    // one rung up — `inspectTreeState` spawns `git fetch`, so a context that
    // kept its own spawn would put unbounded network I/O behind every probe
    // pass however carefully the caller injected a fake.
    treeState: () => (tree ??= inspectTreeState(base.cwd, runCommand)),
    previousTag: () => (tag ??= findPreviousTag(base.cwd, runCommand)),
    // Explicit path: loadConfigSync's default is RELATIVE, so a bare call would
    // resolve against process.cwd() instead of the repo we were handed.
    config: () => (cfg ??= { v: loadConfigSync(join(base.cwd, '.noldor/config.json')) }).v,
  };
}

/** The first surface needing a capture, so the advice can name a concrete `--surface`. */
function captureSurfaceName(verdict: UiFreshnessVerdict): string | undefined {
  return verdict.surfaces.find((s) => s.remediation === 'capture')?.surface;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Every surface the warn row is actually about, each named with its own status.
 *
 * Filtering to the OVERALL status instead would re-create, one tier down, the
 * masking this file's freshness engine exists to prevent: `uninitialized`,
 * `unverified` and `indeterminate` all render one warn row, so a repo holding
 * two of them named only the higher-ranked one and the other surface went
 * unmentioned. `fresh` and `skipped` are excluded because they are the rows
 * with nothing to report.
 */
function warnWorthyNames(verdict: UiFreshnessVerdict): string {
  return verdict.surfaces
    .filter((s) => s.status !== 'fresh' && s.status !== 'skipped')
    .map((s) => `${s.surface} (${s.status})`)
    .join(', ');
}

/** Shared tail for both unevaluated-probe fix lines — one string, so they cannot drift. */
const NOT_A_PASS = 'a probe that could not evaluate its gate must not be read as a pass.';

/**
 * Per-probe override for the timeout row.
 *
 * Only `gh-auth` has advice worth keeping that a generic row would drop, so
 * this is an override rather than a field every probe must declare — 17
 * declarations would serve one real consumer.
 */
const TIMEOUT_ROWS: Partial<Record<PreflightRowId, { detail: string; fix: string }>> = {
  'gh-auth': {
    detail: 'gh probe timed out',
    fix: 'Run `gh auth status` by hand — it may be waiting on a keychain prompt.',
  },
};

/**
 * Run one probe by id, bounded by the context's budget.
 *
 * One owned `AbortController` + `setTimeout` is both the deadline and the
 * cancellation path: firing it aborts any command the probe is waiting on AND
 * resolves the race that produces the timeout row. Deriving both from one
 * deadline is what `concurrency-write-discipline` asks for, and it is why no
 * slack constant is needed to keep two independent bounds from tying. See the
 * body for why this is not `AbortSignal.timeout`.
 *
 * The budget is per PROBE, shared by every command inside it — `gh-auth` makes
 * two sequential calls, and a per-command ceiling let it spend twice the bound.
 *
 * Any unexpected throw becomes a blocking row, never a crash.
 */
export async function runProbe(id: PreflightRowId, ctx: ProbeContext): Promise<PreflightRow> {
  // A context assembled by hand rather than by `makeProbeContext` can arrive with
  // no budget, and `setTimeout(fn, undefined)` fires on the next tick — so an
  // absent budget would time out EVERY probe instead of bounding none. Fall back
  // to the same default the constructor applies.
  //
  // The upper clamp is not defensive noise: `setTimeout` stores its delay in a
  // 32-bit int, so anything past 2_147_483_647 silently wraps to about 1ms and
  // the probe would time out instantly instead of getting the long budget it was
  // handed. Clamping keeps a nonsense budget from becoming a DIFFERENT deadline.
  const MAX_DELAY_MS = 2_147_483_647;
  const requested = ctx.budgetMs;
  const budgetMs =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_DELAY_MS)
      : PROBE_TIMEOUT_MS;

  // ONE deadline drives both the cancellation and the row, per
  // `concurrency-write-discipline`: when it fires it aborts whatever command the
  // probe is waiting on AND resolves the race that produces the timeout row. The
  // earlier design raced a timer against `execFile`'s own timeout and needed a
  // slack constant to stop the two tying; there is no second bound here to drift
  // out of step with.
  //
  // An owned `AbortController` rather than `AbortSignal.timeout`, for two
  // reasons. `AbortSignal.timeout` keeps its timer and this probe's abort
  // listener scheduled until the full budget elapses even when the probe answers
  // in milliseconds — hundreds of probe executions would each leave one pending,
  // which is exactly what a completed probe must not do. And it throws
  // `RangeError` on a non-integer or out-of-range delay, which would escape as a
  // rejection instead of the blocking row this function promises; `setTimeout`
  // coerces instead.
  const controller = new AbortController();
  const deadline = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scoped: ProbeContext = {
    ...ctx,
    // Applied here rather than at each call site, so no probe can forget it.
    // A plain assignment rather than `AbortSignal.any([opts.signal, deadline])`
    // because no probe has a caller signal to compose with — the deadline is the
    // only cancellation source in this path, and a branch nothing can reach is a
    // branch nothing can test.
    runCommand: (cmd, args, opts) => ctx.runCommand(cmd, args, { ...opts, signal: deadline }),
  };

  const TIMED_OUT = Symbol('probe-timeout');
  // Both ways a probe can fail to produce a verdict — it timed out, or it threw
  // — end in the same row shape, so they share one construction below rather
  // than two literals that can drift apart.
  let unevaluated: { detail: string; fix: string };
  try {
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, budgetMs);
      timer.unref?.();
    });
    const outcome = await Promise.race([PROBES[id](scoped), timedOut]);
    if (outcome !== TIMED_OUT) return outcome;
    unevaluated = TIMEOUT_ROWS[id] ?? {
      detail: `probe exceeded its ${budgetMs}ms budget`,
      fix: `Run the gate by hand — ${NOT_A_PASS}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    unevaluated = {
      detail: `probe threw: ${message}`,
      fix: `Investigate the error above — ${NOT_A_PASS}`,
    };
  } finally {
    // On every path out, including the early `return` above: a probe that
    // answered in milliseconds must not leave its budget scheduled.
    if (timer !== undefined) clearTimeout(timer);
  }
  return { id, status: 'blocking', ...unevaluated };
}

/**
 * Spawn a noldor CLI subcommand; resolve its exit code and merged output.
 *
 * Goes through the context's seam like every other spawn — the command name
 * here comes from `noldorCliCommand`, a variable rather than a literal, which
 * is exactly the shape a command-name-keyed scan could never see.
 */
async function runCli(ctx: ProbeContext, args: string[]): Promise<{ code: number; out: string }> {
  const [cmd, cmdArgs] = noldorCliCommand(args);
  // No deadline is passed here on purpose: `runProbe` scopes `ctx.runCommand` so
  // every command it issues already carries the probe's abort signal. That is
  // what kills the child when the budget expires — without it a hung CLI would
  // outlive the probe and the sdd-report probe would never reach its tmpdir
  // cleanup.
  const { code, stdout, stderr } = await ctx.runCommand(cmd, cmdArgs, { cwd: ctx.cwd });
  return { code, out: `${stdout}${stderr}`.trim() };
}

/** First line of a subprocess blob — enough to identify a failure in one row. */
function firstLine(out: string): string {
  const line = out.split('\n').find((l) => l.trim().length > 0);
  return line?.trim() ?? '(no output)';
}

/**
 * A release skip-var: a `skipped` row tagged with the env var that caused it.
 *
 * Deliberately does NOT append to `.noldor/overrides.log` — probe evaluation is
 * side-effect free so `--preflight` stays read-only and the fix pass cannot
 * double-log a row it evaluates twice. `recordOverrides` on the release path
 * turns these tags into the audit breadcrumbs the throwing ladder wrote, once
 * per run.
 */
function overrideSkip(id: PreflightRowId, envVar: string): PreflightRow {
  return {
    id,
    status: 'skipped',
    detail: `SKIPPED via ${envVar}=1`,
    override: `${envVar}=1`,
  };
}

/**
 * Shared shape of the doc-surface probes (`architecture`, `adr`): audited
 * override first, then the surface's own absent/ok/blocking mapping — `absent`
 * is what keeps a blocking gate adoption-safe for a repo that never opted in.
 */
async function docSurfaceRow(
  id: PreflightRowId,
  envVar: string,
  check: () => Promise<{
    status: string;
    findings: readonly { message: string }[];
    notes?: readonly string[];
  }>,
  details: { absent: string; ok: string; blocking: string; fix: string },
  opts?: { severity?: 'blocking' | 'warn' },
): Promise<PreflightRow> {
  if (process.env[envVar] === '1') {
    return overrideSkip(id, envVar);
  }
  const report = await check();
  // Notes ride the detail, or a degraded check renders as clean.
  const suffix =
    report.notes !== undefined && report.notes.length > 0 ? ` — ${report.notes.join('; ')}` : '';
  if (report.status === 'absent') {
    return { id, status: 'skipped', detail: details.absent + suffix };
  }
  if (report.status === 'ok') {
    return { id, status: 'ok', detail: details.ok + suffix };
  }
  return {
    id,
    status: opts?.severity ?? 'blocking',
    detail: (report.findings[0]?.message ?? details.blocking) + suffix,
    fix: details.fix,
  };
}

const PROBES: Record<PreflightRowId, (ctx: ProbeContext) => Promise<PreflightRow>> = {
  /**
   * A foreign `/noldor-gate` session marker blocks a release. Read fresh from
   * disk on every call — the aggregate runs AHEAD of `withReleaseSession`, so
   * there is nothing to snapshot around, and a marker removed by the fix pass
   * must be seen as gone by the report pass.
   */
  'session-marker': async (ctx) => {
    const session = readSession(ctx.cwd);
    if (session === null) {
      return { id: 'session-marker', status: 'ok', detail: 'no .noldor/session.json' };
    }
    // `release-automation` is NOT foreign: `withReleaseSession` deliberately
    // falls through on it (a crashed prior release) and overwrites it with a
    // fresh timestamp. Point at the release-state row instead of crying wolf.
    if (session.path === 'release-automation') {
      return {
        id: 'session-marker',
        status: 'warn',
        detail: 'leftover release-automation marker from a crashed release run',
        fix: 'Harmless — the release overwrites it. If a release died mid-way, see the release-state row and `pnpm release --resume`.',
      };
    }
    const ttlHours = resolveSessionTtlHours(ctx.config());
    const stale = isSessionStale(session, ctx.nowMs, ttlHours);
    const slug = session.slug ?? session.parent ?? '(none)';
    return {
      id: 'session-marker',
      status: 'blocking',
      detail:
        `active gate session (path=${session.path}, slug=${slug})` +
        `${stale ? `, stale past the ${ttlHours}h TTL` : ''}`,
      fix: stale
        ? 'rm .noldor/session.json  (or `pnpm release --preflight --fix`, which removes stale markers)'
        : 'Finish the gate flow, or `rm .noldor/session.json` if you know it is abandoned. --fix will NOT remove a live marker.',
    };
  },

  /**
   * A leftover state file means an earlier release died mid-run. Re-running the
   * full pipeline would re-derive the WRONG version, because the release commit
   * itself would enter the bump window — so name the two valid moves.
   */
  'release-state': async (ctx) => {
    const state = readReleaseState(ctx.cwd);
    if (state === null) {
      return { id: 'release-state', status: 'ok', detail: 'no in-progress release' };
    }
    return {
      id: 'release-state',
      status: 'blocking',
      detail: `in-progress release v${state.version} (.noldor/release-state.json)`,
      fix: '`pnpm release --resume` to finish it, or `git reset --hard && rm .noldor/release-state.json` to discard.',
    };
  },

  branch: async (ctx) => {
    const { branch } = await ctx.treeState();
    return branch === 'main'
      ? { id: 'branch', status: 'ok', detail: 'on main' }
      : {
          id: 'branch',
          status: 'blocking',
          detail: `on ${branch}, not main`,
          fix: 'git checkout main',
        };
  },

  'tree-clean': async (ctx) => {
    const { dirty } = await ctx.treeState();
    if (dirty.length === 0) {
      return { id: 'tree-clean', status: 'ok', detail: 'working tree clean' };
    }
    const shown = dirty.slice(0, 3).join(', ');
    return {
      id: 'tree-clean',
      status: 'blocking',
      detail: `${dirty.length} dirty path(s): ${shown}${dirty.length > 3 ? ', …' : ''}`,
      fix: 'Commit or stash the changes. --fix will never touch a dirty tree.',
    };
  },

  'origin-sync': async (ctx) => {
    const { ahead, behind, remoteMissing } = await ctx.treeState();
    if (remoteMissing) {
      return {
        id: 'origin-sync',
        status: 'blocking',
        detail: 'could not resolve origin/main (no remote, or fetch failed)',
        fix: 'Check `git remote -v` and network access. "Could not verify" is not the same as "in sync".',
      };
    }
    if (ahead === 0 && behind === 0) {
      return { id: 'origin-sync', status: 'ok', detail: 'HEAD == origin/main' };
    }
    if (ahead > 0 && behind > 0) {
      return {
        id: 'origin-sync',
        status: 'blocking',
        detail: `diverged from origin/main (${ahead} ahead, ${behind} behind)`,
        fix: 'Reconcile by hand — --fix only fast-forwards a strictly-behind main, never a diverged one.',
      };
    }
    if (ahead > 0) {
      return {
        id: 'origin-sync',
        status: 'blocking',
        detail: `${ahead} commit(s) ahead of origin/main`,
        fix: 'git push origin main  (a release must not invent history the remote has not seen)',
      };
    }
    return {
      id: 'origin-sync',
      status: 'blocking',
      detail: `${behind} commit(s) behind origin/main`,
      fix: 'git merge --ff-only origin/main  (or `pnpm release --preflight --fix`)',
    };
  },

  'gh-auth': async (ctx) => {
    // The timeout case is runProbe's: it races this whole body against the
    // budget, so the two calls below share one deadline rather than getting the
    // full bound each. That is why this reads only `code` — a killed child's
    // rejection is normalized to a non-zero code like any other failure, and
    // the race has already returned the timeout row by then.
    const opts = { cwd: ctx.cwd };
    const version = await ctx.runCommand('gh', ['--version'], opts);
    const auth =
      version.code === 0 ? await ctx.runCommand('gh', ['auth', 'status'], opts) : version;
    if (auth.code === 0) {
      return { id: 'gh-auth', status: 'ok', detail: 'gh present and authenticated' };
    }
    return {
      id: 'gh-auth',
      status: 'blocking',
      detail: 'gh CLI missing or unauthenticated',
      fix: 'Install from https://cli.github.com/ then run `gh auth login`.',
    };
  },

  'graph-freshness': async (ctx) => {
    const verdict = await evaluateGraphFreshness(ctx.scanPaths, ctx.cwd);
    if (verdict.status === 'skipped') {
      return { id: 'graph-freshness', status: 'skipped', detail: verdict.detail };
    }
    if (verdict.status === 'fresh') {
      return { id: 'graph-freshness', status: 'ok', detail: verdict.detail };
    }
    return {
      id: 'graph-freshness',
      status: 'blocking',
      detail: verdict.detail,
      fix: 'Regenerate the graph (/graphify) and commit it. Not auto-fixable — graph generation is an agent skill.',
    };
  },

  'ui-design-freshness': async (ctx) => {
    // Consumer config is a separate loader from NoldorConfig; absence means the
    // repo never adopted the UI-design stage — skipped, never a throw.
    const ui = loadUiConfig(ctx.cwd);
    if (ui === null) {
      return { id: 'ui-design-freshness', status: 'skipped', detail: 'no consumer config' };
    }
    const verdict = await evaluateUiDesignFreshness(ctx.cwd, ui);
    if (verdict.overall === 'skipped') {
      return {
        id: 'ui-design-freshness',
        status: 'skipped',
        detail: 'no uiPaths configured / no surface history',
      };
    }
    if (verdict.overall === 'fresh') {
      return { id: 'ui-design-freshness', status: 'ok', detail: 'all UI baselines fresh' };
    }
    // The non-blocking verdicts are advisory — adoption must not brick a
    // release, and a git failure may never mint a red — and each must be an
    // EXPLICIT branch, because the fall-through below is `blocking` with
    // `detail` filtered to `stale`, so any status that reaches it blocks with
    // an empty reason. `indeterminate` warns rather than passing silently: it
    // outranks `fresh`, so reaching here means at least one surface could not
    // be checked at all, and the release should say so before it ships.
    if (
      verdict.overall === 'unverified' ||
      verdict.overall === 'uninitialized' ||
      verdict.overall === 'indeterminate'
    ) {
      return {
        id: 'ui-design-freshness',
        status: 'warn',
        detail: `baseline surface(s) needing attention: ${warnWorthyNames(verdict)}`,
        // Derived, not assumed: an `indeterminate` overall can be the
        // synthetic `(unmapped)` row, whose problem is a failed git probe and
        // which carries no `remediation` — telling that operator to declare a
        // capture for a surface named `(unmapped)` is advice for a different
        // problem entirely. `uninitialized` rows likewise repair via ui-sync,
        // not capture.
        ...(verdict.surfaces.some(
          (s) => s.status !== 'fresh' && s.status !== 'skipped' && s.remediation === 'capture',
        )
          ? { fix: capitalize(captureRemediation(captureSurfaceName(verdict))) }
          : {}),
      };
    }
    // Exhaustive by construction. The fall-through below renders `blocking`
    // with a `stale`-filtered detail, so a status that reaches it unhandled
    // blocks every consumer with an empty reason. Naming `stale` explicitly and
    // asserting `never` on the rest makes a new status a typecheck error here
    // instead of a silent release block.
    if (verdict.overall !== 'stale') {
      const never: never = verdict.overall;
      return never;
    }

    // The fix line is DERIVED from the blocking rows, not fixed text: `stale`
    // no longer implies one remedy. A surface whose receipt is behind its UI is
    // repaired by re-capturing, and `design ui-sync` explicitly refuses those
    // rows — it stages nothing and exits 1 — so a hardcoded ui-sync line would
    // send the operator to a command that cannot clear the block.
    const blocking = verdict.surfaces.filter((s) => s.status === 'stale');
    const needsCapture = blocking.some((s) => s.remediation === 'capture');
    const needsSync = blocking.some((s) => s.remediation !== 'capture');
    return {
      id: 'ui-design-freshness',
      status: 'blocking',
      detail: blocking.map((s) => `${s.surface}: ${s.detail}`).join('; '),
      fix: [
        needsCapture ? capitalize(captureRemediation(captureSurfaceName(verdict))) : '',
        needsSync
          ? 'Run `pnpm noldor design ui-sync` in a pencil-capable session and commit the baseline — not auto-fixable, baseline editing is an agent skill.'
          : '',
      ]
        .filter((line) => line.length > 0)
        .join(' '),
    };
  },

  'garden-receipt': async (ctx) => {
    if (process.env.RELEASE_SKIP_GARDEN_GATE === '1') {
      return overrideSkip('garden-receipt', 'RELEASE_SKIP_GARDEN_GATE');
    }
    const verdict = evaluateGardenFreshness({
      receipt: readGardenReceipt(ctx.cwd),
      latestSrcTs: latestGardenScanCommitTs(ctx.cwd, ctx.scanPaths),
    });
    if (verdict.ok) {
      return { id: 'garden-receipt', status: 'ok', detail: 'receipt postdates the latest commit' };
    }
    return {
      id: 'garden-receipt',
      status: 'blocking',
      detail: verdict.reason ?? 'garden receipt stale',
      fix: 'Run /noldor-garden then `pnpm noldor garden receipt` — or `pnpm release --preflight --fix`, which re-stamps when `garden detect` is clean.',
    };
  },

  /**
   * Regenerate the SDD report to a temp path and compare against the committed
   * copy. ALWAYS to a temp path — never in place.
   *
   * An in-place variant existed so the real release could fold volatile-only
   * drift into its own commit, but it made an ostensibly read-only evaluation
   * rewrite a tracked file even when `branch` / `tree-clean` / `origin-sync`
   * were already blocking: `pnpm release` from a dirty tree or feature branch
   * would rewrite `docs/sdd-report.md` and then abort, leaving unexplained drift
   * behind. The throwing ladder aborted before its regen ran. The canonical
   * regen now happens in `index.ts` AFTER the aggregate comes back clean, which
   * both restores that ordering and keeps every probe side-effect free.
   *
   * The temp dir lives under the OS temp dir (never inside the repo, so it
   * cannot dirty the tree or trip `tree-clean`) and is removed in a `finally`.
   */
  'sdd-report': async (ctx) => {
    const committed = await readFile(join(ctx.cwd, 'docs/sdd-report.md'), 'utf8').catch(() => null);
    let regenerated: string;
    let tmpDir: string | null = null;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'noldor-preflight-sdd-'));
      const out = join(tmpDir, 'sdd-report.md');
      const { code, out: cliOut } = await runCli(ctx, [
        'garden',
        'sdd-report',
        '--release',
        '--out',
        out,
      ]);
      if (code !== 0) {
        return {
          id: 'sdd-report',
          status: 'blocking',
          detail: `sdd-report regen failed: ${firstLine(cliOut)}`,
          fix: 'Fix the report generator, then re-run. A report that cannot regenerate cannot be compared.',
        };
      }
      regenerated = await readFile(out, 'utf8');
    } finally {
      if (tmpDir !== null) await rm(tmpDir, { recursive: true, force: true });
    }

    if (committed === null) {
      return {
        id: 'sdd-report',
        status: 'blocking',
        detail: 'no committed docs/sdd-report.md to compare against',
        fix: 'Commit the generated docs/sdd-report.md.',
      };
    }
    // BOTH sides trimmed. `maskEnvironmental` only pattern-replaces and never
    // touches a trailing newline, so comparing a raw `committed` (which ends
    // 0x0a) against a trimmed regen can never be equal — that asymmetry silently
    // turned every volatile-only drift into a blocking row, regressing the exact
    // allowance this row's ok-detail claims to preserve. The old ladder compared
    // both sides trimmed.
    const committedTrimmed = committed.trim();
    const regeneratedTrimmed = regenerated.trim();
    if (committedTrimmed === regeneratedTrimmed) {
      return { id: 'sdd-report', status: 'ok', detail: 'report matches the committed copy' };
    }
    if (onlyVolatileSectionsChanged(committedTrimmed, regeneratedTrimmed)) {
      return {
        id: 'sdd-report',
        status: 'ok',
        detail: 'differs only in environment-local sections (review-skip count / local metrics)',
      };
    }
    return {
      id: 'sdd-report',
      status: 'blocking',
      detail: 'regenerated report differs from the committed copy',
      fix: 'Run `pnpm noldor garden sdd-report --release` and commit the result.',
    };
  },

  'validate-features': async (ctx) => {
    const { code, out } = await runCli(ctx, ['validate', 'features']);
    return code === 0
      ? { id: 'validate-features', status: 'ok', detail: firstLine(out) }
      : {
          id: 'validate-features',
          status: 'blocking',
          detail: firstLine(out),
          fix: 'Run `pnpm noldor validate features` and fix each reported feature MD.',
        };
  },

  'gate-compliance': async (ctx) => {
    if (process.env.RELEASE_SKIP_GATE_COMPLIANCE === '1') {
      return overrideSkip('gate-compliance', 'RELEASE_SKIP_GATE_COMPLIANCE');
    }
    const { code, out } = await runCli(ctx, ['garden', 'detect', '--gate-compliance']);
    return code === 0
      ? { id: 'gate-compliance', status: 'ok', detail: 'no gate-compliance findings' }
      : {
          id: 'gate-compliance',
          status: 'blocking',
          detail: firstLine(out),
          fix: 'Run `pnpm noldor garden detect --gate-compliance` and address each finding.',
        };
  },

  /**
   * The architecture surface must be filled in before a release — but only for a
   * repo that opted in. `checkArchitecture` reports `absent` both for a missing
   * folder and for an untouched scaffold, so `noldor init` cannot hand a fresh
   * consumer a blocking row. Module advisories never reach `findings`, so a
   * renamed directory nags in garden without stopping a release.
   *
   * The override is read first: an overridden run must report through the
   * override tag rather than depending on what the folder happens to hold.
   */
  architecture: (ctx) =>
    docSurfaceRow('architecture', 'RELEASE_SKIP_ARCHITECTURE', () => checkArchitecture(ctx.cwd), {
      absent: 'no opted-in docs/architecture/',
      ok: 'architecture pages complete',
      blocking: 'architecture pages incomplete',
      fix: 'Run `pnpm noldor docs architecture --check` and fill in each reported page.',
    }),

  /**
   * Decision records must validate before a release — but only for a repo that
   * opted in by writing one. `checkAdr` reports `absent` for a missing folder
   * or one with no records, so a consumer who has written no ADRs is never
   * blocked. This row is what catches an invalid record landed outside the
   * push seam (release pushes, override merges, hand edits on main).
   */
  adr: (ctx) =>
    docSurfaceRow('adr', 'RELEASE_SKIP_ADR', () => checkAdr(ctx.cwd), {
      absent: 'no decision records in docs/adr/',
      ok: 'decision records valid',
      blocking: 'decision records invalid',
      fix: 'Run `pnpm noldor docs adr --check` and repair each reported record.',
    }),

  /**
   * README content drift. `warn`, never blocking: the README is consumer-owned
   * and sits outside `RELEASE_SWEEP_GLOBS`, so a stale line must not withhold a
   * release.
   */
  readme: (ctx) =>
    docSurfaceRow(
      'readme',
      'RELEASE_SKIP_README',
      () => checkReadme(ctx.cwd),
      {
        absent: 'no readable README.md',
        ok: 'every docs/ surface is reachable from README.md',
        blocking: 'README content drift',
        fix: 'Run `pnpm noldor checks readme` and repair each reported line.',
      },
      { severity: 'warn' },
    ),

  'cr-gate': async (ctx) => {
    if (process.env.RELEASE_SKIP_CR_GATE === '1') {
      return overrideSkip('cr-gate', 'RELEASE_SKIP_CR_GATE');
    }
    const previousTag = await ctx.previousTag();
    if (previousTag === 'v0.0.0') {
      return { id: 'cr-gate', status: 'skipped', detail: 'no previous tag — first release' };
    }
    const result = await checkCrGate({
      from: previousTag,
      to: 'HEAD',
      cwd: ctx.cwd,
      run: ctx.runCommand,
      exemptions: ctx.config()?.release?.crGateExemptCommits ?? [],
    });
    if (result.ok) {
      const exempt = result.exempted.length > 0 ? ` (${result.exempted.length} exempted)` : '';
      return { id: 'cr-gate', status: 'ok', detail: `all commits since ${previousTag}${exempt}` };
    }
    return {
      id: 'cr-gate',
      status: 'blocking',
      detail: `${result.offenders.length} commit(s) without a review receipt since ${previousTag}`,
      fix: 'Review the offenders listed by the release CR gate, or record an exemption in `release.crGateExemptCommits`.',
    };
  },

  /**
   * Probe the package name on the registry BEFORE tagging.
   *
   * Asserts ownership, never similarity: npm's new-package moderation rules are
   * undisclosed (unscoped `noldor` was rejected as "too similar to `color`"), so
   * an unscoped-and-unpublished name gets an honest `warn` rather than a
   * heuristic green that moderation later overrules.
   */
  'npm-name': async (ctx) => {
    const publishCfg = ctx.config()?.release?.publish;
    if (!publishCfg?.enabled) {
      return { id: 'npm-name', status: 'skipped', detail: 'release.publish.enabled is false' };
    }
    const { name } = readPkgIdentity(ctx.cwd);
    const registry = publishCfg.registry ?? 'https://registry.npmjs.org';
    const scoped = name.startsWith('@');

    const view = await ctx.runCommand(
      'npm',
      ['view', name, 'versions', '--json', '--registry', registry],
      { cwd: ctx.cwd },
    );
    let resolved = view.code === 0;
    if (!resolved) {
      // `stderr` carries the whole story because the seam folds a spawn error's
      // message into it — for an absent `npm` (ENOENT) nothing else would.
      const blob = view.stderr;
      // Only a clean 404 proves the name is unpublished. Anything else — network
      // down, 5xx, missing `npm` — leaves the question unanswered, and reporting
      // `ok` on an unanswered question is worse than admitting the unknown.
      if (!/E404|404 Not Found/.test(blob)) {
        return {
          id: 'npm-name',
          status: 'warn',
          detail: `could not reach the registry: ${firstLine(blob)}`,
          fix: `npm view ${name} --registry ${registry}`,
        };
      }
    }

    // "Ours" is operationalized as "this repo has released before": an
    // unauthenticated `npm view` exposes no ownership metadata.
    const released = (await ctx.previousTag()) !== 'v0.0.0';
    if (resolved) {
      return released
        ? { id: 'npm-name', status: 'ok', detail: `${name} resolves and this repo has released` }
        : {
            id: 'npm-name',
            status: 'blocking',
            detail: `${name} already exists on ${registry} but this repo has never released`,
            fix: 'Pick a different package name, or scope it (@scope/name), then update package.json.',
          };
    }
    return scoped
      ? { id: 'npm-name', status: 'ok', detail: `${name} unpublished and scoped` }
      : {
          id: 'npm-name',
          status: 'warn',
          detail: `${name} is unpublished and unscoped`,
          fix: 'npm new-package moderation can reject a name too similar to a popular package (unscoped `noldor` → "too similar to `color`"). Prefer @scope/name.',
        };
  },
};
