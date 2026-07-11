import type { SessionMarker } from './session.js';

export interface FdSummary {
  name: string;
  summary: string;
}

export interface CrPass {
  reviewer: 'claude' | 'codex' | 'subagent';
  tipSha: string;
  findings: number;
  status: 'clean' | 'addressed';
}

export interface CrResultSummary {
  passes: CrPass[];
  status: 'clean' | 'exhausted';
}

/** Verify-lane outcome lifted from the `.noldor/cr/<slug>-code-verify.json`
 *  sink. Shaped locally (not imported from `src/cr/findings-schema.ts`)
 *  because the `core-is-foundation` boundary forbids `src/core` → `src/cr`
 *  imports. */
export interface VerifyEvidencePair {
  command: string;
  observed: string;
}

export interface VerifySummary {
  verdict: string;
  evidence: VerifyEvidencePair[];
}

export interface PrFlowInput {
  cwd: string;
  branch: string;
  base: string;
  repoUrl: string;
  session: SessionMarker;
  fd: FdSummary | null;
  specPath: string | null;
  planPath: string | null;
  crResults: CrResultSummary;
  verify: VerifySummary | null;
  headSha: string;
  firstCommitSubject: string;
}

export interface PrFlowResult {
  prUrl: string;
  prNumber: number;
  /** ISO timestamp once merged, or `null` when opened in `openOnly` mode (parallel drain K>1:
   *  the supervisor's serialized merge coordinator owns the merge, not this call). */
  mergedAt: string | null;
}

/** Returned by {@link openAndAutoMerge} instead of {@link PrFlowResult} when the
 *  idempotency guard short-circuits the delivery: the branch's commits already
 *  landed on `origin/<base>`, so no push / PR was made. Discriminated by the
 *  `skipped` field so callers narrow with `'skipped' in result`. */
export interface RedundantDelivery {
  skipped: true;
  reason: string;
}

export function composeTitle(input: PrFlowInput): string {
  return input.firstCommitSubject;
}

function renderCrTable(passes: CrPass[]): string {
  const rows = passes.map((p, i) => {
    const statusCell = p.status === 'clean' ? '✅' : '✏️ addressed';
    return `| ${i + 1} | ${p.reviewer} | \`${p.tipSha}\` | ${p.findings} | ${statusCell} |`;
  });
  return [
    '| Pass | Reviewer | Tip SHA | Findings | Status |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** Spec item D3 (acceptance-verify-lane): surface the verify lane's
 *  command/observed pairs on the PR so reviewers see behavioral proof, not
 *  just a verdict word. Omitted entirely when no verify sink was found. */
function renderVerifySection(verify: VerifySummary | null): string {
  if (verify === null) return '';
  const pairs = verify.evidence.map((e, i) =>
    [
      `${i + 1}. \`${e.command}\``,
      '',
      '   ```',
      ...e.observed.split('\n').map((l) => `   ${l}`),
      '   ```',
    ].join('\n'),
  );
  const body =
    pairs.length > 0 ? pairs.join('\n') : '_No command/observed pairs recorded for this verdict._';
  return ['## Verify Evidence', '', `Lane verdict: \`${verify.verdict}\``, '', body, '', ''].join(
    '\n',
  );
}

function renderLinksSection(input: PrFlowInput): string {
  const blobBase = `${input.repoUrl}/blob/${input.headSha}`;
  const lines: string[] = [];
  if (input.fd) {
    // Attach paths leave `session.slug` undefined and set `session.parent`
    // to the FD being extended — mirror the CLI's `session.parent ?? session.slug`
    // priority (pr-flow-cli.ts loadFdSummary call) so the link points at the
    // actual FD instead of `docs/features/unknown.md`.
    const slug = input.session.parent ?? input.session.slug ?? 'unknown';
    lines.push(
      `- Feature MD: [\`docs/features/${slug}.md\`](${blobBase}/docs/features/${slug}.md)`,
    );
  }
  if (input.specPath) {
    lines.push(`- Spec: [\`${input.specPath}\`](${blobBase}/${input.specPath})`);
  }
  if (input.planPath) {
    lines.push(`- Plan: [\`${input.planPath}\`](${blobBase}/${input.planPath})`);
  }
  if (lines.length === 0) return '';
  return `## Links\n\n${lines.join('\n')}\n\n`;
}

export function composeBody(input: PrFlowInput): string {
  if (input.session.path === 'release-sweep') {
    const sweepScope = [
      `- Gate path: \`${input.session.path}\``,
      `- Worktree branch: \`${input.branch}\``,
    ].join('\n');
    return [
      '## Pre-release sweep',
      '',
      'Pre-release sweep results. Lands as a single PR; merge gates the release-confirmation prompt below.',
      '',
      '## Scope',
      '',
      sweepScope,
      '',
    ].join('\n');
  }

  // No-FD paths (micro-chore, fast-track) have no FD summary to draw from, so
  // they fall back to the first commit subject — labelled by the actual gate
  // path. fast-track is a code change, not a doc-only micro-chore; mislabelling
  // it `Micro-chore` misrepresents what shipped.
  const noFdLabel = input.session.path === 'fast-track' ? 'Fast-track' : 'Micro-chore';
  const summary = input.fd ? input.fd.summary : `${noFdLabel}: ${input.firstCommitSubject}`;

  const scope = [
    `- Gate path: \`${input.session.path}\``,
    `- Slug: \`${input.session.slug ?? '—'}\``,
    `- Parent FD: \`${input.session.parent ?? '—'}\``,
    `- Worktree branch: \`${input.branch}\``,
  ].join('\n');

  const links = renderLinksSection(input);

  const crTable = renderCrTable(input.crResults.passes);

  const exhaustedBanner =
    input.crResults.status === 'exhausted'
      ? '> ⚠️ **CR retry exhausted** — codex findings persisted across 3 passes. See passes table below; manual review recommended before merge.\n\n'
      : '';

  const testPlanItems = input.fd
    ? [
        '- [ ] `pnpm validate:features` passes (run pre-merge).',
        '- [ ] `pnpm typecheck` passes.',
        '- [ ] `pnpm test` (relevant subset) passes.',
        '- [ ] Manual dogfood: see feature MD Usage section for acceptance criteria.',
      ]
    : ['- [ ] Doc-only change; no test plan beyond `pnpm validate:features`.'];

  return [
    '## Summary',
    '',
    summary,
    '',
    '## Scope',
    '',
    scope,
    '',
    links + exhaustedBanner + '## CR Results',
    '',
    crTable,
    '',
    renderVerifySection(input.verify) + '## Test Plan',
    '',
    testPlanItems.join('\n'),
    '',
    '---',
    '',
    '*Opened by Noldor `/noldor-gate` end-of-flow. CR run locally; trailers recorded on each commit.*',
    '',
  ].join('\n');
}

export class GhPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhPreflightError';
  }
}

export class MergeTimeoutError extends Error {
  constructor(public prUrl: string) {
    super(`Auto-merge poll timed out for ${prUrl}; merge may still complete later.`);
    this.name = 'MergeTimeoutError';
  }
}

export class PrClosedWithoutMergeError extends Error {
  constructor(public prUrl: string) {
    super(`PR ${prUrl} was closed without merging.`);
    this.name = 'PrClosedWithoutMergeError';
  }
}

export class ChecksFailedError extends Error {
  constructor(
    public prUrl: string,
    public failing: string[],
  ) {
    super(
      `Refusing to merge ${prUrl}: failing status checks — ${failing.join(', ')}. Fix CI (or re-run the failed checks) and retry.`,
    );
    this.name = 'ChecksFailedError';
  }
}

export class ChecksPendingTimeoutError extends Error {
  constructor(public prUrl: string) {
    super(
      `Status checks for ${prUrl} did not settle within the poll window; refusing direct merge with unverified CI.`,
    );
    this.name = 'ChecksPendingTimeoutError';
  }
}

export interface SpawnResult {
  stdout: string;
  exitCode: number;
}
export type SpawnFn = (cmd: string, args: string[], stdin?: string) => Promise<SpawnResult>;

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000; // 10 min
const BEHIND_TIMEOUT_MS = 20 * 60_000; // 20 min — extended when branch is BEHIND base

export async function preflightGh(opts: { spawn: SpawnFn }): Promise<void> {
  const version = await opts.spawn('gh', ['--version']);
  if (version.exitCode !== 0) {
    throw new GhPreflightError(
      'gh CLI not installed. Install via `brew install gh` (or platform equivalent) and run `gh auth login`.',
    );
  }
  const auth = await opts.spawn('gh', ['auth', 'status']);
  if (auth.exitCode !== 0) {
    throw new GhPreflightError(
      'gh CLI is unauthenticated. Run `gh auth login` (scopes: repo, read:org).',
    );
  }
}

const STATUS_THROTTLE_MS = 30_000;

export async function pollAutoMerge(opts: {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs: number;
  timeoutMs: number;
  onStatus?: (line: string) => void;
  now?: () => number;
}): Promise<{ mergedAt: string }> {
  const now = opts.now ?? Date.now;
  const start = now();
  let extendedDeadline = opts.timeoutMs;
  let behindObserved = false;
  let lastEmitMs: number | null = null;
  let lastState: string | null = null;
  let lastMss: string | null = null;

  while (now() - start < extendedDeadline) {
    const r = await opts.spawn('gh', [
      'pr',
      'view',
      opts.prUrl,
      '--json',
      'mergedAt,state,mergeStateStatus',
    ]);
    if (r.exitCode === 0) {
      const data = JSON.parse(r.stdout) as {
        mergedAt: string | null;
        state: string;
        mergeStateStatus?: string | null;
      };
      if (data.mergedAt) return { mergedAt: data.mergedAt };
      if (data.state === 'CLOSED') throw new PrClosedWithoutMergeError(opts.prUrl);
      if (data.state === 'BEHIND' && !behindObserved) {
        behindObserved = true;
        // Absolute ceiling from poll start — not from when BEHIND was first seen
        extendedDeadline = BEHIND_TIMEOUT_MS;
      }
      if (opts.onStatus) {
        const mss = data.mergeStateStatus ?? 'UNKNOWN';
        const elapsedMs = now() - start;
        // Emit on first cycle, on any meaningful transition (so OPEN→BEHIND /
        // BLOCKED→CLEAN surface immediately, not after the 30s window), or when
        // the steady-state throttle window has elapsed. No anti-flap guard: GH
        // merge states do not flap in practice (monotonic toward CLEAN/MERGED).
        const changed = data.state !== lastState || mss !== lastMss;
        if (lastEmitMs === null || changed || elapsedMs - lastEmitMs >= STATUS_THROTTLE_MS) {
          opts.onStatus(
            `Auto-merge: state=${data.state}, mergeStateStatus=${mss}, elapsed=${Math.floor(elapsedMs / 1000)}s`,
          );
          lastEmitMs = elapsedMs;
          lastState = data.state;
          lastMss = mss;
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new MergeTimeoutError(opts.prUrl);
}

/** One entry of `gh pr view --json statusCheckRollup` — a union of CheckRun
 *  (Checks API / GitHub Actions) and StatusContext (legacy commit statuses). */
interface StatusCheck {
  name?: string; // CheckRun
  context?: string; // StatusContext
  status?: string; // CheckRun: QUEUED | IN_PROGRESS | COMPLETED | ...
  conclusion?: string; // CheckRun (when COMPLETED): SUCCESS | FAILURE | NEUTRAL | SKIPPED | ...
  state?: string; // StatusContext: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
}

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);
const FAILING_STATES = new Set(['FAILURE', 'ERROR']);

function checkLabel(c: StatusCheck): string {
  return c.name ?? c.context ?? 'unknown-check';
}

function isFailingCheck(c: StatusCheck): boolean {
  if (c.conclusion !== undefined && FAILING_CONCLUSIONS.has(c.conclusion)) return true;
  return c.state !== undefined && FAILING_STATES.has(c.state);
}

function isPendingCheck(c: StatusCheck): boolean {
  // StatusContext carries `state`, CheckRun carries `status`.
  if (c.state !== undefined) return c.state === 'PENDING' || c.state === 'EXPECTED';
  return c.status !== 'COMPLETED';
}

/** Poll `statusCheckRollup` until every check settles. Returns when all checks
 *  passed (or the PR has no checks at all — repos without CI merge as before).
 *  Throws {@link ChecksFailedError} as soon as any check reports failure and
 *  {@link ChecksPendingTimeoutError} when checks are still pending at the
 *  deadline — in both cases the caller must NOT merge. */
export async function pollChecksBeforeMerge(opts: {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs: number;
  timeoutMs: number;
  onStatus?: (line: string) => void;
  now?: () => number;
}): Promise<void> {
  const now = opts.now ?? Date.now;
  const start = now();
  while (now() - start < opts.timeoutMs) {
    const r = await opts.spawn('gh', ['pr', 'view', opts.prUrl, '--json', 'statusCheckRollup']);
    if (r.exitCode === 0) {
      let checks: StatusCheck[] | null = null;
      try {
        const data = JSON.parse(r.stdout) as { statusCheckRollup: StatusCheck[] | null };
        checks = data.statusCheckRollup ?? [];
      } catch {
        // Unparseable stdout — treat as a transient fetch failure and re-poll.
      }
      if (checks !== null) {
        const failing = checks.filter(isFailingCheck);
        if (failing.length > 0) {
          throw new ChecksFailedError(opts.prUrl, failing.map(checkLabel));
        }
        const pending = checks.filter(isPendingCheck);
        if (pending.length === 0) return;
        opts.onStatus?.(
          `Checks: ${pending.length} pending (${pending.map(checkLabel).join(', ')}), elapsed=${Math.floor((now() - start) / 1000)}s`,
        );
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new ChecksPendingTimeoutError(opts.prUrl);
}

export interface OpenAndAutoMergeInput extends PrFlowInput {
  spawn: SpawnFn;
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (line: string) => void;
  /** When true (parallel drain K>1, via `NOLDOR_DRAIN_OPEN_ONLY=1`): push + open the PR, then RETURN
   *  without merging or polling. The drain supervisor's serialized merge coordinator owns the merge. */
  openOnly?: boolean;
}

/**
 * Idempotency guard for the delivery chokepoint. Returns a {@link RedundantDelivery}
 * when every commit the branch would introduce is already patch-id-equivalent to a
 * commit on `origin/<base>` — i.e. the change already landed (typically because a
 * concurrent process squash-merged the same local commit) and pushing / opening a PR
 * now would deliver a redundant duplicate. This is the PR #76 + #77 race: a triage
 * commit that lived un-pushed on local `main` got shipped twice because nothing
 * detected it had already reached `origin` under a different sha. Returns `null` when
 * there is genuinely new content to deliver.
 *
 * Mechanism: `git cherry origin/<base> <branch>` leans on git's own patch-id
 * equivalence — each examined commit is prefixed `-` when an equivalent patch already
 * exists upstream, `+` otherwise. All `-` (or empty output ⇒ nothing ahead) means the
 * whole branch is redundant. A single `+` means real new content ⇒ deliver.
 *
 * A `git fetch origin <base>` refreshes the remote-tracking ref first: the race hinges
 * on the local `origin/<base>` being stale (the operator hasn't fetched since the
 * concurrent squash-merge), so without the fetch the guard would compare against a
 * pre-duplicate `origin/<base>` and miss the match.
 *
 * Fail-open: if the fetch or `git cherry` errors (offline, missing ref, …) the guard
 * declines to block and returns `null`. A best-effort dedupe must never wedge a
 * legitimate delivery — delivering (the pre-existing behaviour) is the safe default.
 *
 * Coverage boundaries (deliberate, both fail toward delivering — never toward a false skip):
 * - Per-commit patch-id: a concurrent *squash-merge of a multi-commit branch* collapses to
 *   one upstream commit whose patch-id matches none of the individual branch commits, so
 *   `git cherry` reports all `+` and the guard delivers. Only the single-commit shape (the
 *   observed PR #76+#77 case) is caught. Widening this needs a range/tree diff, not cherry.
 * - This guard prevents the redundant *push + PR* only. A headless drain child that skips
 *   here exits 0 with no PR on its branch, which the drain's ship-accounting
 *   (`settleShipVerdict` in `src/autonomous/drain-loop.ts`) reads as a non-ship and retries.
 *   That retry is pre-existing (previously the child's `gh pr create` failed "no commits
 *   between …" and retried anyway) and bounded by the spawn cap — but teaching the drain to
 *   recognize a redundant-skip as a landed ship is a separate drain-state change, not here.
 */
export async function checkRedundantDelivery(opts: {
  branch: string;
  base: string;
  spawn: SpawnFn;
}): Promise<RedundantDelivery | null> {
  const upstream = `origin/${opts.base}`;
  const fetch = await opts.spawn('git', ['fetch', 'origin', opts.base]);
  if (fetch.exitCode !== 0) {
    process.stderr.write(
      `pr-flow: idempotency guard could not fetch ${upstream} (exit ${fetch.exitCode}); proceeding with delivery.\n`,
    );
    return null;
  }
  const cherry = await opts.spawn('git', ['cherry', upstream, opts.branch]);
  if (cherry.exitCode !== 0) {
    process.stderr.write(
      `pr-flow: idempotency guard: 'git cherry ${upstream} ${opts.branch}' failed (exit ${cherry.exitCode}); proceeding with delivery.\n`,
    );
    return null;
  }
  const lines = cherry.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Any `+ ` line ⇒ at least one commit introduces content not yet upstream ⇒ deliver.
  if (lines.some((l) => l.startsWith('+'))) return null;
  const reason =
    lines.length === 0
      ? `delivery skipped — branch ${opts.branch} has no commits ahead of ${upstream} (already merged).`
      : `delivery skipped — all ${lines.length} commit(s) on ${opts.branch} already exist on ${upstream} (patch-id match); no PR opened.`;
  return { skipped: true, reason };
}

export async function openAndAutoMerge(
  input: OpenAndAutoMergeInput,
): Promise<PrFlowResult | RedundantDelivery> {
  await preflightGh({ spawn: input.spawn });

  // Idempotency guard: skip the push/PR when the branch's commits already landed on
  // origin/<base> (patch-id equivalence). Sits at the single delivery chokepoint, so it
  // prevents the redundant push + duplicate PR for every caller that reaches it — the
  // operator gate, the drain child (ships via `pnpm noldor pr-flow`), and the openOnly
  // parallel-drain child. (What the drain does *with* a redundant-skip is out of scope —
  // see the coverage-boundary note on checkRedundantDelivery.)
  const redundant = await checkRedundantDelivery({
    branch: input.branch,
    base: input.base,
    spawn: input.spawn,
  });
  if (redundant) return redundant;

  const push = await input.spawn('git', [
    'push',
    // --force-with-lease: safe no-op on first push; prevents overwriting diverged state on retry
    '--force-with-lease',
    '--set-upstream',
    'origin',
    input.branch,
  ]);
  if (push.exitCode !== 0) {
    throw new Error(`git push failed for branch ${input.branch}: exit ${push.exitCode}`);
  }

  const create = await input.spawn('gh', [
    'pr',
    'create',
    '--base',
    input.base,
    '--head',
    input.branch,
    '--title',
    composeTitle(input),
    '--body',
    composeBody(input),
  ]);
  if (create.exitCode !== 0) {
    throw new Error(`gh pr create failed: exit ${create.exitCode}; stdout: ${create.stdout}`);
  }
  const prUrl = create.stdout.trim();
  const prMatch = prUrl.match(/\/pull\/(\d+)/);
  if (!prMatch) {
    throw new Error(`gh pr create returned unparseable URL: ${prUrl}`);
  }
  const prNumber = Number(prMatch[1]);

  // Parallel drain (K>1): the child's job ends at PR-open. The supervisor's serialized merge
  // coordinator merges it (one at a time, rebased on the prior) — never merge here or two
  // concurrent children would race `main`.
  if (input.openOnly === true) {
    return { prUrl, prNumber, mergedAt: null };
  }

  const { mergedAt } = await mergePrWithFallback({
    prUrl,
    spawn: input.spawn,
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.onStatus !== undefined ? { onStatus: input.onStatus } : {}),
  });

  return { prUrl, prNumber, mergedAt };
}

export interface MergePrWithFallbackInput {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (line: string) => void;
}

/** Merge an open PR: queue auto-merge and poll, falling back to a direct
 *  squash-merge when the repo has auto-merge disabled. Shared by the gate's
 *  `openAndAutoMerge` end-of-flow and `prep promote --ship` so promote batches
 *  land the same way the drain's PRs do. */
export async function mergePrWithFallback(
  input: MergePrWithFallbackInput,
): Promise<{ mergedAt: string }> {
  const merge = await input.spawn('gh', ['pr', 'merge', input.prUrl, '--auto', '--squash']);

  if (merge.exitCode === 0) {
    return pollAutoMerge({
      prUrl: input.prUrl,
      spawn: input.spawn,
      intervalMs: input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(input.onStatus !== undefined ? { onStatus: input.onStatus } : {}),
    });
  }

  // `gh pr merge --auto` fails with `enablePullRequestAutoMerge` when the
  // repo does not have auto-merge enabled (common for solo-dev repos
  // without branch protection). Retry with a synchronous squash — the
  // merge happens immediately, no polling needed. If both legs fail,
  // surface both exit codes.
  process.stderr.write(
    'pr-flow: gh pr merge --auto failed; falling back to direct squash-merge.\n',
  );
  // Unlike the --auto path (GitHub only merges when mergeStateStatus allows),
  // a direct `gh pr merge --squash` merges whatever is there — red CI included
  // when no branch protection blocks it. Wait for checks and refuse a red PR.
  await pollChecksBeforeMerge({
    prUrl: input.prUrl,
    spawn: input.spawn,
    intervalMs: input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(input.onStatus !== undefined ? { onStatus: input.onStatus } : {}),
  });
  const directMerge = await input.spawn('gh', [
    'pr',
    'merge',
    input.prUrl,
    '--squash',
    '--delete-branch',
  ]);
  // gh may emit a non-zero exit from the post-merge local-checkout step
  // (e.g. `'main' is already used by another worktree` when invoked from
  // inside a worktree) even when the merge succeeded server-side. Trust
  // `gh pr view` over `directMerge.exitCode` for the merge verdict.
  const view = await input.spawn('gh', ['pr', 'view', input.prUrl, '--json', 'mergedAt,state']);
  if (view.exitCode !== 0) {
    throw new Error(
      `gh pr merge --auto failed: exit ${merge.exitCode}; direct merge fallback exit ${directMerge.exitCode}; gh pr view failed: exit ${view.exitCode}`,
    );
  }
  let viewData: { mergedAt: string | null; state: string };
  try {
    viewData = JSON.parse(view.stdout) as { mergedAt: string | null; state: string };
  } catch {
    throw new Error(
      `gh pr view returned unparseable JSON after direct merge fallback: ${view.stdout.slice(0, 200)}`,
    );
  }
  if (viewData.state !== 'MERGED' || !viewData.mergedAt) {
    throw new Error(
      `gh pr merge --auto failed: exit ${merge.exitCode}; direct merge fallback exit ${directMerge.exitCode}; PR state is "${viewData.state}".`,
    );
  }
  return { mergedAt: viewData.mergedAt };
}
