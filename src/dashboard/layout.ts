const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Overview' },
  { href: '/vision', label: 'Vision' },
  { href: '/milestones', label: 'Milestones' },
  { href: '/framework', label: 'Framework' },
  { href: '/docs', label: 'Docs' },
  { href: '/skills', label: 'Skills' },
  { href: '/release-notes', label: 'Releases' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/features', label: 'Features' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/velocity', label: 'Velocity' },
  { href: '/hot-zones', label: 'Hot zones' },
  { href: '/wip-age', label: 'WIP age' },
  { href: '/test-pyramid', label: 'Test pyramid' },
  { href: '/graph-health', label: 'Graph health' },
  { href: '/worktrees', label: 'Worktrees' },
  { href: '/agents', label: 'Agents & Drain' },
  { href: '/metrics', label: 'Metrics' },
];

/**
 * Inline data-URI favicon (accent-colored "N" glyph) — no asset file, no extra
 * route, and it silences the browser's /favicon.ico 404, the only console
 * error the 2026-07-11 dashboard audit found.
 */
export const FAVICON_HREF =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2563eb"/><text x="8" y="12" font-size="11" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">N</text></svg>`,
  );

const STYLE = `
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --muted: #6b6b6b; --accent: #2563eb; --line: #e0e0e0; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #f0f0f0; --bg: #111; --muted: #999; --accent: #60a5fa; --line: #2a2a2a; }
  }
  body { margin: 0; font: 14px/1.5 -apple-system, ui-sans-serif, system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  nav { display: flex; gap: 1rem; padding: 0.75rem 1.5rem; border-bottom: 1px solid var(--line); background: var(--bg); position: sticky; top: 0; }
  nav a { color: var(--muted); text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 4px; }
  nav a[aria-current="page"] { color: var(--accent); background: rgba(37,99,235,0.08); font-weight: 600; }
  main { padding: 1.5rem; max-width: min(1300px, 92vw); margin: 0 auto; }
  h1, h2, h3 { line-height: 1.2; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  h2 { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; color: var(--muted); }
  thead th { background: var(--bg); position: sticky; top: 3rem; z-index: 1; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  tbody tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
  tbody tr:hover td { background: rgba(37,99,235,0.05); }
  td { max-width: 40rem; word-break: break-word; }
  .entry-id { display: block; margin-top: 0.15rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: var(--muted); }
  td.description { font-size: 0.88rem; vertical-align: top; }
  td.description .body { font-size: inherit; }
  td.description .body > :first-child { margin-top: 0; }
  td.description .body > :last-child { margin-bottom: 0; }
  td.description .body p { margin: 0 0 0.5rem; line-height: 1.55; }
  td.description .body ul, td.description .body ol { margin: 0.3rem 0; padding-left: 1.4rem; }
  td.description .body pre { margin: 0.4rem 0; }
  /* --- Description clamp + click-to-expand (Task 4) --- */
  /* Default state: clamp preview visible, full-body hidden. */
  td.description .description-toggle {
    display: none;
    margin: 0.25rem 0 0;
    padding: 0.1rem 0.5rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--accent);
    background: rgba(37,99,235,0.06);
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
  }
  td.description.has-overflow .description-toggle { display: inline-block; }
  td.description[aria-expanded="true"] .description-toggle { display: inline-block; }
  td.description .description-toggle:hover { background: rgba(37,99,235,0.14); border-color: var(--accent); }
  td.description .description-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  td.description .description--clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    overflow: hidden;
    color: var(--fg);
  }
  td.description .description-full { display: none; }
  /* Expanded state: hide the preview, show the full markdown body. */
  td.description[aria-expanded="true"] .description--clamped { display: none; }
  td.description[aria-expanded="true"] .description-full { display: block; }
  @media (prefers-color-scheme: dark) {
    td.description .description-toggle { background: rgba(96,165,250,0.08); }
    td.description .description-toggle:hover { background: rgba(96,165,250,0.18); }
  }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
  dt { color: var(--muted); }
  form.filters { display: flex; gap: 0.75rem; align-items: end; margin-bottom: 1rem; }
  form.filters label { display: grid; gap: 0.2rem; font-size: 0.85rem; color: var(--muted); }
  form.filters select, form.filters button { padding: 0.3rem 0.5rem; font: inherit; }
  /* Fixed width — option content differs per page (roadmap vs backlog vs features), so without an upper bound the selects auto-grow to fit the longest option and diverge visually. */
  form.filters select { width: 12rem; }
  .counter-strip { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .counter { padding: 0.5rem 0.75rem; border: 1px solid var(--line); border-radius: 6px; min-width: 6rem; }
  .counter .v { font-size: 1.5rem; font-weight: 600; }
  .counter .l { font-size: 0.8rem; color: var(--muted); }
  a.counter-link { color: inherit; text-decoration: none; }
  a.counter-link .counter:hover { border-color: var(--accent); }
  .bar { background: var(--line); border-radius: 3px; height: 8px; overflow: hidden; }
  .bar > div { background: var(--accent); height: 100%; }
  .empty { color: var(--muted); font-style: italic; padding: 1rem 0; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  pre { overflow-x: auto; padding: 0.5rem; background: rgba(0,0,0,0.04); border-radius: 4px; }
  pre.drain-log { max-height: 24rem; overflow-y: auto; }
  a { color: var(--accent); }
  ul.links { list-style: none; padding: 0; }
  ul.links li { padding: 0.15rem 0; }
  .badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  .badge.fresh { background: rgba(22,163,74,0.15); color: #15803d; }
  .badge.aging { background: rgba(202,138,4,0.18); color: #a16207; }
  .badge.stale { background: rgba(220,38,38,0.18); color: #b91c1c; }
  .badge.type-feat { background: rgba(37,99,235,0.15); color: #1d4ed8; }
  .badge.type-fix { background: rgba(220,38,38,0.18); color: #b91c1c; }
  .badge.type-refactor { background: rgba(124,58,237,0.18); color: #6d28d9; }
  .badge.type-perf { background: rgba(217,70,239,0.18); color: #a21caf; }
  .badge.type-docs { background: rgba(20,184,166,0.18); color: #0f766e; }
  .badge.type-test { background: rgba(202,138,4,0.18); color: #a16207; }
  .badge.type-chore { background: rgba(107,114,128,0.18); color: #4b5563; }
  tr.row-stale td { background: rgba(220,38,38,0.06); }
  .kpi-section + .kpi-section { margin-top: 1rem; }
  .kpi-section h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 0.4rem; border: 0; padding: 0; }
  .milestone-banner { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 6px; padding: 0.75rem 1rem; margin: 0 0 1.5rem; background: rgba(37,99,235,0.04); }
  .milestone-banner .line { font-size: 0.95rem; }
  .milestone-banner .line.next { font-size: 0.8rem; color: var(--muted); margin-top: 0.3rem; }
  .milestone-banner .label { color: var(--muted); text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; margin-right: 0.4rem; }
  @media (prefers-color-scheme: dark) { .milestone-banner { background: rgba(96,165,250,0.06); } }
  @media (prefers-color-scheme: dark) {
    .badge.fresh { color: #4ade80; }
    .badge.aging { color: #facc15; }
    .badge.stale { color: #f87171; }
    .badge.type-feat { color: #60a5fa; }
    .badge.type-fix { color: #f87171; }
    .badge.type-refactor { color: #c4b5fd; }
    .badge.type-perf { color: #f0abfc; }
    .badge.type-docs { color: #5eead4; }
    .badge.type-test { color: #facc15; }
    .badge.type-chore { color: #d1d5db; }
    tr.row-stale td { background: rgba(248,113,113,0.08); }
    tbody tr:nth-child(even) td { background: rgba(255,255,255,0.025); }
    tbody tr:hover td { background: rgba(96,165,250,0.06); }
  }
  /* --- Drag handle + move chip (roadmap / backlog reorder) --- */
  th.drag-col, td.drag-handle { width: 1.5rem; padding-left: 0.4rem; padding-right: 0.2rem; }
  th.action-col, td.actions { width: 9.5rem; white-space: nowrap; text-align: right; }
  /* Keep td.actions a normal table-cell so it stretches to the full row height;
     flex lives on the inner wrapper so the buttons stay vertically centred. */
  td.actions { vertical-align: middle; }
  td.actions .actions-inner { display: flex; gap: 0.3rem; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
  td.drag-handle { color: var(--muted); cursor: grab; user-select: none; vertical-align: middle; }
  td.drag-handle:active { cursor: grabbing; }
  td.drag-handle svg { display: block; margin: 0 auto; }
  td.drag-handle--disabled { opacity: 0.25; cursor: not-allowed; }
  tr[draggable="true"].dragging td { opacity: 0.4; }
  .move-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.6rem; border: 1px solid var(--line); border-radius: 999px; background: rgba(37,99,235,0.06); color: var(--accent); font: inherit; font-size: 0.78rem; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .move-chip:hover { background: rgba(37,99,235,0.14); border-color: var(--accent); }
  .move-chip:active { transform: translateY(1px); }
  .move-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .move-chip__arrow { font-weight: 700; line-height: 1; }
  .remove-chip { display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border: 1px solid var(--line); border-radius: 999px; background: rgba(220,38,38,0.06); color: #b91c1c; font: inherit; font-size: 0.78rem; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .remove-chip:hover { background: rgba(220,38,38,0.14); border-color: #b91c1c; }
  .remove-chip:active { transform: translateY(1px); }
  .remove-chip:focus-visible { outline: 2px solid #b91c1c; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    .move-chip { background: rgba(96,165,250,0.08); }
    .move-chip:hover { background: rgba(96,165,250,0.18); }
    .remove-chip { background: rgba(248,113,113,0.1); color: #f87171; }
    .remove-chip:hover { background: rgba(248,113,113,0.2); }
  }
  /* --- Markdown body surfaces (scoped to .body wrapper) --- */
  .body { font-size: 0.95rem; }
  .body h1 { font-size: 1.4rem; margin: 1.5rem 0 0.75rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; }
  .body h2 { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--line); padding-bottom: 0.2rem; }
  .body h3 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
  .body h4 { font-size: 0.95rem; margin: 1rem 0 0.3rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .body p { line-height: 1.6; margin: 0.5rem 0 1rem; }
  .body ul, .body ol { line-height: 1.6; padding-left: 1.5rem; margin: 0.5rem 0 1rem; }
  .body li + li { margin-top: 0.2rem; }
  .body blockquote { margin: 1rem 0; padding: 0.4rem 0.9rem; border-left: 3px solid var(--accent); background: rgba(37,99,235,0.04); color: var(--muted); }
  .body a { text-decoration: none; }
  .body a:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    .body blockquote { background: rgba(96,165,250,0.06); }
  }
  /* --- Markdown body code + tables --- */
  .body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; padding: 0.1rem 0.35rem; border-radius: 4px; background: rgba(37,99,235,0.08); color: var(--accent); border: 1px solid rgba(37,99,235,0.15); }
  .body pre { padding: 0.75rem 0.9rem; background: rgba(37,99,235,0.04); border: 1px solid rgba(37,99,235,0.18); border-radius: 6px; overflow-x: auto; margin: 0.75rem 0 1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .body pre code { padding: 0; background: transparent; border: 0; border-radius: 0; font-size: 0.85rem; line-height: 1.5; color: var(--fg); }
  .body table { border-collapse: collapse; width: 100%; margin: 0.75rem 0 1rem; font-size: 0.9rem; }
  .body th, .body td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; }
  .body th { background: rgba(0,0,0,0.03); font-weight: 600; color: var(--fg); }
  .body thead th { position: static; box-shadow: none; top: auto; }
  .body tbody tr:nth-child(even) td { background: rgba(0,0,0,0.02); }
  @media (prefers-color-scheme: dark) {
    .body code { background: rgba(96,165,250,0.12); border-color: rgba(96,165,250,0.22); }
    .body pre { background: rgba(96,165,250,0.06); border-color: rgba(96,165,250,0.22); }
    .body th { background: rgba(255,255,255,0.05); }
    .body tbody tr:nth-child(even) td { background: rgba(255,255,255,0.025); }
  }
  /* --- Chip rows --- */
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
  }
  .chip-row .chip-label {
    font-size: 0.85rem;
    color: var(--muted);
    margin-right: 0.25rem;
  }
  .chip-row .chip {
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 0.85rem;
    text-decoration: none;
    color: inherit;
  }
  .chip-row .chip.selected {
    background: var(--accent, #2563eb);
    color: var(--bg);
    border-color: var(--accent, #2563eb);
  }
  .chip-row .chip:not(.selected):hover {
    background: rgba(37,99,235,0.08);
  }
  /* Standalone pill chip (table cells, milestone member lists) — the chip-row
     variant above is scoped to .chip-row. */
  a.chip, span.chip {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 0.8rem;
    text-decoration: none;
    color: inherit;
  }
  /* Warn accent: shipped-milestone-with-open-feature rows + the dangling-banner. */
  .warn { border-left-color: #dc2626 !important; }
  tr.warn td, li.warn { background: rgba(220,38,38,0.07); }
  .milestone-group { border: 1px solid var(--line); border-radius: 6px; padding: 0.75rem 1rem; margin: 0 0 1rem; }
  .milestone-group h3 { margin: 0 0 0.5rem; }
  .milestone-group .status { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  a.reset {
    font-size: 0.8rem;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 1px dotted var(--muted);
  }
  a.reset:hover {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  /* --- highlight.js palette (TS / TSX / JS / JSON / CSS / Bash / etc.) --- */
  .hljs-keyword, .hljs-tag .hljs-name, .hljs-symbol, .hljs-bullet { color: var(--accent); }
  .hljs-string, .hljs-regexp { color: #16a34a; }
  .hljs-comment, .hljs-quote { color: var(--muted); font-style: italic; }
  .hljs-number, .hljs-literal { color: #ea580c; }
  .hljs-built_in, .hljs-type, .hljs-class .hljs-title { color: #c026d3; }
  .hljs-title, .hljs-title.function_ { color: var(--accent); }
  .hljs-attr, .hljs-attribute { color: #ea580c; }
  .hljs-meta, .hljs-meta-keyword { color: var(--muted); }
  .hljs-deletion { color: #b91c1c; background: rgba(220,38,38,0.08); }
  .hljs-addition { color: #15803d; background: rgba(22,163,74,0.08); }
  @media (prefers-color-scheme: dark) {
    .hljs-string, .hljs-regexp { color: #4ade80; }
    .hljs-number, .hljs-literal { color: #fb923c; }
    .hljs-built_in, .hljs-type, .hljs-class .hljs-title { color: #d8b4fe; }
    .hljs-attr, .hljs-attribute { color: #fb923c; }
    .hljs-deletion { color: #f87171; background: rgba(248,113,113,0.10); }
    .hljs-addition { color: #4ade80; background: rgba(74,222,128,0.10); }
  }
  /* --- /agents page: run-timeline bars + outcome badges --- */
  .agents-bar-track { position: relative; background: var(--line); border-radius: 3px; height: 10px; min-width: 8rem; }
  .agents-bar { position: absolute; top: 0; height: 100%; border-radius: 3px; }
  .agents-bar--ok { background: #16a34a; }
  .agents-bar--failed { background: #dc2626; }
  .agents-bar--timeout { background: #d97706; }
  .agents-bar--salvaged { background: #7c3aed; }
  .badge.outcome-ok { background: rgba(22,163,74,0.15); color: #15803d; }
  .badge.outcome-failed { background: rgba(220,38,38,0.18); color: #b91c1c; }
  .badge.outcome-timeout { background: rgba(217,119,6,0.18); color: #b45309; }
  .badge.outcome-salvaged { background: rgba(124,58,237,0.18); color: #6d28d9; }
  @media (prefers-color-scheme: dark) {
    .badge.outcome-ok { color: #4ade80; }
    .badge.outcome-failed { color: #f87171; }
    .badge.outcome-timeout { color: #fbbf24; }
    .badge.outcome-salvaged { color: #c4b5fd; }
  }
`;

/**
 * Escape a string for safe insertion as HTML text or attribute value.
 *
 * @param s - The unsafe string
 * @returns Escaped string with `&`, `<`, `>`, `"`, `'` replaced
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pinned to mermaid 11.x. CDN import via jsdelivr — internal-only dev tool,
// network dependency is acceptable. `securityLevel: 'loose'` lets mermaid
// render `<br/>` and other inline HTML inside node labels (the lifecycle
// flowchart at /framework/lifecycle uses this); no XSS surface here since
// content is repo-authored.
const MERMAID_SCRIPT = `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({ startOnLoad: true, theme: dark ? 'dark' : 'default', securityLevel: 'loose' });
</script>`;

/**
 * Wrap a body string in the dashboard HTML shell.
 *
 * @param opts - title, body, activeNav path, optional combinedEtag
 * @returns Full HTML document
 *
 * @remarks
 * When `combinedEtag` is supplied, a `<meta name="combined-etag"
 * content="<roadmapHash>:<backlogHash>">` tag is emitted in `<head>`.
 * Cross-section client buttons (promote / demote in the dashboard
 * drag-and-drop FD) read this to satisfy the API's combined If-Match
 * precondition. The single-section `etag` lives in the HTTP response
 * header — separate channels by design (header is response-scope,
 * meta is page-scope).
 */
export function renderLayout(opts: {
  title: string;
  body: string;
  activeNav: string | null;
  combinedEtag?: string;
}): string {
  const navHtml = NAV_LINKS.map((l) => {
    const aria = l.href === opts.activeNav ? ' aria-current="page"' : '';
    return `<a href="${l.href}"${aria}>${escapeHtml(l.label)}</a>`;
  }).join('');
  const combinedEtagMeta = opts.combinedEtag
    ? `<meta name="combined-etag" content="${escapeHtml(opts.combinedEtag)}">`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${combinedEtagMeta}<title>${escapeHtml(opts.title)}</title><link rel="icon" href="${FAVICON_HREF}"><style>${STYLE}</style></head><body><nav>${navHtml}</nav><main>${opts.body}</main>${MERMAID_SCRIPT}<script src="/static/drag.js" type="module"></script><script src="/static/agents.js" type="module"></script></body></html>`;
}
