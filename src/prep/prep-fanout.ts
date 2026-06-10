import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';

import { buildDraftPrompt } from './draft.js';
import { discoverPrepEntries, listFdSlugs, listSpecFiles } from './discover.js';
import { renderIndex } from './index-doc.js';
import { spawnClaude, runWithConcurrency } from './spawn.js';
import { batchDirFor, ensureDir, indexPath, manifestPath, writeManifest } from './staging.js';

import type { DraftMeta, FeatureDraft, StagingManifest } from './types.js';

interface FanoutArgs {
  max: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  date?: string;
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') dryRun = true;
    else if (a === '--json') json = true;
    else if (a === '--max') max = intArg(argv[++i], '--max');
    else if (a === '--timeout') timeoutMs = intArg(argv[++i], '--timeout');
    else if (a === '--date') date = argv[++i];
    else throw new Error(`unknown flag: ${a}`);
  }
  return { max, timeoutMs, dryRun, json, ...(date !== undefined ? { date } : {}) };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function run(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cwd = process.cwd();
  const today = parsed.date ?? todayUtc();

  const roadmapRaw = readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
  const entries = discoverPrepEntries(roadmapRaw, listSpecFiles(cwd), listFdSlugs(cwd));

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

  const drafts: FeatureDraft[] = entries.map((e) => {
    const specExists = existsSync(join(absBatchDir, `${e.slug}.spec.md`));
    const metaExists = existsSync(join(absBatchDir, `${e.slug}.meta.json`));
    const planExists = e.tier === 'full' && existsSync(join(absBatchDir, `${e.slug}.plan.md`));
    let meta: DraftMeta = { summary: e.name, confidence: 'low', risks: [], openQuestions: [] };
    if (metaExists) {
      try {
        meta = JSON.parse(
          readFileSync(join(absBatchDir, `${e.slug}.meta.json`), 'utf8'),
        ) as DraftMeta;
      } catch {
        /* keep fallback */
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
