// @fd: graph-and-main-freshness-before-coding
// `noldor worktrees freshness [--file <p>]... [--rebuild] [--json]` — the check
// gate Step 3.5 runs before the first edit. Every verdict exits 0: the command
// reports, the gate prose acts.

import { runIfDirect } from '../core/cli-entry.js';
import { repoRelativePath } from '../core/repo-paths.js';
import { renderDigest } from '../design/graph-context-cli.js';
import { codeFreshness, type CodeFreshness } from './code-freshness.js';

const EXIT_OK = 0;
const EXIT_USAGE = 2;

type ParsedArgs =
  | { ok: true; files: string[]; rebuild: boolean; json: boolean }
  | { ok: false; error: string };

export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  const files: string[] = [];
  let rebuild = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--rebuild') rebuild = true;
    else if (arg === '--file') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: '--file needs a value' };
      }
      i += 1;
      const rel = repoRelativePath(cwd, value);
      if (rel === null || rel.length === 0) {
        return { ok: false, error: `path escapes the repository: ${value}` };
      }
      if (!files.includes(rel)) files.push(rel);
    } else return { ok: false, error: `unknown argument: ${arg}` };
  }
  return { ok: true, files, rebuild, json };
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

async function main(argv: readonly string[]): Promise<number> {
  const cwd = process.cwd();
  const parsed = parseArgs(argv, cwd);
  if (!parsed.ok) {
    process.stderr.write(
      `worktrees freshness: ${parsed.error}\nusage: noldor worktrees freshness [--file <path>]... [--rebuild] [--json]\n`,
    );
    return EXIT_USAGE;
  }
  const result = await codeFreshness({ cwd, files: parsed.files, rebuild: parsed.rebuild });
  process.stdout.write(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : renderReport(result));
  return EXIT_OK;
}

runIfDirect('code-freshness-cli', 'worktrees freshness', main);
