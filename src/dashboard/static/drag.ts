// Vanilla TS dashboard drag client — compiled to dist/drag.js and served by
// /static/<file>. Wires HTML5 drag-and-drop on roadmap/backlog rows plus the
// Promote/Demote buttons. Optimistic DOM splice on drag; reload on any fetch
// failure (server is the source of truth — see spec §6 error semantics).

/**
 * Compute a vertical scroll velocity (px/frame) given the cursor's clientY
 * inside the viewport. Pure — no DOM access; trivially unit-testable.
 *
 * Below the top threshold returns a negative value (scroll up); above the
 * bottom threshold (= viewportHeight - threshold) returns a positive value
 * (scroll down); otherwise 0. The magnitude ramps linearly from 0 at the
 * threshold boundary to ±maxSpeed at the very edge, then clamps at maxSpeed
 * for off-viewport coordinates (negative clientY or > viewportHeight).
 *
 * Decoupled from `window.scrollBy` so the rAF loop can keep scrolling even
 * when the `dragover` event stops firing (HTML5 dragover only fires on
 * cursor motion — parking the cursor inside the threshold would otherwise
 * stall scrolling).
 *
 * @param clientY - Cursor Y in viewport coordinates (matches `DragEvent.clientY`).
 * @param viewportHeight - Viewport height in pixels (typically `window.innerHeight`).
 * @param threshold - Edge zone size in pixels.
 * @param maxSpeed - Maximum scroll speed in pixels per frame.
 * @returns Signed velocity; 0 in the safe middle zone.
 */
export const edgeScrollVelocity = (
  clientY: number,
  viewportHeight: number,
  threshold = 80,
  maxSpeed = 16,
): number => {
  if (clientY < threshold) {
    const ratio = Math.min(1, (threshold - clientY) / threshold);
    return -ratio * maxSpeed;
  }
  const bottomBoundary = viewportHeight - threshold;
  if (clientY > bottomBoundary) {
    const ratio = Math.min(1, (clientY - bottomBoundary) / threshold);
    return ratio * maxSpeed;
  }
  return 0;
};

// First row: expand "insert before" to the full row height. Sticky thead +
// auto-scroll-up threshold otherwise shrink the row-1-top-half target to ~20px.
export function shouldInsertBefore(
  rect: { top: number; height: number },
  clientY: number,
  isFirstRow: boolean,
): boolean {
  if (isFirstRow) return clientY < rect.top + rect.height;
  return clientY < rect.top + rect.height / 2;
}

type Section = 'roadmap' | 'backlog';

interface TableContext {
  table: HTMLTableElement;
  section: Section;
  etag: string;
  dragEnabled: boolean;
}

function ctxFromTable(table: HTMLTableElement): TableContext | null {
  const section = table.dataset.section as Section | undefined;
  const etag = table.dataset.etag;
  if (section !== 'roadmap' && section !== 'backlog') return null;
  if (etag === undefined) return null;
  return { table, section, etag, dragEnabled: table.dataset.dragEnabled === 'true' };
}

function combinedEtag(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="combined-etag"]');
  return meta?.content ?? null;
}

// Module-level state for the rAF auto-scroll loop. Shared across every
// wired table on the page — only one drag can be in flight at a time, and
// the velocity is the same regardless of which table started the drag.
// `lastVelocity` is updated from `dragover`; the rAF loop reads it each
// frame and calls `window.scrollBy`. The loop self-cancels after
// `IDLE_FRAMES_BEFORE_STOP` consecutive zero-velocity frames so a missed
// `dragend` (e.g. user navigates away mid-drag) doesn't leak a spinning rAF.
let lastVelocity = 0;
let scrollLoopHandle: number | null = null;
let idleFrames = 0;
const IDLE_FRAMES_BEFORE_STOP = 30;

function startScrollLoop(): void {
  if (scrollLoopHandle !== null) return;
  idleFrames = 0;
  const tick = (): void => {
    if (lastVelocity !== 0) {
      window.scrollBy({ top: lastVelocity, behavior: 'auto' });
      idleFrames = 0;
    } else {
      idleFrames += 1;
      if (idleFrames >= IDLE_FRAMES_BEFORE_STOP) {
        scrollLoopHandle = null;
        return;
      }
    }
    scrollLoopHandle = window.requestAnimationFrame(tick);
  };
  scrollLoopHandle = window.requestAnimationFrame(tick);
}

function stopScrollLoop(): void {
  lastVelocity = 0;
  if (scrollLoopHandle !== null) {
    window.cancelAnimationFrame(scrollLoopHandle);
    scrollLoopHandle = null;
  }
  idleFrames = 0;
}

function wireDrag(ctx: TableContext): void {
  if (!ctx.dragEnabled) return;
  const tbody = ctx.table.querySelector('tbody');
  if (!tbody) return;

  let draggingRow: HTMLTableRowElement | null = null;

  tbody.addEventListener('dragstart', (ev) => {
    const row = (ev.target as HTMLElement).closest('tr[data-slug]') as HTMLTableRowElement | null;
    if (!row) return;
    draggingRow = row;
    row.classList.add('dragging');
    ev.dataTransfer?.setData('text/plain', row.dataset.slug ?? '');
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    // Kick the rAF loop. Auto-scroll then keeps running across `dragover`
    // pauses (cursor parked inside the edge threshold) until release.
    startScrollLoop();
  });

  tbody.addEventListener('dragover', (ev) => {
    if (!draggingRow) return;
    ev.preventDefault();
    // Update the target velocity from cursor position. `dragover` only fires
    // on cursor motion, so we never call `scrollBy` from here — the rAF loop
    // reads `lastVelocity` and does the actual scrolling.
    lastVelocity = edgeScrollVelocity(ev.clientY, window.innerHeight);
    const overRow = (ev.target as HTMLElement).closest(
      'tr[data-slug]',
    ) as HTMLTableRowElement | null;
    if (!overRow || overRow === draggingRow) return;
    const rect = overRow.getBoundingClientRect();
    // Compute "first row" against non-dragging siblings so the optimistic
    // splice doesn't flip the zone mid-drag once draggingRow becomes the new
    // firstElementChild.
    const firstNonDragging = tbody.querySelector<HTMLTableRowElement>(
      'tr[data-slug]:not(.dragging)',
    );
    const isFirstRow = overRow === firstNonDragging;
    const before = shouldInsertBefore(rect, ev.clientY, isFirstRow);
    overRow.parentElement?.insertBefore(draggingRow, before ? overRow : overRow.nextElementSibling);
  });

  tbody.addEventListener('dragend', () => {
    draggingRow?.classList.remove('dragging');
    draggingRow = null;
    stopScrollLoop();
  });

  tbody.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const row = (ev.target as HTMLElement).closest('tr[data-slug]') as HTMLTableRowElement | null;
    if (!draggingRow || !row) return;
    const allRows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-slug]'));
    const targetIndex = allRows.indexOf(draggingRow);
    const slug = draggingRow.dataset.slug;
    stopScrollLoop();
    if (slug === undefined || targetIndex < 0) return;
    void sendMove(ctx, slug, targetIndex);
  });
}

async function sendMove(ctx: TableContext, slug: string, targetIndex: number): Promise<void> {
  try {
    // Read the live dataset.etag per-fetch so successive drags in one page
    // session don't re-send the stale etag captured at script-load time.
    const res = await fetch(`/api/${ctx.section}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': ctx.table.dataset.etag ?? '',
      },
      body: JSON.stringify({ slug, targetIndex }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { etag?: string };
    if (data.etag) ctx.table.dataset.etag = data.etag;
  } catch {
    window.location.reload();
  }
}

function wireButtons(): void {
  document.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const slug = btn.dataset.slug;
    if (slug === undefined) return;

    // Remove is a single-file delete: the If-Match precondition is the closest
    // table's own `data-etag` (sha256 of that one file), not the combined etag.
    if (action === 'remove') {
      const section = btn.dataset.section;
      if (section !== 'roadmap' && section !== 'backlog') return;
      const table = btn.closest<HTMLTableElement>('table[data-section]');
      const tableEtag = table?.dataset.etag;
      if (tableEtag === undefined) {
        window.location.reload();
        return;
      }
      if (!window.confirm(`Remove "${slug}" from ${section}? This rewrites docs/${section}.md.`)) {
        return;
      }
      void sendRemove(btn, section, slug, tableEtag);
      return;
    }

    if (action !== 'promote' && action !== 'demote') return;
    const etag = combinedEtag();
    if (etag === null) {
      window.location.reload();
      return;
    }
    void sendButton(btn, action, slug, etag);
  });
}

async function sendRemove(
  btn: HTMLButtonElement,
  section: 'roadmap' | 'backlog',
  slug: string,
  etag: string,
): Promise<void> {
  btn.disabled = true;
  try {
    await fetch(`/api/${section}/remove/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: '{}',
    });
  } finally {
    // Server is authoritative — reload regardless of success/failure.
    window.location.reload();
  }
}

// Wire the top/bottom "add roadmap entry" forms. Native constraint validation
// runs before `submit` fires, so name/area are guaranteed present here. The
// If-Match etag rides on the form's own `data-etag` (the roadmap file hash),
// which is available even when the roadmap table isn't rendered (empty filter).
function wireAddForms(): void {
  document.addEventListener('submit', (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>('form.add-entry__form');
    if (!form) return;
    ev.preventDefault();
    const position = form.dataset.position === 'bottom' ? 'bottom' : 'top';
    const etag = form.dataset.etag ?? '';
    const fd = new FormData(form);
    const payload = {
      position,
      name: String(fd.get('name') ?? ''),
      area: String(fd.get('area') ?? ''),
      type: String(fd.get('type') ?? ''),
      size: String(fd.get('size') ?? ''),
      impact: String(fd.get('impact') ?? ''),
      description: String(fd.get('description') ?? ''),
    };
    void sendAdd(form, payload, etag);
  });
}

async function sendAdd(
  form: HTMLFormElement,
  payload: Record<string, string>,
  etag: string,
): Promise<void> {
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    await fetch('/api/roadmap/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(payload),
    });
  } finally {
    window.location.reload();
  }
}

// Toggle the description clamp on the closest `<td class="description">`.
// Single delegate at the document level (same pattern as wireButtons).
// Reads + writes the `aria-expanded` attribute on the <td> — CSS keys off
// `td.description[aria-expanded="true"]` to swap preview ↔ full body.
// The button's own `aria-expanded` stays in sync so screen readers announce
// the correct state, and the visible label flips between Show more/less.
function wireDescriptionToggles(): void {
  document.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button.description-toggle');
    if (!btn) return;
    const cell = btn.closest<HTMLTableCellElement>('td.description');
    if (!cell) return;
    const expanded = cell.getAttribute('aria-expanded') === 'true';
    const next = expanded ? 'false' : 'true';
    cell.setAttribute('aria-expanded', next);
    btn.setAttribute('aria-expanded', next);
    btn.textContent = next === 'true' ? 'Show less' : 'Show more';
  });
}

// Width changes (window resize, container reflow) re-wrap clamped text →
// overflow state can flip. ResizeObserver on each cell keeps the has-overflow
// class in sync with the actual rendered geometry. Font swaps that change
// line-height without changing box width do NOT trigger RO; if that matters,
// add a `document.fonts.ready` resync.
function syncOverflow(cell: HTMLTableCellElement): void {
  const clamped = cell.querySelector<HTMLElement>('.description--clamped');
  if (!clamped) return;
  const overflows = clamped.scrollHeight > clamped.clientHeight + 2;
  cell.classList.toggle('has-overflow', overflows);
}

function wireDescriptionOverflow(): void {
  const cells = document.querySelectorAll<HTMLTableCellElement>('td.description');
  cells.forEach(syncOverflow);
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      syncOverflow(entry.target as HTMLTableCellElement);
    }
  });
  cells.forEach((cell) => ro.observe(cell));
}

async function sendButton(
  btn: HTMLButtonElement,
  action: 'promote' | 'demote',
  slug: string,
  etag: string,
): Promise<void> {
  const url =
    action === 'promote'
      ? `/api/roadmap/promote-from-backlog/${encodeURIComponent(slug)}`
      : `/api/roadmap/demote-to-backlog/${encodeURIComponent(slug)}`;
  btn.disabled = true;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: '{}',
    });
  } finally {
    // Reload regardless of success/failure — the server is authoritative and
    // a stale UI is worse than a brief refresh flash.
    window.location.reload();
  }
}

function init(): void {
  document.querySelectorAll<HTMLTableElement>('table[data-section]').forEach((table) => {
    const ctx = ctxFromTable(table);
    if (ctx) wireDrag(ctx);
  });
  wireButtons();
  wireAddForms();
  wireDescriptionToggles();
  wireDescriptionOverflow();
}

// Guard the auto-init so this module can be imported from non-DOM contexts
// (e.g. vitest unit-testing the pure helper above). The actual compiled
// dist/drag.js runs in the browser where `document` is always defined.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
