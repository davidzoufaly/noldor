import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { spawnAgent } from '../core/agent-runner/registry.js';
import { runWithConcurrency } from '../core/concurrency.js';
import { gitStatusPorcelain } from '../core/git-porcelain.js';

import { buildResearchPrompt, parseResearchStdout } from './prompt.js';
import { createBatchDir, findingsFileName, renderIndex, writeManifest } from './staging.js';
import { FALLBACK_META, tasksFileSchema, type ResearchResult, type TaskSpec } from './types.js';

export interface FanoutArgs {
  tasksFile?: string;
  inlineTasks: string[];
  max: number;
  timeoutMs: number;
  synthesize: boolean;
  dryRun: boolean;
  json: boolean;
}

function intArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Consume a flag's value; a missing value or a following `--flag` is a usage error. */
function strArg(value: string | undefined, name: string): string {
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseArgs(argv: readonly string[]): FanoutArgs {
  const args: FanoutArgs = {
    inlineTasks: [],
    max: 4,
    timeoutMs: 900_000,
    synthesize: false,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--synthesize') args.synthesize = true;
    else if (a === '--max') args.max = intArg(argv[++i], '--max');
    else if (a === '--timeout') args.timeoutMs = intArg(argv[++i], '--timeout');
    else if (a === '--tasks') args.tasksFile = strArg(argv[++i], '--tasks');
    else if (a === '--task') args.inlineTasks.push(strArg(argv[++i], '--task'));
    else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

/**
 * File tasks first, then inline sugar namespaced `cli-task-<n>` (so a file that
 * legitimately contains `task-1` never trips the duplicate-id error).
 */
export function loadTasks(args: FanoutArgs, cwd: string): TaskSpec[] {
  const tasks: TaskSpec[] = [];
  if (args.tasksFile !== undefined) {
    const path = isAbsolute(args.tasksFile) ? args.tasksFile : join(cwd, args.tasksFile);
    tasks.push(...tasksFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).tasks);
  }
  args.inlineTasks.forEach((question, i) => {
    tasks.push({ id: `cli-task-${i + 1}`, question, scope: [] });
  });
  if (tasks.length === 0)
    throw new Error('no tasks: pass --tasks <file.json> and/or --task "<question>"');
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
  }
  return tasks;
}

/** Matches the shape of {@link spawnAgent} that fanout consumes — DI seam for tests. */
export type SpawnAgentLike = (
  prompt: string,
  opts: {
    role: 'researcher';
    needsWrite: false;
    stdio: 'pipe';
    site: string;
    timeoutMs: number;
    cwd: string;
  },
) => Promise<{ exitCode: number; stdout: string; timedOut: boolean }>;

export interface RunDeps {
  cwd?: string;
  now?: () => Date;
  spawnAgentImpl?: SpawnAgentLike;
}

const COST_WARN_TASKS = 8;

export async function run(argv: readonly string[], deps: RunDeps = {}): Promise<number> {
  const args = parseArgs(argv);
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? (() => new Date());
  // spawnAgent is structurally assignable: SpawnAgentLike's opts are narrower
  // than SpawnAgentOpts and AgentResult matches the return shape — no cast.
  const spawn: SpawnAgentLike = deps.spawnAgentImpl ?? spawnAgent;

  const tasks = loadTasks(args, cwd);

  if (args.dryRun) {
    const list = tasks.map((t) => `  ${t.id}: ${t.question}`).join('\n');
    process.stdout.write(
      args.json
        ? `${JSON.stringify({ dryRun: true, tasks: tasks.map((t) => ({ id: t.id, question: t.question })) })}\n`
        : `research fanout (dry-run): ${tasks.length} task(s) would run:\n${list}\n`,
    );
    return 0;
  }

  if (tasks.length > COST_WARN_TASKS) {
    process.stderr.write(
      `research fanout: WARNING — ${tasks.length} tasks (> ${COST_WARN_TASKS}); each spawns a full agent. Consider batching.\n`,
    );
  }

  const startedDate = now(); // one capture — manifest.startedAt and the dir stamp must agree
  const startedAt = startedDate.toISOString();
  const batch = createBatchDir(cwd, startedDate);
  process.stderr.write(
    `research fanout: ${tasks.length} researcher(s) into ${batch.rel} (max ${args.max} concurrent)\n`,
  );

  const preStatus = gitStatusPorcelain(cwd);
  const results: ResearchResult[] = Array.from({ length: tasks.length });
  await runWithConcurrency(tasks, args.max, async (task, index) => {
    process.stderr.write(`  -> researching ${task.id}\n`);
    const file = findingsFileName(task.id);
    // Whole worker body guarded: ANY throw (spawn rejection, parse bug, disk
    // error on write) must fail only this task — runWithConcurrency rejects
    // the whole run on an uncaught throw and would lose the in-flight batch.
    try {
      let spawnStatus: string;
      let stdout = '';
      try {
        const res = await spawn(buildResearchPrompt(task), {
          role: 'researcher',
          needsWrite: false,
          stdio: 'pipe',
          site: 'research.fanout',
          timeoutMs: args.timeoutMs,
          cwd,
        });
        stdout = res.stdout;
        spawnStatus = res.timedOut ? 'timeout' : res.exitCode === 0 ? 'ok' : `exit ${res.exitCode}`;
      } catch (err) {
        spawnStatus = `error: ${(err as Error).message}`;
      }
      const parsed = parseResearchStdout(stdout);
      // Comment header carries enum/kebab-safe fields only (id regex + status
      // enum) — free text like spawnStatus could embed `-->`; it lives in the
      // manifest and INDEX instead.
      const header = `<!-- research id:${task.id} status:${parsed.meta.status} -->`;
      writeFileSync(join(batch.abs, file), `${header}\n\n${parsed.findings}\n`, 'utf8');
      results[index] = {
        id: task.id,
        question: task.question,
        ok: spawnStatus === 'ok' && parsed.parsed,
        spawnStatus,
        meta: parsed.meta,
        findingsFile: file,
      };
    } catch (err) {
      results[index] = {
        id: task.id,
        question: task.question,
        ok: false,
        spawnStatus: `error: ${(err as Error).message}`,
        meta: FALLBACK_META,
        findingsFile: file,
      };
    }
  });

  // Post-batch tree diff: any change vs the pre-spawn snapshot means a child
  // violated the read-only contract (the batch dir itself is gitignored). Warn,
  // never fail — mirrors prep-fanout's D3 posture.
  const postStatus = gitStatusPorcelain(cwd);
  if (postStatus !== preStatus) {
    process.stderr.write(
      `research fanout: WARNING — tracked files changed during fanout (a read-only child wrote); review with \`git status\`:\n${postStatus}\n`,
    );
  }

  const okResults = results.filter((r) => r.ok);
  let synthesized = false;
  if (args.synthesize) {
    if (okResults.length >= 2) {
      const prompt = [
        'You are a read-only synthesis agent. Read the research findings files below',
        '(you may read files; do NOT edit, write, create, or delete anything).',
        'Merge them into one coherent markdown synthesis: agreements, contradictions,',
        'gaps, and a short "what this means" section. Your final message IS the synthesis.',
        '',
        'Questions asked:',
        ...okResults.map((r) => `- ${r.id}: ${r.question}`),
        '',
        'Findings files:',
        ...okResults.map((r) => `- ${join(batch.abs, r.findingsFile)}`),
      ].join('\n');
      try {
        const res = await spawn(prompt, {
          role: 'researcher',
          needsWrite: false,
          stdio: 'pipe',
          site: 'research.synthesize',
          timeoutMs: args.timeoutMs,
          cwd,
        });
        if (!res.timedOut && res.exitCode === 0 && res.stdout.trim().length > 0) {
          writeFileSync(join(batch.abs, 'SYNTHESIS.md'), `${res.stdout.trim()}\n`, 'utf8');
          synthesized = true;
        } else {
          process.stderr.write(
            'research fanout: WARNING — synthesis agent failed; findings + INDEX stand alone.\n',
          );
        }
      } catch (err) {
        process.stderr.write(
          `research fanout: WARNING — synthesis spawn failed (${(err as Error).message}); findings + INDEX stand alone.\n`,
        );
      }
    } else {
      process.stderr.write(
        `research fanout: skipping synthesis (${okResults.length} ok finding(s), need >= 2).\n`,
      );
    }
  }

  const manifest = { startedAt, batchDir: batch.rel, results };
  writeManifest(batch.abs, manifest);
  writeFileSync(join(batch.abs, 'INDEX.md'), renderIndex(manifest), 'utf8');

  const okCount = okResults.length;
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ batchDir: batch.rel, ok: okCount, total: results.length, synthesized, index: join(batch.rel, 'INDEX.md') })}\n`,
    );
  } else {
    process.stdout.write(
      `research fanout: ${okCount}/${results.length} ok. Read ${join(batch.rel, 'INDEX.md')}${synthesized ? ` + ${join(batch.rel, 'SYNTHESIS.md')}` : ''}.\n`,
    );
    for (const r of results) {
      if (!r.ok)
        process.stdout.write(
          `  ! ${r.id}: ${r.spawnStatus}${r.spawnStatus === 'ok' ? ' (envelope unparsed)' : ''}\n`,
        );
    }
  }
  return okCount === results.length ? 0 : 1;
}

function main(): void {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`research fanout: ${(err as Error).message}\n`);
      process.exit(1);
    });
}

const invokedDirect = /[\\/]fanout\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
