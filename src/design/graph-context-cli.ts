// @fd: graphify-plan-of-edges-nodes-for-plans-specs
// `noldor design graph-context [--path <p>]... [--json]` — the surface the
// `/noldor-spec` structural-read step calls.
//
// Argument validation lives here, not in `graphContext`, so the result type
// carries no error member: a caller reaching the module has already-validated
// paths, and a usage error exits 2 before any verdict is computed.

import { relative, isAbsolute, resolve, sep } from 'node:path';

import { graphContext, type GraphContextResult, type PathDigest } from './graph-context.js';

/** Exit codes. `stale` is non-zero so a shell caller can branch on it. */
const EXIT_OK = 0;
const EXIT_STALE = 1;
const EXIT_USAGE = 2;

type ParsedArgs = { ok: true; paths: string[]; json: boolean } | { ok: false; error: string };

/**
 * Normalize every `--path` to repo-relative POSIX form and reject anything
 * escaping the repo. Duplicates collapse — the digest for a path is the same
 * whichever way it was spelled.
 */
export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  const paths: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg !== '--path') {
      return { ok: false, error: `unknown argument: ${arg}` };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: '--path needs a value' };
    }
    i += 1;
    const abs = isAbsolute(value) ? value : resolve(cwd, value);
    const rel = relative(cwd, abs).split(sep).join('/');
    if (rel.length === 0 || rel.startsWith('../')) {
      return { ok: false, error: `path escapes the repository: ${value}` };
    }
    if (!paths.includes(rel)) paths.push(rel);
  }
  return { ok: true, paths, json };
}

/** One digest as the prose an artifact's Structural context unit quotes. */
export function renderDigest(d: PathDigest): string {
  if (!d.inGraph) {
    return `${d.path}\n  not in the graph — too new to have been extracted, or not a code file`;
  }
  const lines = [`${d.path}`, `  community: c${String(d.community ?? -1)}`];
  if (d.coMembers.length > 0) lines.push(`  alongside: ${d.coMembers.join(', ')}`);
  if (d.owners.length > 0) {
    lines.push(
      `  community owned by: ${d.owners
        .map((o) => `${o.slug} (${String(o.count)} file${o.count === 1 ? '' : 's'})`)
        .join(', ')}`,
    );
  }
  if (d.topDegreeSymbols.length > 0) {
    lines.push(
      `  god nodes defined here: ${d.topDegreeSymbols
        .map((s) => `${s.label} — rank #${String(s.rank)}, ${String(s.degree)} edges`)
        .join('; ')}`,
    );
  }
  if (d.crossCommunityEdges.length > 0) {
    lines.push(
      `  cross-community edges: ${d.crossCommunityEdges
        .map((e) => `${e.to} [c${String(e.toCommunity)}] via ${e.relation}`)
        .join(', ')}`,
    );
  }
  if (d.topDegreeSymbols.length === 0 && d.crossCommunityEdges.length === 0) {
    lines.push('  no god nodes and no cross-community edges — an interior file');
  }
  return lines.join('\n');
}

/** The whole report, verdict first so a reader branches before reading detail. */
export function renderReport(result: GraphContextResult): string {
  const head = `status: ${result.status}\n${result.detail}`;
  if (result.status !== 'fresh') return `${head}\n`;
  const toon =
    result.summaryToon === null
      ? ''
      : result.summaryToon.usable
        ? `\nread first: ${result.summaryToon.path}`
        : `\n${result.summaryToon.path} is missing or older than the graph — run pnpm toon (digest below is unaffected)`;
  const digests =
    result.digests.length === 0
      ? '\n\nno paths given — verdict only'
      : `\n\n${result.digests.map(renderDigest).join('\n')}`;
  return `${head}${toon}${digests}\n`;
}

async function main(argv: readonly string[]): Promise<number> {
  const cwd = process.cwd();
  const parsed = parseArgs(argv, cwd);
  if (!parsed.ok) {
    process.stderr.write(
      `design graph-context: ${parsed.error}\nusage: noldor design graph-context [--path <file>]... [--json]\n`,
    );
    return EXIT_USAGE;
  }
  const result = await graphContext({ cwd, paths: parsed.paths });
  process.stdout.write(parsed.json ? `${JSON.stringify(result, null, 2)}\n` : renderReport(result));
  return result.status === 'stale' ? EXIT_STALE : EXIT_OK;
}

const invokedDirect = /[\\/]graph-context-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // An unexpected throw here is a bug report, not a usage error — keep the
      // stack rather than collapsing it to a one-liner.
      process.stderr.write(
        `design graph-context: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
