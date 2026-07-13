import { readFile as readFileAsync } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleAdd, handleDemote, handleMove, handlePromote, handleRemove } from './api/blocks.js';
import {
  getBacklogPath,
  getRoadmapPath,
  loadActiveMilestone,
  loadAgentActivity,
  loadWatchLogTail,
  loadMilestoneGroups,
  loadBacklogWithHash,
  loadCounts,
  loadDrainObservation,
  loadFeatureDetail,
  loadFeatureGitTimestamps,
  loadFeatures,
  loadFrameworkPage,
  loadFrameworkPages,
  loadGaps,
  loadGraphHealth,
  loadHotZones,
  loadReleaseNotes,
  loadRoadmapWithHash,
  loadSkill,
  loadSkills,
  loadTestPyramid,
  loadUserDoc,
  loadUserDocs,
  loadVelocity,
  loadVision,
  loadWipAge,
  loadMetricsReport,
  loadWorktreeHealth,
  setDocRootsOverride,
} from './data.js';
import { renderLayout } from './layout.js';
import {
  parseMultiParam,
  renderAgents,
  renderAgentsLog,
  renderBacklog,
  renderFeatureDetail,
  renderFeatures,
  renderFrameworkIndex,
  renderFrameworkPage,
  renderGaps,
  renderGraphHealth,
  renderHotZones,
  renderOverview,
  renderReleaseNotes,
  renderRoadmap,
  renderSkillPage,
  renderSkillsIndex,
  renderTestPyramid,
  renderUserDoc,
  renderUserDocsIndex,
  renderVelocity,
  renderVision,
  renderMilestones,
  renderWipAge,
  renderMetrics,
  renderWorktrees,
} from './views.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CliArgs {
  /** Undefined when --port absent — caller falls back to env PORT or default 4321. */
  port: number | undefined;
  /** Undefined when --docs absent — caller falls back to process.cwd(). */
  docsPath: string | undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const portIdx = argv.indexOf('--port');
  const docsIdx = argv.indexOf('--docs');
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : undefined;
  const docsPath = docsIdx >= 0 ? argv[docsIdx + 1] : undefined;
  return { port, docsPath };
}

interface RouteResult {
  status: number;
  body: string;
  title: string;
  activeNav: string | null;
  /**
   * Extra HTTP response headers merged into the response. The dispatch
   * branch in `handle()` reads `content-type` here: if absent or
   * `text/html…`, the response is wrapped by `renderLayout` and the
   * `content-type` is forced to `text/html; charset=utf-8`; otherwise
   * the body is served verbatim with these headers (used by the JSON
   * API surface and `/static/<file>`).
   */
  headers?: Record<string, string>;
  /**
   * Optional metadata threaded into the layout shell. Currently only
   * `combinedEtag` (rendered as `<meta name="combined-etag">`), used by
   * cross-section client buttons (promote/demote) that need both the
   * roadmap and backlog hashes for an If-Match precondition.
   */
  layoutExtras?: { combinedEtag?: string };
}

interface RouteMatch {
  handler: (
    params: URLSearchParams,
    pathParams: Record<string, string>,
    req: IncomingMessage,
  ) => Promise<RouteResult>;
  pathParams: Record<string, string>;
}

const STATIC_GET_HANDLERS: Record<string, RouteMatch['handler']> = {
  '/health': async () => ({ status: 200, body: 'OK', title: 'health', activeNav: null }),
  '/': handleOverview,
  '/vision': handleVision,
  '/milestones': handleMilestones,
  '/roadmap': handleRoadmap,
  '/backlog': handleBacklog,
  '/features': handleFeatures,
  '/gaps': handleGaps,
  '/velocity': handleVelocity,
  '/hot-zones': handleHotZones,
  '/wip-age': handleWipAge,
  '/test-pyramid': handleTestPyramid,
  '/graph-health': handleGraphHealth,
  '/worktrees': handleWorktrees,
  '/api/agents': handleApiAgents,
  '/agents': handleAgents,
  '/agents/log': handleAgentsLog,
  '/metrics': handleMetrics,
  '/framework': handleFrameworkIndex,
  '/skills': handleSkillsIndex,
  '/docs': handleUserDocsIndex,
  '/release-notes': handleReleaseNotes,
};

/**
 * Every static GET path the dashboard serves — sourced from the SAME map the
 * router dispatches on, so the route-sweep regression test can't drift from
 * the real routing table.
 */
export const GET_ROUTES: string[] = Object.keys(STATIC_GET_HANDLERS);

function matchRoute(method: string, pathname: string): RouteMatch | null {
  if (method === 'GET') {
    const staticHandler = Object.hasOwn(STATIC_GET_HANDLERS, pathname)
      ? STATIC_GET_HANDLERS[pathname]
      : undefined;
    if (staticHandler) return { handler: staticHandler, pathParams: {} };
    const fwMatch = /^\/framework\/([a-z0-9-]+)$/.exec(pathname);
    if (fwMatch) return { handler: handleFrameworkPage, pathParams: { slug: fwMatch[1] } };
    const skillMatch = /^\/skills\/([a-z0-9-]+)$/.exec(pathname);
    if (skillMatch) return { handler: handleSkillPage, pathParams: { slug: skillMatch[1] } };
    const docsDocMatch = /^\/docs\/(tutorials|how-to|reference|explanation)\/([a-z0-9-]+)$/.exec(
      pathname,
    );
    if (docsDocMatch) {
      return {
        handler: handleUserDoc,
        pathParams: { category: docsDocMatch[1], slug: docsDocMatch[2] },
      };
    }
    const featureMatch = /^\/features\/([a-z0-9-]+)$/.exec(pathname);
    if (featureMatch) {
      return { handler: handleFeatureDetail, pathParams: { slug: featureMatch[1] } };
    }
    // Static assets — regex `[a-z0-9._-]+` blocks path traversal at the
    // routing layer (no `/`, encoded `%2F` stays encoded in WHATWG `url
    // .pathname` and fails the character class, raw `..` is allowed but
    // `handleStatic`'s resolve()-prefix check catches it). Any other
    // `/static/<anything>` shape routes to `handleStaticInvalid` for an
    // explicit 400 — clearer security signal than a generic 404.
    const staticMatch = /^\/static\/([a-z0-9._-]+)$/.exec(pathname);
    if (staticMatch) return { handler: handleStatic, pathParams: { file: staticMatch[1] } };
    if (pathname.startsWith('/static/')) {
      return { handler: handleStaticInvalid, pathParams: {} };
    }
  }
  if (method === 'POST') {
    if (pathname === '/api/roadmap/move') {
      return { handler: handleApiMove(), pathParams: {} };
    }
    const promoteMatch = /^\/api\/roadmap\/promote-from-backlog\/([a-z0-9-]+)$/.exec(pathname);
    if (promoteMatch) {
      return { handler: handleApiPromote, pathParams: { slug: promoteMatch[1] } };
    }
    const demoteMatch = /^\/api\/roadmap\/demote-to-backlog\/([a-z0-9-]+)$/.exec(pathname);
    if (demoteMatch) {
      return { handler: handleApiDemote, pathParams: { slug: demoteMatch[1] } };
    }
    const removeMatch = /^\/api\/(roadmap|backlog)\/remove\/([a-z0-9-]+)$/.exec(pathname);
    if (removeMatch) {
      return {
        handler: handleApiRemove,
        pathParams: { section: removeMatch[1], slug: removeMatch[2] },
      };
    }
    if (pathname === '/api/roadmap/add') {
      return { handler: handleApiAdd, pathParams: {} };
    }
  }
  return null;
}

/**
 * Read up to `limitBytes` of request body and JSON-parse it. Rejects with
 * `body-too-large` if the body exceeds the limit, or `invalid-json` on parse
 * failure. Empty bodies resolve to `{}`.
 *
 * Once the limit is exceeded we pause the stream and resolve immediately —
 * we do NOT destroy the socket, so the caller can still write a 413 JSON
 * response on the paired `ServerResponse`. The pending incoming bytes are
 * drained silently.
 */
async function readJsonBody(req: IncomingMessage, limitBytes = 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limitBytes) {
        aborted = true;
        reject(new Error('body-too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text.length === 0 ? {} : JSON.parse(text));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

/**
 * Build a JSON `RouteResult`. The HTTP branch in `handle` detects the
 * `application/json` content-type and bypasses the HTML layout wrapper.
 */
function jsonResult(status: number, body: object, etag?: string): RouteResult {
  return {
    status,
    body: JSON.stringify(body),
    title: '',
    activeNav: null,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(etag ? { etag } : {}),
    },
  };
}

function handleApiMove(): (
  params: URLSearchParams,
  pathParams: Record<string, string>,
  req: IncomingMessage,
) => Promise<RouteResult> {
  return async (_params, _pathParams, req) => {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'body-too-large') return jsonResult(413, { ok: false, error: msg });
      return jsonResult(400, { ok: false, error: msg });
    }
    const ifMatch = (req.headers['if-match'] as string | undefined) ?? undefined;
    const result = await handleMove({
      path: getRoadmapPath(),
      ifMatch,
      body: (body ?? {}) as { slug?: unknown; targetIndex?: unknown },
    });
    return jsonResult(result.status, result.body, result.body.etag);
  };
}

async function handleApiPromote(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
  req: IncomingMessage,
): Promise<RouteResult> {
  const ifMatch = (req.headers['if-match'] as string | undefined) ?? undefined;
  const result = await handlePromote({
    roadmapPath: getRoadmapPath(),
    backlogPath: getBacklogPath(),
    ifMatch,
    slug: pathParams.slug,
  });
  return jsonResult(result.status, result.body, result.body.etag);
}

async function handleApiDemote(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
  req: IncomingMessage,
): Promise<RouteResult> {
  const ifMatch = (req.headers['if-match'] as string | undefined) ?? undefined;
  const result = await handleDemote({
    roadmapPath: getRoadmapPath(),
    backlogPath: getBacklogPath(),
    ifMatch,
    slug: pathParams.slug,
  });
  return jsonResult(result.status, result.body, result.body.etag);
}

/**
 * Single-file delete of a roadmap or backlog entry. `pathParams.section`
 * (`roadmap` | `backlog`, captured by the route regex) selects the file;
 * `If-Match` is that file's single SHA-256 (the table's `data-etag`).
 */
async function handleApiRemove(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
  req: IncomingMessage,
): Promise<RouteResult> {
  const ifMatch = (req.headers['if-match'] as string | undefined) ?? undefined;
  const path = pathParams.section === 'backlog' ? getBacklogPath() : getRoadmapPath();
  const result = await handleRemove({ path, ifMatch, slug: pathParams.slug });
  return jsonResult(result.status, result.body, result.body.etag);
}

/**
 * Add a new roadmap entry at the top or bottom of `docs/roadmap.md`. Body is
 * `{ position, name, area, type?, size?, impact?, description? }`; `since` is
 * stamped server-side with today's date so the client never supplies it.
 * `If-Match` is the roadmap file's single SHA-256.
 */
async function handleApiAdd(
  _params: URLSearchParams,
  _pathParams: Record<string, string>,
  req: IncomingMessage,
): Promise<RouteResult> {
  let body: unknown;
  try {
    body = await readJsonBody(req, 4096);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'body-too-large') return jsonResult(413, { ok: false, error: msg });
    return jsonResult(400, { ok: false, error: msg });
  }
  const ifMatch = (req.headers['if-match'] as string | undefined) ?? undefined;
  const b = (body ?? {}) as Record<string, unknown>;
  const position = b.position === 'bottom' ? 'bottom' : 'top';
  const since = new Date().toISOString().slice(0, 10);
  const result = await handleAdd({
    path: getRoadmapPath(),
    ifMatch,
    position,
    fields: {
      name: b.name,
      area: b.area,
      since,
      type: b.type,
      size: b.size,
      impact: b.impact,
      description: b.description,
    },
  });
  return jsonResult(result.status, result.body, result.body.etag);
}

/**
 * Root directory for `/static/<file>` responses. Resolved at module load
 * relative to this file's location, not process.cwd(), so the dashboard
 * serves the assets shipped inside the noldor package regardless of where
 * the dashboard process was launched from.
 */
const STATIC_ROOT = fileURLToPath(new URL('./static/dist', import.meta.url));

/**
 * Reject any `/static/<anything>` request whose filename portion did not
 * pass the strict route regex. Returns 400 with a plain-text body so
 * security probes get an explicit rejection rather than a generic 404.
 */
async function handleStaticInvalid(): Promise<RouteResult> {
  return {
    status: 400,
    body: 'invalid path',
    title: '',
    activeNav: null,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  };
}

/**
 * Serve a file from `STATIC_ROOT`. The route matcher already restricts
 * `pathParams.file` to `[a-z0-9._-]+` (no slashes, no traversal), but we
 * re-check `filePath.startsWith(STATIC_ROOT + sep)` so a future change to
 * the regex can't silently widen the surface. Missing files surface as
 * the generic 500 handler in `handle()`.
 */
async function handleStatic(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
): Promise<RouteResult> {
  const filePath = resolvePath(STATIC_ROOT, pathParams.file);
  if (!filePath.startsWith(STATIC_ROOT + sep)) {
    return {
      status: 400,
      body: 'invalid path',
      title: '',
      activeNav: null,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    };
  }
  const body = await readFileAsync(filePath, 'utf8');
  const contentType = filePath.endsWith('.js')
    ? 'application/javascript; charset=utf-8'
    : 'application/octet-stream';
  return {
    status: 200,
    body,
    title: '',
    activeNav: null,
    headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
  };
}

async function handleOverview(): Promise<RouteResult> {
  const [counts, velocity, features, wipAge, worktreeHealth, vision] = await Promise.all([
    loadCounts(),
    loadVelocity(),
    loadFeatures(),
    loadWipAge(),
    loadWorktreeHealth(),
    loadVision(),
  ]);
  const activeMilestone = await loadActiveMilestone(vision);
  const recentDone = features
    .filter((f) => f.frontmatter.phase === 'done' && f.frontmatter.introduced)
    .toSorted((a, b) =>
      (b.frontmatter.introduced ?? '').localeCompare(a.frontmatter.introduced ?? ''),
    )
    .slice(0, 5);
  const inProgressFeatures = features.filter((f) => f.frontmatter.phase === 'in-progress');
  const featureTrees = worktreeHealth.trees.filter((t) => t.path !== '.');
  const kpis = {
    project: counts,
    activity: {
      commits7d: velocity.commits.last7d,
      commits30d: velocity.commits.last30d,
      commits90d: velocity.commits.last90d,
      lastReleaseDaysAgo: velocity.lastReleaseDaysAgo,
      activeBranches: velocity.activeBranches,
    },
    health: {
      staleWip: wipAge.filter((r) => r.bucket === 'stale').length,
      dirtyWorktrees: featureTrees.filter((t) => t.dirtyCount > 0).length,
      behindWorktrees: featureTrees.filter((t) => t.behind > 0).length,
      warnings: worktreeHealth.warnings.length,
    },
  };
  return {
    status: 200,
    body: renderOverview(kpis, inProgressFeatures, recentDone, vision, activeMilestone),
    title: 'Overview',
    activeNav: '/',
  };
}

async function handleVision(): Promise<RouteResult> {
  const vision = await loadVision();
  const activeMilestone = await loadActiveMilestone(vision);
  return {
    status: 200,
    body: renderVision(vision, activeMilestone),
    title: 'Vision',
    activeNav: '/vision',
  };
}

async function handleMilestones(): Promise<RouteResult> {
  const groups = await loadMilestoneGroups();
  return {
    status: 200,
    body: renderMilestones(groups),
    title: 'Milestones',
    activeNav: '/milestones',
  };
}

async function handleFrameworkIndex(): Promise<RouteResult> {
  const pages = await loadFrameworkPages();
  return {
    status: 200,
    body: renderFrameworkIndex(pages),
    title: 'framework',
    activeNav: '/framework',
  };
}

async function handleFrameworkPage(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
): Promise<RouteResult> {
  const page = await loadFrameworkPage(pathParams.slug);
  if (!page) {
    return {
      status: 404,
      body: '<h1>Not found</h1>',
      title: '404',
      activeNav: '/framework',
    };
  }
  return {
    status: 200,
    body: renderFrameworkPage(page),
    title: `framework / ${page.slug}`,
    activeNav: '/framework',
  };
}

async function handleSkillsIndex(): Promise<RouteResult> {
  const skills = await loadSkills();
  return {
    status: 200,
    body: renderSkillsIndex(skills),
    title: 'skills',
    activeNav: '/skills',
  };
}

async function handleSkillPage(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
): Promise<RouteResult> {
  const skill = await loadSkill(pathParams.slug);
  if (!skill) {
    return {
      status: 404,
      body: `<h1>Not found</h1><p>No skill named <code>${pathParams.slug}</code>.</p>`,
      title: '404',
      activeNav: '/skills',
    };
  }
  return {
    status: 200,
    body: renderSkillPage(skill),
    title: `skills / ${skill.slug}`,
    activeNav: '/skills',
  };
}

async function handleUserDocsIndex(params: URLSearchParams): Promise<RouteResult> {
  const categories = await loadUserDocs();
  return {
    status: 200,
    body: renderUserDocsIndex(categories, { category: params.get('category') ?? '' }),
    title: 'docs',
    activeNav: '/docs',
  };
}

async function handleReleaseNotes(): Promise<RouteResult> {
  const notes = await loadReleaseNotes();
  return {
    status: 200,
    body: renderReleaseNotes(notes),
    title: 'release notes',
    activeNav: '/release-notes',
  };
}

async function handleUserDoc(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
): Promise<RouteResult> {
  const doc = await loadUserDoc(pathParams.category, pathParams.slug);
  if (!doc) {
    return {
      status: 404,
      body: '<h1>Not found</h1>',
      title: '404',
      activeNav: '/docs',
    };
  }
  return {
    status: 200,
    body: renderUserDoc(pathParams.category, doc),
    title: `docs / ${pathParams.category} / ${pathParams.slug}`,
    activeNav: '/docs',
  };
}

async function handleRoadmap(params: URLSearchParams): Promise<RouteResult> {
  // Load both sources so the combined-etag meta covers cross-section
  // promote / demote button reads — even though only the roadmap hash
  // is served as the response-level ETag header for /roadmap.
  const [roadmap, backlog] = await Promise.all([loadRoadmapWithHash(), loadBacklogWithHash()]);
  const filters = {
    area: params.get('area') ?? '',
    type: params.get('type') ?? '',
    category: params.get('category') ?? '',
    size: parseMultiParam(params.get('size') ?? undefined),
    impact: parseMultiParam(params.get('impact') ?? undefined),
    sort: params.get('sort') ?? '',
  };
  // Spec §1 activation rule: drag-and-drop is enabled only when the table
  // renders in source-file order — no filters set and sort is empty
  // (default) or explicit `priority`. Any deviation dims the handles and
  // disables row-level `draggable`.
  const dragEnabled =
    filters.area === '' &&
    filters.type === '' &&
    filters.category === '' &&
    filters.size.length === 0 &&
    filters.impact.length === 0 &&
    (filters.sort === '' || filters.sort === 'priority');
  return {
    status: 200,
    body: await renderRoadmap(roadmap.entries, filters, { rawHash: roadmap.rawHash, dragEnabled }),
    title: 'Roadmap',
    activeNav: '/roadmap',
    headers: { etag: roadmap.rawHash },
    layoutExtras: { combinedEtag: `${roadmap.rawHash}:${backlog.rawHash}` },
  };
}

async function handleBacklog(params: URLSearchParams): Promise<RouteResult> {
  const [roadmap, backlog] = await Promise.all([loadRoadmapWithHash(), loadBacklogWithHash()]);
  const filters = {
    area: params.get('area') ?? '',
    type: params.get('type') ?? '',
    category: params.get('category') ?? '',
    size: parseMultiParam(params.get('size') ?? undefined),
    impact: parseMultiParam(params.get('impact') ?? undefined),
    sort: params.get('sort') ?? '',
  };
  return {
    status: 200,
    body: await renderBacklog(backlog.entries, filters, { rawHash: backlog.rawHash }),
    title: 'Backlog',
    activeNav: '/backlog',
    headers: { etag: backlog.rawHash },
    layoutExtras: { combinedEtag: `${roadmap.rawHash}:${backlog.rawHash}` },
  };
}

async function handleFeatures(params: URLSearchParams): Promise<RouteResult> {
  const features = await loadFeatures();
  const sort = params.get('sort') ?? '';
  // git timestamps cost a git spawn — fetch only when the sort needs them
  const gitUpdated = sort.startsWith('git-updated') ? await loadFeatureGitTimestamps() : undefined;
  return {
    status: 200,
    body: renderFeatures(
      features,
      {
        phase: params.get('phase') ?? '',
        category: params.get('category') ?? '',
        area: params.get('area') ?? '',
        updated: params.get('updated') ?? '',
        sort,
        missingIntroduced: params.get('missing-introduced') === '1',
      },
      gitUpdated,
    ),
    title: 'Features',
    activeNav: '/features',
  };
}

async function handleFeatureDetail(
  _params: URLSearchParams,
  pathParams: Record<string, string>,
): Promise<RouteResult> {
  const detail = await loadFeatureDetail(pathParams.slug);
  if (!detail) {
    return {
      status: 404,
      body: `<h1>Not found</h1><p>No feature MD for slug <code>${pathParams.slug}</code>.</p>`,
      title: 'Not found',
      activeNav: '/features',
    };
  }
  return {
    status: 200,
    body: renderFeatureDetail(detail),
    title: detail.frontmatter.name,
    activeNav: '/features',
  };
}

async function handleGaps(params: URLSearchParams): Promise<RouteResult> {
  const gaps = await loadGaps();
  return {
    status: 200,
    body: renderGaps(gaps, { category: params.get('category') ?? '' }),
    title: 'Gaps',
    activeNav: '/gaps',
  };
}

async function handleVelocity(): Promise<RouteResult> {
  const stats = await loadVelocity();
  return {
    status: 200,
    body: renderVelocity(stats),
    title: 'Velocity',
    activeNav: '/velocity',
  };
}

async function handleHotZones(params: URLSearchParams): Promise<RouteResult> {
  const daysRaw = Number(params.get('days') ?? '30');
  const days = ([7, 30, 90] as const).includes(daysRaw as 7 | 30 | 90)
    ? (daysRaw as 7 | 30 | 90)
    : 30;
  const limitRaw = Number(params.get('limit') ?? '10');
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 10;
  const rows = await loadHotZones({ days, limit });
  // `?format=json` returns the bare `HotZoneRow[]` array as `application/json`
  // so agent workflows can skip HTML parsing. Same `days`/`limit` clamping as
  // the HTML branch — only the rendering differs.
  if (params.get('format') === 'json') return jsonResult(200, rows);
  return {
    status: 200,
    body: renderHotZones(rows, { days, limit }),
    title: 'Hot zones',
    activeNav: '/hot-zones',
  };
}

async function handleWipAge(): Promise<RouteResult> {
  const rows = await loadWipAge();
  return {
    status: 200,
    body: renderWipAge(rows),
    title: 'WIP age',
    activeNav: '/wip-age',
  };
}

async function handleTestPyramid(): Promise<RouteResult> {
  const rows = await loadTestPyramid();
  return {
    status: 200,
    body: renderTestPyramid(rows),
    title: 'Test pyramid',
    activeNav: '/test-pyramid',
  };
}

async function handleGraphHealth(): Promise<RouteResult> {
  const snapshot = await loadGraphHealth();
  return {
    status: 200,
    body: renderGraphHealth(snapshot),
    title: 'Graph health',
    activeNav: '/graph-health',
  };
}

async function handleWorktrees(): Promise<RouteResult> {
  const health = await loadWorktreeHealth();
  return {
    status: 200,
    body: renderWorktrees(health),
    title: 'Worktrees',
    activeNav: '/worktrees',
  };
}

/** Read-only JSON for the /agents poller — no CSRF/atomic concerns (mutations only). */
async function handleApiAgents(): Promise<RouteResult> {
  // Drain observation is read first so its parsed retries feed loadAgentActivity —
  // one drain-state.json read per poll. `?? {}` (not undefined) even when no drain
  // is recorded, so the fallback read never fires on this path.
  const drain = await loadDrainObservation();
  const activity = await loadAgentActivity(undefined, { retries: drain.state?.retries ?? {} });
  return jsonResult(200, { ...activity, drain });
}

async function handleAgents(): Promise<RouteResult> {
  const drain = await loadDrainObservation();
  const activity = await loadAgentActivity(undefined, { retries: drain.state?.retries ?? {} });
  return {
    status: 200,
    body: renderAgents(activity, drain),
    title: 'Agents',
    activeNav: '/agents',
  };
}

async function handleAgentsLog(): Promise<RouteResult> {
  const tail = await loadWatchLogTail();
  return {
    status: 200,
    body: renderAgentsLog(tail),
    title: 'Watch log',
    activeNav: '/agents',
  };
}

async function handleMetrics(): Promise<RouteResult> {
  const report = await loadMetricsReport();
  return {
    status: 200,
    body: renderMetrics(report),
    title: 'Metrics',
    activeNav: '/metrics',
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const route = matchRoute(method, url.pathname);
  if (!route) {
    // Known path / wrong method → 405 with Allow header. Probe both verbs;
    // if either matches, surface the supported set instead of a generic 404.
    const allowed: string[] = [];
    if (method !== 'GET' && matchRoute('GET', url.pathname)) allowed.push('GET');
    if (method !== 'POST' && matchRoute('POST', url.pathname)) allowed.push('POST');
    if (allowed.length > 0) {
      res.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
        allow: allowed.join(', '),
      });
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      renderLayout({
        title: 'Not found',
        body: `<h1>Not found</h1><p>No route at <code>${url.pathname}</code>. <a href="/">Back to overview</a>.</p>`,
        activeNav: null,
      }),
    );
    return;
  }
  try {
    const result = await route.handler(url.searchParams, route.pathParams, req);
    if (url.pathname === '/health') {
      res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(result.body);
      return;
    }
    // Non-HTML branch — must run BEFORE the HTML/layout branch so API
    // (`application/json`) and static asset (`application/javascript`,
    // `text/plain`) responses are not wrapped in the dashboard chrome.
    // Any handler that sets a `content-type` other than `text/html` opts
    // into this fast path; the layout-rendering branch below is reserved
    // for handlers that omit `content-type` entirely (the default HTML
    // page surfaces).
    const responseContentType = result.headers?.['content-type'];
    if (responseContentType && !responseContentType.startsWith('text/html')) {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }
    const headers: Record<string, string> = {
      ...result.headers,
      'content-type': 'text/html; charset=utf-8',
    };
    res.writeHead(result.status, headers);
    res.end(
      renderLayout({
        title: result.title,
        body: result.body,
        activeNav: result.activeNav,
        combinedEtag: result.layoutExtras?.combinedEtag,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const escaped = message.replace(
      /[<>&]/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c,
    );
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      renderLayout({
        title: 'Error',
        body: `<h1>Internal error</h1><pre>${escaped}</pre>`,
        activeNav: null,
      }),
    );
  }
}

/**
 * Start the dashboard server.
 *
 * @param opts - Optional `port` (0 = pick free port for tests). Defaults to PORT env or 4321.
 * @returns The bound `Server` and a `baseUrl` like `http://localhost:4321`
 */
export async function startServer(
  opts: { port?: number } = {},
): Promise<{ server: Server; baseUrl: string }> {
  const desired = opts.port ?? Number(process.env.PORT ?? 4321);
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(desired, resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${addr.port}`;
  return { server, baseUrl };
}

async function main(): Promise<void> {
  const { port, docsPath } = parseCliArgs(process.argv.slice(2));
  setDocRootsOverride(docsPath);
  const { baseUrl } = await startServer({ port });
  console.log(`dashboard → ${baseUrl}`);
  process.on('SIGINT', () => process.exit(0));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  void main();
}
