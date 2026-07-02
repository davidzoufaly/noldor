import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { nodeSpawn } from '../core/pr-flow-cli.js';
import { mergePrWithFallback } from '../core/pr-flow.js';
import { readSession, writeSession, clearSession } from '../core/session.js';
import { sizeToTier } from '../core/size-routing.js';
import { parseRoadmap } from '../utils/parse-blocks.js';
import { removeBlock } from '../utils/write-blocks.js';

import { liftSpecSections, scaffoldFd } from './scaffold.js';
import {
  batchDirFor,
  indexPath,
  newestBatchDir,
  readApprovedSlugs,
  readManifest,
} from './staging.js';

import type { FeatureDraft, PrepEntry, StagingManifest } from './types.js';

interface PromoteArgs {
  date?: string;
  slugs?: string[];
  all: boolean;
  dryRun: boolean;
  ship: boolean;
  json: boolean;
}

interface PromoteResult {
  slug: string;
  status: 'promoted' | 'skipped' | 'failed';
  commits: string[];
  note: string;
}

function parseArgs(argv: readonly string[]): PromoteArgs {
  let date: string | undefined;
  let slugs: string[] | undefined;
  let all = false;
  let dryRun = false;
  let ship = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--all') all = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--ship') ship = true;
    else if (a === '--json') json = true;
    else if (a === '--date') date = argv[++i];
    else if (a === '--slugs')
      slugs = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else throw new Error(`unknown flag: ${a}`);
  }
  return {
    all,
    dryRun,
    ship,
    json,
    ...(date !== undefined ? { date } : {}),
    ...(slugs !== undefined ? { slugs } : {}),
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gh(cwd: string, args: string[]): string {
  return execFileSync('gh', args, { cwd, encoding: 'utf8' });
}

function preflight(cwd: string): { ok: boolean; note: string } {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') return { ok: false, note: `not on main (on ${branch})` };
  // Untracked (`??`) files can't leak into the promote commit — only tracked
  // (staged or modified) changes threaten it, so only those block.
  const tracked = git(cwd, ['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.startsWith('??'));
  if (tracked.length > 0) return { ok: false, note: 'working tree not clean' };
  try {
    git(cwd, ['fetch', 'origin', 'main']);
  } catch (e) {
    return { ok: false, note: `git fetch failed: ${(e as Error).message}` };
  }
  const ahead = git(cwd, ['rev-list', '--count', 'origin/main..HEAD']).trim();
  if (ahead !== '0')
    return { ok: false, note: `local main is ahead of origin/main by ${ahead} commit(s)` };
  return { ok: true, note: 'clean' };
}

function selectApproved(
  manifest: StagingManifest,
  absBatchDir: string,
  parsed: PromoteArgs,
): FeatureDraft[] {
  let slugs: string[];
  if (parsed.slugs && parsed.slugs.length > 0) slugs = parsed.slugs;
  else if (parsed.all) slugs = manifest.entries.map((e) => e.slug);
  else slugs = readApprovedSlugs(readFileSync(indexPath(absBatchDir), 'utf8'));
  const wanted = new Set(slugs);
  return manifest.entries.filter((e) => wanted.has(e.slug) && e.complete);
}

function toPrepEntry(roadmapRaw: string, slug: string): PrepEntry | null {
  const r = parseRoadmap(roadmapRaw).find((e) => e.slug === slug);
  if (!r) return null;
  const size = (r.size ?? '').toUpperCase();
  return {
    slug: r.slug,
    name: r.name,
    size,
    tier: sizeToTier(size),
    area: r.area,
    ...(r.parent !== undefined ? { parent: r.parent } : {}),
    deps: r.deps ?? [],
    body: r.description,
  };
}

function promoteOne(cwd: string, today: string, draft: FeatureDraft): PromoteResult {
  const commits: string[] = [];
  const fdRel = join('docs', 'features', `${draft.slug}.md`);
  const fdAbs = join(cwd, fdRel);
  if (existsSync(fdAbs))
    return { slug: draft.slug, status: 'skipped', commits, note: 'FD already exists' };

  const roadmapPath = loadDocRoots(cwd).roadmap;
  const roadmapRaw = readFileSync(roadmapPath, 'utf8');
  const entry = toPrepEntry(roadmapRaw, draft.slug);
  if (!entry)
    return { slug: draft.slug, status: 'failed', commits, note: 'roadmap block not found' };

  const specRel = join('docs', 'superpowers', 'specs', `${today}-${draft.slug}-design.md`);
  const planRel =
    entry.tier === 'full'
      ? join('docs', 'superpowers', 'plans', `${today}-${draft.slug}.md`)
      : null;

  // Scaffold FD from the live roadmap block, then lift User Story/Usage from the approved spec.
  const specStaging = join(cwd, draft.specFile);
  if (!existsSync(specStaging))
    return {
      slug: draft.slug,
      status: 'failed',
      commits,
      note: `staging spec missing: ${draft.specFile}`,
    };
  const specMd = readFileSync(specStaging, 'utf8');

  let planMd: string | null = null;
  if (planRel) {
    const planStaging = join(cwd, draft.planFile);
    if (!existsSync(planStaging))
      return {
        slug: draft.slug,
        status: 'failed',
        commits,
        note: `staging plan missing: ${draft.planFile}`,
      };
    planMd = readFileSync(planStaging, 'utf8');
  }

  let fdMd = scaffoldFd(entry, { specRel, planRel, cwd });
  fdMd = liftSpecSections(specMd, fdMd);

  let removed: { newRaw: string };
  try {
    removed = removeBlock(roadmapRaw, draft.slug);
  } catch (e) {
    return {
      slug: draft.slug,
      status: 'failed',
      commits,
      note: `removeBlock: ${(e as Error).message}`,
    };
  }

  // New FD (never attach) → Noldor-Path *-new so commits survive rollout-marker enforcement.
  const noldorPath = entry.tier === 'full' ? 'full-new' : 'specs-only-new';
  const preSha = git(cwd, ['rev-parse', 'HEAD']).trim();
  try {
    mkdirSync(dirname(fdAbs), { recursive: true });
    writeFileSync(fdAbs, fdMd, 'utf8');
    writeFileSync(roadmapPath, removed.newRaw, 'utf8');
    mkdirSync(join(cwd, dirname(specRel)), { recursive: true });
    writeFileSync(join(cwd, specRel), specMd, 'utf8');
    if (planRel && planMd !== null) {
      mkdirSync(join(cwd, dirname(planRel)), { recursive: true });
      writeFileSync(join(cwd, planRel), planMd, 'utf8');
    }

    // Commits — one per artifact, each carrying Noldor-FD + Noldor-Path trailers (matches gate subjects).
    const trailer = `Noldor-FD: ${draft.slug}`;
    const commit = (paths: string[], subject: string): void => {
      git(cwd, ['add', ...paths]);
      git(cwd, ['commit', '-m', subject, '-m', trailer, '-m', `Noldor-Path: ${noldorPath}`]);
      commits.push(subject);
    };
    commit([fdRel, roadmapPath], `docs(features:${draft.slug}): promote ${draft.slug} to FD`);
    commit([specRel, fdRel], `docs(features:${draft.slug}): add spec for ${draft.slug}`);
    if (planRel) commit([planRel], `docs(features:${draft.slug}): add plan for ${draft.slug}`);
  } catch (e) {
    // Roll back to pristine pre-feature state: undo commits + tracked edits, delete new files.
    try {
      git(cwd, ['reset', '--hard', preSha]);
    } catch {
      /* best-effort rollback */
    }
    for (const p of [fdAbs, join(cwd, specRel), ...(planRel ? [join(cwd, planRel)] : [])]) {
      if (existsSync(p)) rmSync(p);
    }
    return {
      slug: draft.slug,
      status: 'failed',
      commits: [],
      note: `commit failed: ${(e as Error).message}`,
    };
  }

  return { slug: draft.slug, status: 'promoted', commits, note: '' };
}

function writeRecord(
  absBatchDir: string,
  today: string,
  branch: string,
  results: PromoteResult[],
): string {
  const rows = results.map((r) => `| ${r.slug} | ${r.status} | ${r.note || '—'} |`).join('\n');
  const md = [
    `# Promoted — ${today}`,
    '',
    `Branch: \`${branch}\``,
    '',
    '| Slug | Status | Note |',
    '| ---- | ------ | ---- |',
    rows,
    '',
  ].join('\n');
  const path = join(absBatchDir, 'PROMOTED.md');
  writeFileSync(path, md, 'utf8');
  return path;
}

async function shipBranch(
  cwd: string,
  branch: string,
  today: string,
  promoted: PromoteResult[],
): Promise<{ prUrl: string; note: string }> {
  const checklist = promoted.map((r) => `- [x] ${r.slug}`).join('\n');
  const body = `${checklist}\n\nEach is now an in-progress FD carrying its spec (and plan for full-tier), ready for the autonomous plan-runner (\`autonomous run --source plans\`).`;
  git(cwd, ['push', '--force-with-lease', '--set-upstream', 'origin', branch]);
  const prUrl = gh(cwd, [
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    `docs: promote prep-batch ${today} (${promoted.length} FDs)`,
    '--body',
    body,
  ]).trim();
  // Same merge path as the gate's end-of-flow: auto-merge queue + poll, with a
  // direct squash-merge fallback when the repo has auto-merge disabled. Throws
  // when both legs fail — surfaced by finishRun as a ship failure, PR left open.
  const { mergedAt } = await mergePrWithFallback({
    prUrl,
    spawn: nodeSpawn({ cwd }),
    // The auto-merge leg can poll for minutes on pending checks — stream
    // status so --ship doesn't look hung (it used to return immediately).
    onStatus: (line) => process.stderr.write(`${line}\n`),
  });
  // PR is merged. Local-main sync is best-effort — a non-fast-forward (e.g. main
  // moved under us) must NOT be reported as a ship failure.
  try {
    git(cwd, ['checkout', 'main']);
  } catch {
    return { prUrl, note: `PR merged at ${mergedAt}; local main not yet synced` };
  }
  try {
    git(cwd, ['branch', '-D', branch]);
  } catch {
    // The direct-merge fallback runs `gh pr merge --delete-branch`, which may
    // have already deleted the local branch — not a failure.
  }
  try {
    git(cwd, ['fetch', 'origin', 'main']);
    git(cwd, ['merge', '--ff-only', 'origin/main']);
  } catch {
    return { prUrl, note: `PR merged at ${mergedAt}; local main not yet synced` };
  }
  return { prUrl, note: `PR merged at ${mergedAt}; local main synced` };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function run(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cwd = process.cwd();

  const relBatchDir = parsed.date ? batchDirFor(parsed.date) : newestBatchDir(cwd);
  if (!relBatchDir) {
    process.stderr.write('prep promote: no prep batch found under .noldor/prep-batch/\n');
    return 1;
  }
  const absBatchDir = join(cwd, relBatchDir);
  const manifest = readManifest(absBatchDir);
  const selected = selectApproved(manifest, absBatchDir, parsed);

  if (parsed.slugs) {
    const wanted = new Set(parsed.slugs);
    const incomplete = manifest.entries
      .filter((e) => wanted.has(e.slug) && !e.complete)
      .map((e) => e.slug);
    if (incomplete.length > 0)
      process.stderr.write(
        `prep promote: requested but incomplete (skipped): ${incomplete.join(', ')}\n`,
      );
  }

  if (selected.length === 0) {
    process.stdout.write(
      parsed.json
        ? `${JSON.stringify({ batchDir: relBatchDir, promoted: [] })}\n`
        : `prep promote: no approved+complete features in ${relBatchDir}.\n`,
    );
    return 0;
  }

  if (parsed.dryRun) {
    const list = selected.map((d) => `  ${d.slug} (${d.size}/${d.tier})`).join('\n');
    process.stdout.write(
      parsed.json
        ? `${JSON.stringify({ batchDir: relBatchDir, dryRun: true, ship: parsed.ship, slugs: selected.map((d) => d.slug) })}\n`
        : `prep promote (dry-run): would promote ${selected.length} feature(s) from ${relBatchDir}${parsed.ship ? ' and open an auto-merged PR' : ' onto a branch (no push)'}:\n${list}\n`,
    );
    return 0;
  }

  const pf = preflight(cwd);
  if (!pf.ok) {
    process.stderr.write(`prep promote: preflight failed — ${pf.note}\n`);
    return 1;
  }

  const today = manifest.today || todayUtc();
  const branch = `chore/promote-batch-${today}`;

  // Post-rollout, the pre-commit hard wall requires an active session for every
  // hook-visible commit this loop makes. Refuse to clobber a live gate session;
  // write our own and always clear it (mirrors withReleaseSession).
  const existingSession = readSession(cwd);
  if (existingSession) {
    process.stderr.write(
      `prep promote: an active /gate session is present (path=${existingSession.path}). ` +
        `Finish it or rm .noldor/session.json before promoting.\n`,
    );
    return 1;
  }
  writeSession(cwd, { path: 'fast-track', startedAt: new Date().toISOString() });
  try {
    git(cwd, ['fetch', 'origin', 'main']);
    git(cwd, ['checkout', '-B', branch, 'origin/main']);

    const results: PromoteResult[] = [];
    for (const draft of selected) {
      // SERIAL: each promoteOne removes a block from docs/roadmap.md — never parallelize.
      let r: PromoteResult;
      try {
        r = promoteOne(cwd, today, draft);
      } catch (e) {
        r = {
          slug: draft.slug,
          status: 'failed',
          commits: [],
          note: `unexpected: ${(e as Error).message}`,
        };
      }
      results.push(r);
      process.stderr.write(`  ${r.slug} -> ${r.status}${r.note ? ` (${r.note})` : ''}\n`);
    }

    return await finishRun(cwd, parsed, relBatchDir, absBatchDir, today, branch, results);
  } finally {
    clearSession(cwd);
  }
}

async function finishRun(
  cwd: string,
  parsed: PromoteArgs,
  relBatchDir: string,
  absBatchDir: string,
  today: string,
  branch: string,
  results: PromoteResult[],
): Promise<number> {
  const promoted = results.filter((r) => r.status === 'promoted');
  const failedCount = results.filter((r) => r.status === 'failed').length;

  if (promoted.length > 0) {
    // Pre-push receipt gate: promote commits carry `Noldor-Path: *-new`, which
    // requires a review receipt on the tip. These are draft promotions already
    // operator-approved at the artifact stage — not code — so carry an audited
    // override instead of a fake code-review receipt.
    git(cwd, [
      'commit',
      '--amend',
      '--no-edit',
      '--trailer',
      'Noldor-Path-Override: prep-promote batch (drafts operator-approved at artifact stage)',
    ]);
  }

  const recordPath = writeRecord(absBatchDir, today, branch, results);

  let ship: { prUrl: string; note: string } | null = null;
  let shipFailed = false;
  if (parsed.ship && promoted.length > 0 && failedCount > 0) {
    process.stderr.write(
      `prep promote: ${failedCount} draft(s) failed — NOT shipping. Resolve and rerun (branch ${branch} holds the ${promoted.length} promoted).\n`,
    );
  } else if (parsed.ship && promoted.length > 0) {
    try {
      ship = await shipBranch(cwd, branch, today, promoted);
    } catch (e) {
      // Scripted callers must see a requested-but-failed ship in the exit
      // code, not just `ship: null` — e.g. both merge legs failing leaves
      // the promote PR open and needs operator attention.
      shipFailed = true;
      process.stderr.write(`prep promote: ship failed — ${(e as Error).message}\n`);
    }
  }

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ batchDir: relBatchDir, branch, promoted: promoted.map((r) => r.slug), results, record: recordPath, ship })}\n`,
    );
  } else {
    process.stdout.write(
      `prep promote: ${promoted.length}/${results.length} promoted on ${branch}.\n`,
    );
    if (ship) process.stdout.write(`  shipped: ${ship.prUrl}\n`);
    else
      process.stdout.write(
        `  branch ${branch} built locally — review, then push + open a PR (or rerun with --ship).\n`,
      );
    process.stdout.write(`  record: ${recordPath}\n`);
  }
  if (shipFailed) return 1;
  return promoteExitCode(promoted.length, failedCount);
}

/**
 * Exit code for `prep promote`. Non-zero on ANY failed promotion so scripted
 * callers (and the autonomous pipeline) can detect partial failure — a batch
 * where some drafts promoted and others failed must NOT report success. Also
 * non-zero when nothing was promoted (all skipped / none approved). A
 * requested-but-failed `--ship` is handled separately in `finishRun` (exit 1).
 */
function promoteExitCode(promoted: number, failed: number): number {
  if (failed > 0) return 1;
  return promoted > 0 ? 0 : 1;
}

function main(): void {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`prep promote: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}

const invokedDirect = /[\\/]prep-promote\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();

export { parseArgs, preflight, promoteExitCode, promoteOne, run, selectApproved, toPrepEntry };
