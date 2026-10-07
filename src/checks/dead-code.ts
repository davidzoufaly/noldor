// @fd: dead-code-detection-with-knip
/**
 * `noldor dead-code <report|check|baseline>` — a set ratchet over knip's
 * findings (unused files, exports, types and dependencies, plus the unresolved
 * imports and unlisted packages knip reports beside them). `knip.ts` at the repo
 * root silences false positives; everything knip still reports is a true finding
 * and is ratcheted here.
 *
 *                                       report   check   baseline
 *   no finding outside the baseline        0        0        0
 *   a finding the baseline lacks           0        1        0   (records, prints the diff)
 *   baseline absent                        0        3        0
 *   baseline unreadable / version drift    0        3        0   (overwrites)
 *   knip missing, failed or unparseable    3        3        3
 *   usage error                            2        2        2
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { runIfDirect } from '../core/cli-entry.js';
import { readCheckedState, writeJsonState } from '../core/state-file.js';

export const DEAD_CODE_BASELINE = '.noldor/dead-code-baseline.json';

/**
 * Bumped when the key format or the counted issue types change. A baseline from
 * another version reads as unreadable (exit 3), as in skill-size: the ratchet
 * guards this repo only, so a skip would leave it unguarded.
 */
export const DEAD_CODE_ALGORITHM_VERSION = 1;

const KNIP_TIMEOUT_MS = 120_000;

export const deadCodeBaselineSchema = z
  .object({
    algorithmVersion: z.number().int(),
    knipVersion: z.string().min(1),
    recordedAt: z.string().min(1),
    issues: z.array(z.string().min(1)),
  })
  .strict();
export type DeadCodeBaseline = z.infer<typeof deadCodeBaselineSchema>;

const knipSymbolSchema = z.object({ name: z.string(), namespace: z.string().optional() });
const knipRowSchema = z.record(z.string(), z.unknown());
const knipReportSchema = z.object({ issues: z.array(knipRowSchema) });

export type KnipRun =
  | { readonly ok: true; readonly stdout: string; readonly version: string }
  | { readonly ok: false; readonly reason: string };

export type RunKnip = (repo: string) => KnipRun;

export type KeysResult =
  | { readonly ok: true; readonly keys: string[] }
  | { readonly ok: false; readonly reason: string };

export type BaselineRead =
  | { kind: 'ok'; baseline: DeadCodeBaseline }
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string };

const byKey = (a: string, b: string): number => a.localeCompare(b, 'en');

/**
 * Turn knip's `--reporter json` output into one sorted key per finding:
 * `files:<file>`, `<type>:<file>:<name>`, `<type>:<file>:<Parent>.<member>` for
 * a member finding, and `<type>:<file>:<a>|<b>` for a `duplicates` or `cycles`
 * group. The separators cannot collide in practice: knip names are identifiers
 * or import specifiers, and a repo file path holds no `:`.
 */
export function knipKeys(stdout: string): KeysResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (e) {
    return { ok: false, reason: `knip printed no JSON: ${(e as Error).message}` };
  }
  const report = knipReportSchema.safeParse(raw);
  if (!report.success)
    return { ok: false, reason: `unexpected knip JSON: ${report.error.message}` };

  const keys = new Set<string>();
  for (const row of report.data.issues) {
    const file = row['file'];
    if (typeof file !== 'string') return { ok: false, reason: 'knip row without a file' };
    for (const [type, value] of Object.entries(row)) {
      // knip adds `owners` to every row when a CODEOWNERS file exists; it is metadata, not a finding.
      if (!Array.isArray(value) || type === 'owners') continue;
      if (type === 'files') {
        if (value.length > 0) keys.add(`files:${file}`);
        continue;
      }
      for (const item of value) {
        const name = issueName(item);
        if (name === null) return { ok: false, reason: `unexpected ${type} entry in ${file}` };
        keys.add(`${type}:${file}:${name}`);
      }
    }
  }
  return { ok: true, keys: [...keys].sort(byKey) };
}

function issueName(item: unknown): string | null {
  if (Array.isArray(item)) {
    const names: string[] = [];
    for (const s of item) {
      const symbol = knipSymbolSchema.safeParse(s);
      if (!symbol.success) return null;
      names.push(symbol.data.name);
    }
    return names.sort(byKey).join('|');
  }
  const symbol = knipSymbolSchema.safeParse(item);
  if (!symbol.success) return null;
  const { name, namespace } = symbol.data;
  return namespace === undefined ? name : `${namespace}.${name}`;
}

/** Run the repo-local knip binary; any failure is `ok: false`, never a throw. */
export const defaultRunKnip: RunKnip = (repo) => {
  let version: string;
  try {
    const pkg = JSON.parse(readFileSync(join(repo, 'node_modules/knip/package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof pkg.version !== 'string') return { ok: false, reason: 'knip has no version' };
    version = pkg.version;
  } catch (e) {
    return { ok: false, reason: `knip is not installed: ${(e as Error).message}` };
  }
  const run = spawnSync(
    join(repo, 'node_modules/.bin/knip'),
    ['--reporter', 'json', '--no-progress', '--no-exit-code'],
    { cwd: repo, encoding: 'utf8', timeout: KNIP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error !== undefined)
    return { ok: false, reason: `knip did not run: ${run.error.message}` };
  if (run.status !== 0) {
    return { ok: false, reason: `knip exited ${run.status}: ${run.stderr.trim().slice(0, 2000)}` };
  }
  return { ok: true, stdout: run.stdout, version };
};

/** Read `.noldor/dead-code-baseline.json`; a parse, schema or version failure is `unreadable`, never a throw. */
export function readDeadCodeBaseline(repo: string, knipVersion: string): BaselineRead {
  const read = readCheckedState(join(repo, DEAD_CODE_BASELINE), deadCodeBaselineSchema);
  if (read.kind !== 'ok') return read;
  const { algorithmVersion, knipVersion: recordedKnip } = read.value;
  const drift =
    algorithmVersion !== DEAD_CODE_ALGORITHM_VERSION
      ? `algorithm version ${algorithmVersion}; this is version ${DEAD_CODE_ALGORITHM_VERSION}`
      : recordedKnip !== knipVersion
        ? `knip ${recordedKnip}; installed is ${knipVersion}`
        : null;
  return drift === null
    ? { kind: 'ok', baseline: read.value }
    : { kind: 'unreadable', reason: `recorded under ${drift}` };
}

const REMEDY = 'pnpm noldor dead-code baseline';

type Measured = { ok: true; keys: string[]; version: string } | { ok: false };

function measure(repo: string, runKnip: RunKnip): Measured {
  const run = runKnip(repo);
  if (!run.ok) return couldNotLook(run.reason);
  const parsed = knipKeys(run.stdout);
  if (!parsed.ok) return couldNotLook(parsed.reason);
  return { ok: true, keys: parsed.keys, version: run.version };
}

function couldNotLook(reason: string): Measured {
  process.stderr.write(`✗ dead-code: could not look — ${reason}\n`);
  return { ok: false };
}

function printReport(keys: string[]): number {
  const grouped = Map.groupBy(keys, (k) => k.slice(0, k.indexOf(':')));
  for (const [type, group] of grouped) {
    process.stdout.write(`${type} (${group.length})\n`);
    for (const k of group) process.stdout.write(`    ${k.slice(type.length + 1)}\n`);
  }
  process.stdout.write(`dead-code: ${keys.length} finding(s)\n`);
  return 0;
}

function check(repo: string, keys: string[], version: string): number {
  const read = readDeadCodeBaseline(repo, version);
  if (read.kind !== 'ok') {
    const why =
      read.kind === 'absent'
        ? `no baseline at ${DEAD_CODE_BASELINE}`
        : `${DEAD_CODE_BASELINE} is unreadable: ${read.reason}`;
    process.stderr.write(`✗ dead-code: ${why}. Record one: ${REMEDY}\n`);
    return 3;
  }
  const recorded = new Set(read.baseline.issues);
  const current = new Set(keys);
  const added = [...current.difference(recorded)].sort(byKey);
  const gone = recorded.difference(current).size;
  if (added.length > 0) {
    process.stderr.write(`✗ dead-code: ${added.length} finding(s) not in the baseline:\n`);
    for (const k of added) process.stderr.write(`    ${k}\n`);
    process.stderr.write(
      `  Delete the dead code, or — for a knip false positive — add an entry or ignore to knip.ts with its reason.\n`,
    );
    return 1;
  }
  process.stdout.write(`dead-code: ${keys.length} finding(s), none outside the baseline\n`);
  if (gone > 0) {
    process.stdout.write(`  ${gone} recorded finding(s) are gone — lock that in: ${REMEDY}\n`);
  }
  return 0;
}

function record(repo: string, keys: string[], version: string, now: Date): number {
  const read = readDeadCodeBaseline(repo, version);
  const baseline: DeadCodeBaseline = {
    algorithmVersion: DEAD_CODE_ALGORITHM_VERSION,
    knipVersion: version,
    recordedAt: now.toISOString(),
    issues: keys,
  };
  writeJsonState(join(repo, DEAD_CODE_BASELINE), baseline);
  process.stdout.write(`dead-code: recorded ${keys.length} finding(s) to ${DEAD_CODE_BASELINE}\n`);
  if (read.kind !== 'ok') return 0;
  const before = new Set(read.baseline.issues);
  const after = new Set(keys);
  for (const k of [...after.difference(before)].sort(byKey)) process.stdout.write(`  ADDED ${k}\n`);
  for (const k of [...before.difference(after)].sort(byKey))
    process.stdout.write(`  dropped ${k}\n`);
  return 0;
}

/**
 * CLI entry: `noldor dead-code <report|check|baseline>`.
 *
 * @param argv - Arguments after the verb.
 * @param repo - Repository root.
 * @param runKnip - The knip seam; tests pass a fake.
 * @param now - Clock for `recordedAt`.
 * @returns The exit code in the table at the top of this file.
 */
export async function main(
  argv: string[],
  repo: string = process.cwd(),
  runKnip: RunKnip = defaultRunKnip,
  now: Date = new Date(),
): Promise<number> {
  const [sub, ...rest] = argv;
  if ((sub !== 'report' && sub !== 'check' && sub !== 'baseline') || rest.length > 0) {
    process.stderr.write('usage: noldor dead-code <report|check|baseline>\n');
    return 2;
  }
  const measured = measure(repo, runKnip);
  if (!measured.ok) return 3;
  if (sub === 'report') return printReport(measured.keys);
  if (sub === 'check') return check(repo, measured.keys, measured.version);
  return record(repo, measured.keys, measured.version, now);
}

runIfDirect('dead-code', 'dead-code', (argv) => main(argv));
