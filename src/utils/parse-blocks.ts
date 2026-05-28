import { slugify } from './slugify.js';

/**
 * Module-level set of warning keys already emitted in this process. Prevents
 * the dashboard server from spamming the same collision warnings on every
 * page render. Reset is intentional only across process restarts.
 */
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

/**
 * Backlog entry parsed from `docs/backlog.md` (or a roadmap.md entry —
 * the parser is shared). Mirrors a `### Heading` block with bullet-field
 * metadata and a free-text description.
 */
export interface BacklogEntry {
  name: string;
  /**
   * Slug derived from `name` via shared slugify rule. Unique within file for
   * non-empty slugs (collisions get `-2`, `-3`, ... in source order). Headings
   * whose name slugifies to an empty string (all-punctuation) always emit `''`
   * and are flagged via a stderr warning — the HTTP layer rejects empty slugs
   * with 400, so callers do not need to handle the duplicate-empty case.
   */
  slug: string;
  area: string;
  /** Conventional Commits change kind (feat/fix/refactor/chore/docs/perf/test). */
  type?: string;
  /** YYYY-MM-DD; absent on entries created before the schema patch. */
  since?: string;
  deps?: string[];
  parent?: string;
  description: string;
  /** 1-based position of this entry in source order — file-wide for roadmap and backlog (no per-section scope). */
  priority?: number;
  /** Heading depth in the source markdown: 3 = `### Name`, 4 = `#### Name` under an H3 category. */
  level?: 3 | 4;
  /** For level-4 entries, the name of the enclosing H3 category (e.g. `Noldor Framework`). */
  category?: string;
  /** Build-cost estimate. Bullet field `- size: <value>`. Validated downstream; parser accepts any string. */
  size?: string;
  /** User-value / strategic weight. Bullet field `- impact: <value>`. Validated downstream; parser accepts any string. */
  impact?: string;
  /** Confidence in the size + impact estimate. Bullet field `- confidence: <value>`. Validated downstream; parser accepts any string. Default at scoring time: `med`. */
  confidence?: string;
}

/**
 * Track slugs already emitted in source order so duplicates suffix `-2`,
 * `-3`, etc. Emits a stderr warning per collision so operators can rename
 * one of the conflicting headings.
 */
function createSlugTracker(): (name: string, locationLabel: string) => string {
  const counts = new Map<string, number>();
  return (name, locationLabel) => {
    const base = slugify(name);
    if (base.length === 0) {
      // Empty slug means the heading is all punctuation. Surface it loudly —
      // the entry can't be addressed via the API in this state. Caller
      // (parser) accepts the empty string; HTTP layer 400s on read.
      warnOnce(
        `empty:${name}:${locationLabel}`,
        `parse-blocks: heading "${name}" near ${locationLabel} slugifies to empty string; rename the heading.`,
      );
      return '';
    }
    const prev = counts.get(base) ?? 0;
    counts.set(base, prev + 1);
    if (prev === 0) return base;
    const suffixed = `${base}-${prev + 1}`;
    warnOnce(
      `dup:${base}:${locationLabel}`,
      `parse-blocks: duplicate slug "${base}" at ${locationLabel}; emitting "${suffixed}".`,
    );
    return suffixed;
  };
}

/**
 * Parse a markdown file made of `### Heading` blocks with `- key: value`
 * bullet fields. Returns one entry per block. Used for both
 * `docs/backlog.md` (parking lot) and the per-section blocks inside
 * `docs/roadmap.md`.
 *
 * @param raw - Raw file contents
 * @returns Parsed entries in source order
 */
export function parseBacklog(raw: string): BacklogEntry[] {
  return parseEntries(raw);
}

/**
 * Parse `docs/roadmap.md` into a flat priority-ordered list of entries.
 * File order = priority across the whole file. H3 categories (`### Name`
 * with no `- area:` bullet) act as semantic groupers — H4 entries
 * beneath them inherit the category name — but the priority counter
 * advances across categories and is file-wide.
 *
 * H3 headings with a `- area:` bullet are direct entries (level 3).
 * H3 headings without `- area:` act as category containers; H4 entries
 * beneath them (level 4) inherit the category name. Roadmap priority is
 * the position of an entry in source order, file-wide.
 *
 * @param raw - Raw roadmap.md contents
 * @returns Parsed entries in source order
 */
export function parseRoadmap(raw: string): BacklogEntry[] {
  interface PendingBlock {
    level: 3 | 4;
    name: string;
    lines: string[];
    sourceLine: number;
  }

  const entries: BacklogEntry[] = [];
  const lines = raw.split('\n');
  const trackSlug = createSlugTracker();
  let category: string | undefined;
  let inCodeFence = false;
  let pending: PendingBlock | null = null;

  const flush = (): void => {
    if (pending === null) return;
    const parsed = parseBlockBody(pending.lines);
    if (!parsed.area) {
      // H3 without `- area:` is treated as a category container, not an entry.
      if (pending.level === 3) {
        category = pending.name;
      }
      pending = null;
      return;
    }
    // A direct H3 entry (level 3 with `- area:`) interrupts any prior category
    // run — the next H4 should NOT inherit the stale category.
    if (pending.level === 3) {
      category = undefined;
    }
    entries.push({
      area: parsed.area,
      description: parsed.body,
      name: pending.name,
      slug: trackSlug(pending.name, `line ${pending.sourceLine}`),
      parent: parsed.parent,
      since: parsed.since,
      type: parsed.type,
      priority: entries.length + 1,
      level: pending.level,
      category: pending.level === 4 ? category : undefined,
      size: parsed.size,
      impact: parsed.impact,
      confidence: parsed.confidence,
      deps: parsed.deps,
    });
    pending = null;
  };

  // Track lineNum (1-based) so warnings are pinpointable.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      if (pending) pending.lines.push(line);
      continue;
    }

    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      flush();
      pending = { level: 3, name: h3[1], lines: [], sourceLine: lineNum };
      continue;
    }
    const h4 = /^####\s+(.+?)\s*$/.exec(line);
    if (h4) {
      flush();
      pending = { level: 4, name: h4[1], lines: [], sourceLine: lineNum };
      continue;
    }

    if (pending !== null) {
      pending.lines.push(line);
    }
  }
  flush();
  return entries;
}

function parseBlockBody(lines: string[]): {
  area: string;
  type?: string;
  since?: string;
  parent?: string;
  size?: string;
  impact?: string;
  confidence?: string;
  deps?: string[];
  body: string;
} {
  let area = '';
  let type: string | undefined;
  let since: string | undefined;
  let parent: string | undefined;
  let size: string | undefined;
  let impact: string | undefined;
  let confidence: string | undefined;
  let deps: string[] | undefined;
  const bodyLines: string[] = [];
  for (const line of lines) {
    const fieldMatch =
      /^-\s+(area|type|since|parent|size|impact|confidence|deps):\s*(.+?)\s*$/.exec(line);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      if (key === 'area') area = value;
      else if (key === 'type') type = value;
      else if (key === 'since') since = value;
      else if (key === 'parent') parent = value;
      else if (key === 'size') size = value;
      else if (key === 'impact') impact = value;
      else if (key === 'confidence') confidence = value;
      else if (key === 'deps') {
        deps = value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      continue;
    }
    bodyLines.push(line);
  }
  return {
    area,
    body: bodyLines.join('\n').trim(),
    confidence,
    deps,
    impact,
    parent,
    since,
    size,
    type,
  };
}

function parseEntries(raw: string): BacklogEntry[] {
  // Strip fenced code blocks so ### headings inside ``` are not treated as entries.
  const stripped = raw.replace(/^```[\s\S]*?^```/gm, '');
  const blocks = stripped.split(/^### /gm).slice(1);
  const entries: BacklogEntry[] = [];
  const trackSlug = createSlugTracker();

  // We lost line numbers in the split-based parser; pass a per-block index
  // instead so warnings still pinpoint a block, just less precisely.
  let blockIndex = 0;

  for (const block of blocks) {
    blockIndex += 1;
    const firstNewline = block.indexOf('\n');
    const name = block.slice(0, firstNewline).trim();
    const body = block.slice(firstNewline + 1);

    const fieldRe = /^- (\w+): (.+)$/gm;
    const fields: Record<string, string> = {};
    let match: RegExpExecArray | null;
    while ((match = fieldRe.exec(body)) !== null) {
      fields[match[1]] = match[2].trim();
    }

    const description = body.replace(fieldRe, '').replace(/^\n+/, '').replace(/\n+$/, '');

    if (!fields.area) {
      continue;
    }

    entries.push({
      area: fields.area,
      description,
      name,
      slug: trackSlug(name, `block ${blockIndex}`),
      parent: fields.parent,
      since: fields.since,
      type: fields.type,
      priority: entries.length + 1,
      level: 3,
      size: fields.size,
      impact: fields.impact,
      confidence: fields.confidence,
      deps: fields.deps
        ? fields.deps
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined,
    });
  }

  return entries;
}
