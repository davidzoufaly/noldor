import type { Slug } from '../core/slug.js';
import type { ArtifactKind } from './findings-schema.js';

/**
 * Reading a CR lane child's answer file (Q-0250).
 *
 * Lanes used to dig their verdict out of stdout: a fenced JSON block that the first quoted
 * triple backtick closed early, or markdown buckets whose `- (none)` bullet became a blocker.
 * The answer now travels in a file that holds nothing else, so reading it is parse, drop
 * placeholders, validate — no heuristic has to find the answer inside the chatter.
 */

/** Where a dispatch's answer file lives: the lane's repo, slug and artifact kind. */
export interface AnswerLocation {
  repoRoot: string;
  slug: Slug;
  kind: ArtifactKind;
}

/**
 * A list field whose placeholder entries are dropped before validation. `text` names the
 * string property of an object entry; omit it for a list of strings.
 */
export interface PlaceholderField {
  list: string;
  text?: string;
}

/** Why the first answer was rejected, handed to the one repair round. */
export interface RepairContext {
  /** The first child's stdout, kept as evidence — '' when unavailable. */
  stdout: string;
  /** What the first child wrote to the answer file, or null when it wrote nothing. */
  rejected: string | null;
  /** Why that answer was rejected. */
  error: string;
}

/** The part of a zod schema the reader needs, so this module never imports zod. */
export interface SafeParser<T> {
  safeParse: (
    v: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
}

/** What a lane's child must hand back, and how to read it. */
export interface LaneAnswerContract<T> {
  /** Lane segment of the answer file name, e.g. `verifier`. */
  lane: string;
  /** Schema sketch rendered into the answer instruction. */
  shape: string;
  schema: SafeParser<T>;
  placeholderFields?: readonly PlaceholderField[];
  /** Body of the repair round's transcription prompt; the seam appends the answer instruction. */
  repairPrompt: (ctx: RepairContext) => string;
}

/** One read of one answer file. */
export type ReadResult<T> = { ok: true; answer: T } | { ok: false; error: string };

/** A lane's answer after at most one repair round. */
export type LaneAnswer<T> =
  | { ok: true; answer: T; notes: string[] }
  | { ok: false; detail: string; notes: string[] };

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  '',
  'none',
  'n/a',
  'na',
  'no issues',
  'no findings',
  'nothing',
]);

/** Whitespace and `- * _ . , : ; ! ( ) [ ] { } < >`, at either end of the text only. */
const EDGE_NOISE = /^[\s\-*_.,:;!()[\]{}<>]+|[\s\-*_.,:;!()[\]{}<>]+$/g;

/**
 * True when `text` says "nothing here" instead of stating something. Normalization touches
 * the ends only, so `none of the tests assert the exit code` is a finding, not a placeholder.
 */
export function isPlaceholderText(text: string): boolean {
  const normalized = text.replace(EDGE_NOISE, '').replace(/\s+/g, ' ').toLowerCase();
  return PLACEHOLDERS.has(normalized);
}

/**
 * `raw` with every placeholder entry removed from the named list fields. Anything that is
 * not a plain object, and any field that is missing or not an array, passes through
 * untouched — the schema, not this pass, reports those.
 */
export function dropPlaceholders(raw: unknown, fields: readonly PlaceholderField[]): unknown {
  if (fields.length === 0 || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const field of fields) {
    const list = out[field.list];
    if (!Array.isArray(list)) continue;
    out[field.list] = list.filter((entry: unknown) => {
      const text =
        field.text === undefined
          ? entry
          : typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>)[field.text]
            : undefined;
      return !(typeof text === 'string' && isPlaceholderText(text));
    });
  }
  return out;
}

/**
 * The text with ONE fence around the whole file removed. A child told "no fence" sometimes
 * fences anyway; only the first and last lines are touched, and a JSON object never ends in
 * a backtick, so a fence quoted inside a JSON string is never affected.
 */
export function unwrapWholeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  return lines.length < 3 ? trimmed : lines.slice(1, -1).join('\n');
}

/**
 * One answer file's text → the lane's validated answer; `null` means no file was written.
 * Placeholders are dropped BEFORE validation, so a `pass` padded with `["(none)"]` validates
 * as the clean pass it is, while a `fail` left with no real mismatch fails its refinement.
 */
export function readLaneAnswer<T>(
  text: string | null,
  contract: Pick<LaneAnswerContract<T>, 'lane' | 'schema' | 'placeholderFields'>,
): ReadResult<T> {
  if (text === null) return { ok: false, error: 'no answer file was written' };
  let raw: unknown;
  try {
    raw = JSON.parse(unwrapWholeFence(text));
  } catch (err) {
    return { ok: false, error: `answer is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = contract.schema.safeParse(dropPlaceholders(raw, contract.placeholderFields ?? []));
  return parsed.success
    ? { ok: true, answer: parsed.data }
    : {
        ok: false,
        error: `answer does not match the ${contract.lane} schema: ${parsed.error.message.slice(0, 500)}`,
      };
}

/** How much raw child text one sink note keeps verbatim. */
const RAW_KEEP_CHARS = 20_000;

/** `raw` bounded for a sink note, marked when it was cut. */
export function keepRaw(raw: string): string {
  return raw.length <= RAW_KEEP_CHARS
    ? raw
    : `${raw.slice(0, RAW_KEEP_CHARS)}… [truncated, ${raw.length} chars total]`;
}
