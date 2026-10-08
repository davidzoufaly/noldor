// @fd: graph-and-main-freshness-before-coding
// `noldor worktrees freshness [--file <p>]... [--rebuild] [--json]` — the check
// gate Step 3.5 runs before the first edit. Every verdict exits 0: the command
// reports, the gate prose acts.

import { parseArgs as parseCliArgs } from 'node:util';

import { runIfDirect } from '../core/cli-entry.js';
import { repoFileArgs } from '../core/repo-paths.js';
import { renderDigest } from '../design/graph-context-cli.js';
import { codeFreshness, type CodeFreshness } from './code-freshness.js';

const EXIT_OK = 0;
const EXIT_USAGE = 2;

type ParsedArgs =
  | { ok: true; files: string[]; rebuild: boolean; json: boolean }
  | { ok: false; error: string };

export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  let values: { file?: string[]; rebuild?: boolean; json?: boolean };
  try {
    ({ values } = parseCliArgs({
      args: [...argv],
      options: {
        file: { type: 'string', multiple: true },
        rebuild: { type: 'boolean' },
        json: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const files = repoFileArgs(cwd, values.file ?? []);
  if (!files.ok) return files;
  return {
    ok: true,
    files: files.paths,
    rebuild: values.rebuild === true,
    json: values.json === true,
  };
}

export function renderReport(r: CodeFreshness): string {
  const lines = [`graph: ${r.graph.verdict}`, `  ${r.graph.reason}`];
  for (const w of r.graph.warnings) lines.push(`  warning: ${w}`);
  for (const d of r.graph.digests)
    lines.push(
      ...renderDigest(d)
        .split('\n')
        .map((l) => `  ${l}`),
    );

  lines.push(`main: ${r.main.verdict}`, `  ${r.main.reason}`);
  if (r.main.overlap === 'unknown' && r.main.verdict === 'behind') {
    lines.push('  overlap: unknown — no --file given');
  }
  for (const c of r.main.touching) {
    lines.push(`  ${c.sha} ${c.subject} — touches ${c.files.join(', ')}`);
  }
  if (r.main.rebaseAdvised) {
    lines.push('next: git rebase origin/main before the first edit, then re-run this check');
  }
  return `${lines.join('\n')}\n`;
}

const USAGE = 'usage: noldor worktrees freshness [--file <path>]... [--rebuild] [--json]';

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, process.cwd());
  if (!parsed.ok) {
    process.stderr.write(`worktrees freshness: ${parsed.error}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  const { files, rebuild, json } = parsed;
  const result = await codeFreshness({ cwd: process.cwd(), files, rebuild });
  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : renderReport(result));
  return EXIT_OK;
}

runIfDirect('code-freshness-cli', 'worktrees freshness', main);
