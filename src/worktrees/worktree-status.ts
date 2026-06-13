import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * One worktree as parsed from `git worktree list --porcelain`.
 *
 * @remarks
 * `branch` is the short ref (`main`, `feat/foo`) — never the fully
 * qualified `refs/heads/...` form. `null` when `detached` is `true`.
 */
export interface WorktreeRecord {
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
}

/**
 * Parse the output of `git worktree list --porcelain` into structured records.
 *
 * @param porcelain - Raw stdout from the git command.
 * @returns One record per worktree, in the order git emitted them.
 */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  const blocks = porcelain.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    let path: string | null = null;
    let branch: string | null = null;
    let detached = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length);
        branch = ref.replace(/^refs\/heads\//, '');
      } else if (line === 'detached') detached = true;
    }

    if (path !== null) records.push({ path, branch, detached });
  }
  return records;
}

/** Per-worktree git statistics consumed by warnings + formatter. */
export interface WorktreeStats {
  readonly ahead: number;
  readonly behind: number;
  readonly dirtyCount: number;
  readonly dirtyFiles: readonly string[];
  readonly oldestDirtyMtime: Date | null;
  readonly lastCommit: string;
  readonly touchedFiles: readonly string[];
}

/**
 * Run a git subcommand inside `cwd` and return stdout as a UTF-8 string.
 * Returns empty string on failure and logs the failed command + cwd to stderr
 * so a corrupt or unreachable worktree never silently appears healthy.
 */
function gitOrEmpty(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`git ${args.join(' ')} failed in ${cwd}: ${message}\n`);
    return '';
  }
}

/**
 * Gather git statistics for a single worktree, comparing against `main`.
 *
 * @param path - Absolute path to the worktree root.
 * @param branch - Short branch name (or `main` for the root tree).
 * @returns Stats used by the warnings engine and the table formatter.
 */
export async function gatherStats(path: string, branch: string): Promise<WorktreeStats> {
  // ahead/behind
  let ahead = 0;
  let behind = 0;
  if (branch !== 'main') {
    const counts = gitOrEmpty(path, ['rev-list', '--left-right', '--count', `main...${branch}`])
      .trim()
      .split(/\s+/);
    behind = Number(counts[0] ?? 0);
    ahead = Number(counts[1] ?? 0);
  }

  // status
  const statusOut = gitOrEmpty(path, ['status', '--porcelain']);
  const dirtyFiles = statusOut
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  const dirtyCount = dirtyFiles.length;

  let oldestDirtyMtime: Date | null = null;
  for (const rel of dirtyFiles) {
    try {
      const s = await stat(join(path, rel));
      if (oldestDirtyMtime === null || s.mtime < oldestDirtyMtime) oldestDirtyMtime = s.mtime;
    } catch {
      // file may have been deleted; skip
    }
  }

  // last commit
  const lastCommit = gitOrEmpty(path, ['log', '-1', '--format=%h %ar — %s']).trim();

  // touched files vs main
  const touchedFiles =
    branch === 'main'
      ? []
      : gitOrEmpty(path, ['diff', `main...${branch}`, '--name-only'])
          .split('\n')
          .filter(Boolean);

  return { ahead, behind, dirtyCount, dirtyFiles, oldestDirtyMtime, lastCommit, touchedFiles };
}

/** Inclusive port range allocated to feature worktrees. Main holds 5173. */
const PORT_RANGE_START = 5174;
const PORT_RANGE_END = 5179;

/**
 * Read `PORT=` from a worktree's `.env.local`, or null if absent.
 *
 * @param worktreePath - Absolute path to the worktree root.
 * @returns The port number, or `null` if the file is missing or has no PORT line.
 */
export async function readPort(worktreePath: string): Promise<number | null> {
  try {
    const content = await readFile(join(worktreePath, '.env.local'), 'utf-8');
    const match = content.match(/^PORT=(\d+)$/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Port for a dev surface = the tree's stamped base PORT + the surface offset.
 * Offset 0 → the stamped PORT itself (back-compat with a single dev server).
 * Offsets >= 100 by convention keep secondary surfaces clear of the
 * 5174-5179 base cap and of each other.
 *
 * @param basePort - The tree's stamped `.env.local` PORT.
 * @param offset - The surface's configured `portOffset`.
 */
export function deriveSurfacePort(basePort: number, offset: number): number {
  return basePort + offset;
}

/** Input for {@link allocatePorts}. */
export interface PortInput {
  readonly path: string;
  readonly currentPort: number | null;
}

/** Output for {@link allocatePorts}. */
export interface PortAllocation {
  readonly assignments: ReadonlyArray<{ path: string; port: number }>;
  readonly exhausted: boolean;
}

/**
 * Assign the lowest free port in `5174-5179` to any worktree missing one.
 * Append `PORT=<n>` to the worktree's `.env.local`, creating the file if absent
 * and preserving any other lines.
 *
 * @param inputs - One entry per feature worktree (do not include main).
 * @returns Mapping of newly assigned ports plus an `exhausted` flag.
 */
export async function allocatePorts(inputs: readonly PortInput[]): Promise<PortAllocation> {
  const used = new Set<number>(
    inputs.map((i) => i.currentPort).filter((p): p is number => p !== null),
  );
  const needsAssign = inputs.filter((i) => i.currentPort === null);

  const free: number[] = [];
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) free.push(p);
  }
  if (free.length < needsAssign.length) {
    return { assignments: [], exhausted: true };
  }

  const assignments: Array<{ path: string; port: number }> = [];
  for (let i = 0; i < needsAssign.length; i++) {
    const port = free[i]!;
    const target = needsAssign[i]!;
    assignments.push({ path: target.path, port });

    await mkdir(target.path, { recursive: true });
    let existing = '';
    try {
      existing = await readFile(join(target.path, '.env.local'), 'utf-8');
    } catch {
      // file absent
    }
    const newline = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(join(target.path, '.env.local'), `${existing}${newline}PORT=${port}\n`);
  }

  return { assignments, exhausted: false };
}

/** Discriminated union of all warning kinds. */
export type Warning =
  | { kind: 'cap-exceeded'; count: number }
  | { kind: 'drift'; branch: string; behind: number }
  | { kind: 'stale-dirty'; branch: string }
  | { kind: 'orphan'; path: string }
  | { kind: 'overlap'; branchA: string; branchB: string; files: readonly string[] };

const FEATURE_CAP = 3;
const DRIFT_COMMITS = 12;
const STALE_DIRTY_MS = 60 * 60 * 1000;

/** Tree-with-stats input shape consumed by {@link computeWarnings}. */
export interface TreeWithStats {
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly stats: WorktreeStats;
}

/**
 * Aggregate all warnings from a set of feature worktrees.
 *
 * @remarks
 * Drift uses commit count only (`behind >= 12`) in v1. The `>24h` time-based
 * branch from the spec is deferred until the commit-only threshold proves
 * insufficient.
 *
 * @param trees - Feature worktrees (do not include main).
 * @returns Flat list of all warnings found across the set.
 */
export function computeWarnings(trees: readonly TreeWithStats[]): Warning[] {
  const warnings: Warning[] = [];

  if (trees.length > FEATURE_CAP) {
    warnings.push({ kind: 'cap-exceeded', count: trees.length });
  }

  for (const t of trees) {
    if (t.branch === null && !t.detached) {
      warnings.push({ kind: 'orphan', path: t.path });
      continue;
    }
    if (t.branch !== null && t.stats.behind >= DRIFT_COMMITS) {
      warnings.push({ kind: 'drift', branch: t.branch, behind: t.stats.behind });
    }
    if (
      t.branch !== null &&
      t.stats.dirtyCount > 0 &&
      t.stats.oldestDirtyMtime !== null &&
      Date.now() - t.stats.oldestDirtyMtime.getTime() > STALE_DIRTY_MS
    ) {
      warnings.push({ kind: 'stale-dirty', branch: t.branch });
    }
  }

  const overlapInputs = trees
    .filter((t) => t.branch !== null)
    .map((t) => ({ branch: t.branch as string, touchedFiles: t.stats.touchedFiles }));
  for (const o of detectFileOverlap(overlapInputs)) {
    warnings.push({ kind: 'overlap', ...o });
  }

  return warnings;
}

/** One pairwise overlap finding. */
export interface OverlapFinding {
  readonly branchA: string;
  readonly branchB: string;
  readonly files: readonly string[];
}

/**
 * Detect pairwise file overlaps across feature worktrees.
 *
 * @param trees - One entry per feature worktree (omit main).
 * @returns One {@link OverlapFinding} per pair with non-empty intersection.
 */
export function detectFileOverlap(
  trees: ReadonlyArray<{ branch: string; touchedFiles: readonly string[] }>,
): OverlapFinding[] {
  const findings: OverlapFinding[] = [];
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i]!;
      const b = trees[j]!;
      const setB = new Set(b.touchedFiles);
      const shared = a.touchedFiles.filter((f) => setB.has(f));
      if (shared.length > 0) {
        findings.push({ branchA: a.branch, branchB: b.branch, files: shared });
      }
    }
  }
  return findings;
}

/** A row in the status table, including resolved port. */
export interface StatusRow {
  readonly path: string;
  readonly branch: string;
  readonly port: number;
  readonly stats: WorktreeStats;
}

/**
 * Render the status table + warnings as a single multi-line string.
 *
 * @param input - Trees (already enriched with port + stats) and aggregated warnings.
 * @returns A formatted string with a column-aligned table and an optional Warnings section.
 *
 * @example
 * ```typescript
 * const output = formatStatus({ trees, warnings });
 * process.stdout.write(output + '\n');
 * ```
 */
export function formatStatus(input: {
  trees: readonly StatusRow[];
  warnings: readonly Warning[];
}): string {
  const header = ['PATH', 'BRANCH', 'PORT', 'AHEAD/BEHIND', 'DIRTY', 'LAST COMMIT'];
  const rows = input.trees.map((t) => [
    t.path,
    t.branch,
    String(t.port),
    t.branch === 'main' ? '-' : `${t.stats.ahead}/${t.stats.behind}`,
    t.stats.dirtyCount === 0 ? 'clean' : `${t.stats.dirtyCount} mod`,
    t.stats.lastCommit,
  ]);

  const widths = header.map((h, col) => Math.max(h.length, ...rows.map((r) => r[col]!.length)));
  const pad = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();

  const lines: string[] = [pad(header), ...rows.map(pad)];

  if (input.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const w of input.warnings) lines.push(`  ⚠ ${describeWarning(w)}`);
  }

  return lines.join('\n');
}

/**
 * Human-readable text for a warning. Shared between CLI table renderer
 * and dashboard worktree-health view.
 *
 * @param w - The warning record to describe.
 * @returns Single-line description without prefix.
 */
export function describeWarning(w: Warning): string {
  switch (w.kind) {
    case 'cap-exceeded':
      return `${w.count} active feature worktrees — cap is 3`;
    case 'drift':
      return `${w.branch} ${w.behind} commits behind main — rebase recommended`;
    case 'stale-dirty':
      return `${w.branch} has uncommitted changes older than 1 hour`;
    case 'orphan':
      return `${w.path} is an orphan worktree (branch deleted)`;
    case 'overlap':
      return `${w.branchA} and ${w.branchB} both touch ${w.files.join(', ')}`;
  }
}

/**
 * CLI entrypoint. Enumerates worktrees, gathers stats, allocates ports,
 * prints the table + warnings to stdout. Exits non-zero only on port range
 * exhaustion.
 *
 * @remarks
 * Uses `git worktree list --porcelain` (which works from any worktree) to
 * identify the main worktree as the entry whose path does NOT contain
 * `/.worktrees/`. This is reliable regardless of where the script is invoked —
 * unlike `git rev-parse --show-toplevel`, which returns the CWD's own root.
 */
export async function main(): Promise<number> {
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf-8',
  });

  const records = parseWorktreeList(porcelain);
  const mainRecord = records.find((r) => !r.path.includes('/.worktrees/'));
  if (mainRecord === undefined) {
    process.stderr.write('Could not identify main worktree.\n');
    return 1;
  }
  const mainPath = mainRecord.path;
  const featureRecords = records.filter((r) => r.path !== mainPath);

  const portInputs: PortInput[] = await Promise.all(
    featureRecords.map(async (r) => ({
      path: r.path,
      currentPort: await readPort(r.path),
    })),
  );
  const allocation = await allocatePorts(portInputs);
  if (allocation.exhausted) {
    process.stderr.write(
      `Port range 5174-5179 exhausted — clean up worktrees before adding more.\n`,
    );
    return 1;
  }

  const portByPath = new Map<string, number>();
  for (const i of portInputs) if (i.currentPort !== null) portByPath.set(i.path, i.currentPort);
  for (const a of allocation.assignments) portByPath.set(a.path, a.port);

  const treesWithStats: TreeWithStats[] = await Promise.all(
    featureRecords.map(async (r) => ({
      path: r.path,
      branch: r.branch,
      detached: r.detached,
      stats: r.branch ? await gatherStats(r.path, r.branch) : emptyStats(),
    })),
  );

  const mainStats = await gatherStats(mainPath, 'main');
  const rows: StatusRow[] = [
    { path: '.', branch: 'main', port: 5173, stats: mainStats },
    ...treesWithStats
      .filter((t) => t.branch !== null)
      .map((t) => ({
        path: t.path.replace(`${mainPath}/`, ''),
        branch: t.branch as string,
        port: portByPath.get(t.path) ?? 0,
        stats: t.stats,
      })),
  ];

  const warnings = computeWarnings(treesWithStats);
  process.stdout.write(`${formatStatus({ trees: rows, warnings })}\n`);
  return 0;
}

function emptyStats(): WorktreeStats {
  return {
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    dirtyFiles: [],
    oldestDirtyMtime: null,
    lastCommit: '',
    touchedFiles: [],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
