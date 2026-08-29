// One probe per release state gate. Each returns a PreflightRow instead of
// throwing, so the aggregate can report every failure in one pass.
//
// Where a pure evaluator already existed it is reused rather than re-derived:
// `evaluateGardenFreshness`, `checkCrGate` and `onlyVolatileSectionsChanged`
// were already report-shaped, and `inspectTreeState` / `evaluateGraphFreshness`
// were extracted from their throwing wrappers for exactly this purpose. No gate
// condition is expressed twice.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
import { evaluateUiDesignFreshness } from './ui-design-freshness.js';
import type { UiFreshnessVerdict, UiSurfaceFreshness } from './ui-design-freshness.js';
import { readPkgIdentity } from './release-publish.js';
import { checkCrGate } from './release-cr-gate.js';
import { readReleaseState } from './release-state.js';
import { findPreviousTag } from './release-version.js';
import { onlyVolatileSectionsChanged } from './sdd-report-diff.js';
import type { PreflightRow, PreflightRowId } from './preflight-types.js';

const execFileP = promisify(execFile);

/** Ceiling for network-bound probes (`gh auth status`, `npm view`). */
const PROBE_TIMEOUT_MS = 15_000;

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
  /** Memoized `inspectTreeState` — three rows read it, and it runs a `git fetch`. */
  treeState: () => Promise<TreeState>;
  /** Memoized `findPreviousTag` — `cr-gate` and `npm-name` both need it. */
  previousTag: () => Promise<string>;
  /** Memoized `.noldor/config.json` — three rows read it. */
  config: () => NoldorConfig | null;
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
}): ProbeContext {
  let tree: Promise<TreeState> | null = null;
  let tag: Promise<string> | null = null;
  let cfg: { v: NoldorConfig | null } | null = null;
  return {
    ...base,
    // Both take the context's cwd, not process.cwd(): a probe must evaluate the
    // repo it was handed, or a fixture-backed test silently asserts against the
    // developer's own working tree.
    treeState: () => (tree ??= inspectTreeState(base.cwd)),
    previousTag: () => (tag ??= findPreviousTag(base.cwd)),
    // Explicit path: loadConfigSync's default is RELATIVE, so a bare call would
    // resolve against process.cwd() instead of the repo we were handed.
    config: () => (cfg ??= { v: loadConfigSync(join(base.cwd, '.noldor/config.json')) }).v,
  };
}

/**
 * The one remediation sentence for a surface that needs a capture. Single-
 * sourced because `ui-sync` renders the same advice: its earlier wording said
 * only "run design capture", which dead-ends for a legacy row that has no
 * `uiCapture` block — `design capture` exits 2 telling the operator to declare
 * one. The declare-first half is load-bearing.
 */
export const CAPTURE_FIX =
  'Declare `consumer.uiCapture` for the surface if it has none, run `pnpm noldor design capture --surface <name>`, and commit the baseline with its receipt.';

/** Comma-joined surface names carrying `status`, for a freshness detail line. */
function namesWithStatus(
  verdict: UiFreshnessVerdict,
  status: UiSurfaceFreshness['status'],
): string {
  return verdict.surfaces
    .filter((s) => s.status === status)
    .map((s) => s.surface)
    .join(', ');
}

/** Run one probe by id. Any unexpected throw becomes a blocking row, never a crash. */
export async function runProbe(id: PreflightRowId, ctx: ProbeContext): Promise<PreflightRow> {
  try {
    return await PROBES[id](ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      status: 'blocking',
      detail: `probe threw: ${message}`,
      fix: 'Investigate the error above — a probe that cannot evaluate its gate must not be read as a pass.',
    };
  }
}

/** Spawn a noldor CLI subcommand; resolve its exit code and merged output. */
async function runCli(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const [cmd, cmdArgs] = noldorCliCommand(args);
  try {
    const { stdout, stderr } = await execFileP(cmd, cmdArgs, { cwd });
    return { code: 0, out: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
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

  'gh-auth': async () => {
    try {
      // Bounded: a gh keychain prompt or hung network would otherwise stall the
      // whole aggregate with no row to blame it on.
      await execFileP('gh', ['--version'], { timeout: PROBE_TIMEOUT_MS });
      await execFileP('gh', ['auth', 'status'], { timeout: PROBE_TIMEOUT_MS });
      return { id: 'gh-auth', status: 'ok', detail: 'gh present and authenticated' };
    } catch (err) {
      const timedOut = (err as { killed?: boolean }).killed === true;
      return {
        id: 'gh-auth',
        status: 'blocking',
        detail: timedOut
          ? `gh probe timed out after ${PROBE_TIMEOUT_MS}ms`
          : 'gh CLI missing or unauthenticated',
        fix: timedOut
          ? 'Run `gh auth status` by hand — it may be waiting on a keychain prompt.'
          : 'Install from https://cli.github.com/ then run `gh auth login`.',
      };
    }
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
    // Both non-blocking verdicts are advisory for the same reason — adoption
    // must not brick a release — and both must be EXPLICIT branches, because
    // the fall-through below is `blocking` with `detail` filtered to `stale`,
    // so any status that reaches it blocks with an empty reason.
    if (verdict.overall === 'unverified' || verdict.overall === 'uninitialized') {
      return {
        id: 'ui-design-freshness',
        status: 'warn',
        detail: `${verdict.overall} baseline surface(s): ${namesWithStatus(verdict, verdict.overall)}`,
        // Derived, not assumed: an `unverified` overall can also be the
        // synthetic `(unmapped)` row, whose problem is a failed git probe and
        // which carries no `remediation` — telling that operator to declare a
        // capture for a surface named `(unmapped)` is advice for a different
        // problem entirely.
        ...(verdict.surfaces.some(
          (s) => s.status === verdict.overall && s.remediation === 'capture',
        )
          ? { fix: CAPTURE_FIX }
          : {}),
      };
    }
    // Exhaustive by construction. The fall-through below renders `blocking`
    // with a `stale`-filtered detail, so a status that reaches it unhandled
    // blocks every consumer with an empty reason. Naming `stale` explicitly and
    // asserting `never` on the rest makes a sixth status a typecheck error here
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
        needsCapture ? CAPTURE_FIX : '',
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
      const { code, out: cliOut } = await runCli(
        ['garden', 'sdd-report', '--release', '--out', out],
        ctx.cwd,
      );
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
    const { code, out } = await runCli(['validate', 'features'], ctx.cwd);
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
    const { code, out } = await runCli(['garden', 'detect', '--gate-compliance'], ctx.cwd);
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
    const result = checkCrGate({
      from: previousTag,
      to: 'HEAD',
      cwd: ctx.cwd,
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

    let resolved: boolean;
    try {
      await execFileP('npm', ['view', name, 'versions', '--json', '--registry', registry], {
        timeout: PROBE_TIMEOUT_MS,
      });
      resolved = true;
    } catch (err) {
      const blob = `${(err as { stderr?: string }).stderr ?? ''}${(err as Error).message ?? ''}`;
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
      resolved = false;
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
