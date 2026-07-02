// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../server.js';

import type { Server } from 'node:http';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  ({ server, baseUrl } = await startServer({ port: 0 }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('dashboard server', () => {
  it('GET /health returns 200 OK', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect((await res.text()).trim()).toBe('OK');
  });

  it('GET / returns 200 with HTML', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<title>');
  });

  it('GET /features returns 200 with a known feature slug', async () => {
    const res = await fetch(`${baseUrl}/features`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('framework-doc-extraction');
  });

  it('GET /features?phase=in-progress filters', async () => {
    const res = await fetch(`${baseUrl}/features?phase=in-progress`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('in-progress');
  });

  it('GET /features/framework-doc-extraction renders the drill-down', async () => {
    const res = await fetch(`${baseUrl}/features/framework-doc-extraction`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Framework Doc Extraction');
  });

  it('GET /features/<slug> injects live changelog: Unreleased and per-version commits', async () => {
    const res = await fetch(`${baseUrl}/features/framework-doc-extraction`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // framework-doc-extraction carries docs(features:framework-doc-extraction)
    // commits → at least one version heading and one commit link must render.
    expect(body).toContain('<h2');
    expect(body).toMatch(/<h3[^>]*>(Unreleased|0\.\d+\.\d+)/);
    expect(body).toMatch(/href="https:\/\/github\.com\/[^"]+\/commit\/[a-f0-9]+"/);
  });

  it('GET /features/does-not-exist returns 404', async () => {
    const res = await fetch(`${baseUrl}/features/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('GET /unknown-route returns 404', async () => {
    const res = await fetch(`${baseUrl}/unknown-route`);
    expect(res.status).toBe(404);
  });

  it('GET /hot-zones returns 200 with HTML', async () => {
    const res = await fetch(`${baseUrl}/hot-zones`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Hot zones');
  });

  it('GET /hot-zones?days=7&limit=5 reflects filters in form', async () => {
    const res = await fetch(`${baseUrl}/hot-zones?days=7&limit=5`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<option value="7" selected');
    expect(body).toContain('value="5"');
  });

  it('GET /hot-zones?days=42 clamps to 30', async () => {
    const res = await fetch(`${baseUrl}/hot-zones?days=42`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<option value="30" selected');
  });

  it('GET /hot-zones?limit=999 clamps to 100; limit=0 to 1; limit=abc to 10', async () => {
    const high = await (await fetch(`${baseUrl}/hot-zones?limit=999`)).text();
    expect(high).toContain('value="100"');
    const zero = await (await fetch(`${baseUrl}/hot-zones?limit=0`)).text();
    expect(zero).toContain('value="1"');
    const nan = await (await fetch(`${baseUrl}/hot-zones?limit=abc`)).text();
    expect(nan).toContain('value="10"');
  });

  it('GET /hot-zones?format=json returns the bare HotZoneRow[] array as application/json', async () => {
    const res = await fetch(`${baseUrl}/hot-zones?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Self-host repo always has churn, so the array is non-empty; each row
    // carries the documented HotZoneRow shape rather than HTML chrome.
    if (body.length > 0) {
      const row = body[0];
      expect(typeof row.rank).toBe('number');
      expect(typeof row.path).toBe('string');
      expect(typeof row.changeCount).toBe('number');
      expect(Array.isArray(row.authors)).toBe(true);
    }
    // Confirm the JSON branch is not wrapped in the dashboard HTML layout.
    expect(JSON.stringify(body)).not.toContain('<html');
  });

  it('GET /hot-zones?format=json&limit=3 clamps the JSON array to the limit', async () => {
    const res = await fetch(`${baseUrl}/hot-zones?format=json&limit=3`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(3);
  });

  it('GET /hot-zones without format still returns HTML (default branch unchanged)', async () => {
    const res = await fetch(`${baseUrl}/hot-zones`);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET / nav contains a link to /hot-zones', async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    expect(body).toContain('href="/hot-zones"');
  });

  it('GET /wip-age returns 200 with HTML and the page heading', async () => {
    const res = await fetch(`${baseUrl}/wip-age`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('WIP age');
  });

  it('GET /wip-age renders bucket counters', async () => {
    const res = await fetch(`${baseUrl}/wip-age`);
    const body = await res.text();
    expect(body).toContain('in progress');
    expect(body).toContain('fresh');
    expect(body).toContain('aging');
    expect(body).toContain('stale');
  });

  it('GET / nav contains a link to /wip-age', async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    expect(body).toContain('href="/wip-age"');
  });

  it('GET /vision returns 200 with rendered vision body', async () => {
    const res = await fetch(`${baseUrl}/vision`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toMatch(/Vision<\/h1>/);
    expect(body).toContain('North Star');
  });

  it('GET / omits the milestone banner when vision sets no current-milestone', async () => {
    // noldor's docs/vision.md has no `current-milestone:` frontmatter, so the
    // banner renders empty (renderMilestoneBanner returns '' for an unset slug).
    // renderMilestoneBanner's populated-banner path is unit-tested separately.
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    // The `.milestone-banner` class is always in the stylesheet; assert on the
    // banner's rendered text, which only appears when a milestone is set.
    expect(body).not.toContain('Current milestone');
    expect(body).not.toContain('<aside class="milestone-banner">');
    expect(body).toContain('href="/vision"');
  });

  it('GET / nav contains a link to /vision', async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    expect(body).toContain('href="/vision"');
  });

  it('e2e: /roadmap?size=M,L&impact=high,critical&sort=size-desc renders selected chips + sorted state', async () => {
    // Reads real docs/roadmap.md content — the assertions are structural only.
    const res = await fetch(`${baseUrl}/roadmap?size=M,L&impact=high,critical&sort=size-desc`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('chip-row');
    expect(body).toMatch(/class="chip selected"[^>]*>M</);
    expect(body).toMatch(/class="chip selected"[^>]*>L</);
    expect(body).toMatch(/class="chip selected"[^>]*>high</);
    expect(body).toMatch(/class="chip selected"[^>]*>critical</);
    expect(body).toMatch(/<option value="size-desc"\s+selected/);
  });

  it('e2e: /backlog?sort=impact-desc reflects sort selection', async () => {
    const res = await fetch(`${baseUrl}/backlog?sort=impact-desc`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<option value="impact-desc"\s+selected/);
  });

  it('GET /roadmap returns ETag header matching docs/roadmap.md SHA-256', async () => {
    const res = await fetch(`${baseUrl}/roadmap`);
    expect(res.status).toBe(200);
    const expected = createHash('sha256').update(readFileSync('docs/roadmap.md')).digest('hex');
    expect(res.headers.get('etag')).toBe(expected);
  });

  it('GET /backlog returns ETag header matching docs/backlog.md SHA-256', async () => {
    const res = await fetch(`${baseUrl}/backlog`);
    expect(res.status).toBe(200);
    const expected = createHash('sha256').update(readFileSync('docs/backlog.md')).digest('hex');
    expect(res.headers.get('etag')).toBe(expected);
  });

  it('GET /roadmap emits <meta name="combined-etag"> in <head> with both hashes', async () => {
    const res = await fetch(`${baseUrl}/roadmap`);
    expect(res.status).toBe(200);
    const body = await res.text();
    const rHash = createHash('sha256').update(readFileSync('docs/roadmap.md')).digest('hex');
    const bHash = createHash('sha256').update(readFileSync('docs/backlog.md')).digest('hex');
    expect(body).toContain(`<meta name="combined-etag" content="${rHash}:${bHash}">`);
  });

  // ---- POST endpoint smoke tests (safe — no successful writes) ----

  it('POST /api/roadmap/move without If-Match returns 412 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'does-not-matter', targetIndex: 0 }),
    });
    expect(res.status).toBe(412);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/etag/i);
  });

  it('POST /api/backlog/move returns 404 (route removed)', async () => {
    const res = await fetch(`${baseUrl}/api/backlog/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': 'h' },
      body: JSON.stringify({ slug: 'x', targetIndex: 0 }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/roadmap/move with invalid slug returns 400 (before file read)', async () => {
    const rHash = createHash('sha256').update(readFileSync('docs/roadmap.md')).digest('hex');
    const res = await fetch(`${baseUrl}/api/roadmap/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': rHash },
      body: JSON.stringify({ slug: 'Bad Slug!', targetIndex: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/roadmap/move with body >1KB returns 413', async () => {
    const filler = 'x'.repeat(1100);
    const res = await fetch(`${baseUrl}/api/roadmap/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'a', targetIndex: 0, pad: filler }),
    });
    expect(res.status).toBe(413);
  });

  it('POST /api/roadmap/move with invalid JSON returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/roadmap/promote-from-backlog/:slug without If-Match returns 412', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/promote-from-backlog/does-not-exist`, {
      method: 'POST',
    });
    expect(res.status).toBe(412);
  });

  it('POST /api/roadmap/demote-to-backlog/:slug without If-Match returns 412', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/demote-to-backlog/does-not-exist`, {
      method: 'POST',
    });
    expect(res.status).toBe(412);
  });

  it('GET /api/roadmap/move returns 405 with Allow: POST', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/move`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('POST /roadmap returns 405 with Allow: GET', async () => {
    const res = await fetch(`${baseUrl}/roadmap`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('POST /api/roadmap/promote-from-backlog/does-not-exist returns JSON content-type (not HTML)', async () => {
    const res = await fetch(`${baseUrl}/api/roadmap/promote-from-backlog/missing`, {
      method: 'POST',
    });
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(text).not.toContain('<html');
    expect(text).not.toContain('<!DOCTYPE');
  });

  // ---- /static/<file> route ----

  it('GET /static/drag.js returns 200 with application/javascript content-type', async () => {
    const res = await fetch(`${baseUrl}/static/drag.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
    expect(res.headers.get('cache-control')).toContain('no-cache');
  });

  it('GET /static/..%2Fetc%2Fpasswd returns 400 (path traversal blocked)', async () => {
    const res = await fetch(`${baseUrl}/static/..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });
});
