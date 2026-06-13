/**
 * Pure block-rewriter operating on raw markdown strings. Zero IO.
 *
 * **Error contract:** thrown errors include the slug and index but NOT the
 * source file path — this module doesn't know paths. Callers (HTTP layer,
 * scripts) should wrap thrown errors with the file path when surfacing them
 * to operators or HTTP responses.
 *
 * Block identity is by slug derived from heading via the shared `slugify`
 * rule. Heading detection skips fenced code blocks. Trailing blank-line
 * discipline is normalized on every splice.
 */
import { slugify } from './slugify.js';

interface BlockSpan {
  /** Slug for identity. */
  slug: string;
  /** First line of block (heading), 0-based. */
  start: number;
  /** Last line of block (exclusive — one past the trailing blank line). */
  end: number;
  /** 3 or 4. */
  depth: 3 | 4;
}

interface ScanResult {
  /** All block spans in source order. */
  spans: BlockSpan[];
  /** Raw split into lines (no trailing newline retained). */
  lines: string[];
}

function scanBlocks(raw: string): ScanResult {
  const lines = raw.split('\n');
  const spans: BlockSpan[] = [];
  let inCodeFence = false;
  let pendingStart = -1;
  let pendingDepth: 3 | 4 = 3;
  let pendingSlug = '';
  let pendingHasArea = false;

  const flush = (endExclusive: number): void => {
    if (pendingStart === -1) return;
    if (pendingHasArea) {
      spans.push({
        slug: pendingSlug,
        start: pendingStart,
        end: endExclusive,
        depth: pendingDepth,
      });
    }
    pendingStart = -1;
    pendingHasArea = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      flush(i);
      pendingStart = i;
      pendingDepth = 3;
      pendingSlug = slugify(h3[1]);
      pendingHasArea = false;
      continue;
    }
    const h4 = /^####\s+(.+?)\s*$/.exec(line);
    if (h4) {
      flush(i);
      pendingStart = i;
      pendingDepth = 4;
      pendingSlug = slugify(h4[1]);
      pendingHasArea = false;
      continue;
    }
    if (pendingStart !== -1 && /^-\s+area:/.test(line)) {
      pendingHasArea = true;
    }
  }
  flush(lines.length);

  // Slug collision handling for the writer: assign suffix `-2`, `-3` ... so
  // a duplicate heading is still uniquely addressable. Mirror parse-blocks
  // tracker but local-only (no warning — caller already saw it during parse).
  const counts = new Map<string, number>();
  for (const span of spans) {
    const base = span.slug;
    const prev = counts.get(base) ?? 0;
    counts.set(base, prev + 1);
    if (prev > 0) span.slug = `${base}-${prev + 1}`;
  }

  return { spans, lines };
}

/**
 * Count the addressable entry blocks in `rawIn` — i.e. the spans `scanBlocks`
 * recognizes (heading + `- area:` bullet). Category-container headings with no
 * `- area:` are not counted. Used by the dashboard "add entry" flow to resolve
 * the `bottom` position to an append index (`insertBlock` treats
 * `targetIndex === count` as end-of-file).
 */
export function countEntries(rawIn: string): number {
  const raw = rawIn.endsWith('\n') ? rawIn : rawIn + '\n';
  return scanBlocks(raw).spans.length;
}

function findBlockBySlug(spans: BlockSpan[], slug: string): { span: BlockSpan; index: number } {
  const index = spans.findIndex((s) => s.slug === slug);
  if (index === -1) {
    throw new Error(`write-blocks: slug "${slug}" not found in source file`);
  }
  return { span: spans[index], index };
}

function extractLines(lines: string[], start: number, end: number): string[] {
  return lines.slice(start, end);
}

function trimTrailingBlankLines(linesIn: string[]): string[] {
  const out = [...linesIn];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

export function moveBlock(rawIn: string, slug: string, targetIndex: number): string {
  const raw = rawIn.endsWith('\n') ? rawIn : rawIn + '\n';
  const { spans, lines } = scanBlocks(raw);
  const { span, index } = findBlockBySlug(spans, slug);

  if (targetIndex < 0 || targetIndex >= spans.length) {
    throw new Error(
      `write-blocks: targetIndex ${targetIndex} out of range (have ${spans.length} entries)`,
    );
  }
  if (targetIndex === index) return raw;

  // Extract the moving block's lines (trim trailing blanks; we re-emit a single \n separator).
  const movingLines = trimTrailingBlankLines(extractLines(lines, span.start, span.end));

  // Remove the block from `lines`. Then compute where to insert based on
  // the remaining spans' new positions.
  const linesAfterRemove = [...lines.slice(0, span.start), ...lines.slice(span.end)];
  const spansAfterRemove = spans.filter((_, i) => i !== index);

  // targetIndex is the desired entry-position in the resulting file.
  // Compute the line in `linesAfterRemove` at which to insert.
  let insertAtLine: number;
  if (spansAfterRemove.length === 0) {
    insertAtLine = linesAfterRemove.length;
  } else if (targetIndex === spansAfterRemove.length) {
    // Append at end of file.
    insertAtLine = linesAfterRemove.length;
  } else {
    // Insert before the span that now occupies `targetIndex`.
    // span.start in `spansAfterRemove` is relative to the ORIGINAL lines;
    // re-scan against the trimmed array to get the correct line.
    const targetSpan = spansAfterRemove[targetIndex];
    const offset = targetSpan.start > span.start ? span.end - span.start : 0;
    insertAtLine = targetSpan.start - offset;
  }

  const out = [
    ...linesAfterRemove.slice(0, insertAtLine),
    ...movingLines,
    '', // single trailing blank line
    ...linesAfterRemove.slice(insertAtLine),
  ];

  // Collapse runs of >1 trailing blank between blocks introduced by the splice.
  return collapseConsecutiveBlanks(out).join('\n');
}

function collapseConsecutiveBlanks(linesIn: string[]): string[] {
  const out: string[] = [];
  let lastWasBlank = false;
  for (const line of linesIn) {
    const blank = line === '';
    if (blank && lastWasBlank) continue;
    out.push(line);
    lastWasBlank = blank;
  }
  return out;
}

export function removeBlock(rawIn: string, slug: string): { newRaw: string; removedBlock: string } {
  const raw = rawIn.endsWith('\n') ? rawIn : rawIn + '\n';
  const { spans, lines } = scanBlocks(raw);
  const { span } = findBlockBySlug(spans, slug);

  const removedLines = trimTrailingBlankLines(extractLines(lines, span.start, span.end));
  const removedBlock = `${removedLines.join('\n')}\n`;

  const newLines = collapseConsecutiveBlanks([
    ...lines.slice(0, span.start),
    ...lines.slice(span.end),
  ]);
  return { newRaw: newLines.join('\n'), removedBlock };
}

export function insertBlock(
  rawIn: string,
  block: string,
  targetIndex: number,
  destDepth: 3 | 4,
): string {
  const raw = rawIn.endsWith('\n') ? rawIn : rawIn + '\n';
  const { spans, lines } = scanBlocks(raw);
  if (targetIndex < 0 || targetIndex > spans.length) {
    throw new Error(
      `write-blocks: targetIndex ${targetIndex} out of range (have ${spans.length} entries)`,
    );
  }

  // Normalize the incoming block's heading depth.
  const blockLines = block.replace(/\n+$/, '').split('\n');
  const headingRe = /^(#+)\s+(.+?)\s*$/;
  const headingMatch = headingRe.exec(blockLines[0]);
  if (!headingMatch) {
    throw new Error(`write-blocks: incoming block does not start with a heading: ${blockLines[0]}`);
  }
  const newHeading = `${'#'.repeat(destDepth)} ${headingMatch[2]}`;
  const normalizedBlock = [newHeading, ...blockLines.slice(1)];

  // Choose insertion line in current file.
  let insertAtLine: number;
  if (spans.length === 0) {
    insertAtLine = lines.length;
  } else if (targetIndex === spans.length) {
    insertAtLine = lines.length;
  } else {
    insertAtLine = spans[targetIndex].start;
  }

  const out = collapseConsecutiveBlanks([
    ...lines.slice(0, insertAtLine),
    ...normalizedBlock,
    '',
    ...lines.slice(insertAtLine),
  ]);
  return out.join('\n');
}
