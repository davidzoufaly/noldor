import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runWithConcurrency } from '../core/concurrency.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { gitStatusPorcelain } from '../core/git-porcelain.js';

import { buildDraftPrompt } from './draft.js';
import { discoverPrepEntries, listFdSlugs, listSpecFiles } from './discover.js';
import { renderIndex } from './index-doc.js';
import { spawnClaude } from './spawn.js';
import { batchDirFor, ensureDir, indexPath, manifestPath, writeManifest } from './staging.js';

import { draftMetaSchema } from './types.js';
import type { DraftMeta, FeatureDraft, StagingManifest } from './types.js';

interface FanoutArgs {
  max: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  date?: string;
  slugs?: string[];
}

function intArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function parseArgs(argv: readonly string[]): FanoutArgs {
  let max = 4;
  let timeoutMs = 900_000;
  let dryRun = false;
  let json = false;
  let date: string | undefined;
  let slugs: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--json') json = true;
    else if (a === '--max') max = intArg(argv[++i], '--max');
    else if (a === '--timeout') timeoutMs = intArg(argv[++i], '--timeout');
    else if (a === '--date') date = argv[++i];
    else if (a === '--slugs')
      // Mirror `prep promote --slugs`: comma-separated, trimmed, empties dropped.
      slugs = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else throw new Error(`unknown flag: ${a}`);
  }
  return {
    max,
    timeoutMs,
    dryRun,
    json,
    ...(date !== undefined ? { date } : {}),
    ...(slugs !== undefined ? { slugs } : {}),
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function run(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cwd = process.cwd();
  const today = parsed.date ?? todayUtc();

  const roadmapRaw = readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
  const entries = discoverPrepEntries(
    roadmapRaw,
    listSpecFiles(cwd),
    listFdSlugs(cwd),
    parsed.slugs,
  );

  // Surface requested slugs that didn't survive discovery (typo, sub-M, or already
  // designed) so an explicit `--slugs` selection never silently drops entries.
  if (parsed.slugs) {
    const found = new Set(entries.map((e) => e.slug));
    const missing = parsed.slugs.filter((s) => !found.has(s));
    if (missing.length > 0 && !parsed.json) {
      process.stderr.write(
        `prep fanout: ${missing.length} requested slug(s) skipped (not an undesigned M+ roadmap entry): ${missing.join(', ')}\n`,
      );
    }
  }

  if (entries.length === 0) {
    process.stdout.write(
      parsed.json
        ? `${JSON.stringify({ today, drafted: 0, entries: [] })}\n`
        : 'prep fanout: no M+ roadmap entries lacking a spec — nothing to prep.\n',
    );
    return 0;
  }

  const relBatchDir = batchDirFor(today);
  const absBatchDir = join(cwd, relBatchDir);

  if (parsed.dryRun) {
    const list = entries.map((e) => `  ${e.slug} (${e.size}/${e.tier})`).join('\n');
    process.stdout.write(
      parsed.json
        ? `${JSON.stringify({ today, dryRun: true, entries: entries.map((e) => ({ slug: e.slug, size: e.size, tier: e.tier })) })}\n`
        : `prep fanout (dry-run): ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} would be drafted into ${relBatchDir}:\n${list}\n`,
    );
    return 0;
  }

  ensureDir(absBatchDir);
  process.stderr.write(
    `prep fanout: drafting ${entries.length} feature(s) into ${relBatchDir} (max ${parsed.max} concurrent)\n`,
  );

  // Parallel children run with `bypassPermissions` in this shared working tree,
  // isolated only by prompt instruction. Snapshot the tree before spawning so we
  // can flag anything a child dirties outside its allotted staging files (D3).
  const preStatus = gitStatusPorcelain(cwd);
  if (preStatus.length > 0) {
    process.stderr.write(
      `prep fanout: WARNING — working tree dirty before spawn; a pre-existing change may be confused with a child's:\n${preStatus}\n`,
    );
  }

  const spawnStatus = new Map<string, string>();
  await runWithConcurrency(entries, parsed.max, async (e) => {
    process.stderr.write(`  -> drafting ${e.slug}\n`);
    try {
      const res = await spawnClaude(buildDraftPrompt(e, today, relBatchDir), {
        cwd,
        timeoutMs: parsed.timeoutMs,
      });
      spawnStatus.set(e.slug, res.timedOut ? 'timeout' : `exit ${res.exitCode}`);
    } catch (err) {
      spawnStatus.set(e.slug, `error: ${(err as Error).message}`);
    }
  });

  // Post-batch tree diff: the staging dir is gitignored, so any change vs the
  // pre-spawn snapshot is a child writing OUTSIDE its allotted files (e.g.
  // dirtying docs/roadmap.md or a sibling's draft). Warn, don't fail (D3).
  const postStatus = gitStatusPorcelain(cwd);
  if (postStatus !== preStatus) {
    process.stderr.write(
      `prep fanout: WARNING — tracked files outside the batch dir changed during fanout (a child may have written outside its allotted files); review with \`git status\`:\n${postStatus}\n`,
    );
  }

  const drafts: FeatureDraft[] = entries.map((e) => {
    const specExists = existsSync(join(absBatchDir, `${e.slug}.spec.md`));
    const metaExists = existsSync(join(absBatchDir, `${e.slug}.meta.json`));
    const planExists = e.tier === 'full' && existsSync(join(absBatchDir, `${e.slug}.plan.md`));
    let meta: DraftMeta = { summary: e.name, confidence: 'low', risks: [], openQuestions: [] };
    if (metaExists) {
      // The child is an untrusted process: validate shape, don't `as DraftMeta`.
      // valid-JSON-but-wrong-shape (e.g. summary:null, missing openQuestions) would
      // otherwise throw later in renderIndex and lose the whole batch's INDEX.
      try {
        const parsed = draftMetaSchema.safeParse(
          JSON.parse(readFileSync(join(absBatchDir, `${e.slug}.meta.json`), 'utf8')),
        );
        if (parsed.success) meta = parsed.data;
        else
          process.stderr.write(
            `  ! ${e.slug}: meta.json shape invalid (${parsed.error.issues[0]?.message ?? 'unknown'}) — using fallback\n`,
          );
      } catch {
        process.stderr.write(`  ! ${e.slug}: meta.json not valid JSON — using fallback\n`);
      }
    }
    const complete = specExists && metaExists && (e.tier !== 'full' || planExists);
    return {
      slug: e.slug,
      name: e.name,
      tier: e.tier,
      size: e.size,
      area: e.area,
      ...(e.parent !== undefined ? { parent: e.parent } : {}),
      deps: [...e.deps],
      specFile: join(relBatchDir, `${e.slug}.spec.md`),
      planFile: e.tier === 'full' ? join(relBatchDir, `${e.slug}.plan.md`) : '',
      complete,
      summary: meta.summary,
      confidence: meta.confidence,
      risks: meta.risks,
      openQuestions: meta.openQuestions,
    };
  });

  const manifest: StagingManifest = { today, batchDir: relBatchDir, entries: drafts };
  writeManifest(absBatchDir, manifest);
  writeFileSync(indexPath(absBatchDir), renderIndex(manifest), 'utf8');

  const completeCount = drafts.filter((d) => d.complete).length;
  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ today, drafted: completeCount, total: drafts.length, batchDir: relBatchDir, index: indexPath(relBatchDir), manifest: manifestPath(relBatchDir), status: Object.fromEntries(spawnStatus) })}\n`,
    );
  } else {
    process.stdout.write(
      `prep fanout: ${completeCount}/${drafts.length} complete. Review ${indexPath(relBatchDir)} and tick approve, then run \`pnpm noldor prep promote\`.\n`,
    );
    for (const d of drafts) {
      if (!d.complete)
        process.stdout.write(
          `  ! ${d.slug}: incomplete (${spawnStatus.get(d.slug) ?? 'no status'})\n`,
        );
    }
  }
  return completeCount > 0 ? 0 : 1;
}

function main(): void {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`prep fanout: ${(err as Error).message}\n`);
      process.exit(1);
    });
}

const invokedDirect = /[\\/]prep-fanout\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();

export { parseArgs, run };
