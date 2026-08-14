import { parseCliArgs, type ArtifactReview, type Invocation } from './cli-args.js';
import { makeCodexSpawn, type Spawn } from './codex-adapter.js';
import { buildContext } from './context.js';
import { replaceReceiptTrailer } from './receipt-trailer.js';
import { runCodex } from './run-codex.js';
import { readFeatureMd, readRules, reviewWithCodex, sh } from './review-with-codex.js';
import { sidecarFilename, writeSidecar } from './sidecar.js';

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

Orchestrate review lanes (prints {summary, findings} JSON to stdout; no sidecar, no trailer):
  noldor cr codex --plan <path>   review a markdown plan with plan-review heuristics
  noldor cr codex --spec <path>   review a markdown spec with plan-review heuristics
  noldor cr codex --code <path>   review the branch code diff (main...HEAD) with the
                                  code-review prompt; <path> is a label only
  noldor cr codex --slug <slug>   load docs/features/<slug>.md as review context
  noldor cr codex --base-sha <sha>  scope the review to the diff since <sha>
  noldor cr codex --full-review   ignore --base-sha; review the whole artifact/branch
`;

export async function runCli(input: RunCliInput): Promise<number> {
  const inv = parseCliArgs(input.argv);
  const cwd = input.cwd;

  if (inv.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (inv.review) {
    return runReview(inv.review, cwd, input.spawn ?? makeCodexSpawn({ foreground: true, cwd }));
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
  const rules = readRules(cwd);

  const ctx = buildContext({
    lane: inv.lane,
    paths: inv.paths,
    runGit: (args) => sh(cwd, args),
    featureMd,
    rules,
  });

  const record = await runCodex({
    ctx,
    spawn: input.spawn ?? makeCodexSpawn({ foreground: true, cwd }),
  });

  if (!inv.dryRun) {
    const filename = sidecarFilename(filenameSelector(inv, tree));
    writeSidecar(cwd, filename, record);
  }

  if (record.blockers.length > 0) {
    printFindings(record);
    return 1;
  }

  if (isGateLane(inv)) {
    replaceReceiptTrailer({ cwd, key: 'Noldor-Reviewed-Codex', value: tree });
  }
  return 0;
}

/**
 * CLI wrapper over {@link reviewWithCodex}: print `{ summary, findings }` to stdout for a
 * consumer to parse. Always exits 0 when the review ran — findings (including a synthetic
 * "codex spawn failed" blocker) travel in the JSON, never via the exit code, because a
 * non-zero exit here means infrastructure failure rather than review output.
 */
async function runReview(review: ArtifactReview, cwd: string, spawn: Spawn): Promise<number> {
  const out = await reviewWithCodex(review, cwd, spawn);
  process.stdout.write(JSON.stringify(out) + '\n');
  return 0;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli({ argv: process.argv.slice(2), cwd: process.cwd() }).then((code) => process.exit(code));
}
