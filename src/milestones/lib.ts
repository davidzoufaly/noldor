import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';

export const milestoneStatusSchema = z.enum(['draft', 'active', 'shipped']);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

export const milestoneFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    status: milestoneStatusSchema,
    description: z.string().min(1).optional(),
  })
  .strict();

export type MilestoneFrontmatter = z.infer<typeof milestoneFrontmatterSchema>;

export interface Milestone {
  slug: string;
  frontmatter: MilestoneFrontmatter;
  body: string;
}

const MILESTONES_DIR = 'docs/milestones';

/** Serialize a milestone file through gray-matter's YAML engine — the same
 *  serializer/parser pair every other frontmatter writer uses. Hand-rolled
 *  scalar quoting missed YAML implicit types (booleans, null, numbers, dates)
 *  and control characters, so values like `true` or a string containing a
 *  newline wrote frontmatter that read back as the wrong type or injected
 *  extra keys. */
function stringifyMilestone(body: string, fm: MilestoneFrontmatter): string {
  const data: Record<string, string> = { name: fm.name, status: fm.status };
  if (fm.description) data.description = fm.description;
  return matter.stringify(body, data);
}

/** Parse a milestone markdown file at `absPath` into a `Milestone`. */
export function readMilestone(absPath: string): Milestone {
  const raw = readFileSync(absPath, 'utf8');
  const parsed = matter(raw);
  const frontmatter = milestoneFrontmatterSchema.parse(parsed.data);
  const slug = basename(absPath, '.md');
  return { slug, frontmatter, body: parsed.content };
}

/** Load all milestones from `<cwd>/docs/milestones/`. */
export function loadMilestones(cwd: string = process.cwd()): Milestone[] {
  const dir = join(cwd, MILESTONES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readMilestone(join(dir, f)));
}

/** Load a single milestone by slug, or `null` if not found. */
export function loadMilestoneBySlug(slug: string, cwd: string = process.cwd()): Milestone | null {
  const path = join(cwd, MILESTONES_DIR, `${slug}.md`);
  if (!existsSync(path)) return null;
  return readMilestone(path);
}

/** Create a new draft milestone file at `<cwd>/docs/milestones/<slug>.md`. */
export function draftMilestone(
  slug: string,
  description: string | undefined,
  cwd: string = process.cwd(),
): void {
  const dir = join(cwd, MILESTONES_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.md`);
  if (existsSync(path)) {
    throw new Error(`Milestone "${slug}" already exists at ${path}`);
  }
  const body = `\n## Gate\n\n<!-- TODO: paragraph describing the strategic gate -->\n\n## Success Criteria\n\n<!-- TODO: bulleted list of measurable ship conditions -->\n\n## Out of Scope\n\n<!-- TODO: deliberate exclusions -->\n`;
  const fm: MilestoneFrontmatter = { name: slug, status: 'draft' };
  if (description) fm.description = description;
  writeFileSync(path, stringifyMilestone(body, fm), 'utf8');
}

// ---------------------------------------------------------------------------
// activateMilestone — atomicity-critical: all preflight checks run before any
// write touches the filesystem.
// ---------------------------------------------------------------------------

interface PreflightResult {
  target: Milestone;
  previousActive: Milestone | null;
  visionRaw: string;
}

function preflightActivate(slug: string, cwd: string): PreflightResult {
  const milestonesDir = join(cwd, MILESTONES_DIR);
  if (!existsSync(milestonesDir)) {
    throw new Error(`docs/milestones directory not found at ${milestonesDir}`);
  }
  const targetPath = join(milestonesDir, `${slug}.md`);
  if (!existsSync(targetPath)) {
    throw new Error(`Milestone "${slug}" not found at ${targetPath}`);
  }
  const target = readMilestone(targetPath);
  if (target.frontmatter.status === 'shipped') {
    throw new Error(`Cannot activate "${slug}": shipped is terminal.`);
  }

  const visionPath = join(cwd, 'docs/vision.md');
  if (!existsSync(visionPath)) {
    throw new Error(`docs/vision.md not found at ${visionPath}`);
  }
  const visionRaw = readFileSync(visionPath, 'utf8');

  const allMilestones = loadMilestones(cwd);
  const activeFiles = allMilestones.filter((m) => m.frontmatter.status === 'active');
  if (activeFiles.length > 1) {
    throw new Error(
      `Refusing to operate: multiple active milestones detected (${activeFiles.map((m) => m.slug).join(', ')}). Run pnpm validate:milestones to inspect.`,
    );
  }
  const previousActive = activeFiles[0] ?? null;
  return { target, previousActive, visionRaw };
}

function setFrontmatterField(raw: string, key: string, value: string): string {
  // Match both non-empty frontmatter (`---\n<body>\n---`) and empty (`---\n---`)
  const fmRe = /^---\n([\s\S]*?)\n?---/;
  const m = fmRe.exec(raw);
  if (!m) throw new Error(`No frontmatter found`);
  const body = m[1];
  const lines = body.length > 0 ? body.split('\n').filter((l) => l !== '') : [];
  const keyRe = new RegExp(`^${key}:`);
  let found = false;
  const updated = lines.map((line) => {
    if (keyRe.test(line)) {
      found = true;
      return `${key}: ${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}: ${value}`);
  return raw.replace(fmRe, `---\n${updated.join('\n')}\n---`);
}

function serializeMilestone(m: Milestone, statusOverride?: MilestoneStatus): string {
  return stringifyMilestone(m.body, {
    ...m.frontmatter,
    status: statusOverride ?? m.frontmatter.status,
  });
}

/** Atomically promote `slug` to active, ship the previous active (if any), and
 *  update `docs/vision.md`'s `current-milestone` field. All preflight checks
 *  run before any file is written. */
export function activateMilestone(slug: string, cwd: string = process.cwd()): void {
  const { target, previousActive, visionRaw } = preflightActivate(slug, cwd);

  if (target.frontmatter.status === 'active') {
    return;
  }

  const targetWritten = serializeMilestone(target, 'active');
  const previousWritten = previousActive ? serializeMilestone(previousActive, 'shipped') : null;
  const visionUpdated = setFrontmatterField(visionRaw, 'current-milestone', slug);

  writeFileSync(join(cwd, MILESTONES_DIR, `${slug}.md`), targetWritten, 'utf8');
  writeFileSync(join(cwd, 'docs/vision.md'), visionUpdated, 'utf8');
  if (previousActive && previousWritten) {
    writeFileSync(join(cwd, MILESTONES_DIR, `${previousActive.slug}.md`), previousWritten, 'utf8');
  }
}

export interface ListResult {
  active: Milestone[];
  draft: Milestone[];
  shipped: Milestone[];
}

export function listMilestones(cwd: string = process.cwd()): ListResult {
  const all = loadMilestones(cwd);
  return {
    active: all.filter((m) => m.frontmatter.status === 'active'),
    draft: all.filter((m) => m.frontmatter.status === 'draft'),
    shipped: all.filter((m) => m.frontmatter.status === 'shipped'),
  };
}
