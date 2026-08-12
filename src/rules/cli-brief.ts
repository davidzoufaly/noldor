/**
 * `noldor rules brief --file <path> [--file <path> …] [--stage <stage>] [--json]`
 *
 * Prints the cascade rules that apply to those files, binding ones first, and
 * records the surfaced ids in `session.injectedRules`. The author-facing half of
 * rule injection; the reviewer-facing half is `orchestrate --kind code`.
 *
 * `--file` is REQUIRED. `fileMatches` (`resolve.ts`) never matches a file-scoped
 * rule against a query with no file, and every rule in the store is file-scoped,
 * so a stage-only brief would print "no rules match" no matter what the store
 * holds — a confident lie. Refusing is the honest answer.
 */
import { STAGES } from '../core/rules/stage.js';
import type { Stage } from '../core/rules/stage.js';
import { runIfDirect } from '../core/cli-entry.js';
import { stampInjectedRules } from '../core/session.js';
import { renderBrief, unionResults } from './brief.js';
import { runResolve } from './cli-cores.js';

class UsageError extends Error {}

export interface BriefArgs {
  files: string[];
  stage?: Stage;
  json: boolean;
}

export function parseBriefArgs(argv: readonly string[]): BriefArgs {
  const args: BriefArgs = { files: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--json') args.json = true;
    else if (flag === '--file') {
      const value = argv[++i];
      if (value === undefined || value.length === 0) throw new UsageError('--file needs a path');
      args.files.push(value);
    } else if (flag === '--stage') {
      const value = argv[++i];
      if (value === undefined || !(STAGES as readonly string[]).includes(value)) {
        throw new UsageError(`--stage must be one of: ${STAGES.join(', ')}`);
      }
      args.stage = value as Stage;
    } else throw new UsageError(`unknown flag: ${flag}`);
  }
  if (args.files.length === 0) {
    throw new UsageError(
      'usage: noldor rules brief --file <path> [--file <path> …] [--stage <stage>] [--json]\n' +
        '  --file is required: a file-scoped rule never matches a stage-only query, so a\n' +
        '  brief with no file would report "no rules match" however full the store is.',
    );
  }
  return args;
}

export function runBrief(argv: readonly string[], cwd: string = process.cwd()): number {
  let args: BriefArgs;
  try {
    args = parseBriefArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  }

  const result = unionResults(
    args.files.map((file) =>
      runResolve(cwd, { file, ...(args.stage ? { stage: args.stage } : {}) }),
    ),
  );

  process.stdout.write(
    args.json
      ? `${JSON.stringify({ files: args.files, stage: args.stage ?? null, ...result })}\n`
      : renderBrief(result, { files: args.files, ...(args.stage ? { stage: args.stage } : {}) }),
  );

  stampInjectedRules(
    cwd,
    [...result.enforce, ...result.injected].map((r) => r.id),
    (message) => process.stderr.write(`rules brief: ${message}\n`),
  );
  return 0;
}

runIfDirect('cli-brief', 'rules brief', (argv) => Promise.resolve(runBrief(argv)));
