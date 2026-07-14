import { describeWarning, renderMarkdown } from './data.js';
import { escapeHtml } from './layout.js';
import { loadConsumerConfig } from '../core/consumer-config.js';

import type { BacklogEntry } from '../utils/parse-blocks.js';
import type { BlockedByGraphView } from './data.js';
import type { MetricResult, MetricsReport } from '../metrics/types.js';
import type { Gap } from '../core/fd-load.js';
import type {
  ActiveMilestonePayload,
  AgentActivity,
  AgentRunGroup,
  LiveAgentRow,
  DrainObservation,
  DashboardCounts,
  FeatureDetail,
  FeatureRecord,
  FrameworkPage,
  FrameworkPageDetail,
  GraphHealthSnapshot,
  HotZoneRow,
  MilestoneGroup,
  ReleaseNotes,
  Roadmap,
  RoadmapEntry,
  SkillPage,
  SkillPageDetail,
  TestPyramidRow,
  UserDocDetail,
  UserDocsCategoryData,
  VelocityStats,
  Vision,
  WipAgeRow,
  WorktreeHealth,
} from './data.js';

function deriveRepoSlug(repoUrl: string): string {
  // 'https://github.com/owner/repo' -> 'owner/repo'
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return m?.[1] ?? 'unknown/unknown';
}

const GITHUB_REPO = process.env.GITHUB_REPO ?? deriveRepoSlug(loadConsumerConfig().repoUrl);

/**
 * Parse a comma-separated multi-select URL param.
 *
 * Trims whitespace, drops empty segments. Stable order preserves URL form.
 */
export function parseMultiParam(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Toggle a value in a multi-select param list. Returns a new array; does not
 * mutate the input.
 */
export function toggleMultiParam(current: string[], value: string): string[] {
  if (current.includes(value)) {
    return current.filter((v) => v !== value);
  }
  return [...current, value];
}

/**
 * Render a row of toggle chips for a single multi-select param.
 *
 * Each chip is an anchor whose href encodes the toggled state of the named
 * `param` while carrying every entry in `otherParams` forward unchanged.
 * Empty result-list serializes to param-omission (clean URL).
 *
 * @param opts.label - Human-readable label printed once at the row start
 * @param opts.param - URL param name (e.g. "size")
 * @param opts.values - All possible values in display order
 * @param opts.selected - Currently-selected values
 * @param opts.otherParams - Every URL param except `param`
 * @returns HTML fragment for one `<div class="chip-row">` element
 */
export function renderChipRow(opts: {
  label: string;
  param: string;
  values: string[];
  selected: string[];
  otherParams: URLSearchParams;
}): string {
  const chips = opts.values
    .map((v) => {
      const next = toggleMultiParam(opts.selected, v);
      const params = new URLSearchParams(opts.otherParams);
      if (next.length > 0) params.set(opts.param, next.join(','));
      const qs = params.toString();
      const href = qs.length > 0 ? `?${qs}` : '?';
      const cls = opts.selected.includes(v) ? 'chip selected' : 'chip';
      return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(v)}</a>`;
    })
    .join(' ');
  return `<div class="chip-row"><span class="chip-label">${escapeHtml(opts.label)}</span> ${chips}</div>`;
}

export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL'] as const;
export const IMPACT_ORDER = ['low', 'med', 'high', 'critical'] as const;

/**
 * Age buckets for the `/backlog` view, oldest last. `undated` collects
 * entries with a missing or unparseable `since:` field.
 */
export const AGE_BUCKET_ORDER = ['0-30d', '30-90d', '90d+', 'undated'] as const;
export type AgeBucket = (typeof AGE_BUCKET_ORDER)[number];

const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  '0-30d': '0–30 days',
  '30-90d': '30–90 days',
  '90d+': '90+ days',
  undated: 'No date',
};

const DAY_MS = 86_400_000;

/**
 * Bucket a backlog entry by the age of its `since:` date — pure frontmatter
 * math, no git. Boundaries are inclusive on the young side (exactly 30 days
 * → `0-30d`, exactly 90 → `30-90d`); future dates clamp to `0-30d`; missing
 * or unparseable dates land in `undated`.
 */
export function ageBucket(since: string | undefined, now: Date): AgeBucket {
  if (!since) return 'undated';
  const t = Date.parse(since);
  if (Number.isNaN(t)) return 'undated';
  const days = (now.getTime() - t) / DAY_MS;
  if (days <= 30) return '0-30d';
  if (days <= 90) return '30-90d';
  return '90d+';
}

export interface SortableEntry {
  name: string;
  size?: string;
  impact?: string;
  since?: string;
  area?: string;
  type?: string;
}

export const SORT_MODES = [
  ['name-asc', 'Name A→Z'],
  ['size-asc', 'Size ↑ (XS → XL)'],
  ['size-desc', 'Size ↓ (XL → XS)'],
  ['impact-desc', 'Impact ↓ (critical → low)'],
  ['impact-asc', 'Impact ↑ (low → critical)'],
  ['since-desc', 'Since ↓ (newest)'],
  ['since-asc', 'Since ↑ (oldest)'],
  ['area-asc', 'Area A→Z'],
  ['type-asc', 'Type A→Z'],
] as const;

/**
 * Sort modes shown in the roadmap / backlog dropdown — `priority` (file
 * order) is the first option and the new default. The remaining modes
 * mirror {@link SORT_MODES}, which is also used by other views that do
 * not need a file-order option.
 */
export const PRIORITY_SORT_MODES = [['priority', 'Priority'], ...SORT_MODES] as const;

/**
 * Compare two values that may be undefined. Undefined ALWAYS sorts last,
 * independent of direction. `direction` controls the ordering of defined
 * values only.
 */
function cmpUndefLast<V>(
  a: V | undefined,
  b: V | undefined,
  direction: 'asc' | 'desc',
  cmp: (x: V, y: V) => number,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return direction === 'asc' ? cmp(a, b) : cmp(b, a);
}

const ordinalOf = (value: string, order: readonly string[]): number => order.indexOf(value);

const cmpOrdinal =
  (order: readonly string[]) =>
  (a: string, b: string): number =>
    ordinalOf(a, order) - ordinalOf(b, order);

const cmpString = (a: string, b: string): number => a.localeCompare(b);

/**
 * Sort a list of entries by the named sort mode. Pure — returns a new array.
 *
 * Mode resolution:
 * - Empty-string `mode` routes to `defaultSort` (caller-supplied; back-compat
 *   default `'name-asc'`). Roadmap and backlog views pass `'priority'` so the
 *   no-query-string URL renders entries in source-file order.
 * - `'priority'` is identity — entries arrive in source order from the
 *   parser, so we return them unchanged. This is the only mode where the
 *   drag-and-drop UI is allowed to be enabled (see spec §1 activation rule).
 * - Unknown modes fall back to `name-asc`.
 *
 * Undefined ordinal/string values sort LAST in both `asc` and `desc`
 * directions (so an entry without `size:` never jumps to the top of a
 * `size-asc` view, and never to the top of a `size-desc` view either).
 */
export function sortEntries<T extends SortableEntry>(
  entries: readonly T[],
  mode: string,
  defaultSort: string = 'name-asc',
): T[] {
  const effective = mode === '' ? defaultSort : mode;
  const arr = [...entries];
  switch (effective) {
    case 'priority':
      // Identity — entries arrive in source order from the parser.
      break;
    case 'size-asc':
      arr.sort((a, b) => cmpUndefLast(a.size, b.size, 'asc', cmpOrdinal(SIZE_ORDER)));
      break;
    case 'size-desc':
      arr.sort((a, b) => cmpUndefLast(a.size, b.size, 'desc', cmpOrdinal(SIZE_ORDER)));
      break;
    case 'impact-desc':
      arr.sort((a, b) => cmpUndefLast(a.impact, b.impact, 'desc', cmpOrdinal(IMPACT_ORDER)));
      break;
    case 'impact-asc':
      arr.sort((a, b) => cmpUndefLast(a.impact, b.impact, 'asc', cmpOrdinal(IMPACT_ORDER)));
      break;
    case 'since-desc':
      arr.sort((a, b) => cmpUndefLast(a.since, b.since, 'desc', cmpString));
      break;
    case 'since-asc':
      arr.sort((a, b) => cmpUndefLast(a.since, b.since, 'asc', cmpString));
      break;
    case 'area-asc':
      arr.sort((a, b) => cmpUndefLast(a.area, b.area, 'asc', cmpString));
      break;
    case 'type-asc':
      arr.sort((a, b) => cmpUndefLast(a.type, b.type, 'asc', cmpString));
      break;
    default:
      arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return arr;
}

async function renderDescription(md: string): Promise<string> {
  return renderMarkdown(md);
}

/**
 * Flatten markdown to a single plain-text string suitable for CSS
 * `-webkit-line-clamp`. Block-level constructs (lists, code fences,
 * headings) cannot live inside a single line-clamped element because
 * `-webkit-line-clamp` requires a single block-formatting context with
 * text children — `<summary>` cannot contain `<p>`/`<pre>` per spec.
 *
 * Transformations:
 * - Strip fenced code blocks entirely (block-level cannot be inline-flattened).
 * - Strip heading markers (`#`).
 * - Flatten list bullets (`-`, `*`, `+`) to comma-joined items.
 * - Strip inline code (`) and emphasis (`*`/`_`) markers, keeping the text.
 * - Collapse all whitespace runs to single spaces; trim.
 *
 * Pure. Used by the `/roadmap` and `/backlog` row builders to produce the
 * preview span sibling of the full markdown body div (Task 4).
 *
 * @param markdown - Source markdown.
 * @returns Plain-text preview suitable for clamped display.
 */
export function plainTextPreview(markdown: string): string {
  let text = markdown;
  // 1. Drop fenced code blocks (any language tag).
  text = text.replace(/```[\s\S]*?```/g, '');
  // 2. Strip inline code markers but keep the content.
  text = text.replace(/`([^`]*)`/g, '$1');
  // 3. Strip heading markers (e.g. "## Foo" → "Foo").
  text = text.replace(/^#{1,6}\s+/gm, '');
  // 4. Replace list bullets with the item text only.
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  // 5. Strip emphasis markers (* and _).
  text = text.replace(/[*_]+/g, '');
  // 6. Split into non-empty trimmed lines, then join with appropriate
  //    separators: list-item runs become comma-joined; paragraphs become
  //    space-separated. Heuristic: consecutive non-empty lines with no
  //    blank line between them are treated as a list-ish run when the
  //    original input had bullet markers.
  const hadList = /^[ \t]*[-*+]\s+/m.test(markdown);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  if (hadList && lines.length > 1) {
    return lines.join(', ');
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * KPI bundle for the overview page, grouped into three sections so the
 * counter strip stays scannable.
 */
export interface OverviewKpis {
  project: DashboardCounts;
  activity: {
    commits7d: number;
    commits30d: number;
    commits90d: number;
    lastReleaseDaysAgo: number | null;
    activeBranches: number;
  };
  health: {
    staleWip: number;
    dirtyWorktrees: number;
    behindWorktrees: number;
    warnings: number;
  };
}

function renderCounter(v: string | number, l: string, href?: string): string {
  const counter = `<div class="counter"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  return href ? `<a class="counter-link" href="${href}">${counter}</a>` : counter;
}

function cmpStr(x: string | undefined, y: string | undefined): number {
  return (x ?? '').localeCompare(y ?? '');
}

/**
 * Render the milestone banner: current milestone label + description. Resolves
 * the active milestone file by slug from vision frontmatter.
 *
 * @param vision - Vision payload (frontmatter only is used here)
 * @param activeMilestone - Resolved milestone payload, or null if not found / not set
 * @returns HTML banner string
 */
export function renderMilestoneBanner(
  vision: Vision,
  activeMilestone: ActiveMilestonePayload | null,
): string {
  const slug = vision.frontmatter['current-milestone'];
  if (!slug) {
    return '';
  }
  if (!activeMilestone) {
    return `<aside class="milestone-banner warn">
    <div class="line">Milestone slug "${escapeHtml(slug)}" referenced in vision but file not found — run <code>pnpm validate:milestones</code>.</div>
  </aside>`;
  }
  const tagline = activeMilestone.description
    ? ` — ${escapeHtml(activeMilestone.description)}`
    : '';
  return `<aside class="milestone-banner">
    <div class="line"><span class="label">Current milestone</span> <strong>${escapeHtml(activeMilestone.name)}</strong>${tagline} · <a href="/vision">read vision →</a></div>
  </aside>`;
}

/**
 * Render the `/milestones` page: milestones grouped by status (active → draft →
 * shipped), each listing its member features as links with a phase chip and a
 * done/total roll-up. A shipped milestone with any non-`done` member renders in
 * the `warn` style (echoing the garden `milestone-shipped-incomplete` detector).
 * Empty-state when no milestones are declared — the layer is optional.
 *
 * @param groups - Milestone groups from `buildMilestoneGroups`
 * @returns HTML body string
 */
export function renderMilestones(groups: MilestoneGroup[]): string {
  if (groups.length === 0) {
    return `<h1>Milestones</h1><p class="empty">No milestones declared — milestones are optional. Create one with <code>/noldor-milestone draft</code>.</p>`;
  }
  const sections = groups
    .map((g) => {
      const members =
        g.members.length === 0
          ? '<p class="empty">No member features.</p>'
          : `<ul>${g.members
              .map(
                (f) =>
                  `<li><a href="/features/${escapeHtml(f.slug)}">${escapeHtml(f.frontmatter.name)}</a> <span class="chip">${escapeHtml(f.frontmatter.phase)}</span></li>`,
              )
              .join('')}</ul>`;
      const desc = g.description ? ` — ${escapeHtml(g.description)}` : '';
      return `<section class="milestone-group${g.incomplete ? ' warn' : ''}">
        <div class="status">${escapeHtml(g.status)}${g.incomplete ? ' · shipped with open features' : ''}</div>
        <h3>${escapeHtml(g.name)} <span class="chip">${g.doneCount}/${g.total} done</span></h3>
        ${desc ? `<p>${desc.slice(3)}</p>` : ''}
        ${members}
      </section>`;
    })
    .join('');
  return `<h1>Milestones</h1>${sections}`;
}

/**
 * Render the overview page: milestone banner, three KPI sections
 * (Project / Activity / Health), the In-progress list (derived from
 * features with `phase: in-progress`), and the recently shipped list.
 *
 * @param kpis - Pre-computed KPI bundle for the three sections.
 * @param inProgressFeatures - Features whose frontmatter `phase` is `in-progress`.
 * @param recentDone - Recently shipped features.
 * @param vision - Vision payload for the milestone banner.
 * @param activeMilestone - Resolved milestone payload, or null if not found / not set.
 * @returns HTML body string
 */
export function renderOverview(
  kpis: OverviewKpis,
  inProgressFeatures: FeatureRecord[],
  recentDone: FeatureRecord[],
  vision: Vision,
  activeMilestone: ActiveMilestonePayload | null,
): string {
  const banner = renderMilestoneBanner(vision, activeMilestone);
  const projectSection = `<div class="kpi-section"><h3>Project</h3><div class="counter-strip">
    ${renderCounter(`${kpis.project.features.byPhase.done}/${kpis.project.features.total}`, 'features done')}
    ${renderCounter(kpis.project.features.byPhase['in-progress'], 'in progress')}
    ${renderCounter(kpis.project.gaps, 'gaps')}
    ${renderCounter(kpis.project.roadmap.total, 'roadmap')}
    ${renderCounter(kpis.project.backlog, 'backlog')}
    ${renderCounter(kpis.project.skills, 'skills', '/framework#skills')}
    ${renderCounter(kpis.project.scripts, 'scripts')}
  </div></div>`;

  const activitySection = `<div class="kpi-section"><h3>Activity</h3><div class="counter-strip">
    ${renderCounter(kpis.activity.commits7d, 'commits 7d')}
    ${renderCounter(kpis.activity.commits30d, 'commits 30d')}
    ${renderCounter(kpis.activity.commits90d, 'commits 90d')}
    ${renderCounter(kpis.activity.lastReleaseDaysAgo ?? '—', 'days since release')}
    ${renderCounter(kpis.activity.activeBranches, 'active branches')}
  </div></div>`;

  const healthSection = `<div class="kpi-section"><h3>Health</h3><div class="counter-strip">
    ${renderCounter(kpis.health.staleWip, 'stale WIP (≥14d)')}
    ${renderCounter(kpis.health.dirtyWorktrees, 'dirty worktrees')}
    ${renderCounter(kpis.health.behindWorktrees, 'behind worktrees')}
    ${renderCounter(kpis.health.warnings, 'worktree warnings')}
  </div></div>`;

  const inProgressList =
    inProgressFeatures.length === 0
      ? '<p class="empty">No features in progress.</p>'
      : `<ul>${inProgressFeatures
          .map(
            (f) =>
              `<li><a href="/features/${escapeHtml(f.slug)}"><strong>${escapeHtml(f.frontmatter.name)}</strong></a> — ${escapeHtml(f.frontmatter.area)}</li>`,
          )
          .join('')}</ul>`;

  const recentList =
    recentDone.length === 0
      ? '<p class="empty">No recently shipped features.</p>'
      : `<ul>${recentDone.map((f) => `<li><a href="/features/${escapeHtml(f.slug)}">${escapeHtml(f.frontmatter.name)}</a> — ${escapeHtml(f.frontmatter.introduced ?? 'unreleased')}</li>`).join('')}</ul>`;

  return `<h1>Overview</h1>
    ${banner}
    ${projectSection}
    ${activitySection}
    ${healthSection}
    <h2>In progress</h2>${inProgressList}
    <h2>Recently shipped</h2>${recentList}`;
}

/**
 * Render the `/vision` page: frontmatter table on top (when active milestone
 * is present), rendered markdown body below. Mirrors the feature drill-down
 * shape so the layout reads consistently across the dashboard.
 *
 * @param vision - Vision payload with rendered HTML body
 * @param activeMilestone - Resolved milestone payload, or null if not found / not set
 * @returns HTML body string
 */
export function renderVision(
  vision: Vision,
  activeMilestone: ActiveMilestonePayload | null,
): string {
  const slug = vision.frontmatter['current-milestone'];
  const rows: Array<[string, string]> = [];
  if (slug && activeMilestone) {
    rows.push(['current milestone', activeMilestone.name]);
    if (activeMilestone.description) rows.push(['description', activeMilestone.description]);
  }
  const table = rows.length
    ? `<table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`
    : '';
  return `${table}<div class="body">${vision.bodyHtml}</div>`;
}

/**
 * Render the release-notes page — source-file breadcrumb + the rendered
 * body. The body's leading `# Release Notes` header serves as the page
 * heading; no extra `<h1>` here.
 *
 * @param notes - Notes payload from `loadReleaseNotes`
 * @returns HTML body string
 */
export function renderReleaseNotes(notes: ReleaseNotes): string {
  return `<p><code>docs/release-notes.md</code></p>
    <div class="body">${notes.bodyHtml}</div>`;
}

/**
 * Render the framework index — the `docs/noldor/` page table followed by a
 * merged Skills subsection (skills are framework surface; a separate page
 * split related signal). One page row per `docs/noldor/` page linking to
 * `/framework/<slug>`; one skill row per project-local skill linking to
 * `/skills/<slug>`.
 *
 * @param pages - Pages from `loadFrameworkPages`
 * @param skills - Skills from `loadSkills`
 * @returns HTML body string
 */
export function renderFrameworkIndex(pages: FrameworkPage[], skills: SkillPage[]): string {
  const pageRows = pages
    .map(
      (p) => `<tr>
      <td><a href="/framework/${escapeHtml(p.slug)}"><strong>${escapeHtml(p.title)}</strong></a></td>
    </tr>`,
    )
    .join('');
  const skillRows = skills
    .map(
      (s) => `<tr>
      <td><a href="/skills/${escapeHtml(s.slug)}"><strong>/${escapeHtml(s.name)}</strong></a></td>
      <td>${escapeHtml(s.description)}</td>
    </tr>`,
    )
    .join('');
  return `<h1>Framework</h1>
    <p>Noldor framework pages (${pages.length}). Source: <code>docs/noldor/</code>.</p>
    <table>
      <thead><tr><th>Page</th></tr></thead>
      <tbody>${pageRows}</tbody>
    </table>
    <h2 id="skills">Skills</h2>
    <p>Project-local skills (${skills.length}). Source: <code>.claude/skills/&lt;name&gt;/SKILL.md</code> · operator summaries in <a href="/framework/skill-catalog">skill-catalog</a>.</p>
    <table>
      <thead><tr><th>Trigger</th><th>Description</th></tr></thead>
      <tbody>${skillRows}</tbody>
    </table>`;
}

/**
 * Render a single framework page: title, breadcrumb back to index,
 * source-file path, and the link-rewritten body in `.body` for
 * markdown styling.
 *
 * @param page - Detail from `loadFrameworkPage`
 * @returns HTML body string
 */
export function renderFrameworkPage(page: FrameworkPageDetail): string {
  return `<h1>${escapeHtml(page.title)}</h1>
    <p><a href="/framework">← back to framework index</a> · <code>docs/noldor/${escapeHtml(page.slug)}.md</code></p>
    <div class="body">${page.bodyHtml}</div>`;
}

/**
 * Render a single skill: trigger title, breadcrumb back to the merged
 * framework index (skills live there now), source-file path, cross-link to
 * its skill-catalog block, and the rendered SKILL.md body in `.body` for
 * markdown styling.
 *
 * @param skill - Detail from `loadSkill`
 * @returns HTML body string
 */
export function renderSkillPage(skill: SkillPageDetail): string {
  return `<h1>/${escapeHtml(skill.name)}</h1>
    <p><a href="/framework#skills">← back to framework</a> · <code>.claude/skills/${escapeHtml(skill.slug)}/SKILL.md</code> · <a href="/framework/skill-catalog">operator summary →</a></p>
    <div class="body">${skill.bodyHtml}</div>`;
}

/**
 * Render the user-docs index as a single flat list grouped by Diátaxis
 * category. Mirrors `/gaps` shape: a category filter dropdown plus
 * `<h2>Category (N)</h2>` headings with per-doc bullet lists. Each doc
 * links straight to `/docs/<category>/<slug>` so the index also serves
 * as a one-click jumplist into doc detail.
 *
 * @param categories - Categories from `loadUserDocs`
 * @param filters - Active filter state from the URL querystring
 * @returns HTML body string
 */
export function renderUserDocsIndex(
  categories: UserDocsCategoryData[],
  filters: { category: string },
): string {
  const filtered = filters.category
    ? categories.filter((c) => c.category === filters.category)
    : categories;
  const allCategoryNames = categories.map((c) => c.category).toSorted();
  const form = `<form class="filters" method="get">
    <label>Category
      <select name="category" onchange="this.form.submit()">
        <option value="">All</option>
        ${allCategoryNames
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}"${c === filters.category ? ' selected' : ''}>${escapeHtml(c)}</option>`,
          )
          .join('')}
      </select>
    </label>
  </form>`;
  const sections = filtered
    .filter((c) => c.docs.length > 0)
    .map(
      (c) =>
        `<h2>${escapeHtml(c.category)} (${c.docs.length})</h2><ul>${c.docs
          .map(
            (d) =>
              `<li><a href="/docs/${escapeHtml(c.category)}/${escapeHtml(d.slug)}"><strong>${escapeHtml(d.title)}</strong></a></li>`,
          )
          .join('')}</ul>`,
    )
    .join('');
  const header = `<h1>Docs</h1>
    <p>User documentation organized by the <a href="https://diataxis.fr/">Diátaxis</a> framework. Source: <code>docs/user/</code>.</p>
    ${form}`;
  if (sections.length === 0) {
    return `${header}<p class="empty">No matching docs.</p>`;
  }
  return `${header}${sections}`;
}

/**
 * Render a single user doc — title, breadcrumb back to the docs index,
 * source-file path, link-rewritten body in `.body` for markdown styling.
 *
 * @param category - Diátaxis category (for the source path display)
 * @param doc - Detail from `loadUserDoc`
 * @returns HTML body string
 */
export function renderUserDoc(category: string, doc: UserDocDetail): string {
  return `<h1>${escapeHtml(doc.title)}</h1>
    <p><a href="/docs">← back to docs</a> · <code>docs/user/${escapeHtml(category)}/${escapeHtml(doc.slug)}.md</code></p>
    <div class="body">${doc.bodyHtml}</div>`;
}

const DRAG_GRIP_SVG = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.2"/><circle cx="8" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="8" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="8" cy="12" r="1.2"/></svg>`;

/**
 * Render the stable entry ID (Q-NNNN) as a muted line under the entry name.
 * Empty string when the entry carries no ID (consumer repos that haven't run
 * `triage backfill-ids`).
 */
function renderEntryId(id: string | undefined): string {
  return id ? `<span class="entry-id">${escapeHtml(id)}</span>` : '';
}

async function renderRoadmapRows(entries: RoadmapEntry[], dragEnabled: boolean): Promise<string> {
  const dragAttr = dragEnabled ? 'true' : 'false';
  const handleClass = dragEnabled ? 'drag-handle' : 'drag-handle drag-handle--disabled';
  const rows = await Promise.all(
    entries.map(async (e) => {
      const typeBadge = e.type
        ? `<span class="badge type-${escapeHtml(e.type)}">${escapeHtml(e.type)}</span>`
        : '—';
      const slug = escapeHtml(e.slug);
      const descId = `desc-${slug}`;
      const descHtml = await renderDescription(e.body);
      return `<tr data-slug="${slug}" draggable="${dragAttr}">
        <td class="${handleClass}" aria-label="Drag to reorder">${DRAG_GRIP_SVG}</td>
        <td><strong>${escapeHtml(e.name)}</strong>${renderEntryId(e.id)}</td>
        <td>${escapeHtml(e.category ?? '—')}</td>
        <td>${escapeHtml(e.area)}</td>
        <td>${typeBadge}</td>
        <td>${escapeHtml(e.size ?? '—')}</td>
        <td>${escapeHtml(e.impact ?? '—')}</td>
        <td>${escapeHtml(e.since ?? '—')}</td>
        <td class="description"><span class="description--clamped">${escapeHtml(plainTextPreview(e.body))}</span><div id="${descId}" class="body description-full">${descHtml}</div><button type="button" class="description-toggle" aria-expanded="false" aria-controls="${descId}">Show more</button></td>
        <td class="actions"><div class="actions-inner"><button type="button" class="move-chip" data-action="move-top" data-slug="${slug}"><span class="move-chip__arrow" aria-hidden="true">⤒</span>Top</button><button type="button" class="move-chip" data-action="move-bottom" data-slug="${slug}"><span class="move-chip__arrow" aria-hidden="true">⤓</span>Bottom</button><button type="button" class="move-chip" data-action="demote" data-slug="${slug}"><span class="move-chip__arrow" aria-hidden="true">↓</span>Demote</button><button type="button" class="remove-chip" data-action="remove" data-section="roadmap" data-slug="${slug}">Remove</button></div></td>
      </tr>`;
    }),
  );
  return rows.join('');
}

/**
 * Render the roadmap as a single flat priority-ordered table, filterable
 * by area / type / category / size / impact, with a sort dropdown and
 * toggle chips for the multi-select params.
 *
 * One table replaces the old Now / Next / Later section split — file order
 * in `docs/roadmap.md` is the priority. The row count badge shows
 * `(filtered of total)` so filter state is visible at a glance.
 *
 * The rendered `<table>` carries `data-section="roadmap"`, `data-etag` (the
 * file's content hash for optimistic-concurrency checks against the move
 * API), and `data-drag-enabled` (the spec §1 activation predicate, computed
 * in the caller). Each row carries `data-slug`, a conditional `draggable`
 * attribute, a leading drag-handle cell, and trailing Top / Bottom / Demote
 * buttons that the client-side script (Task 7) wires up. Top / Bottom resolve
 * against the full file order server-side, so they work from filtered and
 * sorted views where drag is disabled. When `dragEnabled` is false the
 * drag handle is dimmed via the `drag-handle--disabled` CSS class.
 *
 * @param roadmap - Parsed roadmap (flat array in priority order)
 * @param filters - Active filter state from the URL querystring
 * @param meta - File hash + drag-activation flag (see spec §1)
 * @returns HTML body string
 */
export async function renderRoadmap(
  roadmap: Roadmap,
  filters: {
    area: string;
    type: string;
    category: string;
    size: string[];
    impact: string[];
    sort: string;
  },
  meta: { rawHash: string; dragEnabled: boolean } = { rawHash: '', dragEnabled: false },
): Promise<string> {
  const areas = Array.from(new Set(roadmap.map((e) => e.area))).toSorted();
  const types = Array.from(
    new Set(roadmap.map((e) => e.type).filter((t): t is string => Boolean(t))),
  ).toSorted();
  const categories = Array.from(
    new Set(roadmap.map((e) => e.category).filter((c): c is string => Boolean(c))),
  ).toSorted();

  const matches = (e: RoadmapEntry): boolean =>
    (!filters.area || e.area === filters.area) &&
    (!filters.type || e.type === filters.type) &&
    (!filters.category || e.category === filters.category) &&
    (filters.size.length === 0 || (e.size !== undefined && filters.size.includes(e.size))) &&
    (filters.impact.length === 0 || (e.impact !== undefined && filters.impact.includes(e.impact)));

  const filtered = sortEntries(roadmap.filter(matches), filters.sort, 'priority');

  const buildOther = (excluded: 'size' | 'impact'): URLSearchParams => {
    const p = new URLSearchParams();
    if (filters.area) p.set('area', filters.area);
    if (filters.type) p.set('type', filters.type);
    if (filters.category) p.set('category', filters.category);
    if (filters.sort) p.set('sort', filters.sort);
    if (excluded !== 'size' && filters.size.length > 0) p.set('size', filters.size.join(','));
    if (excluded !== 'impact' && filters.impact.length > 0)
      p.set('impact', filters.impact.join(','));
    return p;
  };

  // `Priority` (file order) is the new default — it's selected when sort is
  // empty (no querystring) OR explicit `priority`. Other modes mirror SORT_MODES.
  const priorityIsSelected = filters.sort === '' || filters.sort === 'priority';
  const sortOptions = PRIORITY_SORT_MODES.map(([v, l]) => {
    const isSelected = v === 'priority' ? priorityIsSelected : v === filters.sort;
    return `<option value="${escapeHtml(v)}"${isSelected ? ' selected' : ''}>${escapeHtml(l)}</option>`;
  }).join('');

  const selectForm = `<form class="filters" method="get">
    <label>Area
      <select name="area" onchange="this.form.submit()">
        <option value="">All</option>
        ${areas.map((a) => `<option value="${escapeHtml(a)}"${a === filters.area ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
    </label>
    <label>Type
      <select name="type" onchange="this.form.submit()">
        <option value="">All</option>
        ${types.map((t) => `<option value="${escapeHtml(t)}"${t === filters.type ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>
    </label>
    <label>Category
      <select name="category" onchange="this.form.submit()">
        <option value="">All</option>
        ${categories.map((c) => `<option value="${escapeHtml(c)}"${c === filters.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </label>
    <label>Sort
      <select name="sort" onchange="this.form.submit()">${sortOptions}</select>
    </label>
    ${filters.size.length > 0 ? `<input type="hidden" name="size" value="${escapeHtml(filters.size.join(','))}" />` : ''}
    ${filters.impact.length > 0 ? `<input type="hidden" name="impact" value="${escapeHtml(filters.impact.join(','))}" />` : ''}
  </form>`;

  const sizeChips = renderChipRow({
    label: 'Size',
    param: 'size',
    values: [...SIZE_ORDER],
    selected: filters.size,
    otherParams: buildOther('size'),
  });
  const impactChips = renderChipRow({
    label: 'Impact',
    param: 'impact',
    values: [...IMPACT_ORDER],
    selected: filters.impact,
    otherParams: buildOther('impact'),
  });
  const resetLink = `<a class="reset" href="?">Reset</a>`;

  if (filtered.length === 0) {
    return `<h1>Roadmap</h1>${selectForm}${sizeChips}${impactChips}<p>${resetLink}</p><p class="empty">No matching entries (0 of ${roadmap.length}).</p>`;
  }
  const dragEnabledAttr = meta.dragEnabled ? 'true' : 'false';
  const tbody = await renderRoadmapRows(filtered, meta.dragEnabled);
  return `<h1>Roadmap</h1>${selectForm}${sizeChips}${impactChips}<p>${resetLink}</p><p class="count">(${filtered.length} of ${roadmap.length})</p><table data-section="roadmap" data-etag="${escapeHtml(meta.rawHash)}" data-drag-enabled="${dragEnabledAttr}">
    <thead><tr><th class="drag-col" aria-hidden="true"></th><th>Name</th><th>Category</th><th>Area</th><th>Type</th><th>Size</th><th>Impact</th><th>Since</th><th>Description</th><th class="action-col">Actions</th></tr></thead>
    <tbody>${tbody}</tbody>
  </table>`;
}

/**
 * Render the backlog list with area / type / size / impact filters, sort
 * dropdown, toggle chips for the multi-select params, and a reset link.
 *
 * Each row shows the entry's name, area, type badge, since date, and the
 * paragraph description so users do not need to drill into `docs/backlog.md`
 * to see the rationale.
 *
 * Entries are grouped into age buckets by their `since:` field
 * ({@link ageBucket} — 0–30 / 30–90 / 90+ days, undated last); old entries
 * are signal to promote, demote, or delete. Each non-empty bucket renders
 * its own heading + table; filters and sort apply across buckets, sort
 * order is preserved within each bucket.
 *
 * Every bucket `<table>` carries `data-section="backlog"` + `data-etag`
 * (the promote-button wiring in `static/drag.ts` binds per-table); rows
 * expose only a trailing Promote button (no drag-handle column, no
 * `draggable` attribute) — `docs/backlog.md` is a priority-less parking
 * lot, so file order is incidental and drag-to-reorder UI is conceptually
 * noise.
 *
 * @param entries - Backlog entries
 * @param filters - Active filter state
 * @param meta - File hash (etag attribute on the table); `now` overrides
 *   the bucket-math clock (tests)
 * @returns HTML body string
 */
export async function renderBacklog(
  entries: BacklogEntry[],
  filters: {
    area: string;
    type: string;
    category: string;
    size: string[];
    impact: string[];
    sort: string;
  },
  meta: { rawHash: string; now?: Date } = { rawHash: '' },
): Promise<string> {
  const matches = (e: BacklogEntry): boolean =>
    (!filters.area || e.area === filters.area) &&
    (!filters.type || e.type === filters.type) &&
    (!filters.category || e.category === filters.category) &&
    (filters.size.length === 0 || (e.size !== undefined && filters.size.includes(e.size))) &&
    (filters.impact.length === 0 || (e.impact !== undefined && filters.impact.includes(e.impact)));

  const filtered = sortEntries(entries.filter(matches), filters.sort, 'priority');
  const areas = Array.from(new Set(entries.map((e) => e.area))).toSorted();
  const types = Array.from(
    new Set(entries.map((e) => e.type).filter((t): t is string => Boolean(t))),
  ).toSorted();
  const categories = Array.from(
    new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c))),
  ).toSorted();

  const buildOther = (excluded: 'size' | 'impact'): URLSearchParams => {
    const p = new URLSearchParams();
    if (filters.area) p.set('area', filters.area);
    if (filters.type) p.set('type', filters.type);
    if (filters.category) p.set('category', filters.category);
    if (filters.sort) p.set('sort', filters.sort);
    if (excluded !== 'size' && filters.size.length > 0) p.set('size', filters.size.join(','));
    if (excluded !== 'impact' && filters.impact.length > 0)
      p.set('impact', filters.impact.join(','));
    return p;
  };

  const priorityIsSelected = filters.sort === '' || filters.sort === 'priority';
  const sortOptions = PRIORITY_SORT_MODES.map(([v, l]) => {
    const isSelected = v === 'priority' ? priorityIsSelected : v === filters.sort;
    return `<option value="${escapeHtml(v)}"${isSelected ? ' selected' : ''}>${escapeHtml(l)}</option>`;
  }).join('');

  const selectForm = `<form class="filters" method="get">
    <label>Area
      <select name="area" onchange="this.form.submit()">
        <option value="">All</option>
        ${areas.map((a) => `<option value="${escapeHtml(a)}"${a === filters.area ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
    </label>
    <label>Type
      <select name="type" onchange="this.form.submit()">
        <option value="">All</option>
        ${types.map((t) => `<option value="${escapeHtml(t)}"${t === filters.type ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>
    </label>
    <label>Category
      <select name="category" onchange="this.form.submit()">
        <option value="">All</option>
        ${categories.map((c) => `<option value="${escapeHtml(c)}"${c === filters.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </label>
    <label>Sort
      <select name="sort" onchange="this.form.submit()">${sortOptions}</select>
    </label>
    ${filters.size.length > 0 ? `<input type="hidden" name="size" value="${escapeHtml(filters.size.join(','))}" />` : ''}
    ${filters.impact.length > 0 ? `<input type="hidden" name="impact" value="${escapeHtml(filters.impact.join(','))}" />` : ''}
  </form>`;

  const sizeChips = renderChipRow({
    label: 'Size',
    param: 'size',
    values: [...SIZE_ORDER],
    selected: filters.size,
    otherParams: buildOther('size'),
  });
  const impactChips = renderChipRow({
    label: 'Impact',
    param: 'impact',
    values: [...IMPACT_ORDER],
    selected: filters.impact,
    otherParams: buildOther('impact'),
  });
  const resetLink = `<a class="reset" href="?">Reset</a>`;

  if (filtered.length === 0) {
    return `<h1>Backlog</h1>${selectForm}${sizeChips}${impactChips}<p>${resetLink}</p><p class="empty">No matching entries (0 of ${entries.length}).</p>`;
  }

  const renderRow = async (e: BacklogEntry): Promise<string> => {
    const typeBadge = e.type
      ? `<span class="badge type-${escapeHtml(e.type)}">${escapeHtml(e.type)}</span>`
      : '—';
    const slug = escapeHtml(e.slug);
    const descId = `desc-${slug}`;
    const descHtml = await renderDescription(e.description);
    return `<tr data-slug="${slug}">
        <td><strong>${escapeHtml(e.name)}</strong>${renderEntryId(e.id)}</td>
        <td>${escapeHtml(e.category ?? '—')}</td>
        <td>${escapeHtml(e.area)}</td>
        <td>${typeBadge}</td>
        <td>${escapeHtml(e.size ?? '—')}</td>
        <td>${escapeHtml(e.impact ?? '—')}</td>
        <td>${escapeHtml(e.since ?? '—')}</td>
        <td class="description"><span class="description--clamped">${escapeHtml(plainTextPreview(e.description))}</span><div id="${descId}" class="body description-full">${descHtml}</div><button type="button" class="description-toggle" aria-expanded="false" aria-controls="${descId}">Show more</button></td>
        <td class="actions"><div class="actions-inner"><button type="button" class="move-chip" data-action="promote" data-slug="${slug}"><span class="move-chip__arrow" aria-hidden="true">↑</span>Promote</button><button type="button" class="remove-chip" data-action="remove" data-section="backlog" data-slug="${slug}">Remove</button></div></td>
      </tr>`;
  };

  const now = meta.now ?? new Date();
  const buckets = new Map<AgeBucket, BacklogEntry[]>();
  for (const e of filtered) {
    const b = ageBucket(e.since, now);
    const group = buckets.get(b);
    if (group) {
      group.push(e);
    } else {
      buckets.set(b, [e]);
    }
  }

  const sections = (
    await Promise.all(
      AGE_BUCKET_ORDER.filter((b) => buckets.has(b)).map(async (b) => {
        const group = buckets.get(b) as BacklogEntry[];
        const rows = (await Promise.all(group.map(renderRow))).join('');
        return `<h2 class="age-bucket">${escapeHtml(AGE_BUCKET_LABELS[b])} (${group.length})</h2><table data-section="backlog" data-etag="${escapeHtml(meta.rawHash)}">
    <thead><tr><th>Name</th><th>Category</th><th>Area</th><th>Type</th><th>Size</th><th>Impact</th><th>Since</th><th>Description</th><th class="action-col">Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
      }),
    )
  ).join('');

  return `<h1>Backlog</h1>${selectForm}${sizeChips}${impactChips}<p>${resetLink}</p><p class="count">(${filtered.length} of ${entries.length})</p>${sections}`;
}

/**
 * Render the feature grid with phase / category / area filter form.
 *
 * @param features - All features
 * @param filters - Active filter state
 * @returns HTML body string
 */
export function renderFeatures(
  features: FeatureRecord[],
  filters: {
    phase: string;
    category: string;
    area: string;
    updated: string;
    sort: string;
    missingIntroduced?: boolean;
  },
  gitUpdated?: ReadonlyMap<string, string>,
): string {
  const filtered = features.filter(
    (f) =>
      (!filters.phase || f.frontmatter.phase === filters.phase) &&
      (!filters.category || f.frontmatter.category === filters.category) &&
      (!filters.area || f.frontmatter.area === filters.area) &&
      (!filters.updated || f.frontmatter.updated === filters.updated) &&
      (!filters.missingIntroduced || !f.frontmatter.introduced),
  );
  const sortMode = filters.sort || 'name-asc';
  filtered.sort((a, b) => {
    switch (sortMode) {
      case 'introduced-desc':
        return cmpStr(b.frontmatter.introduced, a.frontmatter.introduced);
      case 'introduced-asc':
        return cmpStr(a.frontmatter.introduced, b.frontmatter.introduced);
      case 'updated-desc':
        return cmpStr(b.frontmatter.updated, a.frontmatter.updated);
      case 'updated-asc':
        return cmpStr(a.frontmatter.updated, b.frontmatter.updated);
      case 'git-updated-desc':
        return cmpUndefLast(gitUpdated?.get(a.slug), gitUpdated?.get(b.slug), 'desc', cmpString);
      case 'git-updated-asc':
        return cmpUndefLast(gitUpdated?.get(a.slug), gitUpdated?.get(b.slug), 'asc', cmpString);
      default:
        return cmpStr(a.frontmatter.name, b.frontmatter.name);
    }
  });
  const categories = Array.from(new Set(features.map((f) => f.frontmatter.category))).toSorted();
  const areas = Array.from(new Set(features.map((f) => f.frontmatter.area))).toSorted();
  const updates = Array.from(
    new Set(features.map((f) => f.frontmatter.updated).filter((v): v is string => Boolean(v))),
  ).toSorted((a, b) => b.localeCompare(a));
  const phases = ['done', 'in-progress'];
  const form = `<form class="filters" method="get">
    <label>Phase
      <select name="phase" onchange="this.form.submit()">
        <option value="">All</option>
        ${phases.map((p) => `<option value="${p}"${p === filters.phase ? ' selected' : ''}>${p}</option>`).join('')}
      </select>
    </label>
    <label>Category
      <select name="category" onchange="this.form.submit()">
        <option value="">All</option>
        ${categories.map((c) => `<option value="${escapeHtml(c)}"${c === filters.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </label>
    <label>Area
      <select name="area" onchange="this.form.submit()">
        <option value="">All</option>
        ${areas.map((a) => `<option value="${escapeHtml(a)}"${a === filters.area ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}
      </select>
    </label>
    <label>Updated
      <select name="updated" onchange="this.form.submit()">
        <option value="">All</option>
        ${updates.map((u) => `<option value="${escapeHtml(u)}"${u === filters.updated ? ' selected' : ''}>${escapeHtml(u)}</option>`).join('')}
      </select>
    </label>
    <label>Sort
      <select name="sort" onchange="this.form.submit()">
        ${[
          ['name-asc', 'Name A→Z'],
          ['introduced-desc', 'Introduced ↓'],
          ['introduced-asc', 'Introduced ↑'],
          ['updated-desc', 'Updated ↓'],
          ['updated-asc', 'Updated ↑'],
          ['git-updated-desc', 'Last commit ↓'],
          ['git-updated-asc', 'Last commit ↑'],
        ]
          .map(
            ([v, l]) =>
              `<option value="${escapeHtml(v)}"${v === sortMode ? ' selected' : ''}>${escapeHtml(l)}</option>`,
          )
          .join('')}
      </select>
    </label>
    <label>Missing introduced
      <input type="checkbox" name="missing-introduced" value="1"${filters.missingIntroduced ? ' checked' : ''} onchange="this.form.submit()">
    </label>
  </form>`;
  const table =
    filtered.length === 0
      ? '<p class="empty">No matching features.</p>'
      : `<table><thead><tr><th>Name</th><th>Phase</th><th>Category</th><th>Area</th><th>Milestone</th><th>Introduced</th><th>Updated</th></tr></thead><tbody>${filtered
          .map(
            (f) =>
              `<tr><td><a href="/features/${escapeHtml(f.slug)}">${escapeHtml(f.frontmatter.name)}</a></td><td>${escapeHtml(f.frontmatter.phase)}</td><td>${escapeHtml(f.frontmatter.category)}</td><td>${escapeHtml(f.frontmatter.area)}</td><td>${f.frontmatter.milestone ? `<a class="chip" href="/milestones">${escapeHtml(f.frontmatter.milestone)}</a>` : '—'}</td><td>${escapeHtml(f.frontmatter.introduced ?? '—')}</td><td>${escapeHtml(f.frontmatter.updated ?? '—')}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return `<h1>Features (${filtered.length} of ${features.length})</h1>${form}${table}`;
}

/**
 * Render gaps grouped by category, with a category filter form.
 *
 * @param gaps - All gaps
 * @param filters - Active filter state
 * @returns HTML body string
 */
export function renderGaps(gaps: Gap[], filters: { category: string }): string {
  const filtered = filters.category ? gaps.filter((g) => g.category === filters.category) : gaps;
  const categories = Array.from(new Set(gaps.map((g) => g.category))).toSorted();
  const form = `<form class="filters" method="get">
    <label>Category
      <select name="category" onchange="this.form.submit()">
        <option value="">All</option>
        ${categories.map((c) => `<option value="${escapeHtml(c)}"${c === filters.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </label>
  </form>`;
  if (filtered.length === 0) {
    return `<h1>Gaps</h1>${form}<p class="empty">No matching gaps.</p>`;
  }
  const groups = new Map<string, Gap[]>();
  for (const g of filtered) {
    if (!groups.has(g.category)) groups.set(g.category, []);
    groups.get(g.category)!.push(g);
  }
  const sections = Array.from(groups.entries())
    .map(
      ([cat, list]) =>
        `<h2>${escapeHtml(cat)} (${list.length})</h2><ul>${list.map((g) => `<li><strong>${escapeHtml(g.itemId)}</strong> — ${escapeHtml(g.message)}</li>`).join('')}</ul>`,
    )
    .join('');
  return `<h1>Gaps</h1>${form}${sections}`;
}

/**
 * Sorted horizontal-bar table (label / bar / count). Shared by /velocity and the
 * /metrics per-metric renderers; `tag` picks the heading level so the table nests
 * under a page heading (`h2`) or inside a metric card (`h3`).
 */
function barTable(title: string, data: Record<string, number>, tag: 'h2' | 'h3' = 'h2'): string {
  const entries = Object.entries(data).toSorted(([, a], [, b]) => b - a);
  const max = Math.max(1, entries[0]?.[1] ?? 1);
  if (entries.length === 0)
    return `<${tag}>${escapeHtml(title)}</${tag}><p class="empty">No data.</p>`;
  return `<${tag}>${escapeHtml(title)}</${tag}><table>${entries
    .map(
      ([k, v]) =>
        `<tr><td style="width:8rem">${escapeHtml(k)}</td><td><div class="bar"><div style="width:${Math.round((v / max) * 100)}%"></div></div></td><td style="width:3rem;text-align:right">${v}</td></tr>`,
    )
    .join('')}</table>`;
}

/**
 * Render git velocity stats: counter strip, by-type/by-scope bars, releases table, top authors.
 *
 * @param stats - Velocity stats
 * @returns HTML body string
 */
export function renderVelocity(stats: VelocityStats): string {
  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${stats.commits.last7d}</div><div class="l">commits 7d</div></div>
    <div class="counter"><div class="v">${stats.commits.last30d}</div><div class="l">commits 30d</div></div>
    <div class="counter"><div class="v">${stats.commits.last90d}</div><div class="l">commits 90d</div></div>
    <div class="counter"><div class="v">${stats.lastReleaseDaysAgo ?? '—'}</div><div class="l">days since release</div></div>
    <div class="counter"><div class="v">${stats.activeBranches}</div><div class="l">active branches</div></div>
  </div>`;

  const bars = (title: string, data: Record<string, number>): string => barTable(title, data);

  const releasesTable =
    stats.releases.length === 0
      ? '<h2>Releases</h2><p class="empty">No tagged releases.</p>'
      : `<h2>Releases</h2><table><thead><tr><th>Tag</th><th>Date</th><th>Commits since prev</th></tr></thead><tbody>${stats.releases
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.tag)}</td><td>${escapeHtml(r.date)}</td><td>${r.commitsSincePrev}</td></tr>`,
          )
          .join('')}</tbody></table>`;

  const authorsTable =
    stats.topAuthors30d.length === 0
      ? ''
      : `<h2>Top authors (30d)</h2><table><thead><tr><th>Author</th><th>Commits</th></tr></thead><tbody>${stats.topAuthors30d
          .map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${a.commits}</td></tr>`)
          .join('')}</tbody></table>`;

  return `<h1>Velocity</h1>${counterStrip}${bars('Commits by type (30d)', stats.commitsByType)}${bars('Commits by scope (30d)', stats.commitsByScope)}${releasesTable}${authorsTable}`;
}

/**
 * Render the feature drill-down: frontmatter table on top, link sections,
 * rendered markdown body below.
 *
 * @param detail - Feature detail with rendered HTML body
 * @returns HTML body string
 */
export function renderFeatureDetail(detail: FeatureDetail): string {
  const fm = detail.frontmatter;
  const rows: Array<[string, string]> = [
    ['name', fm.name],
    ['phase', fm.phase],
    ['area', fm.area],
    ['category', fm.category],
    ['packages', fm.packages.join(', ')],
    ['deps', fm.deps.join(', ') || '—'],
    ['introduced', fm.introduced ?? '—'],
    ['updated', fm.updated ?? '—'],
  ];
  const table = `<table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;

  // Per-FD link sections moved into the FD body's auto-generated `## Resources`
  // block (via `pnpm sync:fd-resources`). Body markdown is rendered below; the
  // duplicate frontmatter-driven sections used to live here.

  return `<h1>${escapeHtml(fm.name)}</h1>${table}<div class="body">${detail.bodyHtml}</div>`;
}

/**
 * Render the hot-zones subsection of the WIP-age page: filter form + ranked
 * file table or empty state. Emits an `<h2>` so it nests under the page `<h1>`.
 *
 * @param rows - Pre-sorted, pre-ranked hot-zone rows
 * @param filters - Active `days` window and `limit`
 * @returns HTML body string
 */
export function renderHotZones(
  rows: HotZoneRow[],
  filters: { days: number; limit: number },
): string {
  const dayOptions = [7, 30, 90]
    .map((d) => `<option value="${d}"${d === filters.days ? ' selected' : ''}>${d} days</option>`)
    .join('');
  // Hot zones keeps an explicit Apply button because the Limit input is a
  // <number> field — incremental keystrokes would prematurely submit on
  // onchange. The Window dropdown is auto-submit for consistency with the
  // rest of the dashboard.
  const form = `<form class="filters" method="get">
    <label>Window
      <select name="days" onchange="this.form.submit()">${dayOptions}</select>
    </label>
    <label>Limit
      <input type="number" name="limit" min="1" max="100" value="${filters.limit}">
    </label>
    <button type="submit">Apply</button>
  </form>`;

  const heading = `<h2>Hot zones (top ${filters.limit}, last ${filters.days} days)</h2>`;

  if (rows.length === 0) {
    return `${heading}${form}<p class="empty">No matching commits in window.</p>`;
  }

  const body = rows
    .map((row) => {
      const blobUrl = `https://github.com/${escapeHtml(GITHUB_REPO)}/blob/main/${row.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      const features =
        row.featureSlugs.length === 0
          ? '—'
          : row.featureSlugs
              .map((s) => `<a href="/features/${escapeHtml(s)}">${escapeHtml(s)}</a>`)
              .join(', ');
      const authors = row.authors.map((a) => escapeHtml(a)).join(', ');
      return `<tr>
        <td>${row.rank}</td>
        <td><a href="${blobUrl}"><code>${escapeHtml(row.path)}</code></a></td>
        <td>${row.changeCount}</td>
        <td>+${row.insertions} / −${row.deletions}</td>
        <td>${authors}</td>
        <td>${features}</td>
        <td><time>${escapeHtml(row.lastCommitDate)}</time> · <code>${escapeHtml(row.lastCommitHash)}</code> · ${escapeHtml(row.lastCommitSubject)}</td>
      </tr>`;
    })
    .join('');

  const table = `<table>
    <thead><tr><th>#</th><th>File</th><th>Changes</th><th>Lines (+/−)</th><th>Authors</th><th>Features</th><th>Last commit</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;

  return `${heading}${form}${table}`;
}

/**
 * Render the worktree health page: counter strip, status table with
 * inline `<details>` for dirty file lists, and an optional warnings list.
 *
 * @param health - Validated worktree snapshot
 * @returns HTML body string
 */
export function renderWorktrees(health: WorktreeHealth): string {
  const featureTrees = health.trees.filter((t) => t.path !== '.');
  const totalDirty = health.trees.reduce((sum, t) => sum + t.dirtyCount, 0);
  const totalBehind = health.trees.reduce((sum, t) => sum + t.behind, 0);

  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${featureTrees.length}</div><div class="l">feature trees</div></div>
    <div class="counter"><div class="v">${health.warnings.length}</div><div class="l">warnings</div></div>
    <div class="counter"><div class="v">${totalBehind}</div><div class="l">commits behind</div></div>
    <div class="counter"><div class="v">${totalDirty}</div><div class="l">dirty</div></div>
  </div>`;

  const renderBranchCell = (t: WorktreeHealth['trees'][number]): string => {
    if (t.path === '.' || t.branch === '(detached)') {
      return escapeHtml(t.branch);
    }
    const encodedBranch = t.branch.split('/').map(encodeURIComponent).join('/');
    const compareUrl = `https://github.com/${GITHUB_REPO}/compare/main...${encodedBranch}`;
    const branchLink = `<a href="${compareUrl}">${escapeHtml(t.branch)}</a>`;
    const featureLink = t.featureSlug
      ? ` <a href="/features/${encodeURIComponent(t.featureSlug)}" title="feature MD">↗</a>`
      : '';
    return `${branchLink}${featureLink}`;
  };

  const renderDirtyCell = (t: WorktreeHealth['trees'][number]): string => {
    if (t.dirtyCount === 0) return 'clean';
    const items = t.dirtyFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
    return `<details><summary>${t.dirtyCount} mod</summary><ul>${items}</ul></details>`;
  };

  const rows = health.trees
    .map((t) => {
      const aheadBehind = t.path === '.' ? '—' : `${t.ahead}/${t.behind}`;
      const portCell = t.port === null ? '—' : String(t.port);
      return `<tr><td>${escapeHtml(t.path)}</td><td>${renderBranchCell(t)}</td><td>${portCell}</td><td>${aheadBehind}</td><td>${renderDirtyCell(t)}</td><td>${escapeHtml(t.lastCommit)}</td></tr>`;
    })
    .join('');

  const table = `<table><thead><tr><th>Path</th><th>Branch</th><th>Port</th><th>Ahead/Behind</th><th>Dirty</th><th>Last commit</th></tr></thead><tbody>${rows}</tbody></table>`;

  const emptyNote = featureTrees.length === 0 ? '<p class="empty">no feature worktrees</p>' : '';

  const warningsSection =
    health.warnings.length === 0
      ? ''
      : `<h2>Warnings</h2><ul>${health.warnings
          .map((w) => `<li>⚠ ${escapeHtml(describeWarning(w))}</li>`)
          .join('')}</ul>`;

  return `<h1>Worktrees</h1>${counterStrip}${table}${emptyNote}${warningsSection}`;
}

/** Human-compact duration for agent runtimes: "12s", "4m 32s", "1h 04m". */
export function formatAgentDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

const LIVE_EMPTY_ROW = '<tr><td colspan="7" class="empty">no agents running</td></tr>';
const INBOX_EMPTY_ROW =
  '<tr><td colspan="5" class="empty">inbox empty — nothing needs you</td></tr>';

function renderLiveRows(live: LiveAgentRow[]): string {
  if (live.length === 0) return LIVE_EMPTY_ROW;
  return live
    .map((r) => {
      const slugCell =
        r.slug === null
          ? '—'
          : `<a href="/features/${escapeHtml(r.slug)}">${escapeHtml(r.slug)}</a>`;
      const staleBadge = r.stale ? ' <span class="badge stale">stale</span>' : '';
      return `<tr${r.stale ? ' class="row-stale"' : ''}>
        <td>${escapeHtml(r.kind)}</td>
        <td>${slugCell}</td>
        <td>${r.lane === null ? '—' : `<code>${escapeHtml(r.lane)}</code>`}</td>
        <td>${r.phase === null ? '—' : escapeHtml(r.phase)}</td>
        <td>${escapeHtml(formatAgentDuration(r.runtimeMs))}${staleBadge}</td>
        <td>${r.retries}</td>
        <td><a href="/agents/log">log</a></td>
      </tr>`;
    })
    .join('');
}

function renderRunGroup(g: AgentRunGroup): string {
  const starts = g.bars.map((b) => b.startMs).filter((v): v is number => v !== null);
  const fallbackStart = Date.parse(g.startTs);
  const runStart = starts.length > 0 ? Math.min(...starts) : fallbackStart;
  const runEnd = Math.max(
    runStart + 1,
    ...g.bars.map((b) => (b.startMs ?? runStart) + b.durationMs),
  );
  const span = runEnd - runStart;
  const rows = g.bars
    .map((b) => {
      const left = (((b.startMs ?? runStart) - runStart) / span) * 100;
      const width = Math.min(100, Math.max(2, (b.durationMs / span) * 100));
      const label = [b.kind, b.slug, b.lane].filter((v): v is string => v !== null).join(' · ');
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td style="width:55%"><div class="agents-bar-track"><div class="agents-bar agents-bar--${b.outcome}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%" title="${escapeHtml(formatAgentDuration(b.durationMs))}"></div></div></td>
        <td>${escapeHtml(formatAgentDuration(b.durationMs))}</td>
        <td><span class="badge outcome-${b.outcome}">${b.outcome}</span></td>
      </tr>`;
    })
    .join('');
  const totals = `${g.totals.shipped} shipped · ${g.totals.unfinished} unfinished · ${g.totals.escalated} escalated`;
  const barsTable =
    g.bars.length === 0
      ? '<p class="empty">no completed spawns in this run</p>'
      : `<table><thead><tr><th>Agent</th><th>Timeline</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table>`;
  return `<div class="milestone-group">
    <div class="status">${escapeHtml(g.startTs)}${g.endTs !== g.startTs ? ` → ${escapeHtml(g.endTs)}` : ''}</div>
    <h3><code>${escapeHtml(g.runId)}</code></h3>
    <p class="muted">${escapeHtml(totals)}</p>
    ${barsTable}
  </div>`;
}

function renderInboxRows(inbox: AgentActivity['inbox']): string {
  if (inbox.length === 0) return INBOX_EMPTY_ROW;
  return inbox
    .map(
      (r) => `<tr>
      <td><code>${escapeHtml(r.source)}:${escapeHtml(r.slug)}</code></td>
      <td>${escapeHtml(r.reason)}</td>
      <td><time>${escapeHtml(r.ts)}</time></td>
      <td>${escapeHtml(r.evidence || '(none)')}</td>
      <td>${escapeHtml(r.suggestedAction)}</td>
    </tr>`,
    )
    .join('');
}

/**
 * Render the /agents page: live board (running agents), per-run timeline
 * (spawned→exited bars, outcome-colored), and the escalation inbox (same rows
 * as `noldor autonomous inbox`). The static poller (`/static/agents.js`)
 * patches `#agents-live-body`, `#agents-inbox-body` and both counters in
 * place every ~2s; first paint is fully server-side (no-JS safe).
 */
export function renderAgents(activity: AgentActivity, drain: DrainObservation): string {
  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v" id="agents-live-count">${activity.live.length}</div><div class="l">running</div></div>
    <div class="counter"><div class="v">${activity.runs.length}</div><div class="l">runs</div></div>
    <div class="counter"><div class="v" id="agents-inbox-count">${activity.inbox.length}</div><div class="l">open escalations</div></div>
  </div>`;
  const liveTable = `<table>
    <thead><tr><th>Kind</th><th>Slug</th><th>Lane</th><th>Phase</th><th>Runtime</th><th>Retries</th><th>Log</th></tr></thead>
    <tbody id="agents-live-body">${renderLiveRows(activity.live)}</tbody>
  </table>`;
  const timeline =
    activity.runs.length === 0
      ? '<p class="empty">no recorded runs</p>'
      : activity.runs.map(renderRunGroup).join('');
  const inboxTable = `<table>
    <thead><tr><th>Entry</th><th>Reason</th><th>Since</th><th>Evidence</th><th>Suggested action</th></tr></thead>
    <tbody id="agents-inbox-body">${renderInboxRows(activity.inbox)}</tbody>
  </table>`;
  return `<h1>Agents</h1>
  ${counterStrip}
  ${renderDrainSection(drain)}
  <h2>Live board</h2>
  <p class="muted">Self-refreshes every ~2s via <code>/api/agents</code>. Log links tail the shared <code>.noldor/watch.log</code>.</p>
  ${liveTable}
  <h2>Run timeline</h2>
  ${timeline}
  <h2>Escalation inbox</h2>
  ${inboxTable}`;
}

/** One-line drain status summary — patched in place by the /agents poller. */
export function drainStatusLine(state: DrainObservation['state']): string {
  if (state === null) return 'no drain recorded';
  const parts = [
    `drain ${state.pidAlive ? 'running' : 'dead'} (pid ${String(state.pid)})`,
    `phase ${state.phase}`,
    `shipped ${String(state.shipped)}`,
    `started ${state.startedAt}`,
  ];
  if (state.merging !== null) parts.push(`merging ${state.merging}`);
  if (state.skip.length > 0) parts.push(`skipped: ${state.skip.join(', ')}`);
  return parts.join(' · ');
}

/** In-flight tbody rows (slug → phase → retries); exported for the poller's server-side twin tests. */
export function renderDrainInFlightRows(state: DrainObservation['state']): string {
  if (state === null || state.inFlight.length === 0) {
    return `<tr><td colspan="3" class="empty">nothing in flight</td></tr>`;
  }
  return state.inFlight
    .map(
      (f) => `<tr>
        <td><a href="/features/${encodeURIComponent(f.slug)}">${escapeHtml(f.slug)}</a></td>
        <td>${escapeHtml(f.phase)}</td>
        <td>${String(state.retries[f.slug] ?? 0)}</td>
      </tr>`,
    )
    .join('');
}

/** Parked tbody rows (entry → reason → since). */
export function renderDrainParkedRows(parked: DrainObservation['parked']): string {
  if (parked.length === 0) {
    return `<tr><td colspan="3" class="empty">nothing parked</td></tr>`;
  }
  return parked
    .map(
      (p) => `<tr>
        <td><code>${escapeHtml(p.source)}:${escapeHtml(p.slug)}</code></td>
        <td>${escapeHtml(p.reason)}</td>
        <td>${escapeHtml(p.ts)}</td>
      </tr>`,
    )
    .join('');
}

/** Copy shown in the log pane before any drain has written the shared log. */
export const DRAIN_LOG_EMPTY_COPY = 'no watch log yet — appears once a drain starts';

/**
 * The /agents Drain section: status line, in-flight + parked tables, and the
 * auto-tailing shared-log pane. Every dynamic element carries an id the
 * `/static/agents.js` poller patches in place (~2s).
 */
export function renderDrainSection(drain: DrainObservation): string {
  return `<h2>Drain</h2>
  <p class="muted" id="drain-status">${escapeHtml(drainStatusLine(drain.state))}</p>
  <table>
    <thead><tr><th>In flight</th><th>Phase</th><th>Retries</th></tr></thead>
    <tbody id="drain-inflight-body">${renderDrainInFlightRows(drain.state)}</tbody>
  </table>
  <h3>Parked</h3>
  <table>
    <thead><tr><th>Entry</th><th>Reason</th><th>Since</th></tr></thead>
    <tbody id="drain-parked-body">${renderDrainParkedRows(drain.parked)}</tbody>
  </table>
  <h3>Live log</h3>
  <p class="muted">Shared <code>.noldor/watch.log</code> — tail auto-refreshes every ~2s. <a href="/agents/log">Full page</a>.</p>
  <pre id="drain-log-pane" class="drain-log">${escapeHtml(drain.logTail ?? DRAIN_LOG_EMPTY_COPY)}</pre>`;
}

/**
 * Render the /agents/log tail. The log is SHARED across agents (children run
 * stdio-inherit — spec D3): rows interleave at K>1, labelled as such.
 */
export function renderAgentsLog(tail: string | null): string {
  const back = `<p><a href="/agents">← back to agents</a> · <code>.noldor/watch.log</code> <span class="muted">(shared across agents — rows interleave at K&gt;1; tail auto-refreshes every ~2s)</span></p>`;
  return `<h1>Watch log</h1>${back}<pre id="drain-log-pane" class="drain-log">${escapeHtml(tail ?? DRAIN_LOG_EMPTY_COPY)}</pre>`;
}

/**
 * Render the WIP-age section of the consolidated page: counter strip with
 * bucket totals, table of in-progress features sorted by age desc with a
 * colored bucket badge. The hot-zones subsection is appended by the handler.
 *
 * @param rows - WIP age rows pre-sorted by age desc
 * @returns HTML body string
 */
/**
 * Render the `/blocked-by` page: counter strip + client-rendered mermaid
 * flowchart of the roadmap+backlog dependency graph (arrows point blocked →
 * blocker), plus a server-rendered cycle list so the critical signal survives
 * without JS/CDN. Cycle members are styled red, backlog nodes muted, dangling
 * refs dashed.
 */
export function renderBlockedBy(graph: BlockedByGraphView): string {
  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${graph.nodes.length}</div><div class="l">entries in graph</div></div>
    <div class="counter"><div class="v">${graph.edges.length}</div><div class="l">blocked-by edges</div></div>
    <div class="counter"><div class="v">${graph.cycles.length}</div><div class="l">cycles</div></div>
    <div class="counter"><div class="v">${graph.unlinked}</div><div class="l">unlinked entries</div></div>
  </div>`;

  if (graph.edges.length === 0 && graph.cycles.length === 0) {
    return `<h1>Blocked-by graph</h1>${counterStrip}<p class="empty">No blocked-by edges declared — the queue is dependency-free.</p>`;
  }

  // Synthetic mermaid ids (s_<n> / d_<n>) sidestep slug-vs-mermaid-syntax
  // collisions; labels are quoted with quotes stripped.
  const idOf = new Map(graph.nodes.map((n, i) => [n.slug, `s_${i}`]));
  // Mermaid (securityLevel 'loose') renders inline HTML from the DECODED
  // textContent of the <pre>, so the outer escapeHtml does not protect
  // labels — strip HTML brackets too, or an entry named `<img onerror=…>`
  // (creatable via the roadmap add API) executes on this page.
  const label = (text: string): string => text.replace(/["`<>]/g, "'");
  const lines: string[] = ['flowchart LR'];
  for (const n of graph.nodes) {
    const idSuffix = n.id !== undefined ? ` (${n.id})` : '';
    lines.push(`  ${idOf.get(n.slug)}["${label(n.name + idSuffix)}"]`);
  }
  let danglingSeq = 0;
  for (const e of graph.edges) {
    const from = idOf.get(e.from);
    if (from === undefined) continue;
    if (e.to !== undefined) {
      const to = idOf.get(e.to);
      if (to !== undefined) lines.push(`  ${from} --> ${to}`);
    } else if (e.dangling !== undefined) {
      const dId = `d_${danglingSeq++}`;
      lines.push(`  ${dId}["${label(e.dangling)} (unknown)"]`);
      lines.push(`  ${from} -.-> ${dId}`);
    }
  }
  lines.push('  classDef cycle stroke:#dc2626,stroke-width:2px;');
  lines.push('  classDef backlog opacity:0.55,stroke-dasharray:3 3;');
  const cycleIds = graph.nodes.filter((n) => n.inCycle).map((n) => idOf.get(n.slug));
  if (cycleIds.length > 0) lines.push(`  class ${cycleIds.join(',')} cycle;`);
  const backlogIds = graph.nodes
    .filter((n) => n.source === 'backlog' && !n.inCycle)
    .map((n) => idOf.get(n.slug));
  if (backlogIds.length > 0) lines.push(`  class ${backlogIds.join(',')} backlog;`);

  const cyclesHtml =
    graph.cycles.length === 0
      ? ''
      : `<h2>Cycles</h2><ul>${graph.cycles
          .map(
            (c) =>
              `<li><code>${escapeHtml([...c, c[0] ?? ''].join(' → '))}</code> — every member is a defensible edge to cut; resolve by hand.</li>`,
          )
          .join('')}</ul>`;

  const legend = `<p class="muted">Arrows point blocked → blocker. Red = cycle member; dashed/muted = backlog entry; dotted arrow = dangling ref (no matching entry).</p>`;

  return `<h1>Blocked-by graph</h1>${counterStrip}${legend}<pre class="mermaid">${escapeHtml(lines.join('\n'))}</pre>${cyclesHtml}`;
}

export function renderWipAge(rows: WipAgeRow[]): string {
  const buckets = { fresh: 0, aging: 0, stale: 0 };
  for (const r of rows) buckets[r.bucket] += 1;

  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${rows.length}</div><div class="l">in progress</div></div>
    <div class="counter"><div class="v">${buckets.fresh}</div><div class="l">fresh (&lt;7d)</div></div>
    <div class="counter"><div class="v">${buckets.aging}</div><div class="l">aging (7–13d)</div></div>
    <div class="counter"><div class="v">${buckets.stale}</div><div class="l">stale (≥14d)</div></div>
  </div>`;

  if (rows.length === 0) {
    return `<h1>WIP age</h1>${counterStrip}<p class="empty">No features in progress.</p>`;
  }

  const body = rows
    .map((r) => {
      const rowClass = r.bucket === 'stale' ? ' class="row-stale"' : '';
      return `<tr${rowClass}>
        <td><a href="/features/${escapeHtml(r.slug)}">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(r.area)}</td>
        <td>${r.ageDays}</td>
        <td><span class="badge ${r.bucket}">${r.bucket}</span></td>
      </tr>`;
    })
    .join('');

  const table = `<table>
    <thead><tr><th>Name</th><th>Area</th><th>Age (days)</th><th>Bucket</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;

  return `<h1>WIP age</h1>${counterStrip}${table}`;
}

/**
 * Render the test-pyramid page: per-module source/test/case counts with a
 * test-to-code ratio, worst-covered modules first.
 */
export function renderTestPyramid(rows: TestPyramidRow[]): string {
  const totals = rows.reduce(
    (acc, r) => ({
      sourceFiles: acc.sourceFiles + r.sourceFiles,
      testFiles: acc.testFiles + r.testFiles,
      testCases: acc.testCases + r.testCases,
    }),
    { sourceFiles: 0, testFiles: 0, testCases: 0 },
  );
  const untested = rows.filter((r) => r.sourceFiles > 0 && r.testFiles === 0).length;
  const overallRatio =
    totals.sourceFiles > 0 ? (totals.testFiles / totals.sourceFiles).toFixed(2) : '—';

  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${rows.length}</div><div class="l">modules</div></div>
    <div class="counter"><div class="v">${totals.sourceFiles}</div><div class="l">source files</div></div>
    <div class="counter"><div class="v">${totals.testFiles}</div><div class="l">test files</div></div>
    <div class="counter"><div class="v">${totals.testCases}</div><div class="l">test cases</div></div>
    <div class="counter"><div class="v">${overallRatio}</div><div class="l">tests per source file</div></div>
    <div class="counter"><div class="v">${untested}</div><div class="l">untested modules</div></div>
  </div>`;

  if (rows.length === 0) {
    return `<h1>Test pyramid</h1>${counterStrip}<p class="empty">No code files found under the configured scan paths.</p>`;
  }

  const maxRatio = Math.max(...rows.map((r) => r.ratio ?? 0), 1);
  const body = rows
    .map((r) => {
      const isUntested = r.sourceFiles > 0 && r.testFiles === 0;
      const rowClass = isUntested ? ' class="row-stale"' : '';
      const badge = isUntested
        ? '<span class="badge stale">untested</span>'
        : r.ratio === null
          ? '<span class="badge aging">test-only</span>'
          : '<span class="badge fresh">covered</span>';
      const ratioCell =
        r.ratio === null
          ? '—'
          : `${r.ratio.toFixed(2)} <div class="bar" style="width:120px"><div style="width:${Math.round((r.ratio / maxRatio) * 100)}%"></div></div>`;
      return `<tr${rowClass}>
        <td><code>${escapeHtml(r.module)}</code></td>
        <td>${r.sourceFiles}</td>
        <td>${r.testFiles}</td>
        <td>${r.testCases}</td>
        <td>${ratioCell}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join('');

  const table = `<table>
    <thead><tr><th>Module</th><th>Source files</th><th>Test files</th><th>Test cases</th><th>Tests / source</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;

  return `<h1>Test pyramid</h1>${counterStrip}${table}`;
}

/**
 * Render the graphify health snapshot: god-node count, low-cohesion community
 * count, and dead-export count parsed from `graphify-out/GRAPH_REPORT.md`,
 * labelled with the report's run date. `null` snapshot → "run /graphify" empty
 * state; `deadExportCount === null` → "not reported" (graphify emits no such
 * section today).
 */
export function renderGraphHealth(snapshot: GraphHealthSnapshot | null): string {
  if (snapshot === null) {
    return `<h1>Graph health</h1><p class="empty">No graph report found at <code>graphify-out/GRAPH_REPORT.md</code>. Run <code>/graphify</code> to generate one.</p>`;
  }

  const asOf =
    snapshot.reportDate === null
      ? 'unknown date'
      : `${escapeHtml(snapshot.reportDate)}${snapshot.scope === null ? '' : ` · scope ${escapeHtml(snapshot.scope)}`}`;
  const deadExports = snapshot.deadExportCount === null ? '—' : String(snapshot.deadExportCount);
  // Percentage is against the communities actually scored for cohesion
  // (scannedCommunityCount), not the Summary total — the latter counts
  // thin/omitted communities the report never details, which would understate.
  const lowCohesionPct =
    snapshot.scannedCommunityCount > 0
      ? ` (${Math.round((snapshot.lowCohesionCount / snapshot.scannedCommunityCount) * 100)}% of ${snapshot.scannedCommunityCount} scored)`
      : '';

  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v">${snapshot.godNodeCount}</div><div class="l">god nodes</div></div>
    <div class="counter"><div class="v">${snapshot.lowCohesionCount}</div><div class="l">low-cohesion communities${lowCohesionPct}</div></div>
    <div class="counter"><div class="v">${deadExports}</div><div class="l">dead exports</div></div>
    <div class="counter"><div class="v">${snapshot.communityCount ?? '—'}</div><div class="l">communities</div></div>
    <div class="counter"><div class="v">${snapshot.nodeCount ?? '—'}</div><div class="l">nodes</div></div>
    <div class="counter"><div class="v">${snapshot.edgeCount ?? '—'}</div><div class="l">edges</div></div>
  </div>`;

  const caption = `<p class="muted">Snapshot as of ${asOf}. Low-cohesion threshold: cohesion ≤ ${snapshot.lowCohesionThreshold}.${snapshot.deadExportCount === null ? ' Dead exports not reported by graphify.' : ''}</p>`;

  const godRows =
    snapshot.godNodes.length === 0
      ? '<tr><td colspan="2" class="empty">No god nodes reported.</td></tr>'
      : snapshot.godNodes
          .map((g) => `<tr><td><code>${escapeHtml(g.name)}</code></td><td>${g.edges}</td></tr>`)
          .join('');
  const godTable = `<h2>God nodes</h2><table>
    <thead><tr><th>Symbol</th><th>Edges</th></tr></thead>
    <tbody>${godRows}</tbody>
  </table>`;

  const cohesionRows =
    snapshot.lowCohesionCommunities.length === 0
      ? '<tr><td colspan="3" class="empty">No communities below the cohesion threshold.</td></tr>'
      : snapshot.lowCohesionCommunities
          .map(
            (c) =>
              `<tr class="row-stale"><td>${c.id}</td><td><code>${escapeHtml(c.label)}</code></td><td>${c.cohesion}</td></tr>`,
          )
          .join('');
  const cohesionTable = `<h2>Low-cohesion communities</h2><table>
    <thead><tr><th>#</th><th>Label</th><th>Cohesion</th></tr></thead>
    <tbody>${cohesionRows}</tbody>
  </table>`;

  return `<h1>Graph health</h1>${counterStrip}${caption}${cohesionTable}${godTable}`;
}

/** Labeled empty-state line for a metric with no underlying data. Escapes internally. */
function metricEmpty(hint: string): string {
  return `<p class="muted">no data yet — ${escapeHtml(hint)}</p>`;
}

/** Generic JSON body — fallback for unknown metric ids and value-shape drift. */
function genericMetricBody(m: MetricResult): string {
  return `<pre>${escapeHtml(JSON.stringify(m.value, null, 2))}</pre>`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Narrow to a string→number map (numeric values only); throws on mismatch so the card falls back. */
function numberMap(v: unknown): Record<string, number> {
  if (!isRecord(v)) throw new Error('not a record');
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'number') throw new Error('non-numeric value');
    out[k] = val;
  }
  return out;
}

interface MetricBody {
  body: string;
  /** Extra audit markup appended inside the formula/blind-spots expander. */
  audit?: string;
}

function renderCycleTimeBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v) || typeof v.medianDays !== 'number' || typeof v.p90Days !== 'number') {
    throw new Error('cycle-time shape');
  }
  const samples = Array.isArray(m.samples) ? m.samples : [];
  const median = samples.length === 0 ? '—' : String(v.medianDays);
  const p90 = samples.length === 0 ? '—' : String(v.p90Days);
  const counters = `<div class="counter-strip">
    <div class="counter"><div class="v">${escapeHtml(median)}</div><div class="l">median days</div></div>
    <div class="counter"><div class="v">${escapeHtml(p90)}</div><div class="l">p90 days</div></div>
  </div>`;
  const excluded = isRecord(v.excluded)
    ? `<p class="muted">excluded: ${Number(v.excluded.noIntake ?? 0)} no intake · ${Number(v.excluded.noTag ?? 0)} no tag</p>`
    : '';
  const byPath = isRecord(v.medianByPath)
    ? barTable('Median days by path', numberMap(v.medianByPath), 'h3')
    : '';
  const rows = samples
    .filter(isRecord)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(String(s.slug ?? ''))}</td><td>${Number(s.days ?? 0)}</td><td>${escapeHtml(String(s.path ?? ''))}</td><td>${escapeHtml(String(s.provenance ?? ''))}</td></tr>`,
    )
    .join('');
  const audit =
    rows === ''
      ? undefined
      : `<h3>Samples</h3><table><thead><tr><th>Slug</th><th>Days</th><th>Path</th><th>Provenance</th></tr></thead><tbody>${rows}</tbody></table>`;
  return { body: `${counters}${excluded}${byPath}`, audit };
}

function renderRoutingAccuracyBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v) || typeof v.total !== 'number' || typeof v.matches !== 'number') {
    throw new Error('routing-accuracy shape');
  }
  if (v.total === 0) {
    return {
      body: metricEmpty(
        'no shipped entries with a recoverable roadmap size and Noldor-Path trailer in the window',
      ),
    };
  }
  const table = isRecord(v.table) ? v.table : {};
  const suggestedKeys = Object.keys(table);
  const actualKeys = [
    ...new Set(suggestedKeys.flatMap((k) => (isRecord(table[k]) ? Object.keys(table[k]) : []))),
  ].toSorted();
  const head = `<tr><th>suggested \\ actual</th>${actualKeys.map((a) => `<th>${escapeHtml(a)}</th>`).join('')}</tr>`;
  const body = suggestedKeys
    .map((s) => {
      const row = isRecord(table[s]) ? (table[s] as Record<string, unknown>) : {};
      return `<tr><td>${escapeHtml(s)}</td>${actualKeys.map((a) => `<td>${Number(row[a] ?? 0)}</td>`).join('')}</tr>`;
    })
    .join('');
  const matrix = `<h3>Suggested vs actual</h3><table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  const headline = `<p><strong>${v.matches}/${v.total}</strong> routed as suggested (last ${Number(v.window ?? 0)} shipped)</p>`;
  const excluded =
    Number(v.excluded ?? 0) > 0 ? `<p class="muted">excluded: ${Number(v.excluded)}</p>` : '';
  return { body: `${headline}${matrix}${excluded}` };
}

function renderCrEffectivenessBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v) || !isRecord(v.perLane) || !isRecord(v.correctiveBySlug)) {
    throw new Error('cr-effectiveness shape');
  }
  const lanes = Object.entries(v.perLane).filter((e): e is [string, Record<string, unknown>] =>
    isRecord(e[1]),
  );
  const corrective = numberMap(v.correctiveBySlug);
  if (lanes.length === 0 && Object.keys(corrective).length === 0) {
    return { body: metricEmpty('no `.noldor/cr` lane findings in this checkout') };
  }
  const maxBlockers = Math.max(1, ...lanes.map(([, l]) => Number(l.blockers ?? 0)));
  const laneRows = lanes
    .map(
      ([lane, l]) =>
        `<tr><td>${escapeHtml(lane)}</td><td><div class="bar"><div style="width:${Math.round((Number(l.blockers ?? 0) / maxBlockers) * 100)}%"></div></div></td><td style="text-align:right">${Number(l.blockers ?? 0)}</td><td style="text-align:right">${Number(l.suggestions ?? 0)}</td></tr>`,
    )
    .join('');
  const laneTable =
    lanes.length === 0
      ? metricEmpty('no lane findings')
      : `<h3>Findings per lane</h3><table><thead><tr><th>Lane</th><th></th><th>Blockers</th><th>Suggestions</th></tr></thead><tbody>${laneRows}</tbody></table>`;
  const correctiveTable =
    Object.keys(corrective).length === 0
      ? `<p class="muted">no corrective fix:/revert: commits within ${Number(v.windowDays ?? 0)} days of release</p>`
      : `${barTable(`Corrective commits within ${Number(v.windowDays ?? 0)}d of release`, corrective, 'h3')}`;
  return { body: `${laneTable}${correctiveTable}` };
}

function renderDrainReliabilityBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v) || !('lastRun' in v) || !('history' in v)) {
    throw new Error('drain-reliability shape');
  }
  const lastRun = isRecord(v.lastRun)
    ? `<div class="counter-strip">
    <div class="counter"><div class="v">${Number(v.lastRun.shipped ?? 0)}</div><div class="l">shipped (last run)</div></div>
    <div class="counter"><div class="v">${Number(v.lastRun.skipped ?? 0)}</div><div class="l">skipped</div></div>
    <div class="counter"><div class="v">${Number(v.lastRun.retried ?? 0)}</div><div class="l">retried</div></div>
  </div>`
    : metricEmpty('no drain-state.json in this checkout (written per drain run)');
  let history = '<p class="muted">no event/escalation history</p>';
  if (isRecord(v.history)) {
    const mean = Number(v.history.meanDurationMs ?? 0);
    const perSlug = isRecord(v.history.escalatedBySlug) ? numberMap(v.history.escalatedBySlug) : {};
    const perSlugTable =
      Object.keys(perSlug).length === 0 ? '' : barTable('Escalations by slug', perSlug, 'h3');
    history = `<p>salvaged <strong>${Number(v.history.salvaged ?? 0)}</strong> · escalated <strong>${Number(v.history.escalatedTotal ?? 0)}</strong> · mean agent duration <strong>${escapeHtml(formatAgentDuration(mean))}</strong></p>${perSlugTable}`;
  }
  return { body: `${lastRun}${history}` };
}

function renderOverridePressureBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v)) throw new Error('override-pressure shape');
  const windows = Object.entries(v).filter((e): e is [string, Record<string, unknown>] =>
    isRecord(e[1]),
  );
  if (windows.length === 0) {
    return { body: metricEmpty('no Noldor-Override trailers in commit history') };
  }
  const trailerKeys = [...new Set(windows.flatMap(([, row]) => Object.keys(row)))].toSorted();
  const maxTotal = Math.max(
    1,
    ...windows.map(([, row]) => trailerKeys.reduce((a, k) => a + Number(row[k] ?? 0), 0)),
  );
  const head = `<tr><th>release window</th>${trailerKeys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}<th>total</th></tr>`;
  const rows = windows
    .map(([w, row]) => {
      const total = trailerKeys.reduce((a, k) => a + Number(row[k] ?? 0), 0);
      return `<tr><td>${escapeHtml(w)}</td>${trailerKeys.map((k) => `<td>${Number(row[k] ?? 0)}</td>`).join('')}<td><div class="bar"><div style="width:${Math.round((total / maxTotal) * 100)}%"></div></div>${total}</td></tr>`;
    })
    .join('');
  return {
    body: `<h3>Override commits by release window</h3><table><thead>${head}</thead><tbody>${rows}</tbody></table><p class="muted">windows listed in bucket-insertion order, not chronological</p>`,
  };
}

function renderTokensPerFeatureBody(m: MetricResult): MetricBody {
  const v = m.value;
  if (!isRecord(v)) throw new Error('tokens-per-feature shape');
  const entries = Object.entries(v);
  if (entries.length === 0) {
    return { body: metricEmpty('no agent-events with usage records') };
  }
  const totals: Record<string, number> = {};
  const noUsage: string[] = [];
  for (const [slug, val] of entries) {
    if (typeof val === 'number') totals[slug] = val;
    else noUsage.push(slug);
  }
  // All-null map ≠ no events: the null-slug line below already tells the story.
  const bars = Object.keys(totals).length === 0 ? '' : barTable('Tokens by feature', totals, 'h3');
  const nulls =
    noUsage.length === 0
      ? ''
      : `<p class="muted">no usage data (null ≠ zero): ${noUsage.map((s) => escapeHtml(s)).join(', ')}</p>`;
  return { body: `${bars}${nulls}` };
}

const METRIC_RENDERERS: Record<string, (m: MetricResult) => MetricBody> = {
  'cycle-time': renderCycleTimeBody,
  'routing-accuracy': renderRoutingAccuracyBody,
  'cr-effectiveness': renderCrEffectivenessBody,
  'drain-reliability': renderDrainReliabilityBody,
  'override-pressure': renderOverridePressureBody,
  'tokens-per-feature': renderTokensPerFeatureBody,
};

/** Fixed group layout; report metrics missing from it render under a trailing Other group. */
const METRIC_GROUPS: [string, string[]][] = [
  ['Delivery', ['cycle-time', 'routing-accuracy']],
  ['Quality', ['cr-effectiveness', 'override-pressure']],
  ['Autonomy', ['drain-reliability', 'tokens-per-feature']],
];

function renderMetricCard(m: MetricResult): string {
  let rendered: MetricBody;
  try {
    const renderer = METRIC_RENDERERS[m.id];
    rendered = renderer ? renderer(m) : { body: genericMetricBody(m) };
  } catch {
    // Value-shape drift (collector changed under the view): degrade, never break the page.
    rendered = { body: genericMetricBody(m) };
  }
  const blind = m.blindSpots.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  return [
    '<section class="card">',
    `<h3>${escapeHtml(m.id)} <small>[${escapeHtml(m.unit)}]</small></h3>`,
    rendered.body,
    '<details><summary>formula + blind spots</summary>',
    `<p><strong>Formula:</strong> ${escapeHtml(m.formula)}</p>`,
    `<ul>${blind}</ul>`,
    rendered.audit ?? '',
    '</details>',
    '</section>',
  ].join('\n');
}

/** Page-top headline counters. Guarded per counter — a missing/odd metric renders '—'. */
function renderMetricsHeadline(byId: Map<string, MetricResult>): string {
  let median = '—';
  let p90 = '—';
  let share = '—';
  let shipped = '—';
  const ct = byId.get('cycle-time');
  if (ct && isRecord(ct.value) && Array.isArray(ct.samples) && ct.samples.length > 0) {
    if (typeof ct.value.medianDays === 'number') median = String(ct.value.medianDays);
    if (typeof ct.value.p90Days === 'number') p90 = String(ct.value.p90Days);
    const autonomous = ct.samples.filter(
      (s) => isRecord(s) && s.provenance === 'autonomous',
    ).length;
    share = `${Math.round((autonomous / ct.samples.length) * 100)}%`;
  }
  const dr = byId.get('drain-reliability');
  if (dr && isRecord(dr.value) && isRecord(dr.value.lastRun)) {
    const s = dr.value.lastRun.shipped;
    if (typeof s === 'number') shipped = String(s);
  }
  return `<div class="counter-strip">
    <div class="counter"><div class="v">${escapeHtml(median)}</div><div class="l">median cycle (d)</div></div>
    <div class="counter"><div class="v">${escapeHtml(p90)}</div><div class="l">p90 cycle (d)</div></div>
    <div class="counter"><div class="v">${escapeHtml(share)}</div><div class="l">autonomous share</div></div>
    <div class="counter"><div class="v">${escapeHtml(shipped)}</div><div class="l">drain shipped (last run)</div></div>
  </div>`;
}

export function renderMetrics(report: MetricsReport | null): string {
  if (!report) {
    return '<section class="card"><h2>Metrics</h2><p>metrics unavailable: compute failed — run <code>pnpm noldor metrics compute</code> for the error.</p></section>';
  }
  const byId = new Map(report.metrics.map((m) => [m.id, m]));
  const groupedIds = new Set(METRIC_GROUPS.flatMap(([, ids]) => ids));
  const sections: string[] = [];
  for (const [title, ids] of METRIC_GROUPS) {
    const cards = ids.filter((id) => byId.has(id)).map((id) => renderMetricCard(byId.get(id)!));
    if (cards.length > 0) sections.push(`<h2>${title}</h2>\n${cards.join('\n')}`);
  }
  const other = report.metrics.filter((m) => !groupedIds.has(m.id));
  if (other.length > 0) {
    sections.push(`<h2>Other</h2>\n${other.map((m) => renderMetricCard(m)).join('\n')}`);
  }
  const warnings =
    report.factsWarnings.length > 0
      ? `<p class="muted">warnings: ${escapeHtml(report.factsWarnings.join(' | '))}</p>`
      : '';
  return `<h1>Metrics</h1><p class="muted">head ${escapeHtml(report.head.slice(0, 7))} · ${escapeHtml(report.generatedAt)}</p>${warnings}${renderMetricsHeadline(byId)}${sections.join('\n')}`;
}
