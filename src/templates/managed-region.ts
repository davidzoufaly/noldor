// @fd: scaffold-one-agent-rules-file-not-two

/** Opening line of the framework-owned region of a region-managed template. */
export const REGION_START = '<!-- noldor:rules:start -->';
/** Closing line of the framework-owned region of a region-managed template. */
export const REGION_END = '<!-- noldor:rules:end -->';

/** A well-formed region: its text (both marker lines included) and where it sits. */
export interface RegionSpan {
  readonly region: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Where a document's framework region is. Markers count only as whole lines, so
 * prose that mentions one is not a marker. Any layout other than one start line
 * followed by one end line is `malformed`: guessing which pair the consumer meant
 * could overwrite their text.
 */
export type RegionRead =
  | { readonly kind: 'absent' }
  | ({ readonly kind: 'present' } & RegionSpan)
  | { readonly kind: 'malformed'; readonly reason: string };

function markerLines(lines: readonly string[], marker: string): number[] {
  return lines.flatMap((line, i) => (line.trim() === marker ? [i] : []));
}

/** Locate the framework region in `doc`. */
export function readRegion(doc: string): RegionRead {
  const lines = doc.split('\n');
  const starts = markerLines(lines, REGION_START);
  const ends = markerLines(lines, REGION_END);
  if (starts.length === 0 && ends.length === 0) return { kind: 'absent' };
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      kind: 'malformed',
      reason: `expected one start and one end marker, found ${starts.length} start and ${ends.length} end`,
    };
  }
  const [startLine] = starts;
  const [endLine] = ends;
  if (endLine < startLine) {
    return { kind: 'malformed', reason: 'the end marker comes before the start marker' };
  }
  return {
    kind: 'present',
    region: lines.slice(startLine, endLine + 1).join('\n'),
    startLine,
    endLine,
  };
}

/** `doc` with the region at `span` swapped for `region`; every other line is kept. */
export function replaceRegion(doc: string, span: RegionSpan, region: string): string {
  const lines = doc.split('\n');
  return [...lines.slice(0, span.startLine), region, ...lines.slice(span.endLine + 1)].join('\n');
}

/** `doc` followed by a blank line and `region`, so the consumer's opening stays first. */
export function appendRegion(doc: string, region: string): string {
  if (doc.length === 0) return `${region}\n`;
  return `${doc.endsWith('\n') ? doc : `${doc}\n`}\n${region}\n`;
}

/**
 * The region of a template noldor ships. A region-managed template without
 * exactly one well-formed region is a packaging bug, not a consumer state.
 */
export function requireRegion(templateDoc: string, rel: string): RegionSpan {
  const read = readRegion(templateDoc);
  if (read.kind !== 'present') {
    throw new Error(`template ${rel} carries no well-formed noldor:rules region`);
  }
  return read;
}

/**
 * What bringing a consumer's region-managed file up to its template takes.
 * `append` never overwrites anything, so it needs no `--update`; `replace`
 * overwrites framework-owned text the consumer may have edited, so it does.
 */
export type RegionSync =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'append'; readonly content: string }
  | { readonly kind: 'replace'; readonly content: string }
  | { readonly kind: 'malformed'; readonly reason: string };

/** Compare a consumer file against its template by region alone. */
export function planRegionSync(consumerDoc: string, templateDoc: string, rel: string): RegionSync {
  const template = requireRegion(templateDoc, rel);
  const read = readRegion(consumerDoc);
  if (read.kind === 'malformed') return read;
  if (read.kind === 'absent') {
    return { kind: 'append', content: appendRegion(consumerDoc, template.region) };
  }
  if (read.region === template.region) return { kind: 'unchanged' };
  return { kind: 'replace', content: replaceRegion(consumerDoc, read, template.region) };
}
