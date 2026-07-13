import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';
import { promisify } from 'node:util';

import matter from 'gray-matter';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { z } from 'zod';

import { escapeHtml } from './layout.js';
import { FeatureFrontmatterSchema } from '../core/feature-schema.js';
import { loadCategories, loadConsumerConfig } from '../core/consumer-config.js';
import { areaToCategory } from '../lib/area-category.js';
import { loadMilestoneBySlug, loadMilestones, type Milestone } from '../milestones/lib.js';
import { parseBacklog, parseRoadmap as parseRoadmapBlocks } from '../utils/parse-blocks.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { actualPackageNames, scanRoots } from '../core/repo-paths.js';
import { collectGaps } from '../garden/sdd-report.js';
import { listPlans, listSpecs, loadSddFeatures, readTextFiles, walkRepo } from '../core/fd-load.js';
import { commitsForFeature } from '../release/release-fd-commits.js';
import { prsSinceLastTag, type PrRef } from '../release/fd-prs-since-tag.js';
import { getRepoUrl } from '../release/release-version.js';
import {
  computeWarnings,
  describeWarning,
  gatherStats,
  parseWorktreeList,
  readPort,
} from '../worktrees/worktree-status.js';
import { loadPark, readInboxRows, type InboxRow } from '../autonomous/escalations.js';
import { WATCH_LOG_REL } from '../autonomous/watch-detach.js';

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);

marked.use({
  walkTokens(token) {
    if (token.type !== 'html') return;
    const htmlToken = token as { raw: string; text?: string };
    const raw = htmlToken.raw.trim().startsWith('<!--') ? '' : escapeHtml(htmlToken.raw);
    htmlToken.raw = raw;
    htmlToken.text = raw;
  },
});

import type { BacklogEntry } from '../utils/parse-blocks.js';
import type { MetricsReport } from '../metrics/types.js';
import type { ReportInput } from '../garden/sdd-report.js';
import type { FeatureRecord as SddFeatureRecord, Gap } from '../core/fd-load.js';
import type { FeatureCommit } from '../release/release-fd-commits.js';
import type { Warning } from '../worktrees/worktree-status.js';
import type { AgentEvent } from '../core/agent-events.js';
import type { DrainState } from '../autonomous/drain-state.js';

const execFileAsync = promisify(execFile);

let docRootsOverride: string | undefined;

export function setDocRootsOverride(path: string | undefined): void {
  docRootsOverride = path;
}

export function getDocRoot(): string {
  return docRootsOverride ?? process.cwd();
}

export function getRoadmapPath(): string {
  return loadDocRoots(getDocRoot()).roadmap;
}
export function getBacklogPath(): string {
  return loadDocRoots(getDocRoot()).backlog;
}
export function getVisionPath(): string {
  return loadDocRoots(getDocRoot()).vision;
}
export function getReleaseNotesPath(): string {
  // not in DocRoots; build manually
  return join(getDocRoot(), 'docs', 'release-notes.md');
}
export function getFeaturesDir(): string {
  return loadDocRoots(getDocRoot()).features;
}
export function getSkillsDir(): string {
  // not under docs/; keep cwd-relative but use override-aware root
  return join(getDocRoot(), '.claude', 'skills');
}
export function getScriptsDir(): string {
  return join(getDocRoot(), 'scripts');
}
export function getNoldorDir(): string {
  return join(getDocRoot(), 'docs', 'noldor');
}

// Reading-flow order from docs/noldor/README.md route table.
// Pages with a `noldor-page` frontmatter slug not listed here fall
// back to alphabetical order at the tail.
const FRAMEWORK_PAGE_ORDER = [
  'lifecycle',
  'complexity-gating',
  'feature-md-schema',
  'worktree-discipline',
  'git-and-commits',
  'workflow',
  'doc-conventions',
  'triage',
  'testing-principles',
  'versioning',
  'skill-catalog',
  'script-catalog',
  'garden-and-drift',
  'graph-integration',
  'adoption-guide',
  'engineering-principles',
];

const EXCLUDE_PATTERNS: RegExp[] = [
  /^pnpm-lock\.yaml$/,
  /^graphify-out\//,
  /^docs\/sdd-report\.md$/,
  /^docs\/user\/reference\/api\//,
  /\.original\.md$/,
];

export type FeatureRecord = SddFeatureRecord & { bodyMarkdown: string };

/**
 * Per-feature live changelog: commits since the last tag (Unreleased) plus
 * a per-version commit list bucketed by tag pair. Computed live by
 * {@link loadFdChangelog} from `git log` filtered by `<area>:<slug>` scope.
 */
export interface FdChangelog {
  unreleased: FeatureCommit[];
  /**
   * Map keyed by version string (without leading `v`). Insertion order
   * matches tag creatordate ascending — oldest first.
   */
  perVersion: Map<string, FeatureCommit[]>;
}

export type FeatureDetail = FeatureRecord & { bodyHtml: string; changelog: FdChangelog };

const HTML_ENTITY_DECODES: Array<[RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  // `&amp;` MUST run last — decoding it earlier would re-introduce live `&`
  // characters into the other entity sequences (e.g. `&amp;gt;` → `&gt;` →
  // `>`), corrupting literal `&amp;` text in the source.
  [/&amp;/g, '&'],
];

function decodeHtmlEntities(s: string): string {
  let out = s;
  for (const [pattern, replacement] of HTML_ENTITY_DECODES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Render markdown to HTML via marked + markedHighlight, then post-process
 * fenced ```mermaid blocks: swap the `<pre><code class="hljs language-mermaid">…</code></pre>`
 * shell for `<div class="mermaid">…</div>` with the source HTML-decoded
 * so mermaid.js can parse the raw flowchart syntax client-side.
 *
 * @param markdown - Source markdown
 * @returns Rendered HTML with mermaid fences swapped to mermaid containers
 */
function renderToHtml(markdown: string): string {
  const html = marked.parse(markdown, { gfm: true, breaks: false }) as string;
  return html.replace(
    /<pre><code class="hljs language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_match, encoded: string) => `<div class="mermaid">${decodeHtmlEntities(encoded)}</div>`,
  );
}

// Structural block: `## PRs` heading + blank line + HTML-comment marker + trailing newline,
// followed by end-of-string or another blank line (ensuring the marker line is the last
// line in the block, not immediately followed by prose). A regex is the right tool here
// because the match is genuinely multi-line and line-anchored — `^## PRs\n\n<!--...-->\n`
// followed by `(?:\n|$)` — and the HTML-comment whitespace tolerance (`\s*`) cannot be
// expressed with plain string methods.
const PR_BLOCK_PATTERN = /^## PRs\n\n<!--\s*@prs-since-last-release:\s*[\w-]+\s*-->\n(?=\n|$)/m;

// Bare marker (no surrounding heading). Used when the structural block
// pattern doesn't match — author placed the marker outside the canonical
// scaffolded shape. A regex is correct here because we need to capture the
// slug group AND tolerate arbitrary whitespace inside the HTML comment.
const PR_BARE_MARKER_PATTERN = /<!--\s*@prs-since-last-release:\s*([\w-]+)\s*-->/g;

function renderPrSection(refs: PrRef[]): string {
  if (refs.length === 0) return '';
  return `## PRs\n\n${refs.map((r) => `- #${r.number}: ${r.title} ([link](${r.url}))`).join('\n')}\n`;
}

/**
 * Render markdown to HTML. Expands `<!-- @prs-since-last-release: <slug> -->`
 * markers by calling {@link prsSinceLastTag} and substituting the canonical
 * `## PRs` + marker block with a live bullet list (or stripping the block
 * when 0 PRs are returned).
 *
 * Sync fast-path: when no marker is present the function returns immediately
 * without any async work.
 *
 * @param markdown - Source markdown (FD body or any document markdown)
 * @returns Rendered HTML with mermaid fences swapped and PR markers expanded
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  // Sync fast-path — no marker present, skip all async work.
  if (!markdown.includes('<!-- @prs-since-last-release:')) {
    return renderToHtml(markdown);
  }

  // Extract slug from the first marker (single marker per FD, spec §1.5).
  // Non-global regex so the capture group extracts the slug directly.
  const slugMatch = markdown.match(/<!--\s*@prs-since-last-release:\s*([\w-]+)\s*-->/);
  const slug = slugMatch?.[1];
  if (!slug) return renderToHtml(markdown);

  const cwd = process.cwd();
  const repoUrl = await getRepoUrl();
  const refs = await prsSinceLastTag(slug, cwd, repoUrl);

  // Try structural strip/replace first (heading + blank + marker block).
  let processed: string;
  if (PR_BLOCK_PATTERN.test(markdown)) {
    processed = markdown.replace(PR_BLOCK_PATTERN, renderPrSection(refs));
  } else {
    // Free-floating marker: replace bare marker with bullets only.
    const bullets =
      refs.length > 0
        ? refs.map((r) => `- #${r.number}: ${r.title} ([link](${r.url}))`).join('\n')
        : '';
    processed = markdown.replace(PR_BARE_MARKER_PATTERN, bullets);
  }

  return renderToHtml(processed);
}

export const roadmapEntrySchema = z
  .object({
    name: z.string().min(1),
    // Empty slug is allowed at the data layer for all-punctuation headings
    // (parse-blocks warns + emits `''`); the HTTP write layer rejects empty
    // slugs with 400 so callers don't need a separate skip path.
    slug: z.string().regex(/^[a-z0-9-]*$/),
    area: z.string().min(1),
    type: z.string().optional(),
    since: z.string().optional(),
    category: z.string().optional(),
    size: z.string().optional(),
    impact: z.string().optional(),
    body: z.string(),
  })
  .strict();

export type RoadmapEntry = z.infer<typeof roadmapEntrySchema>;

export const roadmapSchema = z.array(roadmapEntrySchema);

export type Roadmap = z.infer<typeof roadmapSchema>;

/**
 * Parse roadmap entries from raw markdown text. Pure — no I/O. Used by tests
 * and by the path-bound {@link parseRoadmap} below which reads
 * `docs/roadmap.md`.
 */
export function parseRoadmapFromString(raw: string): Roadmap {
  const blocks = parseRoadmapBlocks(raw);
  const entries: RoadmapEntry[] = blocks.map((block) => {
    const entry: RoadmapEntry = {
      name: block.name,
      slug: block.slug,
      area: block.area,
      body: block.description,
    };
    if (block.type !== undefined) entry.type = block.type;
    if (block.since !== undefined) entry.since = block.since;
    if (block.category !== undefined) entry.category = block.category;
    if (block.size !== undefined) entry.size = block.size;
    if (block.impact !== undefined) entry.impact = block.impact;
    return entry;
  });
  return roadmapSchema.parse(entries);
}

export async function parseRoadmap(): Promise<Roadmap> {
  const { entries } = await loadRoadmapWithHash();
  return entries;
}

/**
 * Roadmap entries plus the SHA-256 hex digest of the raw file bytes. The
 * `rawHash` is the ETag value served on `GET /roadmap` and the
 * `If-Match` value the write API requires for `/api/blocks/move`. Using
 * the raw bytes (not the parsed shape) means hash equality implies
 * byte-identical source — any concurrent reformatting / write invalidates
 * cached etags exactly when it changes the file.
 */
export interface LoadedRoadmap {
  entries: Roadmap;
  rawHash: string;
}

/**
 * Backlog entries plus the SHA-256 hex digest of the raw file bytes.
 * Mirror of {@link LoadedRoadmap}; same etag semantics.
 */
export interface LoadedBacklog {
  entries: BacklogEntry[];
  rawHash: string;
}

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Read `docs/roadmap.md`, parse entries, and return both the parsed
 * entries and the SHA-256 hex of the raw file bytes. Callers that
 * only need the entries can keep using {@link parseRoadmap}; the
 * dashboard's drag-and-drop write path needs the hash for ETag /
 * If-Match precondition checks.
 */
export async function loadRoadmapWithHash(): Promise<LoadedRoadmap> {
  const raw = await readFile(getRoadmapPath(), 'utf8');
  return { entries: parseRoadmapFromString(raw), rawHash: sha256Hex(raw) };
}

/**
 * Parse backlog entries from raw markdown text, then stamp a user-facing
 * release-notes `category` on each entry by mapping `area` via the shared
 * {@link areaToCategory} helper. The backlog source has no `- category:`
 * bullet, so the dashboard derives one for the `/backlog` Category column
 * and filter. Existing `category` values (e.g. inherited from a nested H4
 * container) are preserved.
 *
 * Pure — no I/O. Used by tests and by {@link loadBacklogWithHash}.
 *
 * @param raw - Raw `docs/backlog.md` contents (or any compatible markdown)
 * @returns Parsed backlog entries with `category` stamped
 */
export function parseBacklogFromString(raw: string): BacklogEntry[] {
  const entries = parseBacklog(raw);
  for (const entry of entries) {
    if (entry.category === undefined) {
      entry.category = areaToCategory(entry.area);
    }
  }
  return entries;
}

/**
 * Read `docs/backlog.md`, parse entries, and return both the parsed
 * entries and the SHA-256 hex of the raw file bytes. Backlog file may
 * be absent in fresh repos — when missing, returns `{ entries: [],
 * rawHash: sha256('') }` so callers can still compute a combined etag.
 */
export async function loadBacklogWithHash(): Promise<LoadedBacklog> {
  const raw = await readFile(getBacklogPath(), 'utf8').catch(() => '');
  return { entries: parseBacklogFromString(raw), rawHash: sha256Hex(raw) };
}

/**
 * Load every feature MD, validate frontmatter, return slug + frontmatter + raw body.
 *
 * @returns Array of feature records sorted by slug
 */
export async function loadFeatures(): Promise<FeatureRecord[]> {
  const featuresDir = getFeaturesDir();
  const entries = await readdir(featuresDir);
  const mdFiles = entries.filter((e) => e.endsWith('.md'));
  const records = await Promise.all(
    mdFiles.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = await readFile(join(featuresDir, file), 'utf8');
      const parsed = matter(raw);
      const frontmatter = FeatureFrontmatterSchema.parse(parsed.data);
      return { slug, frontmatter, bodyMarkdown: parsed.content };
    }),
  );
  records.sort((a, b) => a.slug.localeCompare(b.slug));
  return records;
}

/**
 * Parse `git log --format=%cI --name-only` output into a slug → last-commit
 * date map. The log arrives newest-first, so the first occurrence of each
 * feature MD path wins. Non-`.md` paths are ignored.
 */
export function parseFeatureLastCommitDates(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  let current = '';
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      current = line;
      continue;
    }
    if (!current || !line.endsWith('.md')) continue;
    const slug = posix.basename(line, '.md');
    if (!map.has(slug)) map.set(slug, current);
  }
  return map;
}

/**
 * Resolve each feature MD's last git commit date (`%cI`) in a single
 * `git log` pass over the features dir. Features never committed (fresh,
 * untracked files) are absent from the map.
 *
 * @returns Map of feature slug → ISO-8601 committer date
 */
export async function loadFeatureGitTimestamps(): Promise<Map<string, string>> {
  const { stdout } = await execFileAsync(
    'git',
    ['log', '--format=%cI', '--name-only', '--', getFeaturesDir()],
    { cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 },
  );
  return parseFeatureLastCommitDates(stdout);
}

const CHANGELOG_HEADING = '## Changelog';

async function listVersionTags(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['tag', '--list', 'v*', '--sort=creatordate'], {
    cwd,
  });
  return stdout.split('\n').filter(Boolean);
}

/**
 * Walk every `v*` tag (creatordate ascending) and bucket commits whose
 * scope matches `<area>:<slug>` into per-version arrays plus an
 * `unreleased` array for everything since the most recent tag. The first
 * tag's bucket uses `''` (repo-start) as `fromRef` so commits reachable
 * from that tag are included without leaking commits from later versions.
 *
 * @param slug - feature slug
 * @param cwd - repository root (defaults to `process.cwd()`); accepts a fixture path for tests
 */
export async function loadFdChangelog(
  slug: string,
  cwd: string = process.cwd(),
): Promise<FdChangelog> {
  const tags = await listVersionTags(cwd);
  const perVersion = new Map<string, FeatureCommit[]>();
  for (let i = 0; i < tags.length; i++) {
    const fromRef = i === 0 ? '' : tags[i - 1];
    const toRef = tags[i];
    const commits = await commitsForFeature(slug, fromRef, toRef, cwd);
    perVersion.set(toRef.replace(/^v/, ''), commits);
  }
  const lastTag = tags.at(-1) ?? '';
  const unreleased =
    lastTag !== ''
      ? await commitsForFeature(slug, lastTag, 'HEAD', cwd)
      : await commitsForFeature(slug, '', 'HEAD', cwd);
  return { unreleased, perVersion };
}

/**
 * Merge a live {@link FdChangelog} into an FD body's `## Changelog`
 * section. Returns the full body markdown with:
 *
 * - `### Unreleased > #### Commits` prepended (when `unreleased.length > 0`).
 * - `#### Commits` appended under each existing static `### <version>` whose
 *   live commit list is non-empty.
 * - Synthesized `### <version>` blocks (with `_(no summary on file)_`
 *   placeholder) for versions that have live commits but no static block.
 * - Static `### <version>` blocks with no live commits left untouched.
 * - Any pre-existing `### Unreleased` block in the static body dropped
 *   (defensive — the dashboard owns Unreleased now).
 *
 * Empty changelog (no commits anywhere) returns the body unchanged.
 *
 * @param body - FD body markdown (no frontmatter)
 * @param changelog - Live changelog from {@link loadFdChangelog}
 * @param repoUrl - Repo URL prefix for commit anchors (e.g. https://github.com/foo/bar)
 */
export function mergeChangelogIntoBody(
  body: string,
  changelog: FdChangelog,
  repoUrl: string,
): string {
  if (changelog.unreleased.length === 0 && changelog.perVersion.size === 0) {
    return body;
  }

  // Line-anchored match so inline markdown references like
  // `"per-version `## Changelog` > ### <version>"` inside prose don't
  // confuse the locator.
  const headingMatch = body.match(/^## Changelog\s*$/m);
  let head: string;
  let staticSection: string;
  if (!headingMatch || headingMatch.index === undefined) {
    const trimmed = body.replace(/\s+$/, '');
    head =
      trimmed.length > 0 ? `${trimmed}\n\n${CHANGELOG_HEADING}\n\n` : `${CHANGELOG_HEADING}\n\n`;
    staticSection = '';
  } else {
    const headingEnd = headingMatch.index + headingMatch[0].length;
    head = body.slice(0, headingEnd) + '\n\n';
    staticSection = body.slice(headingEnd).replace(/^\n+/, '');
    // Defensive: if another `## ` heading follows the changelog, only
    // operate on the slice up to it. Current FDs put Changelog last.
    const nextH2 = staticSection.match(/^## /m);
    if (nextH2 && nextH2.index !== undefined) {
      staticSection = staticSection.slice(0, nextH2.index);
    }
  }

  const staticBlocks = parseStaticVersionBlocks(staticSection);

  const out: string[] = [];
  if (changelog.unreleased.length > 0) {
    out.push(renderUnreleasedBlock(changelog.unreleased, repoUrl));
  }
  const renderedVersions = new Set<string>();
  // Newest tag first → reverse insertion order.
  const versionsNewestFirst = [...changelog.perVersion.keys()].toReversed();
  for (const version of versionsNewestFirst) {
    const commits = changelog.perVersion.get(version) ?? [];
    const staticBody = staticBlocks.byVersion.get(version);
    out.push(renderVersionBlock(version, staticBody, commits, repoUrl));
    renderedVersions.add(version);
  }
  // Legacy-only versions present in static but not in perVersion (e.g.
  // tag deleted). Preserve as-is. `Unreleased` is dropped — dashboard owns it.
  for (const version of staticBlocks.versionOrder) {
    if (renderedVersions.has(version) || version === 'Unreleased') continue;
    const staticBody = staticBlocks.byVersion.get(version) ?? '';
    out.push(`### ${version}\n\n${staticBody}`.replace(/\n+$/, '') + '\n');
  }
  return head + out.join('\n').replace(/\n+$/, '') + '\n';
}

function parseStaticVersionBlocks(section: string): {
  byVersion: Map<string, string>;
  versionOrder: string[];
} {
  const byVersion = new Map<string, string>();
  const versionOrder: string[] = [];
  if (section.trim().length === 0) return { byVersion, versionOrder };
  const parts = section.split(/(?=^### )/m).filter((p) => p.trim().length > 0);
  for (const part of parts) {
    const m = /^### (.+?)\s*$/m.exec(part);
    if (!m) continue;
    const heading = m[1].trim();
    const version = heading.replace(/^v/, '');
    const lineEnd = part.indexOf('\n');
    const content = lineEnd === -1 ? '' : part.slice(lineEnd + 1).replace(/\n+$/, '');
    byVersion.set(version, content);
    versionOrder.push(version);
  }
  return { byVersion, versionOrder };
}

function renderUnreleasedBlock(commits: FeatureCommit[], repoUrl: string): string {
  return `### Unreleased\n\n#### Commits\n\n${renderCommitList(commits, repoUrl)}\n`;
}

function renderVersionBlock(
  version: string,
  staticBody: string | undefined,
  commits: FeatureCommit[],
  repoUrl: string,
): string {
  const heading = `### ${version}`;
  const summaryBody =
    staticBody && staticBody.trim().length > 0 ? staticBody : '_(no summary on file)_';
  if (commits.length === 0) {
    return `${heading}\n\n${summaryBody}`.replace(/\n+$/, '') + '\n';
  }
  return (
    `${heading}\n\n${summaryBody}\n\n#### Commits\n\n${renderCommitList(commits, repoUrl)}`.replace(
      /\n+$/,
      '',
    ) + '\n'
  );
}

function renderCommitList(commits: FeatureCommit[], repoUrl: string): string {
  return commits
    .map((c) => `- ${c.type}: ${c.subject} ([${c.sha}](${repoUrl}/commit/${c.sha}))`)
    .join('\n');
}

/**
 * Load a single feature MD, merge in the live per-version + Unreleased
 * changelog, and render the result to HTML.
 *
 * @param slug - kebab-case slug matching the filename stem
 * @returns Feature detail with rendered HTML and live changelog, or null if no matching file
 */
export async function loadFeatureDetail(slug: string): Promise<FeatureDetail | null> {
  const features = await loadFeatures();
  const match = features.find((f) => f.slug === slug);
  if (!match) return null;
  const changelog = await loadFdChangelog(slug);
  const repoUrl = await getRepoUrl();
  const mergedBody = mergeChangelogIntoBody(match.bodyMarkdown, changelog, repoUrl);
  const rendered = await renderMarkdown(mergedBody);
  const bodyHtml = rewriteRelativeLinksToVscode(rendered, process.cwd());
  return { ...match, bodyHtml, changelog };
}

/**
 * Rewrite `<a href="../../<path>">` anchors (as emitted by FD body
 * Resources blocks) to `vscode://file/<repoRoot>/<path>` so clicks from
 * the local dashboard open files directly in VSCode. External absolute
 * URLs (github commit links etc.) are untouched.
 *
 * @param html - Marked-rendered HTML
 * @param repoRoot - Absolute path to the repo root (typically `process.cwd()`)
 * @returns HTML with relative-path anchors swapped to vscode:// URLs
 */
export function rewriteRelativeLinksToVscode(html: string, repoRoot: string): string {
  return html.replace(
    /<a href="\.\.\/\.\.\/([^"]+)"/g,
    (_match, path: string) => `<a href="vscode://file${repoRoot}/${path}" rel="noopener"`,
  );
}

/**
 * Rewrite relative markdown-doc links in rendered HTML to dashboard
 * routes. Resolves the `href` value relative to `sourceDir` (a
 * repo-rooted path like `docs/noldor` or `docs/user/tutorials`),
 * then maps the resolved path against the dashboard's known corpora:
 *
 * - `docs/noldor/<slug>.md` → `/framework/<slug>`
 * - `docs/user/<category>/<slug>.md` → `/docs/<category>/<slug>`
 * - `docs/features/<slug>.md` → `/features/<slug>`
 *
 * Anchor-only links (`#section`) and absolute external `https?://`
 * links pass through. Markdown links to files outside the surfaced
 * corpora (e.g. `docs/backlog.md`, `README.md`) are left as-is.
 *
 * @param html - Marked-rendered HTML
 * @param sourceDir - Repo-rooted directory of the source markdown
 * @returns HTML with applicable `.md` anchors rewritten
 */
export function rewriteDocLinks(html: string, sourceDir: string): string {
  return html.replace(
    /<a\s+href="([^"#]+\.md)(#[^"]*)?"/g,
    (full, path: string, hash: string | undefined) => {
      const tail = hash ?? '';
      // Rewrite absolute GitHub `blob/<ref>/docs/features/<slug>.md` URLs to
      // `/features/<slug>` BEFORE the generic external short-circuit. The
      // release script emits these into `docs/release-notes.md` as "Feature
      // page" links; on the dashboard we want them to land on the internal
      // FD drill-down instead of bouncing out to GitHub.
      const ghMatch =
        /^https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/docs\/features\/(.+)\.md$/.exec(path);
      if (ghMatch) return `<a href="/features/${ghMatch[1]}${tail}"`;
      if (/^https?:\/\//.test(path)) return full;
      const resolved = posix.normalize(posix.join(sourceDir, path));
      const fwMatch = /^docs\/noldor\/(.+)\.md$/.exec(resolved);
      if (fwMatch) return `<a href="/framework/${fwMatch[1]}${tail}"`;
      const userMatch = /^docs\/user\/(tutorials|how-to|reference|explanation)\/(.+)\.md$/.exec(
        resolved,
      );
      if (userMatch) return `<a href="/docs/${userMatch[1]}/${userMatch[2]}${tail}"`;
      const fdMatch = /^docs\/features\/(.+)\.md$/.exec(resolved);
      if (fdMatch) return `<a href="/features/${fdMatch[1]}${tail}"`;
      return full;
    },
  );
}

export const visionFrontmatterSchema = z
  .object({
    'current-milestone': z.string().min(1).optional(),
  })
  .strict();

export type VisionFrontmatter = z.infer<typeof visionFrontmatterSchema>;

export interface Vision {
  frontmatter: VisionFrontmatter;
  bodyHtml: string;
}

/**
 * Read docs/vision.md, validate frontmatter, render body to HTML.
 *
 * @returns Vision frontmatter + rendered HTML body
 */
export async function loadVision(): Promise<Vision> {
  const raw = await readFile(getVisionPath(), 'utf8');
  const parsed = matter(raw);
  const frontmatter = visionFrontmatterSchema.parse(parsed.data);
  const bodyHtml = await renderMarkdown(parsed.content);
  return { frontmatter, bodyHtml };
}

export interface ActiveMilestonePayload {
  slug: string;
  name: string;
  description: string | null;
  bodyHtml: string;
}

export async function loadActiveMilestone(vision: Vision): Promise<ActiveMilestonePayload | null> {
  const slug = vision.frontmatter['current-milestone'];
  if (!slug) return null;
  const m = loadMilestoneBySlug(slug);
  if (!m) return null;
  return {
    slug: m.slug,
    name: m.frontmatter.name,
    description: m.frontmatter.description ?? null,
    bodyHtml: await renderMarkdown(m.body),
  };
}

/** One milestone plus its member features + a phase roll-up, for the /milestones page. */
export interface MilestoneGroup {
  slug: string;
  name: string;
  status: 'draft' | 'active' | 'shipped';
  description: string | null;
  members: FeatureRecord[];
  doneCount: number;
  total: number;
  /** True when status is `shipped` but at least one member is not `done` (warn row). */
  incomplete: boolean;
}

/**
 * Group features under their declared `milestone` slug and compute a per-milestone
 * phase roll-up. Pure (milestones + features injected) so the grouping is unit-
 * testable. Members are matched by `frontmatter.milestone === milestone.slug`;
 * features with no milestone (or one with no matching declared milestone) are
 * omitted. Order: active → draft → shipped, then by name within each status.
 */
export function buildMilestoneGroups(
  milestones: readonly Milestone[],
  features: readonly FeatureRecord[],
): MilestoneGroup[] {
  const statusOrder: Record<MilestoneGroup['status'], number> = { active: 0, draft: 1, shipped: 2 };
  return milestones
    .map((m): MilestoneGroup => {
      const members = features.filter((f) => f.frontmatter.milestone === m.slug);
      const doneCount = members.filter((f) => f.frontmatter.phase === 'done').length;
      const status = m.frontmatter.status;
      return {
        slug: m.slug,
        name: m.frontmatter.name,
        status,
        description: m.frontmatter.description ?? null,
        members,
        doneCount,
        total: members.length,
        incomplete: status === 'shipped' && doneCount < members.length,
      };
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
}

/** Load all milestones + features and group them for the /milestones page. */
export async function loadMilestoneGroups(): Promise<MilestoneGroup[]> {
  const features = await loadFeatures();
  return buildMilestoneGroups(loadMilestones(), features);
}

export interface ReleaseNotes {
  bodyHtml: string;
}

/**
 * Read `docs/release-notes.md` and return its rendered HTML body. The
 * file has no frontmatter — the leading `# Release Notes` header is
 * rendered into the page heading by `marked`.
 *
 * @returns Rendered release-notes body
 */
export async function loadReleaseNotes(): Promise<ReleaseNotes> {
  // Absent until the first release runs — the release script generates
  // `docs/release-notes.md`. Degrade to a placeholder rather than 500.
  const raw = await readFile(getReleaseNotesPath(), 'utf8').catch(
    () => '_No release notes yet — generated on the first release._',
  );
  return { bodyHtml: await renderMarkdown(raw) };
}

export interface FrameworkPage {
  slug: string;
  title: string;
  filePath: string;
  bodyMarkdown: string;
}

/**
 * Read every `docs/noldor/*.md` (excluding `README.md`), parse
 * frontmatter, and return pages ordered by the README route-table
 * sequence in {@link FRAMEWORK_PAGE_ORDER}. Unknown slugs sort to the
 * tail alphabetically.
 *
 * @returns Framework pages in reading-flow order
 */
export async function loadFrameworkPages(): Promise<FrameworkPage[]> {
  const noldorDir = getNoldorDir();
  const entries = await readdir(noldorDir);
  const mds = entries.filter((e) => e.endsWith('.md') && e !== 'README.md');
  const pages = await Promise.all(
    mds.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const filePath = join(noldorDir, file);
      const raw = await readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const titleMatch = /^# (.+)$/m.exec(parsed.content);
      const title = titleMatch ? titleMatch[1].trim() : slug;
      return { slug, title, filePath, bodyMarkdown: parsed.content };
    }),
  );
  return pages.toSorted((a, b) => {
    const ai = FRAMEWORK_PAGE_ORDER.indexOf(a.slug);
    const bi = FRAMEWORK_PAGE_ORDER.indexOf(b.slug);
    if (ai === -1 && bi === -1) return a.slug.localeCompare(b.slug);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export interface FrameworkPageDetail extends FrameworkPage {
  bodyHtml: string;
}

const USER_DOCS_CATEGORIES = ['tutorials', 'how-to', 'reference', 'explanation'] as const;
export type UserDocsCategory = (typeof USER_DOCS_CATEGORIES)[number];

export interface UserDoc {
  slug: string;
  title: string;
  filePath: string;
  bodyMarkdown: string;
}

export interface UserDocsCategoryData {
  category: UserDocsCategory;
  docs: UserDoc[];
}

/**
 * Walk the four `docs/user/<category>/*.md` directories — tutorials,
 * how-to, reference, explanation — parse each top-level `.md` file's
 * frontmatter + first H1, and return the four categories in canonical
 * Diátaxis quadrant order. Generated `index.md` files are filtered
 * out; the typedoc-generated `reference/api/` subtree is excluded by
 * the `.md`-only file filter (subdirectories aren't recursed).
 *
 * @returns Diátaxis categories with their parsed docs
 */
export async function loadUserDocs(): Promise<UserDocsCategoryData[]> {
  const base = join(getDocRoot(), 'docs', 'user');
  const result: UserDocsCategoryData[] = [];
  for (const category of USER_DOCS_CATEGORIES) {
    const dir = join(base, category);
    const entries = await readdir(dir).catch(() => [] as string[]);
    const mds = entries.filter((e) => e.endsWith('.md') && e !== 'index.md');
    const docs = await Promise.all(
      mds.map(async (file) => {
        const slug = file.replace(/\.md$/, '');
        const filePath = join(dir, file);
        const raw = await readFile(filePath, 'utf8');
        const parsed = matter(raw);
        const titleMatch = /^# (.+)$/m.exec(parsed.content);
        const title = titleMatch ? titleMatch[1].trim() : slug;
        return { slug, title, filePath, bodyMarkdown: parsed.content };
      }),
    );
    result.push({ category, docs: docs.toSorted((a, b) => a.slug.localeCompare(b.slug)) });
  }
  return result;
}

export interface UserDocDetail extends UserDoc {
  bodyHtml: string;
}

/**
 * Load a single user doc, render its body to HTML, and rewrite
 * inter-doc links to dashboard routes. Source dir for relative-path
 * resolution is `docs/user/<category>`.
 *
 * @param category - Diátaxis category
 * @param slug - Doc slug (filename stem; matches `loadUserDocs` output)
 * @returns Doc detail with rendered HTML, or `null` if no matching file
 */
export async function loadUserDoc(category: string, slug: string): Promise<UserDocDetail | null> {
  const all = await loadUserDocs();
  const cat = all.find((c) => c.category === category);
  if (!cat) return null;
  const match = cat.docs.find((d) => d.slug === slug);
  if (!match) return null;
  const rendered = await renderMarkdown(match.bodyMarkdown);
  const bodyHtml = rewriteDocLinks(rendered, `docs/user/${category}`);
  return { ...match, bodyHtml };
}

/**
 * Load a single noldor page, render its body to HTML, and rewrite
 * inter-page links to dashboard routes.
 *
 * @param slug - Page slug (filename stem; matches `loadFrameworkPages` output)
 * @returns Page detail with rendered HTML, or `null` if no matching file
 */
export async function loadFrameworkPage(slug: string): Promise<FrameworkPageDetail | null> {
  const pages = await loadFrameworkPages();
  const match = pages.find((p) => p.slug === slug);
  if (!match) return null;
  const rendered = await renderMarkdown(match.bodyMarkdown);
  const bodyHtml = rewriteDocLinks(rendered, 'docs/noldor');
  return { ...match, bodyHtml };
}

export interface SkillPage {
  slug: string;
  name: string;
  description: string;
  filePath: string;
  bodyMarkdown: string;
}

/**
 * Lenient SKILL.md frontmatter split. Skill descriptions are free prose
 * and routinely contain `: ` sequences that blow up strict YAML (e.g.
 * `phase: in-progress → done`), so `matter()` is not safe here. Treat
 * the frontmatter block as plain `key: value` lines instead — only
 * `name` and `description` are consumed, both single-line by the skill
 * authoring convention.
 */
function parseSkillMd(raw: string): { name?: string; description?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { body: raw };
  const out: { name?: string; description?: string; body: string } = {
    body: raw.slice(m[0].length),
  };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (kv) out[kv[1] as 'name' | 'description'] = kv[2].trim();
  }
  return out;
}

/**
 * Read every `.claude/skills/<dir>/SKILL.md`, parse frontmatter (`name`,
 * `description`), and return skills sorted alphabetically by slug. The
 * slug is the directory name; frontmatter `name` falls back to it when
 * absent. Directories without a SKILL.md are skipped.
 *
 * @returns Project-local skills in alphabetical order
 */
export async function loadSkills(): Promise<SkillPage[]> {
  const skillsDir = getSkillsDir();
  let dirs: string[];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const skills = await Promise.all(
    dirs.map(async (dir): Promise<SkillPage | null> => {
      const filePath = join(skillsDir, dir, 'SKILL.md');
      const raw = await readFile(filePath, 'utf8').catch(() => null);
      if (raw === null) return null;
      const parsed = parseSkillMd(raw);
      return {
        slug: dir,
        name: parsed.name !== undefined && parsed.name.length > 0 ? parsed.name : dir,
        description: parsed.description ?? '',
        filePath,
        bodyMarkdown: parsed.body,
      };
    }),
  );
  return skills
    .filter((s): s is SkillPage => s !== null)
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}

export interface SkillPageDetail extends SkillPage {
  bodyHtml: string;
}

/**
 * Load a single skill, render its SKILL.md body to HTML, and rewrite
 * relative doc links (`../../../docs/noldor/…`, FD links, …) to
 * dashboard routes. Source dir for relative-path resolution is the
 * skill's own directory, `.claude/skills/<slug>`.
 *
 * @param slug - Skill directory name (matches `loadSkills` output)
 * @returns Skill detail with rendered HTML, or `null` if no matching skill
 */
export async function loadSkill(slug: string): Promise<SkillPageDetail | null> {
  const skills = await loadSkills();
  const match = skills.find((s) => s.slug === slug);
  if (!match) return null;
  const rendered = await renderMarkdown(match.bodyMarkdown);
  const bodyHtml = rewriteDocLinks(rendered, `.claude/skills/${slug}`);
  return { ...match, bodyHtml };
}

/**
 * Read docs/backlog.md and return parsed entries. Thin wrapper around
 * {@link loadBacklogWithHash} for callers that don't need the source
 * file's SHA-256 hash.
 *
 * @returns Backlog entries in document order
 */
export async function loadBacklog(): Promise<BacklogEntry[]> {
  const { entries } = await loadBacklogWithHash();
  return entries;
}

/**
 * Build a full SDD `ReportInput` and run every detector via `collectGaps`.
 *
 * Mirrors `src/garden/sdd-report.ts` `main()` so dashboard gap output stays
 * consistent with `pnpm sdd:report`.
 *
 * @returns All gaps surfaced by the SDD detectors
 */
export async function loadGaps(): Promise<Gap[]> {
  const input = await loadSddInput();
  return collectGaps(input);
}

/**
 * Build the SDD `ReportInput` the same way `sdd-report` `main()` does — scan
 * roots and package discovery via `src/core/repo-paths.ts` — so dashboard gap
 * output matches `pnpm noldor garden sdd-report` on any layout. Exported for
 * the layout-parity regression tests; production callers use {@link loadGaps}.
 */
export async function loadSddInput(): Promise<ReportInput> {
  const features = await loadSddFeatures('docs/features');
  const ideasMd = await readFile('ideas.md', 'utf8').catch(() => '');
  const backlogRaw = await readFile('docs/backlog.md', 'utf8').catch(() => '');
  const backlog = parseBacklog(backlogRaw);
  const specPaths = await listSpecs('docs/superpowers/specs');
  const planPaths = await listPlans('docs/superpowers/plans');

  const roots = scanRoots();
  const allRepoPaths: string[] = [];
  for (const root of roots) {
    await walkRepo(root, allRepoPaths);
  }

  const testFiles = allRepoPaths.filter(
    (p) => /\.test\.(ts|tsx)$/.test(p) || /\.spec\.(ts|tsx)$/.test(p),
  );
  const testInputs = await readTextFiles(testFiles);

  const docFiles: string[] = [];
  for (const sub of ['docs/user/tutorials', 'docs/user/explanation']) {
    try {
      const entries = await readdir(sub, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          docFiles.push(join(sub, e.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const docInputs = await readTextFiles(docFiles);

  const actualPackages = await actualPackageNames();

  const readmeContent = await readFile('README.md', 'utf8').catch(() => '');
  const staleDays = Number(process.env.SDD_STALE_DAYS ?? '90');

  return {
    actualPackages,
    allRepoPaths,
    backlog,
    docInputs,
    features,
    graphPath: 'graphify-out/graph.json',
    graphSrcRoots: roots,
    ideasMd,
    planPaths,
    readmeContent,
    specPaths,
    staleDays,
    testInputs,
  };
}

export const dashboardCountsSchema = z
  .object({
    features: z.object({
      total: z.number().int().nonnegative(),
      byPhase: z.object({
        done: z.number().int().nonnegative(),
        'in-progress': z.number().int().nonnegative(),
      }),
      byCategory: z.record(z.string(), z.number().int().nonnegative()),
      byArea: z.record(z.string(), z.number().int().nonnegative()),
    }),
    roadmap: z.object({
      total: z.number().int().nonnegative(),
    }),
    backlog: z.number().int().nonnegative(),
    skills: z.number().int().nonnegative(),
    scripts: z.number().int().nonnegative(),
    gaps: z.number().int().nonnegative(),
  })
  .strict();

export type DashboardCounts = z.infer<typeof dashboardCountsSchema>;

/**
 * One row in the hot-zones table — file path with churn metrics.
 */
export const hotZoneRowSchema = z
  .object({
    rank: z.number().int().positive(),
    path: z.string().min(1),
    changeCount: z.number().int().positive(),
    insertions: z.number().int().nonnegative(), // lines added across window (binary diffs count 0)
    deletions: z.number().int().nonnegative(), // lines removed across window (binary diffs count 0)
    authors: z.array(z.string()), // distinct, sorted
    lastCommitDate: z.string(), // YYYY-MM-DD
    lastCommitHash: z.string(), // short hash
    lastCommitSubject: z.string(),
    featureSlugs: z.array(z.string()), // matching features.frontmatter.links.code
  })
  .strict();

export type HotZoneRow = z.infer<typeof hotZoneRowSchema>;

/**
 * One row in the WIP age table — an in-progress feature with its
 * computed age (days since the feature MD was first added to git).
 */
export const wipAgeRowSchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    area: z.string().min(1),
    ageDays: z.number().int().nonnegative(),
    bucket: z.enum(['fresh', 'aging', 'stale']),
    firstCommitTimestamp: z.number().int().nonnegative(),
  })
  .strict();

export type WipAgeRow = z.infer<typeof wipAgeRowSchema>;

/**
 * Bucket boundaries for WIP age, in days. Fresh: 0-6, aging: 7-13,
 * stale: 14+.
 */
export const WIP_AGE_THRESHOLDS = { aging: 7, stale: 14 } as const;

/**
 * Load all aggregate counts driving the overview page.
 *
 * @returns Validated counts object
 */
export async function loadCounts(): Promise<DashboardCounts> {
  const [features, roadmap, backlog, gaps, skillsCount, scriptsCount] = await Promise.all([
    loadFeatures(),
    parseRoadmap(),
    loadBacklog(),
    loadGaps(),
    countMatching(getSkillsDir(), /SKILL\.md$/, true),
    countScriptFiles(),
  ]);

  const byPhase = { done: 0, 'in-progress': 0 } as Record<'done' | 'in-progress', number>;
  const byCategory: Record<string, number> = {};
  const byArea: Record<string, number> = {};
  for (const c of loadCategories()) byCategory[c] = 0;
  for (const f of features) {
    byPhase[f.frontmatter.phase] += 1;
    byCategory[f.frontmatter.category] = (byCategory[f.frontmatter.category] ?? 0) + 1;
    byArea[f.frontmatter.area] = (byArea[f.frontmatter.area] ?? 0) + 1;
  }

  return dashboardCountsSchema.parse({
    features: { total: features.length, byPhase, byCategory, byArea },
    roadmap: { total: roadmap.length },
    backlog: backlog.length,
    skills: skillsCount,
    scripts: scriptsCount,
    gaps: gaps.length,
  });
}

async function countMatching(dir: string, pattern: RegExp, recurse: boolean): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isFile() && pattern.test(e.name)) n += 1;
      else if (recurse && e.isDirectory())
        n += await countMatching(join(dir, e.name), pattern, true);
    }
    return n;
  } catch {
    return 0;
  }
}

async function countScriptFiles(): Promise<number> {
  const entries = await readdir(getScriptsDir(), { withFileTypes: true, recursive: true });
  return entries.filter(
    (e) =>
      e.isFile() &&
      e.name.endsWith('.ts') &&
      !e.name.endsWith('.test.ts') &&
      e.name !== 'tsconfig.json',
  ).length;
}

export interface ReleaseInfo {
  tag: string;
  date: string;
  commitsSincePrev: number;
}

export interface VelocityStats {
  commits: { last7d: number; last30d: number; last90d: number };
  commitsByType: Record<string, number>;
  commitsByScope: Record<string, number>;
  releases: ReleaseInfo[];
  lastReleaseDaysAgo: number | null;
  activeBranches: number;
  activeWorktrees: number;
  topAuthors30d: Array<{ name: string; commits: number }>;
}

async function git(args: string[]): Promise<string> {
  const start = Date.now();
  const { stdout } = await execFileAsync('git', args, {
    signal: AbortSignal.timeout(1500),
    maxBuffer: 5_000_000,
  });
  const elapsed = Date.now() - start;
  if (elapsed > 500) console.warn(`slow git ${args.join(' ')} ${elapsed}ms`);
  return stdout;
}

async function tryGit<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Compute realtime velocity stats from `git`. Each field falls back to
 * a safe default when its underlying git call fails or times out.
 *
 * @returns Velocity snapshot
 */
export async function loadVelocity(): Promise<VelocityStats> {
  const [last7d, last30d, last90d, log30d, tags, branches, worktrees, authors30d] =
    await Promise.all([
      tryGit(
        async () =>
          Number((await git(['rev-list', '--count', '--since=7 days ago', 'HEAD'])).trim()),
        0,
      ),
      tryGit(
        async () =>
          Number((await git(['rev-list', '--count', '--since=30 days ago', 'HEAD'])).trim()),
        0,
      ),
      tryGit(
        async () =>
          Number((await git(['rev-list', '--count', '--since=90 days ago', 'HEAD'])).trim()),
        0,
      ),
      tryGit(
        async () =>
          (await git(['log', '--since=30 days ago', '--format=%s'])).split('\n').filter(Boolean),
        [] as string[],
      ),
      tryGit(
        async () =>
          (
            await git([
              'tag',
              '--list',
              'v*',
              '--sort=-creatordate',
              '--format=%(refname:short)|%(creatordate:short)',
            ])
          )
            .split('\n')
            .filter(Boolean),
        [] as string[],
      ),
      tryGit(
        async () =>
          (await git(['for-each-ref', 'refs/heads/', '--format=%(refname:short)']))
            .split('\n')
            .filter(Boolean),
        [] as string[],
      ),
      tryGit(
        async () =>
          (await git(['worktree', 'list', '--porcelain']))
            .split('\n')
            .filter((l) => l.startsWith('worktree ')),
        [] as string[],
      ),
      tryGit(
        async () =>
          (await git(['shortlog', '-sn', '--no-merges', '--since=30 days ago', 'HEAD']))
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const m = /^\s*(\d+)\s+(.+)$/.exec(line);
              return m ? { name: m[2], commits: Number(m[1]) } : null;
            })
            .filter((x): x is { name: string; commits: number } => x !== null),
        [] as Array<{ name: string; commits: number }>,
      ),
    ]);

  const commitsByType: Record<string, number> = {};
  const commitsByScope: Record<string, number> = {};
  for (const subject of log30d) {
    const m = /^([a-z]+)(?:\(([^)]+)\))?(!)?:/i.exec(subject);
    if (!m) continue;
    const type = m[1].toLowerCase();
    commitsByType[type] = (commitsByType[type] ?? 0) + 1;
    if (m[2]) {
      const scope = m[2].split(':')[0].toLowerCase();
      commitsByScope[scope] = (commitsByScope[scope] ?? 0) + 1;
    }
  }

  // Tags arrive newest-first (--sort=-creatordate). Iterate oldest→newest so
  // `prevTag..tag` ranges go ancestor→descendant (non-empty); reverse the
  // accumulated releases at the end to restore newest-first display order.
  const releases: ReleaseInfo[] = [];
  const tagsOldestFirst = tags.toReversed();
  let prevTag: string | null = null;
  for (const line of tagsOldestFirst) {
    const [tag, date] = line.split('|');
    if (!tag || !date) continue;
    const range = prevTag ? `${prevTag}..${tag}` : tag;
    const commitsSincePrev = await tryGit(
      async () => Number((await git(['rev-list', '--count', range])).trim()),
      0,
    );
    releases.push({ tag, date, commitsSincePrev });
    prevTag = tag;
  }
  releases.reverse();

  const lastReleaseDaysAgo = releases[0]
    ? Math.floor((Date.now() - new Date(releases[0].date).getTime()) / 86_400_000)
    : null;

  const activeBranches = branches.filter((b) => b !== 'main').length;
  const activeWorktrees = Math.max(0, worktrees.length - 1);

  return {
    commits: { last7d, last30d, last90d },
    commitsByType,
    commitsByScope,
    releases,
    lastReleaseDaysAgo,
    activeBranches,
    activeWorktrees,
    topAuthors30d: authors30d.slice(0, 5),
  };
}

/**
 * Resolve a numstat rename path to its post-rename form: braced segment
 * renames (`dir/{old => new}/f.ts`, `src/{ => sub}/a.ts`) keep the right
 * side; whole-path renames (`old.ts => new.ts`) keep the right side.
 * An emptied leading segment (`{src => }/a.ts`) leaves no stray slash.
 * Non-rename paths pass through unchanged.
 */
export function resolveRenamePath(raw: string): string {
  const braced = raw
    .replace(/\{([^{}]*) => ([^{}]*)\}/g, '$2')
    .replaceAll('//', '/')
    .replace(/^\//, '');
  if (braced !== raw) return braced;
  const arrow = raw.indexOf(' => ');
  return arrow === -1 ? raw : raw.slice(arrow + 4);
}

/**
 * Compute the top-N most-changed files in the last `days` days.
 *
 * One git call (`git log --since=Nd --no-merges --numstat --format=...`)
 * is parsed in a single pass into per-file metrics. `--numstat` (not
 * `--shortstat`) because lines changed must be attributed per file, and
 * shortstat only emits per-commit totals. Binary diffs report `-\t-` and
 * count as 0 inserted / 0 deleted. Generated and lockfile paths are
 * excluded via {@link EXCLUDE_PATTERNS}. Each surviving row is
 * cross-referenced against feature MDs' `links.code` to populate
 * `featureSlugs`.
 *
 * @remarks
 * Parser assumes no tracked path begins with `__C__` (the commit-header sentinel).
 * Safe for all real-world path conventions in this repo.
 *
 * @param opts - `days` (window) and `limit` (max rows).
 * @returns Hot-zone rows, ranked by change count desc.
 */
export async function loadHotZones(opts: {
  days: 7 | 30 | 90;
  limit: number;
}): Promise<HotZoneRow[]> {
  const { days, limit } = opts;
  const lines = await tryGit(
    async () =>
      (
        await git([
          'log',
          `--since=${days} days ago`,
          '--no-merges',
          '--numstat',
          '--format=__C__%h%x09%an%x09%cs%x09%s',
        ])
      ).split('\n'),
    [] as string[],
  );

  interface Acc {
    path: string;
    changeCount: number;
    insertions: number;
    deletions: number;
    authors: Set<string>;
    lastCommitDate: string;
    lastCommitSubject: string;
    lastCommitHash: string;
  }
  const accByPath = new Map<string, Acc>();

  let curHash = '';
  let curAuthor = '';
  let curDate = '';
  let curSubject = '';
  for (const line of lines) {
    if (line.startsWith('__C__')) {
      const [hash, author, date, ...subjectParts] = line.slice(5).split('\t');
      curHash = hash ?? '';
      curAuthor = author ?? '';
      curDate = date ?? '';
      curSubject = subjectParts.join('\t');
      continue;
    }
    if (line === '') continue;
    // Numstat line: `<ins>\t<del>\t<path>` — `-` for binary diffs. Churn from
    // a rename (`dir/{old => new}` / `old => new`) attributes to the new path.
    const [ins, del, ...pathParts] = line.split('\t');
    if (ins === undefined || del === undefined || pathParts.length === 0) continue;
    const path = resolveRenamePath(pathParts.join('\t'));
    const insertions = ins === '-' ? 0 : Number.parseInt(ins, 10);
    const deletions = del === '-' ? 0 : Number.parseInt(del, 10);
    let acc = accByPath.get(path);
    if (!acc) {
      acc = {
        path,
        changeCount: 1,
        insertions,
        deletions,
        authors: new Set<string>([curAuthor]),
        lastCommitDate: curDate,
        lastCommitSubject: curSubject,
        lastCommitHash: curHash,
      };
      accByPath.set(path, acc);
      continue;
    }
    acc.changeCount += 1;
    acc.insertions += insertions;
    acc.deletions += deletions;
    acc.authors.add(curAuthor);
    if (curDate > acc.lastCommitDate) {
      acc.lastCommitDate = curDate;
      acc.lastCommitSubject = curSubject;
      acc.lastCommitHash = curHash;
    }
  }

  const filtered = Array.from(accByPath.values()).filter(
    (a) => !EXCLUDE_PATTERNS.some((re) => re.test(a.path)),
  );

  filtered.sort((a, b) => {
    if (a.changeCount !== b.changeCount) return b.changeCount - a.changeCount;
    if (a.lastCommitDate !== b.lastCommitDate)
      return b.lastCommitDate.localeCompare(a.lastCommitDate);
    return a.path.localeCompare(b.path);
  });

  const sliced = filtered.slice(0, limit);

  const features = await loadFeatures();

  const rows: HotZoneRow[] = sliced.map((a, i) => ({
    rank: i + 1,
    path: a.path,
    changeCount: a.changeCount,
    insertions: a.insertions,
    deletions: a.deletions,
    authors: Array.from(a.authors).toSorted((x, y) => x.localeCompare(y)),
    lastCommitDate: a.lastCommitDate,
    lastCommitSubject: a.lastCommitSubject,
    lastCommitHash: a.lastCommitHash,
    featureSlugs: featureSlugsForCodePath(a.path, features),
  }));

  return z.array(hotZoneRowSchema).parse(rows);
}

export function featureSlugsForCodePath(
  filePath: string,
  features: ReadonlyArray<{ slug: string; frontmatter: { links: { code: readonly string[] } } }>,
): string[] {
  return features
    .filter((f) => f.frontmatter.links.code.some((p) => codePathOwnsFile(p, filePath)))
    .map((f) => f.slug);
}

function codePathOwnsFile(codePath: string, filePath: string): boolean {
  const normalized = codePath.endsWith('/') ? codePath.slice(0, -1) : codePath;
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}

/**
 * Load WIP age rows: one per `phase: in-progress` feature, with the
 * number of days since its feature MD was first committed.
 *
 * Uses `git log --diff-filter=A --format=%ct -- docs/features/<slug>.md`.
 * Features whose MD is uncommitted are skipped (no creation timestamp).
 *
 * @param opts - Optional `now` override (epoch-anchored Date) for tests.
 * @returns Rows sorted by `ageDays` desc (oldest first).
 */
export async function loadWipAge(opts?: { now?: Date }): Promise<WipAgeRow[]> {
  const now = opts?.now ?? new Date();
  const features = await loadFeatures();
  const inProgress = features.filter((f) => f.frontmatter.phase === 'in-progress');
  const rows: WipAgeRow[] = [];
  for (const f of inProgress) {
    const path = `docs/features/${f.slug}.md`;
    const raw = await tryGit(
      async () => (await git(['log', '--diff-filter=A', '--format=%ct', '--', path])).trim(),
      '',
    );
    const lines = raw.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const earliest = lines[lines.length - 1];
    const firstCommitTimestamp = Number(earliest);
    if (!Number.isFinite(firstCommitTimestamp) || firstCommitTimestamp <= 0) continue;
    const ageMs = now.getTime() - firstCommitTimestamp * 1000;
    const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    const bucket: WipAgeRow['bucket'] =
      ageDays >= WIP_AGE_THRESHOLDS.stale
        ? 'stale'
        : ageDays >= WIP_AGE_THRESHOLDS.aging
          ? 'aging'
          : 'fresh';
    rows.push({
      slug: f.slug,
      name: f.frontmatter.name,
      area: f.frontmatter.area,
      ageDays,
      bucket,
      firstCommitTimestamp,
    });
  }
  rows.sort((a, b) => {
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
    return a.slug.localeCompare(b.slug);
  });
  return z.array(wipAgeRowSchema).parse(rows);
}

/**
 * Zod schema for one module row on the test-pyramid page.
 *
 * @remarks
 * `ratio` is test files per source file, rounded to 2 decimals; `null` when
 * the module has no source files (test-only directories).
 */
export const testPyramidRowSchema = z
  .object({
    module: z.string().min(1),
    sourceFiles: z.number().int().nonnegative(),
    testFiles: z.number().int().nonnegative(),
    testCases: z.number().int().nonnegative(),
    ratio: z.number().nonnegative().nullable(),
  })
  .strict();

export type TestPyramidRow = z.infer<typeof testPyramidRowSchema>;

/** File extensions counted as code on the test-pyramid page. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/**
 * Whether a repo-relative path is a test file (`__tests__/` segment or a
 * `.test.<ext>` suffix).
 */
export function isTestPath(relPath: string): boolean {
  const p = relPath.split(sep).join('/');
  if (p.split('/').includes('__tests__')) return true;
  return CODE_EXTENSIONS.some((ext) => p.endsWith(`.test${ext}`));
}

/**
 * Count test cases in a test-file source: top-level-ish `it(`/`test(` calls,
 * including modifier forms like `it.each(...)`, `test.skip(`.
 */
export function countTestCases(content: string): number {
  const matches = content.match(/^\s*(?:it|test)(?:\.\w+)*(?:\(|`)/gm);
  return matches ? matches.length : 0;
}

/**
 * Load per-module test-pyramid stats: source-file / test-file / test-case
 * counts plus the test-to-code ratio, for every module directory under the
 * consumer config's `scanPaths` (fallback `['src']`).
 *
 * @remarks
 * A module is the first directory level under a scan path (`src/cr`,
 * `src/core`, ...); files sitting directly in a scan path root are grouped
 * under the scan path itself. Rows sort worst-covered first (ratio
 * ascending, `null` last), so untested modules surface at the top.
 */
export async function loadTestPyramid(): Promise<TestPyramidRow[]> {
  const root = getDocRoot();
  let scanPaths: string[];
  try {
    scanPaths = loadConsumerConfig(root).scanPaths;
  } catch {
    scanPaths = [];
  }
  if (scanPaths.length === 0) scanPaths = ['src'];

  const byModule = new Map<string, { sourceFiles: number; testFiles: number; testCases: number }>();
  for (const scanPath of scanPaths) {
    const base = join(root, scanPath);
    const files: string[] = [];
    await walkRepo(base, files);
    for (const file of files) {
      const ext = file.slice(file.lastIndexOf('.'));
      if (!CODE_EXTENSIONS.includes(ext) || file.endsWith('.d.ts')) continue;
      const rel = file
        .slice(base.length + 1)
        .split(sep)
        .join('/');
      const firstDir = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : null;
      const module =
        firstDir === null || firstDir === '__tests__' ? scanPath : `${scanPath}/${firstDir}`;
      const agg = byModule.get(module) ?? { sourceFiles: 0, testFiles: 0, testCases: 0 };
      if (isTestPath(rel)) {
        agg.testFiles += 1;
        const content = await readFile(file, 'utf8');
        agg.testCases += countTestCases(content);
      } else {
        agg.sourceFiles += 1;
      }
      byModule.set(module, agg);
    }
  }

  const rows: TestPyramidRow[] = [...byModule.entries()].map(([module, agg]) => ({
    module,
    ...agg,
    ratio: agg.sourceFiles > 0 ? Math.round((agg.testFiles / agg.sourceFiles) * 100) / 100 : null,
  }));
  rows.sort((a, b) => {
    if (a.ratio === null && b.ratio === null) return a.module.localeCompare(b.module);
    if (a.ratio === null) return 1;
    if (b.ratio === null) return -1;
    if (a.ratio !== b.ratio) return a.ratio - b.ratio;
    return a.module.localeCompare(b.module);
  });
  return z.array(testPyramidRowSchema).parse(rows);
}

/**
 * Zod schema for a single worktree entry in the health snapshot.
 *
 * @remarks
 * `featureSlug` is non-null only when the branch name matches `feat/<slug>`
 * and a corresponding feature MD exists in `docs/features/`.
 */
export const worktreeHealthTreeSchema = z
  .object({
    path: z.string(),
    branch: z.string(),
    port: z.number().int().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    dirtyCount: z.number().int().nonnegative(),
    dirtyFiles: z.array(z.string()),
    lastCommit: z.string(),
    featureSlug: z.string().nullable(),
  })
  .strict();

/** A single worktree row in the health snapshot. */
export type WorktreeHealthTree = z.infer<typeof worktreeHealthTreeSchema>;

/**
 * Zod schema for the full worktree health snapshot.
 *
 * @remarks
 * `warnings` uses `z.unknown()` because the `Warning` discriminated union
 * is typed via TypeScript only; Zod validation on individual trees is
 * sufficient for the dashboard's integrity needs.
 */
export const worktreeHealthSchema = z
  .object({
    trees: z.array(worktreeHealthTreeSchema),
    warnings: z.array(z.unknown()),
  })
  .strict();

/**
 * Snapshot returned by {@link loadWorktreeHealth}.
 *
 * @remarks
 * Manually declared (not `z.infer<typeof worktreeHealthSchema>`) because
 * `Warning` is a TypeScript-only discriminated union from `worktree-status.ts`
 * — the runtime schema treats `warnings` as `z.array(z.unknown())` for
 * pass-through, but the surfaced type uses the precise union so consumers
 * (views layer) can exhaustively switch on `kind`.
 */
export type WorktreeHealth = {
  trees: WorktreeHealthTree[];
  warnings: Warning[];
};

/**
 * Enumerate worktrees, gather stats per tree, and resolve feature MD
 * cross-links. Read-only — never writes `.env.local` (port allocation
 * remains a CLI concern).
 *
 * @returns Validated worktree health snapshot
 */
export async function loadWorktreeHealth(): Promise<WorktreeHealth> {
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf-8',
  });
  const records = parseWorktreeList(porcelain);
  const mainRecord = records.find((r) => !r.path.includes('/.worktrees/'));
  if (mainRecord === undefined) {
    throw new Error('Could not identify main worktree.');
  }
  const mainPath = mainRecord.path;

  const features = await loadFeatures();
  const slugSet = new Set(features.map((f) => f.slug));

  const treesWithStats = await Promise.all(
    records.map(async (r) => {
      const branchLabel = r.detached ? '(detached)' : (r.branch ?? '(detached)');
      const isMain = r.path === mainPath;
      const branchForStats = isMain ? 'main' : (r.branch ?? '');
      const stats = branchForStats
        ? await gatherStats(r.path, branchForStats)
        : {
            ahead: 0,
            behind: 0,
            dirtyCount: 0,
            dirtyFiles: [] as readonly string[],
            oldestDirtyMtime: null,
            lastCommit: '',
            touchedFiles: [] as readonly string[],
          };
      const port = isMain ? 5173 : await readPort(r.path);
      const slug = r.branch && r.branch.startsWith('feat/') ? r.branch.slice('feat/'.length) : null;
      const featureSlug = slug !== null && slugSet.has(slug) ? slug : null;
      return {
        record: r,
        isMain,
        path: isMain ? '.' : r.path.replace(`${mainPath}/`, ''),
        branch: isMain ? 'main' : branchLabel,
        port,
        stats,
        featureSlug,
      };
    }),
  );

  const featureTreesForWarnings = treesWithStats
    .filter((t) => !t.isMain)
    .map((t) => ({
      path: t.record.path,
      branch: t.record.branch,
      detached: t.record.detached,
      stats: t.stats,
    }));
  const warnings = computeWarnings(featureTreesForWarnings);

  const trees: WorktreeHealthTree[] = treesWithStats.map((t) => ({
    path: t.path,
    branch: t.branch,
    port: t.port,
    ahead: t.stats.ahead,
    behind: t.stats.behind,
    dirtyCount: t.stats.dirtyCount,
    dirtyFiles: [...t.stats.dirtyFiles],
    lastCommit: t.stats.lastCommit,
    featureSlug: t.featureSlug,
  }));

  // Validate; warnings are pass-through (z.unknown() — typed by re-export).
  const validatedTrees = z.array(worktreeHealthTreeSchema).parse(trees);
  return { trees: validatedTrees, warnings };
}

export { describeWarning };

/**
 * Cohesion at or below this threshold marks a community as "low cohesion" — a
 * sprawling, poorly-clustered group worth flagging before a release sweep.
 * `/graphify` cohesion runs ~0.05–0.55; 0.15 cleanly separates the diffuse
 * communities (split-candidates) from the focused ones.
 */
export const LOW_COHESION_THRESHOLD = 0.15;

/** One god node: a name and its edge count, parsed from the report's God Nodes list. */
export const graphGodNodeSchema = z
  .object({ name: z.string().min(1), edges: z.number().int().nonnegative() })
  .strict();
export type GraphGodNode = z.infer<typeof graphGodNodeSchema>;

/** One community row: id, label, and cohesion score from the report's Communities section. */
export const graphCommunitySchema = z
  .object({ id: z.number().int().nonnegative(), label: z.string(), cohesion: z.number() })
  .strict();
export type GraphCommunity = z.infer<typeof graphCommunitySchema>;

/**
 * A point-in-time health snapshot derived from `graphify-out/GRAPH_REPORT.md`.
 *
 * @remarks
 * `reportDate` is the run date from the report header (`# Graph Report - src
 * (2026-06-01)`) — the snapshot's "as of" label. `deadExportCount` is `null`
 * because `/graphify` does not currently emit a dead-export section; the parser
 * still reads one if a future report version adds it (see {@link parseGraphReport}).
 * `communityCount` is the Summary total (includes thin/omitted communities);
 * `scannedCommunityCount` is how many community blocks the report actually
 * details (the ones cohesion was scored for) — the correct denominator for the
 * low-cohesion percentage.
 */
export const graphHealthSnapshotSchema = z
  .object({
    scope: z.string().nullable(),
    reportDate: z.string().nullable(),
    nodeCount: z.number().int().nonnegative().nullable(),
    edgeCount: z.number().int().nonnegative().nullable(),
    communityCount: z.number().int().nonnegative().nullable(),
    scannedCommunityCount: z.number().int().nonnegative(),
    godNodeCount: z.number().int().nonnegative(),
    godNodes: z.array(graphGodNodeSchema),
    lowCohesionThreshold: z.number(),
    lowCohesionCount: z.number().int().nonnegative(),
    lowCohesionCommunities: z.array(graphCommunitySchema),
    deadExportCount: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type GraphHealthSnapshot = z.infer<typeof graphHealthSnapshotSchema>;

/**
 * Slice a `## <title>` section body out of a markdown report: everything from
 * the heading line to (but not including) the next `## ` heading or EOF.
 * Returns `null` when the section is absent. `title` is always a trusted
 * literal here, but escape it defensively in case a metachar ever creeps in.
 */
function graphReportSection(raw: string, title: string): string | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^##\\s+${escaped}[^\\n]*$`, 'm').exec(raw);
  if (start === null) return null;
  const after = raw.slice(start.index + start[0].length);
  const next = /^##\s/m.exec(after);
  return next === null ? after : after.slice(0, next.index);
}

/**
 * Count dead/unused exports if the report carries such a section. `/graphify`
 * does not emit one today, so this returns `null` (rendered as "not reported").
 * Kept forward-compatible: a future `## Dead Exports` / `## Unused Exports`
 * section is read as either an explicit count line or a bullet list.
 */
function parseDeadExports(raw: string): number | null {
  for (const title of ['Dead Exports', 'Unused Exports']) {
    const body = graphReportSection(raw, title);
    if (body === null) continue;
    const countLine = /(\d+)\s+(?:dead|unused)\s+exports?/i.exec(body);
    if (countLine !== null) return Number(countLine[1]);
    const bullets = body.match(/^\s*[-*]\s+/gm);
    return bullets === null ? 0 : bullets.length;
  }
  return null;
}

/**
 * Parse a `GRAPH_REPORT.md` body into a {@link GraphHealthSnapshot}. Pure — no
 * filesystem access, so it is directly unit-testable against report fixtures.
 * Missing sections degrade to `null` / empty rather than throwing, so a partial
 * or future-version report still yields a usable snapshot.
 */
export function parseGraphReport(raw: string): GraphHealthSnapshot {
  const header = /^#\s+Graph Report\s*-\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/m.exec(raw);
  const scope = header === null ? null : header[1]!.trim();
  const reportDate = header === null ? null : header[2]!;

  // Scope the node/edge/community parse to the Summary section so a stray
  // "N nodes · M edges" elsewhere in the report can never mis-match.
  const summarySection = graphReportSection(raw, 'Summary');
  const summary =
    summarySection === null
      ? null
      : /(\d+)\s+nodes\s*·\s*(\d+)\s+edges\s*·\s*(\d+)\s+communities/.exec(summarySection);
  const nodeCount = summary === null ? null : Number(summary[1]);
  const edgeCount = summary === null ? null : Number(summary[2]);

  const godNodes: GraphGodNode[] = [];
  const godSection = graphReportSection(raw, 'God Nodes');
  if (godSection !== null) {
    const re = /^\s*\d+\.\s+`([^`]+)`\s*-\s*(\d+)\s+edges/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(godSection)) !== null) {
      godNodes.push({ name: m[1]!, edges: Number(m[2]) });
    }
  }

  const communities: GraphCommunity[] = [];
  const commRe = /^###\s+Community\s+(\d+)\s+-\s+"([^"]*)"\s*\r?\nCohesion:\s*([\d.]+)/gm;
  let cm: RegExpExecArray | null;
  while ((cm = commRe.exec(raw)) !== null) {
    communities.push({ id: Number(cm[1]), label: cm[2]!, cohesion: Number(cm[3]) });
  }
  const lowCohesionCommunities = communities
    .filter((c) => c.cohesion <= LOW_COHESION_THRESHOLD)
    .sort((a, b) => a.cohesion - b.cohesion || a.id - b.id);

  // Prefer the Summary's authoritative total (counts thin/omitted communities);
  // fall back to the count of parsed Community blocks when Summary is absent.
  const communityCount =
    summary !== null ? Number(summary[3]) : communities.length > 0 ? communities.length : null;

  return graphHealthSnapshotSchema.parse({
    scope,
    reportDate,
    nodeCount,
    edgeCount,
    communityCount,
    scannedCommunityCount: communities.length,
    godNodeCount: godNodes.length,
    godNodes,
    lowCohesionThreshold: LOW_COHESION_THRESHOLD,
    lowCohesionCount: lowCohesionCommunities.length,
    lowCohesionCommunities,
    deadExportCount: parseDeadExports(raw),
  });
}

/**
 * Load the graphify health snapshot from `graphify-out/GRAPH_REPORT.md` under
 * the doc root. Returns `null` when the report does not exist yet (no
 * `/graphify` run) — the page renders a "run /graphify" empty state.
 */
export async function loadGraphHealth(): Promise<GraphHealthSnapshot | null> {
  const reportPath = join(getDocRoot(), 'graphify-out', 'GRAPH_REPORT.md');
  let raw: string;
  try {
    raw = await readFile(reportPath, 'utf8');
  } catch {
    return null;
  }
  return parseGraphReport(raw);
}

/** Fail-open: any compute error → null; the view renders a labeled degraded state. */
export async function loadMetricsReport(): Promise<MetricsReport | null> {
  try {
    const { compute } = await import('../metrics/compute.js');
    return await compute(getDocRoot());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent activity (/agents page + /api/agents)

/** Timeline bucket for event rows written before run ids existed (spec D6). */
export const NO_RUN_ID = '(no run id)';

/**
 * Live rows spawned longer ago than this are flagged stale, not live —
 * pid-liveness can false-positive on a recycled pid (spec risk #2). Generous
 * vs the 30-min default iteration timeout to tolerate raised timeouts.
 */
export const LIVE_STALE_CEILING_MS = 2 * 60 * 60 * 1000;

export type { InboxRow };

export interface LiveAgentRow {
  spawnId: string;
  runId: string | null;
  /** Agent role — the board's "kind" column. */
  kind: string;
  slug: string | null;
  /** Spawn site (e.g. drain.spawnGate, cr.verify-dispatch) — the "lane" column. */
  lane: string | null;
  /** Latest phase row for the slug, when any. */
  phase: string | null;
  pid: number;
  startedTs: string;
  runtimeMs: number;
  retries: number;
  stale: boolean;
}

export interface AgentRunBar {
  kind: string;
  slug: string | null;
  lane: string | null;
  /** Epoch ms of the paired spawned row (fallback: exited ts − duration). */
  startMs: number | null;
  durationMs: number;
  outcome: 'ok' | 'failed' | 'timeout' | 'salvaged';
}

export interface AgentRunGroup {
  runId: string;
  startTs: string;
  endTs: string;
  bars: AgentRunBar[];
  totals: { shipped: number; unfinished: number; escalated: number };
}

export interface AgentActivity {
  live: LiveAgentRow[];
  runs: AgentRunGroup[];
  inbox: InboxRow[];
}

export interface AgentActivityDeps {
  /** Liveness probe; default = signal-0. Injectable so tests exercise dead pids. */
  isPidAlive?: (pid: number) => boolean;
  /** Clock (epoch ms); injectable for runtime/staleness tests. */
  nowMs?: () => number;
  /**
   * Pre-parsed drain-state retries. `handleApiAgents` passes the map already
   * read by {@link loadDrainObservation} so `drain-state.json` is parsed once
   * per poll, not twice. Absent → this loader reads the file itself (existing
   * callers/tests unchanged).
   */
  retries?: Record<string, number>;
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Line-tolerant JSONL read (same posture as the metrics facts reader): corrupt lines skipped. */
async function readJsonlRows<T>(path: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const rows: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // skip corrupt line — the writer is fail-open, the reader is line-tolerant
    }
  }
  return rows;
}

/**
 * Derive the `/agents` payload from `.noldor/agent-events.jsonl` (+ drain-state
 * retries + the escalation inbox via {@link readInboxRows}, reused verbatim —
 * no logic duplication). Back-compat by contract: `event` absent ⇒ 'exited',
 * `runId` absent ⇒ the {@link NO_RUN_ID} bucket at the bottom of the timeline.
 */
export async function loadAgentActivity(
  cwd: string = getDocRoot(),
  deps: AgentActivityDeps = {},
): Promise<AgentActivity> {
  const isPidAlive = deps.isPidAlive ?? defaultPidAlive;
  const nowMs = deps.nowMs ?? Date.now;
  const events = await readJsonlRows<AgentEvent>(join(cwd, '.noldor', 'agent-events.jsonl'));
  const escalations = await readJsonlRows<{ runId?: string; resolved?: boolean }>(
    join(cwd, '.noldor', 'escalations.jsonl'),
  );
  let retries: Record<string, number>;
  if (deps.retries !== undefined) {
    retries = deps.retries;
  } else {
    try {
      const state = JSON.parse(
        await readFile(join(cwd, '.noldor', 'drain-state.json'), 'utf8'),
      ) as DrainState;
      retries = state.retries ?? {};
    } catch {
      retries = {};
    }
  }

  const eventOf = (e: AgentEvent): 'spawned' | 'exited' | 'phase' => e.event ?? 'exited';

  const exitedSpawnIds = new Set(
    events.filter((e) => eventOf(e) === 'exited' && e.spawnId !== undefined).map((e) => e.spawnId),
  );
  const latestPhase = new Map<string, string>();
  for (const e of events) {
    if (eventOf(e) === 'phase' && e.slug !== undefined && e.phase !== undefined) {
      latestPhase.set(e.slug, e.phase);
    }
  }

  const live: LiveAgentRow[] = [];
  for (const e of events) {
    if (eventOf(e) !== 'spawned' || e.spawnId === undefined || e.pid === undefined) continue;
    if (exitedSpawnIds.has(e.spawnId)) continue; // paired — completed
    if (!isPidAlive(e.pid)) continue; // dead process — not live
    const runtimeMs = Math.max(0, nowMs() - Date.parse(e.ts));
    live.push({
      spawnId: e.spawnId,
      runId: e.runId ?? null,
      kind: e.role,
      slug: e.slug ?? null,
      lane: e.site ?? null,
      phase: (e.slug !== undefined ? latestPhase.get(e.slug) : undefined) ?? null,
      pid: e.pid,
      startedTs: e.ts,
      runtimeMs,
      retries: (e.slug !== undefined ? retries[e.slug] : undefined) ?? 0,
      stale: runtimeMs > LIVE_STALE_CEILING_MS,
    });
  }

  const spawnedById = new Map<string, AgentEvent>();
  for (const e of events) {
    if (eventOf(e) === 'spawned' && e.spawnId !== undefined) spawnedById.set(e.spawnId, e);
  }
  const groups = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const key = e.runId ?? NO_RUN_ID;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const runs: AgentRunGroup[] = [...groups.entries()].map(([runId, rows]) => {
    const bars: AgentRunBar[] = rows
      .filter((e) => eventOf(e) === 'exited')
      .map((e) => {
        const spawned = e.spawnId !== undefined ? spawnedById.get(e.spawnId) : undefined;
        const durationMs = e.durationMs ?? 0;
        const startMs =
          spawned !== undefined ? Date.parse(spawned.ts) : Date.parse(e.ts) - durationMs;
        return {
          kind: e.kind ?? e.role,
          slug: e.slug ?? null,
          lane: e.site ?? null,
          startMs: Number.isNaN(startMs) ? null : startMs,
          durationMs,
          outcome:
            e.kind === 'salvaged'
              ? ('salvaged' as const)
              : e.timedOut === true
                ? ('timeout' as const)
                : (e.exitCode ?? 0) === 0
                  ? ('ok' as const)
                  : ('failed' as const),
        };
      });
    const finalPhase = new Map<string, string>();
    for (const e of rows) {
      if (eventOf(e) === 'phase' && e.slug !== undefined && e.phase !== undefined) {
        finalPhase.set(e.slug, e.phase);
      }
    }
    let shipped = 0;
    let unfinished = 0;
    for (const phase of finalPhase.values()) {
      if (phase === 'merged') shipped += 1;
      else unfinished += 1;
    }
    const escalated = escalations.filter(
      (r) => r.resolved === undefined && (r.runId ?? NO_RUN_ID) === runId,
    ).length;
    const tss = rows.map((r) => r.ts).toSorted();
    return {
      runId,
      startTs: tss[0] ?? '',
      endTs: tss[tss.length - 1] ?? '',
      bars,
      totals: { shipped, unfinished, escalated },
    };
  });
  // Newest first; the legacy bucket always sinks to the bottom (spec D6).
  runs.sort((a, b) => {
    if (a.runId === NO_RUN_ID) return 1;
    if (b.runId === NO_RUN_ID) return -1;
    return b.startTs.localeCompare(a.startTs);
  });

  return { live, runs, inbox: readInboxRows(cwd) };
}

export interface DrainObservationState {
  pid: number;
  pidAlive: boolean;
  startedAt: string;
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  inFlight: Array<{ slug: string; phase: string }>;
  merging: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
}

export interface ParkedRow {
  slug: string;
  source: string;
  reason: string;
  ts: string;
}

export interface DrainObservation {
  /** null ⇒ no drain-state.json ⇒ "no drain recorded". */
  state: DrainObservationState | null;
  parked: ParkedRow[];
  /** loadWatchLogTail — null ⇒ no watch.log yet. */
  logTail: string | null;
}

export interface DrainObservationDeps {
  /** Liveness probe; default = signal-0. Injectable so tests exercise dead pids. */
  isPidAlive?: (pid: number) => boolean;
}

/**
 * Drain-level observation payload for the /agents page: the drain-state
 * heartbeat, parked entries, and the shared watch-log tail. Every source file
 * is individually failure-tolerant — missing or corrupt ⇒ that section renders
 * its empty state, never a 500.
 */
export async function loadDrainObservation(
  cwd: string = getDocRoot(),
  deps: DrainObservationDeps = {},
): Promise<DrainObservation> {
  const isPidAlive = deps.isPidAlive ?? defaultPidAlive;
  let state: DrainObservationState | null = null;
  try {
    const raw = JSON.parse(
      await readFile(join(cwd, '.noldor', 'drain-state.json'), 'utf8'),
    ) as DrainState;
    state = {
      pid: raw.pid,
      pidAlive: isPidAlive(raw.pid),
      startedAt: raw.startedAt,
      phase: raw.phase,
      inFlight: raw.inFlight ?? [],
      merging: raw.merging ?? null,
      shipped: raw.shipped,
      skip: raw.skip ?? [],
      retries: raw.retries ?? {},
    };
  } catch {
    state = null;
  }
  // On disk the park file is a ParkMap keyed `"${source}:${slug}"` — slug and
  // source are not stored fields, so split the key. A colon-free key (unreachable
  // via parkKey, defensive) maps to source '' + the whole key as slug.
  let parked: ParkedRow[] = [];
  try {
    parked = Object.entries(loadPark(cwd)).map(([key, v]) => {
      const i = key.indexOf(':');
      return {
        source: i === -1 ? '' : key.slice(0, i),
        slug: i === -1 ? key : key.slice(i + 1),
        reason: v.reason,
        ts: v.ts,
      };
    });
  } catch {
    parked = [];
  }
  return { state, parked, logTail: await loadWatchLogTail(cwd) };
}

/**
 * Last `maxLines` lines of the SHARED watch log (`.noldor/watch.log`,
 * {@link WATCH_LOG_REL}) — a single file for all drain modes: the detached
 * daemon redirects its whole stdio there, attached drains tee child output
 * into it via `spawnAgent`'s `logSink`. Rows interleave at K>1 and the UI
 * labels it as shared. Absent file → null (route renders a friendly empty
 * state).
 */
export async function loadWatchLogTail(
  cwd: string = getDocRoot(),
  maxLines = 200,
): Promise<string | null> {
  try {
    const raw = await readFile(join(cwd, WATCH_LOG_REL), 'utf8');
    const lines = raw.split('\n');
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  } catch {
    return null;
  }
}
