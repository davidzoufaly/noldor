import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import matter from 'gray-matter';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';
import { loadDocRoots } from './doc-roots.js';
import {
  assessEntrySplit,
  assessFdBreadth,
  assessPlanSplit,
  type SplitSignal,
} from './split-suggestion.js';

/**
 * `pnpm noldor noldor split-check` — suggest a split when an entry/FD/plan
 * exceeds the `split-suggestion.ts` size thresholds.
 *
 * Exit contract mirrors `lint-plan-snippets` exactly so skills shell out to
 * both uniformly: 0 = clean, 2 = signals present (one stdout line per
 * signal), 1 = infra error (unknown slug, unreadable path, bad usage).
 * Errors emit on stdout (not stderr) so /gate Step 2.5 and the skills can
 * surface them in prompt descriptions; the CLI's consumers capture stdout.
 */
export interface SplitCheckResult {
  readonly exitCode: 0 | 1 | 2;
  readonly lines: readonly string[];
}

const USAGE = 'usage: split-check --entry <slug> | --plan <path> | --fd <slug> [--add <path>...]';

function usageError(detail: string): SplitCheckResult {
  return { exitCode: 1, lines: [USAGE, `error: ${detail}`] };
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Resolve a slug to its entry — `docs/roadmap.md` first, then `docs/backlog.md`. */
function findEntry(slug: string, cwd: string): BacklogEntry | null {
  const roots = loadDocRoots(cwd);
  const roadmapRaw = readFileOrNull(roots.roadmap);
  if (roadmapRaw !== null) {
    const hit = parseRoadmap(roadmapRaw).find((e) => e.slug === slug);
    if (hit !== undefined) return hit;
  }
  const backlogRaw = readFileOrNull(roots.backlog);
  if (backlogRaw !== null) {
    const hit = parseBacklog(backlogRaw).find((e) => e.slug === slug);
    if (hit !== undefined) return hit;
  }
  return null;
}

function formatSignal(s: SplitSignal): string {
  return `[${s.rule}] ${s.message}`;
}

function toResult(signals: readonly SplitSignal[]): SplitCheckResult {
  if (signals.length === 0) return { exitCode: 0, lines: [] };
  return { exitCode: 2, lines: signals.map(formatSignal) };
}

export function runSplitCheck(args: readonly string[], cwd: string): SplitCheckResult {
  let entry: string | undefined;
  let plan: string | undefined;
  let fd: string | undefined;
  const add: string[] = [];
  let i = 0;
  while (i < args.length) {
    const flag = args[i];
    if (flag !== '--entry' && flag !== '--plan' && flag !== '--fd' && flag !== '--add') {
      return usageError(`unknown argument ${flag}`);
    }
    const value = args[i + 1];
    if (value === undefined) return usageError(`missing value after ${flag}`);
    if (flag === '--entry') entry = value;
    else if (flag === '--plan') plan = value;
    else if (flag === '--fd') fd = value;
    else add.push(value);
    i += 2;
  }
  const modes = [entry, plan, fd].filter((m) => m !== undefined);
  if (modes.length !== 1) return { exitCode: 1, lines: [USAGE] };

  if (entry !== undefined) {
    const found = findEntry(entry, cwd);
    if (found === null) return usageError(`no roadmap/backlog entry with slug "${entry}"`);
    return toResult(assessEntrySplit(found));
  }

  if (plan !== undefined) {
    const path = isAbsolute(plan) ? plan : join(cwd, plan);
    const md = readFileOrNull(path);
    if (md === null) return usageError(`cannot read plan at ${path}`);
    return toResult(assessPlanSplit(md));
  }

  const fdPath = join(loadDocRoots(cwd).features, `${fd}.md`);
  const raw = readFileOrNull(fdPath);
  if (raw === null) return usageError(`cannot read FD at ${fdPath}`);
  const data = matter(raw).data as { links?: { code?: unknown } };
  const rawCode = data.links?.code;
  const code = Array.isArray(rawCode)
    ? rawCode.filter((p): p is string => typeof p === 'string')
    : [];
  const signal = assessFdBreadth(code, add);
  return toResult(signal === null ? [] : [signal]);
}

function main(): void {
  const result = runSplitCheck(process.argv.slice(2), process.cwd());
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(result.exitCode);
}

const invokedDirect = /[\\/]split-check-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  main();
}
