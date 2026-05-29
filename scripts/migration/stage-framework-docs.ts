import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { partitionBlocks } from './partition-blocks.js';

export interface StageOptions {
  cwd: string;
  apply: boolean;
}

export interface MovePlan {
  source: string;
  dest: string;
  kind: 'feature' | 'plan' | 'spec';
}

export interface PartitionPlan {
  source: string;
  frameworkDest: string;
  slugs: string[];
}

export interface StagePlan {
  moves: MovePlan[];
  partitions: PartitionPlan[];
}

const CLASSIFICATION_FILE = '.noldor/classification/framework.txt';

export function stageFrameworkDocs(opts: StageOptions): StagePlan {
  const classPath = join(opts.cwd, CLASSIFICATION_FILE);
  if (!existsSync(classPath)) {
    throw new Error(
      `stageFrameworkDocs: missing ${CLASSIFICATION_FILE}. Run \`pnpm noldor:classify\` first.`,
    );
  }

  const rows = readFileSync(classPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [kind, ident] = l.split('\t');
      return { kind: kind.trim(), ident: ident.trim() };
    });

  const moves: MovePlan[] = [];
  const roadmapSlugs: string[] = [];
  const backlogSlugs: string[] = [];

  for (const row of rows) {
    switch (row.kind) {
      case 'feature':
        moves.push({
          source: `docs/features/${row.ident}.md`,
          dest: `packages/noldor/docs/features/${row.ident}.md`,
          kind: 'feature',
        });
        break;
      case 'plan':
        moves.push({
          source: `docs/superpowers/plans/${row.ident}`,
          dest: `packages/noldor/docs/superpowers/plans/${row.ident}`,
          kind: 'plan',
        });
        break;
      case 'spec':
        moves.push({
          source: `docs/superpowers/specs/${row.ident}`,
          dest: `packages/noldor/docs/superpowers/specs/${row.ident}`,
          kind: 'spec',
        });
        break;
      case 'roadmap':
        roadmapSlugs.push(row.ident);
        break;
      case 'backlog':
        backlogSlugs.push(row.ident);
        break;
      default:
        throw new Error(`stageFrameworkDocs: unknown classification kind '${row.kind}'`);
    }
  }

  const partitions: PartitionPlan[] = [];
  if (roadmapSlugs.length > 0) {
    partitions.push({
      source: 'docs/roadmap.md',
      frameworkDest: 'packages/noldor/docs/roadmap.md',
      slugs: roadmapSlugs,
    });
  }
  if (backlogSlugs.length > 0) {
    partitions.push({
      source: 'docs/backlog.md',
      frameworkDest: 'packages/noldor/docs/backlog.md',
      slugs: backlogSlugs,
    });
  }

  if (!opts.apply) {
    console.log('=== Dry run ===');
    for (const m of moves) console.log(`mv  ${m.source} -> ${m.dest}`);
    for (const p of partitions)
      console.log(`split ${p.source} -> ${p.frameworkDest} (${p.slugs.length} slugs)`);
    console.log(`(${moves.length} files, ${partitions.length} partitions)`);
    return { moves, partitions };
  }

  for (const m of moves) {
    const src = join(opts.cwd, m.source);
    if (!existsSync(src)) {
      console.warn(`skip: source missing: ${m.source}`);
      continue;
    }
    execSync(`git mv "${m.source}" "${m.dest}"`, { cwd: opts.cwd });
  }

  for (const p of partitions) {
    const src = join(opts.cwd, p.source);
    const body = readFileSync(src, 'utf8');
    const slugSet = new Set(p.slugs);
    const { framework, product } = partitionBlocks(body, slugSet);
    if (framework.length === 0) continue;

    const headerLine = body.match(/^# .+/)?.[0] ?? '# Framework';
    const frameworkBody = `${headerLine}\n\n${framework}\n`;
    writeFileSync(join(opts.cwd, p.frameworkDest), frameworkBody);
    writeFileSync(src, product);
    execSync(`git add "${p.source}" "${p.frameworkDest}"`, { cwd: opts.cwd });
  }

  return { moves, partitions };
}

// CLI entrypoint
if (process.argv[1]?.endsWith('stage-framework-docs.ts')) {
  const apply = process.argv.includes('--apply');
  stageFrameworkDocs({ cwd: process.cwd(), apply });
}
