import { readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';

import { isBookkeepingOnly } from './allowlist.js';
import { discoverAddedFiles } from './branch-added.js';
import { stripTrailers } from './trailers.js';
import { readSession, clearSession, type SessionMarker } from './session.js';
import { loadConfig, type NoldorConfig } from './config.js';
import { promptSelect } from './prompt-stdin.js';
import {
  openAndAutoMerge,
  type FdSummary,
  type CrResultSummary,
  type SpawnFn,
  type SummaryCommit,
  type VerifySummary,
} from './pr-flow.js';

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Pick the most recent path by `YYYY-MM-DD-` filename prefix. Paths whose
 * basename lacks a date prefix fall back to lexical-descending order — works
 * in practice because the framework convention is date-prefixed plan/spec
 * filenames; the fallback exists so a non-conforming entry doesn't crash
 * discovery. Returns `null` on empty input.
 */
export function pickMostRecentByDatePrefix(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const sorted = paths.toSorted((a, b) => {
    const aBase = a.split('/').pop() ?? a;
    const bBase = b.split('/').pop() ?? b;
    const aDate = DATE_PREFIX.exec(aBase)?.[0] ?? '';
    const bDate = DATE_PREFIX.exec(bBase)?.[0] ?? '';
    if (aDate !== bDate) return aDate < bDate ? 1 : -1;
    return aBase < bBase ? 1 : -1;
  });
  return sorted[0];
}

export function parseCrTrailersFromLog(log: string): CrResultSummary {
  const passes: CrResultSummary['passes'] = [];
  for (const line of log.split('\n')) {
    const claude = /^\s*Noldor-Reviewed:\s*(\S+)/.exec(line);
    if (claude) {
      passes.push({ reviewer: 'claude', tipSha: claude[1], findings: 0, status: 'clean' });
      continue;
    }
    const subagent = /^\s*Noldor-Reviewed-Subagent:\s*(\S+)/.exec(line);
    if (subagent) {
      passes.push({ reviewer: 'subagent', tipSha: subagent[1], findings: 0, status: 'clean' });
      continue;
    }
    const codex = /^\s*Noldor-Reviewed-Codex:\s*(\S+)/.exec(line);
    if (codex) {
      passes.push({ reviewer: 'codex', tipSha: codex[1], findings: 0, status: 'clean' });
    }
  }
  return { passes, status: 'clean' };
}

export function normalizeRepoUrl(raw: string): string {
  const trimmed = raw.trim();
  const sshMatch = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return trimmed.replace(/\.git$/, '');
}

/** Record separator used in the summary-commit `git log` format (ASCII RS/US, never in a path). */
const RECORD_SEP = '\x1e';

/** A commit ahead of the base, with the paths it touched. */
export interface CommitFiles {
  sha: string;
  files: string[];
}

/**
 * Parse `git log --reverse --format=%x1e%H --name-only <range>`.
 *
 * The record separator leads each entry so a commit's file list cannot be
 * confused with the next commit's sha — `--name-only` prints paths on their own
 * lines after the format, with no terminator of its own.
 */
export function parseCommitFileLists(out: string): CommitFiles[] {
  return out
    .split(RECORD_SEP)
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [shaLine, ...rest] = chunk.split('\n');
      return {
        sha: (shaLine ?? '').trim(),
        files: rest.map((l) => l.trim()).filter((l) => l.length > 0),
      };
    });
}

/**
 * Pick which commit the PR title and no-FD Summary describe.
 *
 * `/noldor-gate` retires an entry's roadmap block BEFORE implementing it (skill
 * Step 2, "Roadmap-entry retirement"), so the OLDEST commit on a drained
 * fast-track branch is bookkeeping — `docs(roadmap): retire <slug> …`, touching
 * `docs/roadmap.md` and nothing else. Taking the first commit put that
 * bookkeeping line in the title and Summary of every drained entry (PRs
 * #299-#303 all read "retire <slug> — shipped via fast-track (no FD)" and never
 * named the change that shipped).
 *
 * So: the first commit that carries code. The skip set is the whole
 * {@link isBookkeepingOnly} list, not just the roadmap — since Q-0107
 * `remove-block` co-stages `.noldor/retired-entry-ids.json`, and a `full-*`
 * branch leads with its spec and plan commits; a roadmap-only test lands on
 * those and describes the PR by its bookkeeping again.
 *
 * The `files.length > 0` guard is load-bearing: `git log --name-only` prints no
 * paths for a merge commit and `isBookkeepingOnly([])` is `false`, so without it
 * a branch an operator merged `main` into would be titled `Merge branch 'main'`
 * with an empty body.
 *
 * A branch with no code commit at all (retirement-only) keeps the first one and
 * gets `composeBody`'s deterministic retirement template.
 */
export function pickSummarySha(commits: readonly CommitFiles[]): string | undefined {
  const substantive = commits.find((c) => c.files.length > 0 && !isBookkeepingOnly(c.files));
  return (substantive ?? commits[0])?.sha;
}

function execGit(args: readonly string[]): string {
  const r = spawnSync('git', [...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout;
}

function loadFdSummary(cwd: string, slug: string): FdSummary | null {
  const fdPath = join(cwd, 'docs', 'features', `${slug}.md`);
  let md: string;
  try {
    md = readFileSync(fdPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `pnpm pr-flow: warning — could not read FD at ${fdPath}: ${message}. ` +
        `PR body will fall back to "Micro-chore: <first commit subject>".\n`,
    );
    return null;
  }
  const nameMatch = /^name:\s*(.+)$/m.exec(md);
  const summaryMatch = /## Summary\s*\n\n([\s\S]*?)\n\n/.exec(md);
  if (!nameMatch || !summaryMatch) {
    process.stderr.write(
      `pnpm pr-flow: warning — FD at ${fdPath} is missing required fields ` +
        `(name frontmatter or ## Summary section). PR body will fall back to ` +
        `"Micro-chore: <first commit subject>".\n`,
    );
    return null;
  }
  return { name: nameMatch[1].trim(), summary: summaryMatch[1].trim() };
}

/**
 * Lift the verify lane's verdict + evidence from its code-stage sink so the
 * PR body can show behavioral proof (acceptance-verify-lane spec item D3).
 * Best-effort by design: a missing sink (verify lane not in `crLanes.code`),
 * unreadable JSON, or an off-shape payload all return `null` — the PR body
 * simply omits the section. The shape check is hand-rolled because the
 * `core-is-foundation` boundary forbids importing `src/cr/findings-schema.ts`.
 */
export function loadVerifyEvidence(cwd: string, slug: string): VerifySummary | null {
  // Canonical `-verifier.json` first, then the legacy pre-0.7.0 `-verify.json`
  // name (a consumer mid-upgrade may still have one). Inlined rather than
  // importing the lanes helper — the `core-is-foundation` boundary keeps this
  // module dependency-free of `src/cr/`.
  const crDir = join(cwd, '.noldor', 'cr');
  const candidates = [
    join(crDir, `${slug}-code-verifier.json`),
    join(crDir, `${slug}-code-verify.json`),
  ];
  let parsed: unknown;
  let found = false;
  for (const sinkPath of candidates) {
    try {
      parsed = JSON.parse(readFileSync(sinkPath, 'utf8'));
      found = true;
      break;
    } catch {
      // candidate absent or unparseable — try the next one
    }
  }
  if (!found) return null;
  if (typeof parsed !== 'object' || parsed === null) return null;
  const sink = parsed as { verdict?: unknown; evidence?: unknown };
  if (typeof sink.verdict !== 'string') return null;
  const rawEvidence = Array.isArray(sink.evidence) ? sink.evidence : [];
  const evidence = rawEvidence.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const pair = e as { command?: unknown; observed?: unknown };
    if (typeof pair.command !== 'string' || typeof pair.observed !== 'string') return [];
    return [{ command: pair.command, observed: pair.observed }];
  });
  return { verdict: sink.verdict, evidence };
}

export interface ApprovalGateInput {
  config: NoldorConfig | null;
  session: SessionMarker;
}

export function shouldPromptForPrApproval(input: ApprovalGateInput): boolean {
  if (input.session.autonomous) return false;
  return input.config?.autonomous?.requireHumanPrApproval === true;
}

/**
 * Clears the session marker once a `micro-chore` PR has merged. micro-chore is
 * one-and-done and, unlike worktree-backed paths, has no worktree whose removal
 * would drop the marker — so without this it lingers in the main repo's
 * `.noldor/` and can silently block the next day's work. A no-op for every
 * other path (those imply ongoing multi-commit work). See the
 * session-marker-auto-expire spec.
 */
export function clearMicroChoreSession(cwd: string, session: SessionMarker): void {
  if (session.path === 'micro-chore') clearSession(cwd);
}

export function nodeSpawn(opts?: { cwd?: string }): SpawnFn {
  return async (cmd, args, stdin) => {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ stdout, exitCode: code ?? -1 }));
      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    });
  };
}

export async function runCli(cwd: string): Promise<number> {
  const session: SessionMarker | null = readSession(cwd);
  if (session === null) {
    process.stderr.write(
      'pnpm pr-flow: no .noldor/session.json found. Run /noldor-gate first to set the session marker.\n',
    );
    return 1;
  }

  const config = await loadConfig(join(cwd, '.noldor', 'config.json')).catch(() => null);
  if (shouldPromptForPrApproval({ config, session })) {
    const choice = await promptSelect({
      message: 'requireHumanPrApproval: open PR + auto-merge now?',
      choices: [
        { name: 'yes — proceed', value: 'yes' as const },
        { name: 'no — abort pr-flow', value: 'no' as const },
      ],
    });
    if (choice === 'no') {
      process.stderr.write('pnpm pr-flow: aborted by operator at approval gate.\n');
      return 1;
    }
  }

  const branch = execGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const headSha = execGit(['rev-parse', 'HEAD']).trim();
  // One `git log` walk, read twice: which commit the PR describes, and every
  // path the branch touched (the latter decides the retirement template and the
  // Test Plan shape in `composeBody`).
  // `-c core.quotePath=false` so a non-ASCII path arrives verbatim rather than
  // as `"src/caf\303\251.ts"`, which matches no glob — `isBookkeepingOnly` and
  // `touchesCode` would then misread the branch and render "Doc-only change"
  // for a real source rewrite. (`-z` is not usable here: `--name-only` shares
  // its NUL separator with the format string, and the RECORD_SEP framing this
  // parser relies on would be lost.)
  const branchCommits = parseCommitFileLists(
    execGit([
      '-c',
      'core.quotePath=false',
      'log',
      '--reverse',
      `--format=${RECORD_SEP}%H`,
      '--name-only',
      'origin/main..HEAD',
    ]),
  );
  const summarySha = pickSummarySha(branchCommits);
  const branchFiles = [...new Set(branchCommits.flatMap((c) => c.files))];

  if (summarySha === undefined) {
    process.stderr.write('pnpm pr-flow: no commits ahead of origin/main on current branch.\n');
    return 1;
  }

  const summaryCommit: SummaryCommit = {
    subject: execGit(['log', '-1', '--format=%s', summarySha]).trim(),
    body: stripTrailers(execGit(['log', '-1', '--format=%b', summarySha])),
  };

  const fdSlug = session.parent ?? session.slug;
  const fd = fdSlug !== undefined ? loadFdSummary(cwd, fdSlug) : null;
  const verify = fdSlug !== undefined ? loadVerifyEvidence(cwd, fdSlug) : null;

  // One git round-trip, filtered twice — the query is identical for both.
  const addedFiles = discoverAddedFiles({ cwd });
  const planPath = pickMostRecentByDatePrefix(
    addedFiles.filter((f) => f.startsWith('docs/design/plans/')),
  );
  const specPath = pickMostRecentByDatePrefix(
    addedFiles.filter((f) => f.startsWith('docs/design/specs/')),
  );

  const log = execGit(['log', '--format=%H%n%s%n%n%b', 'origin/main..HEAD']);
  const crResults = parseCrTrailersFromLog(log);

  const repoUrl = normalizeRepoUrl(execGit(['remote', 'get-url', 'origin']));

  const result = await openAndAutoMerge({
    cwd,
    branch,
    base: 'main',
    repoUrl,
    session,
    fd,
    specPath,
    planPath,
    crResults,
    verify,
    headSha,
    summaryCommit,
    branchFiles,
    spawn: nodeSpawn(),
    onStatus: (line) => process.stderr.write(line + '\n'),
    // Parallel drain K>1: the supervisor's merge coordinator merges; this call stops at PR-open.
    openOnly: process.env.NOLDOR_DRAIN_OPEN_ONLY === '1',
  });

  // Idempotency guard fired: the branch's commits already reached origin/main
  // (patch-id match) — a concurrent process delivered them. Report the no-op and
  // exit clean; nothing was pushed. See checkRedundantDelivery / the PR #76+#77 race.
  if ('skipped' in result) {
    process.stdout.write(`pnpm pr-flow: ${result.reason}\n`);
    clearMicroChoreSession(cwd, session);
    return 0;
  }

  process.stdout.write(
    result.mergedAt === null
      ? `PR opened (merge deferred to drain coordinator): ${result.prUrl}\n`
      : `PR merged: ${result.prUrl} at ${result.mergedAt}\n`,
  );
  // micro-chore is one-and-done: clear its main-repo session marker now that the
  // PR has shipped, so it can't linger into the next day's work. No-op otherwise.
  clearMicroChoreSession(cwd, session);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runCli(process.cwd()).then((code) => process.exit(code));
}
