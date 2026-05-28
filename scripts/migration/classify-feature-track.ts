#!/usr/bin/env tsx
/**
 * Phase 0 classifier entrypoint.
 *
 * Reads (via reused loaders from packages/noldor/src/):
 *   - docs/features/*.md            via loadSddFeatures
 *   - docs/roadmap.md               via parseRoadmap
 *   - docs/backlog.md               via parseBacklog
 *   - docs/superpowers/plans/*.md   filename only (classifyPlanOrSpec)
 *   - docs/superpowers/specs/*.md   filename only (classifyPlanOrSpec)
 *   - ideas.md                      local-only audit, gitignored
 *
 * Emits to `.noldor/classification/` (columnar: `<type>\t<id>` per line):
 *   - framework.txt — all framework entries
 *   - product.txt — all product entries
 *   - ambiguous.txt — needs operator review
 *   - cross-tree-links.txt — findings from auditCrossTreeLinks
 *
 * `<type>` is one of `feature`, `roadmap`, `backlog`, `plan`, `spec`.
 *
 * Idempotency: clobbers the four output files on every run. Safe to re-run
 * BEFORE operator manual review. DO NOT re-run AFTER manual review — clobber
 * will overwrite operator reclassifications. Phase 1 follow-up adds a
 * --apply / --dry-run flag pair plus a content-hash guard.
 *
 * Spec: docs/superpowers/specs/2026-05-28-framework-doc-extraction-design.md § Phase 0.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadSddFeatures } from '../../src/garden/sdd-report.ts';
import { parseBacklog, parseRoadmap } from '../../src/utils/parse-blocks.ts';
import { classifyFeature, classifyPlanOrSpec, type Track } from './classify.ts';
import { auditCrossTreeLinks, type FeatureRecord } from './cross-tree-link-audit.ts';

const OUT_DIR = '.noldor/classification';

interface BucketLine {
  readonly type: 'feature' | 'roadmap' | 'backlog' | 'plan' | 'spec';
  readonly id: string;
}

function formatLine(b: BucketLine): string {
  return `${b.type}\t${b.id}`;
}

async function listMarkdownFilenames(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

function byBucketLine(a: BucketLine, b: BucketLine): number {
  return a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type);
}

async function main(): Promise<void> {
  // ─── Features ────────────────────────────────────────────────────────
  const features = await loadSddFeatures('docs/features');

  const featureTracks = new Map<string, Track>();
  for (const f of features) {
    featureTracks.set(
      f.slug,
      classifyFeature({
        slug: f.slug,
        name: f.frontmatter.name ?? f.slug,
        area: f.frontmatter.area ?? '',
      }),
    );
  }

  const framework: BucketLine[] = [];
  const product: BucketLine[] = [];
  const ambiguous: BucketLine[] = [];

  for (const [slug, track] of featureTracks) {
    const line: BucketLine = { type: 'feature', id: slug };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── Roadmap + backlog (schema-C blocks) ─────────────────────────────
  const roadmapRaw = await readFileOrEmpty('docs/roadmap.md');
  const backlogRaw = await readFileOrEmpty('docs/backlog.md');

  for (const entry of parseRoadmap(roadmapRaw)) {
    const track = classifyFeature({ slug: entry.slug, name: entry.name, area: entry.area });
    const line: BucketLine = { type: 'roadmap', id: entry.slug || entry.name };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }
  for (const entry of parseBacklog(backlogRaw)) {
    const track = classifyFeature({ slug: entry.slug, name: entry.name, area: entry.area });
    const line: BucketLine = { type: 'backlog', id: entry.slug || entry.name };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── Plans + specs (inherit by FD slug embedded in filename) ─────────
  for (const filename of await listMarkdownFilenames('docs/superpowers/plans')) {
    const track = classifyPlanOrSpec({ filename, featureTracks });
    const line: BucketLine = { type: 'plan', id: filename };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }
  for (const filename of await listMarkdownFilenames('docs/superpowers/specs')) {
    const track = classifyPlanOrSpec({ filename, featureTracks });
    const line: BucketLine = { type: 'spec', id: filename };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── ideas.md — gitignored, local-only audit (summary count only) ────
  const ideasRaw = await readFileOrEmpty('ideas.md');
  const ideasBulletCount = ideasRaw.split('\n').filter((l) => /^[-*]\s/.test(l)).length;

  // ─── Cross-tree link audit ───────────────────────────────────────────
  // `loadSddFeatures` returns frontmatter only — re-read each FD here to
  // extract the markdown body for [[slug]] scanning.
  const records: FeatureRecord[] = [];
  for (const f of features) {
    const raw = await readFile(join('docs/features', `${f.slug}.md`), 'utf8');
    records.push({
      slug: f.slug,
      deps: (f.frontmatter.deps ?? []) as readonly string[],
      links: { spec: '', code: [], tests: [] },
      body: matter(raw).content,
    });
  }
  const findings = auditCrossTreeLinks({ featureTracks, features: records });

  // ─── Write outputs ───────────────────────────────────────────────────
  await mkdir(OUT_DIR, { recursive: true });

  await writeFile(
    join(OUT_DIR, 'framework.txt'),
    framework.toSorted(byBucketLine).map(formatLine).join('\n') + '\n',
  );
  await writeFile(
    join(OUT_DIR, 'product.txt'),
    product.toSorted(byBucketLine).map(formatLine).join('\n') + '\n',
  );
  await writeFile(
    join(OUT_DIR, 'ambiguous.txt'),
    ambiguous.toSorted(byBucketLine).map(formatLine).join('\n') + '\n',
  );

  const findingsLines = findings.map(
    (f) => `${f.sourceSlug}\t${f.sourceTrack}\t${f.targetSlug}\t${f.targetTrack}\t${f.field}`,
  );
  await writeFile(
    join(OUT_DIR, 'cross-tree-links.txt'),
    findingsLines.toSorted().join('\n') + '\n',
  );

  // ─── Console summary ─────────────────────────────────────────────────
  console.log(
    `classify-feature-track: framework=${framework.length} product=${product.length} ambiguous=${ambiguous.length} cross_tree=${findings.length}`,
  );
  console.log(
    `ideas.md (gitignored, local audit only): ${ideasBulletCount} bullet(s) detected; split mechanism deferred to Phase 4.`,
  );
  console.log(`Wrote .noldor/classification/{framework,product,ambiguous,cross-tree-links}.txt`);

  if (ambiguous.length > 0) {
    console.log(
      `\nAmbiguous entries (${ambiguous.length}) require manual review. Edit .noldor/classification/ambiguous.txt — move each line to framework.txt or product.txt (preserve the columnar <type>\\t<id> format) — then DO NOT re-run this script.`,
    );
  }
}

main().catch((err) => {
  console.error('classify-feature-track failed:', err);
  process.exit(1);
});
