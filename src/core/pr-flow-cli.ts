import { readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';

import { readSession, clearSession, type SessionMarker } from './session.js';
import { loadConfig, type NoldorConfig } from '../cr/config.js';
import { promptSelect } from '../cr/prompt-stdin.js';
import { openAndAutoMerge, type FdSummary, type CrResultSummary, type SpawnFn } from './pr-flow.js';

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

function discoverAddedFiles(prefix: string): string[] {
  const log = execGit(['diff-tree', '--diff-filter=A', '--name-only', '-r', 'origin/main..HEAD']);
  return log
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefix));
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
      'pnpm pr-flow: no .noldor/session.json found. Run /gate first to set the session marker.\n',
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
  const firstCommitSubject = execGit(['log', '--reverse', '--format=%s', 'origin/main..HEAD'])
    .split('\n')
    .filter((s) => s.length > 0)[0];

  if (firstCommitSubject === undefined) {
    process.stderr.write('pnpm pr-flow: no commits ahead of origin/main on current branch.\n');
    return 1;
  }

  const fdSlug = session.parent ?? session.slug;
  const fd = fdSlug !== undefined ? loadFdSummary(cwd, fdSlug) : null;

  const planPath = pickMostRecentByDatePrefix(discoverAddedFiles('docs/superpowers/plans/'));
  const specPath = pickMostRecentByDatePrefix(discoverAddedFiles('docs/superpowers/specs/'));

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
    headSha,
    firstCommitSubject,
    spawn: nodeSpawn(),
    onStatus: (line) => process.stderr.write(line + '\n'),
    // Parallel drain K>1: the supervisor's merge coordinator merges; this call stops at PR-open.
    openOnly: process.env.NOLDOR_DRAIN_OPEN_ONLY === '1',
  });

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
