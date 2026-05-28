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
  headSha: string;
  firstCommitSubject: string;
}

export interface PrFlowResult {
  prUrl: string;
  prNumber: number;
  mergedAt: string;
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

  const summary = input.fd ? input.fd.summary : `Micro-chore: ${input.firstCommitSubject}`;

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
    '## Test Plan',
    '',
    testPlanItems.join('\n'),
    '',
    '---',
    '',
    '*Opened by Noldor `/gate` end-of-flow. CR run locally; trailers recorded on each commit.*',
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

export async function pollAutoMerge(opts: {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs: number;
  timeoutMs: number;
}): Promise<{ mergedAt: string }> {
  const start = Date.now();
  let extendedDeadline = opts.timeoutMs;
  let behindObserved = false;

  while (Date.now() - start < extendedDeadline) {
    const r = await opts.spawn('gh', ['pr', 'view', opts.prUrl, '--json', 'mergedAt,state']);
    if (r.exitCode === 0) {
      const data = JSON.parse(r.stdout) as { mergedAt: string | null; state: string };
      if (data.mergedAt) return { mergedAt: data.mergedAt };
      if (data.state === 'CLOSED') throw new PrClosedWithoutMergeError(opts.prUrl);
      if (data.state === 'BEHIND' && !behindObserved) {
        behindObserved = true;
        // Absolute ceiling from poll start — not from when BEHIND was first seen
        extendedDeadline = BEHIND_TIMEOUT_MS;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new MergeTimeoutError(opts.prUrl);
}

export interface OpenAndAutoMergeInput extends PrFlowInput {
  spawn: SpawnFn;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function openAndAutoMerge(input: OpenAndAutoMergeInput): Promise<PrFlowResult> {
  await preflightGh({ spawn: input.spawn });

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

  const merge = await input.spawn('gh', ['pr', 'merge', prUrl, '--auto', '--squash']);

  let mergedAt: string;
  if (merge.exitCode === 0) {
    const polled = await pollAutoMerge({
      prUrl,
      spawn: input.spawn,
      intervalMs: input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    mergedAt = polled.mergedAt;
  } else {
    // `gh pr merge --auto` fails with `enablePullRequestAutoMerge` when the
    // repo does not have auto-merge enabled (common for solo-dev repos
    // without branch protection). Retry with a synchronous squash — the
    // merge happens immediately, no polling needed. If both legs fail,
    // surface both exit codes.
    process.stderr.write(
      'pr-flow: gh pr merge --auto failed; falling back to direct squash-merge.\n',
    );
    const directMerge = await input.spawn('gh', [
      'pr',
      'merge',
      prUrl,
      '--squash',
      '--delete-branch',
    ]);
    // gh may emit a non-zero exit from the post-merge local-checkout step
    // (e.g. `'main' is already used by another worktree` when invoked from
    // inside a worktree) even when the merge succeeded server-side. Trust
    // `gh pr view` over `directMerge.exitCode` for the merge verdict.
    const view = await input.spawn('gh', ['pr', 'view', prUrl, '--json', 'mergedAt,state']);
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
    mergedAt = viewData.mergedAt;
  }

  return { prUrl, prNumber, mergedAt };
}
