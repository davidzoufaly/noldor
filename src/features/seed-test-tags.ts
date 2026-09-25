// @fd: sdd-co-tag-detector

import { parseArgs } from 'node:util';

import { atomicWriteFile } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { loadSddFeatures } from '../core/fd-load.js';
import { repoRelativePath, scanRoots } from '../core/repo-paths.js';
import {
  collectTestInputs,
  computeMissingCoTags,
  isStaleGraphGap,
  loadFreshGraphOrWarn,
} from '../garden/graph-fd-lookup.js';
import type { MissingCoTags, TestInput } from '../garden/graph-fd-lookup.js';

const GRAPH_PATH = 'graphify-out/graph.json';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

// Horizontal whitespace only, `\r` excluded: the tests adapter's own pattern
// ends in `\s*`, which reaches past the line break, so a replace over it would
// delete the newline after the tag (and the `\r` of a CRLF file).
const TESTS_TAG_LINE_RE = /^\/\/[^\S\r\n]*@tests:[^\S\r\n]*(.*?)[^\S\r\n]*$/m;

/** Parsed `seed-test-tags` arguments, or the usage error that stopped the parse. */
export type SeedArgs = { ok: true; apply: boolean; paths: string[] } | { ok: false; error: string };

/**
 * Parse `[--path <p>]... [--apply]`, normalizing every `--path` to repo-relative
 * POSIX form.
 *
 * @param argv - Arguments after the command name
 * @param cwd - Repository root the paths resolve against
 * @returns The options, or an error naming the bad argument
 */
export function parseSeedArgs(argv: readonly string[], cwd: string): SeedArgs {
  let values: { apply?: boolean; path?: string[] };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { apply: { type: 'boolean' }, path: { type: 'string', multiple: true } },
      strict: true,
    }));
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const paths: string[] = [];
  for (const raw of values.path ?? []) {
    const rel = repoRelativePath(cwd, raw);
    if (rel === null) return { ok: false, error: `--path ${raw} is outside the repository` };
    if (!paths.includes(rel)) paths.push(rel);
  }
  return { ok: true, apply: values.apply ?? false, paths };
}

/**
 * Whether `path` is one of `filters` or sits under one at a `/` boundary. An
 * empty filter list selects every path, and so does `''`, the repository root.
 *
 * @param path - Repo-relative POSIX path of a test file
 * @param filters - Normalized `--path` values
 * @returns True when the path is in the batch
 */
export function isSelected(path: string, filters: readonly string[]): boolean {
  return (
    filters.length === 0 || filters.some((f) => f === '' || path === f || path.startsWith(`${f}/`))
  );
}

/**
 * Add `missing` slugs to the file's first `// @tests:` line, after the slugs
 * already there. A file with no such line comes back unchanged: inserting one
 * is detector 10's call, not this command's.
 *
 * @param content - Test file text
 * @param missing - Slugs to add, in the order to append them
 * @returns The text with the tag line extended, or `content` unchanged
 */
export function mergeTestsTag(content: string, missing: readonly string[]): string {
  const match = TESTS_TAG_LINE_RE.exec(content);
  if (!match) return content;
  const present = match[1]!
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  const added = missing.filter((slug) => !present.includes(slug));
  if (added.length === 0) return content;
  const line = `// @tests: ${[...present, ...added].join(', ')}`;
  return content.slice(0, match.index) + line + content.slice(match.index + match[0].length);
}

/** One file the seeder rewrites: its path, the slugs it gains, its new text. */
export interface TagEdit {
  path: string;
  slugs: string[];
  content: string;
}

/** What a batch would change, before anything is written. */
export interface SeedPlan {
  edits: TagEdit[];
  /** Tests with missing co-tags but no `// @tests:` line to merge into. */
  untagged: string[];
}

/**
 * Turn the missing co-tags into per-file edits for the selected batch.
 *
 * @param missing - Output of `computeMissingCoTags`
 * @param testInputs - The same test inputs the computation ran over
 * @param filters - Normalized `--path` values
 * @returns The edits, plus the selected tests left for detector 10
 */
export function planSeed(
  missing: readonly MissingCoTags[],
  testInputs: readonly TestInput[],
  filters: readonly string[],
): SeedPlan {
  const contentByPath = new Map(testInputs.map(({ content, path }) => [path, content]));
  const plan: SeedPlan = { edits: [], untagged: [] };
  for (const { missing: slugs, path } of missing) {
    const content = contentByPath.get(path);
    if (content === undefined || !isSelected(path, filters)) continue;
    const next = mergeTestsTag(content, slugs);
    if (next !== content) plan.edits.push({ content: next, path, slugs });
    else if (!TESTS_TAG_LINE_RE.test(content)) plan.untagged.push(path);
  }
  return plan;
}

/** What one {@link seedTestTags} run did. */
export type SeedResult =
  | { kind: 'graph-unusable'; stale: boolean }
  | { kind: 'no-match'; paths: string[] }
  | {
      kind: 'seeded';
      plan: SeedPlan;
      written: string[];
      failure?: { path: string; message: string };
    };

/**
 * Seed the missing `// @tests:` co-tags of one batch, from the cwd's graph.
 *
 * @param options - `apply` writes the edits; `paths` scopes the batch
 * @returns `graph-unusable` before reading anything when the graph is stale
 *   or missing; `no-match` naming every `--path` that selects no test file;
 *   otherwise the plan and the files written — none on a dry run, and only
 *   those before the first failure when a write fails
 */
export async function seedTestTags(options: {
  apply: boolean;
  paths: readonly string[];
}): Promise<SeedResult> {
  const loaded = loadFreshGraphOrWarn(GRAPH_PATH, scanRoots());
  if (!loaded.ok) return { kind: 'graph-unusable', stale: isStaleGraphGap(loaded.gap) };

  const testInputs = await collectTestInputs();
  const unmatched = options.paths.filter((f) => !testInputs.some((t) => isSelected(t.path, [f])));
  if (unmatched.length > 0) return { kind: 'no-match', paths: unmatched };

  const features = await loadSddFeatures(loadDocRoots().features);
  const { e2ePrefix } = loadConsumerConfig();
  const missing = computeMissingCoTags(features, testInputs, loaded.graph, e2ePrefix);
  const plan = planSeed(missing, testInputs, options.paths);
  const written: string[] = [];
  if (!options.apply) return { kind: 'seeded', plan, written };
  for (const edit of plan.edits) {
    try {
      await atomicWriteFile(edit.path, edit.content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'seeded', plan, written, failure: { message, path: edit.path } };
    }
    written.push(edit.path);
  }
  return { kind: 'seeded', plan, written };
}

/** The text and exit code {@link seedTestTags}'s result prints as. */
export interface SeedReport {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Render a result for the terminal.
 *
 * @param result - What {@link seedTestTags} returned
 * @param apply - Whether the run was asked to write
 * @returns Output and exit code: 0 done, 1 refused or failed mid-batch,
 *   2 a `--path` that selects nothing
 */
export function renderSeedResult(result: SeedResult, apply: boolean): SeedReport {
  if (result.kind === 'graph-unusable') {
    const why = result.stale
      ? `${GRAPH_PATH} is older than a file under the scan roots — regenerate it with pnpm noldor graphify build, then re-run. Every --apply leaves the graph older than the files it wrote, so regenerate between batches.`
      : `${GRAPH_PATH} does not exist — generate it with pnpm noldor graphify build, then re-run.`;
    return { code: EXIT_REFUSED, stdout: '', stderr: `seed-test-tags: ${why}\n` };
  }
  if (result.kind === 'no-match') {
    const named = result.paths.map((p) => `--path ${p}`).join(', ');
    return {
      code: EXIT_USAGE,
      stdout: '',
      stderr: `seed-test-tags: no test file under ${named}\n`,
    };
  }
  const { plan, written, failure } = result;
  const lines = plan.edits.map((edit) => `${edit.path}  + ${edit.slugs.join(', ')}`);
  if (plan.untagged.length > 0) {
    lines.push(
      `left alone — no // @tests: line to merge into (${plan.untagged.length}): ${plan.untagged.join(', ')}`,
    );
  }
  if (failure) {
    const stderr = `seed-test-tags: wrote ${written.length} of ${plan.edits.length} file(s), then failed on ${failure.path}: ${failure.message}\n`;
    return { code: EXIT_REFUSED, stdout: lines.map((l) => `${l}\n`).join(''), stderr };
  }
  if (plan.edits.length === 0) lines.push('seed-test-tags: nothing to seed');
  else if (!apply) {
    lines.push(
      `seed-test-tags: dry run — re-run with --apply to write ${plan.edits.length} file(s)`,
    );
  } else {
    lines.push(
      `seed-test-tags: wrote ${written.length} file(s). Run pnpm noldor sync test-links, and regenerate the graph (pnpm noldor graphify build) before the next batch.`,
    );
  }
  return { code: EXIT_OK, stdout: lines.map((l) => `${l}\n`).join(''), stderr: '' };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseSeedArgs(argv, process.cwd());
  if (!args.ok) {
    process.stderr.write(
      `seed-test-tags: ${args.error}\nusage: noldor features seed-test-tags [--path <dir|file>]... [--apply]\n`,
    );
    return EXIT_USAGE;
  }
  const out = renderSeedResult(await seedTestTags(args), args.apply);
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  return out.code;
}

runIfDirect('seed-test-tags', 'features seed-test-tags', main);
