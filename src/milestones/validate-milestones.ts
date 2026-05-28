import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { milestoneFrontmatterSchema, type Milestone } from './lib.js';

export function validateMilestones(cwd: string = process.cwd()): string[] {
  const errors: string[] = [];
  const milestonesDir = join(cwd, 'docs/milestones');

  // Parse all milestone files with safeParse so invalid files don't throw.
  // Snapshot invariants 1 + 2: name matches filename stem; status is valid enum.
  const all: Milestone[] = [];
  if (existsSync(milestonesDir)) {
    for (const file of readdirSync(milestonesDir).filter((f) => f.endsWith('.md'))) {
      const path = join(milestonesDir, file);
      const slug = basename(file, '.md');
      const raw = readFileSync(path, 'utf8');
      const parsed = matter(raw);
      const result = milestoneFrontmatterSchema.safeParse(parsed.data);
      if (!result.success) {
        errors.push(`${file}: ${result.error.issues.map((i) => i.message).join('; ')}`);
        continue;
      }
      if (result.data.name !== slug) {
        errors.push(`${file}: name "${result.data.name}" does not match filename stem "${slug}"`);
      }
      all.push({ slug, frontmatter: result.data, body: parsed.content });
    }
  }

  // Snapshot invariant 3: at most one active.
  const active = all.filter((m) => m.frontmatter.status === 'active');
  if (active.length > 1) {
    errors.push(
      `multiple active milestones: ${active.map((m) => m.slug).join(', ')} (invariant 3)`,
    );
  }

  // Snapshot invariant 4: vision current-milestone resolves to an active file.
  const visionPath = join(cwd, 'docs/vision.md');
  if (existsSync(visionPath)) {
    const visionParsed = matter(readFileSync(visionPath, 'utf8'));
    const currentSlug = visionParsed.data['current-milestone'] as string | undefined;
    if (currentSlug) {
      const target = all.find((m) => m.slug === currentSlug);
      if (!target) {
        errors.push(
          `vision.md current-milestone "${currentSlug}" not found in docs/milestones (invariant 4)`,
        );
      } else if (target.frontmatter.status !== 'active') {
        errors.push(
          `vision.md current-milestone "${currentSlug}" has status "${target.frontmatter.status}", expected "active" (invariant 4)`,
        );
      }
    }
  }

  return errors;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const errors = validateMilestones();
  if (errors.length === 0) {
    console.log('Validated milestones — all OK.');
    process.exit(0);
  }
  for (const e of errors) console.error(e);
  console.error(`${errors.length} validation error(s).`);
  process.exit(1);
}
