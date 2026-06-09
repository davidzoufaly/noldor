import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCliArgs, type Invocation, type PlanReview } from './cli-args.js';
import { buildContext } from './context.js';
import { runCodex, type Spawn } from './run-codex.js';
import { sidecarFilename, writeSidecar, type CrRecord } from './sidecar.js';

export interface RunCliInput {
  argv: readonly string[];
  cwd: string;
  spawn?: Spawn;
}

const USAGE = `noldor cr codex — Codex code-review / plan-review pass

Code-review lanes (writes a sidecar; gate lane amends Noldor-Reviewed-Codex):
  noldor cr codex                 gate lane (main...HEAD), amends trailer
  noldor cr codex --working       review the working tree (HEAD), no trailer
  noldor cr codex <sha>           review main...<sha>, no trailer
  noldor cr codex <from>..<to>    review a commit range, no trailer
  noldor cr codex --paths a,b     scope the diff to comma-separated paths
  noldor cr codex --rerun         re-run the gate lane over an existing trailer
  noldor cr codex --dry-run       run without writing a sidecar or trailer

Plan/spec-review lanes (prints {summary, findings} JSON to stdout; no sidecar, no trailer):
  noldor cr codex --plan <path>   review a markdown plan with plan-review heuristics
  noldor cr codex --spec <path>   review a markdown spec with plan-review heuristics
  noldor cr codex --slug <slug>   load docs/features/<slug>.md as review context
  noldor cr codex --base-sha <sha>  scope the artifact review to its diff since <sha>
  noldor cr codex --full-review   ignore --base-sha; review the whole artifact
`;

export async function runCli(input: RunCliInput): Promise<number> {
  const inv = parseCliArgs(input.argv);
  const cwd = input.cwd;

  if (inv.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (inv.review) {
    return runPlanReview(inv.review, cwd, input.spawn ?? defaultSpawn);
  }

  const tree = sh(cwd, ['rev-parse', `${refForLane(inv)}^{tree}`]).trim();

  if (isGateLane(inv) && !inv.rerun) {
    const tipMsg = sh(cwd, ['log', '-1', '--format=%B']);
    if (/^Noldor-Reviewed-Codex:[ \t]*\S/m.test(tipMsg)) {
      process.stderr.write('Codex CR already on tip. Use --rerun to overwrite.\n');
      return 0;
    }
  }

  const featureMd = readFeatureMd(cwd);
  const rules = readIfExists(cwd, '.claude/engineering-rules.md');

  const ctx = buildContext({
    lane: inv.lane,
    paths: inv.paths,
    runGit: (args) => sh(cwd, args),
    featureMd,
    rules,
  });

  const record = await runCodex({ ctx, spawn: input.spawn ?? defaultSpawn });

  if (!inv.dryRun) {
    const filename = sidecarFilename(filenameSelector(inv, tree));
    writeSidecar(cwd, filename, record);
  }

  if (record.blockers.length > 0) {
    printFindings(record);
    return 1;
  }

  if (isGateLane(inv)) {
    const msgFile = refMsgPath(cwd);
    execFileSync(
      'git',
      ['interpret-trailers', '--in-place', '--trailer', `Noldor-Reviewed-Codex: ${tree}`, msgFile],
      { cwd },
    );
    execFileSync('git', ['commit', '--amend', '-F', msgFile], { cwd });
  }
  return 0;
}

interface OutFinding {
  file: string;
  message: string;
  severity: 'high' | 'med' | 'low';
  line?: number;
  suggestion?: string;
}

/**
 * Plan/spec review: read the artifact (or its diff since `--base-sha`), run
 * codex with plan-review heuristics, and print `{ summary, findings }` to
 * stdout for the orchestrate codex lane to consume. Always exits 0 when codex
 * ran — findings (including a synthetic "codex spawn failed" blocker) travel in
 * the JSON, never via the exit code, because the lane treats a non-zero exit as
 * an infrastructure error rather than review output.
 */
async function runPlanReview(review: PlanReview, cwd: string, spawn: Spawn): Promise<number> {
  const rules = readIfExists(cwd, '.claude/engineering-rules.md');
  const featureMd = review.slug
    ? readIfExists(cwd, `docs/features/${review.slug}.md`)
    : readFeatureMd(cwd);
  const artifact =
    review.baseSha && !review.fullReview
      ? sh(cwd, ['diff', `${review.baseSha}..HEAD`, '--', review.artifact])
      : readIfExists(cwd, review.artifact);

  const record = await runCodex({
    ctx: { kind: review.kind, artifact, featureMd, rules },
    spawn,
  });

  const out = { summary: record.summary, findings: toFindings(record) };
  process.stdout.write(JSON.stringify(out) + '\n');
  return 0;
}

/**
 * Map a codex {@link CrRecord} to the orchestrate lane's `Finding[]` shape.
 * Blockers always become `severity: 'high'` (the lane reclassifies high-severity
 * findings as blockers); suggestions are pinned non-high so they stay
 * suggestions. The codex schema uses `medium`; the lane schema uses `med`.
 */
function toFindings(record: CrRecord): OutFinding[] {
  const map = (f: CrRecord['blockers'][number], severity: OutFinding['severity']): OutFinding => {
    const o: OutFinding = { file: f.file, message: f.message, severity };
    if (f.line != null) o.line = f.line;
    if (f.suggestion != null) o.suggestion = f.suggestion;
    return o;
  };
  return [
    ...record.blockers.map((b) => map(b, 'high')),
    ...record.suggestions.map((s) => map(s, s.severity == null ? 'low' : 'med')),
  ];
}

function isGateLane(inv: Invocation): boolean {
  return inv.lane.kind === 'gate' && !inv.dryRun;
}

function refForLane(inv: Invocation): string {
  switch (inv.lane.kind) {
    case 'gate':
    case 'working':
      return 'HEAD';
    case 'sha':
      return inv.lane.sha;
    case 'range':
      return inv.lane.to;
  }
}

function filenameSelector(inv: Invocation, tree: string): Parameters<typeof sidecarFilename>[0] {
  if (inv.paths.length > 0) return { kind: 'paths', tree, pathsHash: hashPaths(inv.paths) };
  if (inv.lane.kind === 'working')
    return { kind: 'working', tree, timestamp: Math.floor(Date.now() / 1000) };
  if (inv.lane.kind === 'range') return { kind: 'range', from: inv.lane.from, to: inv.lane.to };
  if (inv.lane.kind === 'sha') return { kind: 'sha', tree };
  return { kind: 'gate', tree };
}

function hashPaths(paths: readonly string[]): string {
  let h = 0;
  for (const ch of paths.join('|')) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

function readFeatureMd(cwd: string): string {
  const session = readSession(cwd);
  const slug = session?.parent ?? session?.slug;
  if (!slug) return '';
  return readIfExists(cwd, `docs/features/${slug}.md`);
}

function readSession(cwd: string): { parent?: string; slug?: string } | null {
  try {
    return JSON.parse(readFileSync(join(cwd, '.noldor', 'session.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readIfExists(cwd: string, rel: string): string {
  const p = join(cwd, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function refMsgPath(cwd: string): string {
  const msg = sh(cwd, ['log', '-1', '--format=%B']);
  const tmp = join(cwd, '.git', 'CR_AMEND_MSG');
  writeFileSync(tmp, msg, 'utf8');
  return tmp;
}

function printFindings(r: {
  blockers: Array<{ file: string; line: number | null; message: string }>;
  suggestions: Array<{ file: string; line: number | null; message: string }>;
  summary: string;
}): void {
  process.stderr.write(
    `\nCodex CR: ${r.blockers.length} blocker(s), ${r.suggestions.length} suggestion(s)\n`,
  );
  for (const b of r.blockers) {
    process.stderr.write(`  blocker  ${b.file}${b.line ? ':' + b.line : ''}  ${b.message}\n`);
  }
  for (const s of r.suggestions) {
    process.stderr.write(`  suggest  ${s.file}${s.line ? ':' + s.line : ''}  ${s.message}\n`);
  }
}

const defaultSpawn: Spawn = async ({ cmd, args, stdin }) =>
  new Promise((resolve) => {
    const c = nodeSpawn(cmd, args);
    let stdout = '';
    let settled = false;
    const settle = (result: { stdout: string; exitCode: number }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    c.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    c.on('close', (exitCode) => settle({ stdout, exitCode: exitCode ?? 0 }));
    c.on('error', () => settle({ stdout: '', exitCode: 127 }));
    c.stdin.on('error', () => {});
    c.stdin.end(stdin);
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli({ argv: process.argv.slice(2), cwd: process.cwd() }).then((code) => process.exit(code));
}
