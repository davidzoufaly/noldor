// @fd: architecture-decision-record-surface
import matter from 'gray-matter';
import { z } from 'zod';

/**
 * Filename contract for a decision record: `NNNN-<slug>.md` — four digits,
 * zero-padded, then a kebab-case slug. Numbers are unique across the folder;
 * gaps are legal, because a record is never renumbered once published (the
 * append-only discipline `validate-pushed-adrs` enforces at the push seam).
 */
export const ADR_FILENAME_RE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is also a real calendar day (rejects `2026-02-31`). */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

/** The text between the leading `---` fences, or nothing when absent. */
function rawFrontmatterBlock(raw: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  return m ? m[1] : '';
}

const adrNumber = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v).padStart(4, '0') : v))
  .pipe(z.string().regex(/^\d{4}$/, 'Expected a four-digit record number'));

/**
 * Frontmatter contract for one record. `superseded-by` is required exactly
 * when `status: superseded` — both directions of that iff are enforced by
 * `checkAdr` (`missing-superseded-by` / `stray-superseded-by`), not here,
 * because the cross-record chain rules need the whole folder anyway.
 *
 * YAML reads bare `0001` as a number and bare dates as `Date`; both are
 * normalized back to the canonical string forms before validation so authors
 * are not forced to quote.
 */
export const adrFrontmatterSchema = z.object({
  status: z.enum(['accepted', 'superseded']),
  date: z
    .union([z.string(), z.date()])
    .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))
    .refine(isRealDate, 'Expected a real YYYY-MM-DD date'),
  supersedes: adrNumber.optional(),
  'superseded-by': adrNumber.optional(),
});
export type AdrFrontmatter = z.infer<typeof adrFrontmatterSchema>;

export type AdrParseResult =
  | { success: true; data: AdrFrontmatter; body: string }
  | { success: false; errors: string[] };

/**
 * Parse one record's raw text into validated frontmatter plus body.
 *
 * gray-matter throws on malformed YAML — an expected failure for a hand-edited
 * file, so it is caught at this boundary and returned as the result type.
 */
export function parseAdrFrontmatter(raw: string): AdrParseResult {
  let parsed: { data: unknown; content: string };
  try {
    parsed = matter(raw);
  } catch (err) {
    return { success: false, errors: [`frontmatter does not parse: ${(err as Error).message}`] };
  }
  // YAML parses a bare date into a `Date` and silently rolls an invalid
  // calendar day over (`2026-02-31` → March 3rd), so the schema's refine never
  // sees the authored text. Validate the textual form first.
  const dateLine = /^date:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(rawFrontmatterBlock(raw));
  if (dateLine && !isRealDate(dateLine[1])) {
    return {
      success: false,
      errors: [`date: expected a real YYYY-MM-DD date, got ${dateLine[1]}`],
    };
  }
  const result = adrFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { success: true, data: result.data, body: parsed.content };
}

/**
 * Next record number: max existing + 1, zero-padded to four digits.
 *
 * Shared by `adr new` so minting has exactly one implementation. Non-matching
 * filenames contribute nothing — `checkAdr` reports them separately.
 *
 * @param existingFilenames - Basenames currently in the folder
 */
export function nextAdrNumber(existingFilenames: readonly string[]): string {
  let max = 0;
  for (const name of existingFilenames) {
    const m = ADR_FILENAME_RE.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return String(max + 1).padStart(4, '0');
}

/** Title-case a kebab slug for the template heading. */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The record body `adr new` writes. A generator template embedded in code —
 * deliberately NOT a `templates/` file: `init` never copies it and
 * `template-sync` must never see it.
 */
export function renderAdrTemplate(opts: {
  slug: string;
  date: string;
  supersedes?: string;
}): string {
  const supersedesLine = opts.supersedes === undefined ? '' : `supersedes: '${opts.supersedes}'\n`;
  return `---
status: accepted
date: ${opts.date}
${supersedesLine}---

# ${titleFromSlug(opts.slug)}

## Context

What situation and constraints made this decision necessary?

## Decision

What was decided, stated as a binding rule.

## Consequences

What this makes easier, what it makes harder, and what it rules out.
`;
}
