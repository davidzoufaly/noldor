// @tests: ui-design-review-lane
// What every `design geometry-*` entrypoint shares: where its lines go, how its
// argv is read, which slug its dispatches file their answers under outside a CR
// round, and how a comparison prints. Each
// command takes an `emit` so tests read output as strings instead of capturing
// a stream, and each defaults it to stdout — declared once here so the default
// cannot drift per command (and so the repeated signature stops reading as a
// duplicated block to the clone detector).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readValueFlags } from '../../core/cli-entry.js';
import { parseSlug, type Slug } from '../../core/slug.js';
import { GEOMETRY_FAMILIES, type GeometryComparison } from './geometry-compare-core.js';

/** Sink for one output line. */
export type Emit = (line: string) => void;

/** The production default: one line to stdout. */
export const stdoutEmit: Emit = (line) => process.stdout.write(`${line}\n`);

const adhoc = parseSlug('geometry-adhoc');
if (!adhoc.ok) throw new Error(adhoc.error.message);

/**
 * The slug a hand-run `design geometry-*` command files its pencil child's
 * answer under (`.noldor/cr/answers/geometry-adhoc-code-geometry-extract-*.json`)
 * when no `--slug` is given. Minted through `parseSlug` rather than cast, so the
 * brand is earned the same way a CR round's slug is.
 */
export const GEOMETRY_ADHOC_SLUG: Slug = adhoc.slug;

/** What a geometry CLI declares about its argv. */
export interface GeometryFlagSpec<R extends string, O extends string> {
  label: string;
  usage: string;
  /** Flags that must carry a value. */
  required: readonly R[];
  /** Flags that may carry one. */
  optional: readonly O[];
  /** Exact number of positional arguments. */
  positional: number;
  /**
   * The command reads a surface out of a `.pen` through the pencil child, so it
   * also takes `--pen` and `--surface` (required), `--page` and `--slug`.
   */
  design?: boolean;
}

/** The design-reader flags, resolved: the file exists and the slug is a real slug. */
export interface DesignFlags {
  penPath: string;
  surface: string;
  pageSelector?: string;
  /** `--slug`, or {@link GEOMETRY_ADHOC_SLUG}: no CR round owns a hand run. */
  slug: Slug;
}

export interface GeometryFlags<R extends string, O extends string> {
  required: Readonly<Record<R, string>>;
  optional: Readonly<Partial<Record<O, string>>>;
  positional: readonly string[];
  /** Present exactly when the spec sets `design`. */
  design?: DesignFlags;
}

const DESIGN_FLAGS = ['--pen', '--surface', '--page', '--slug'];

/**
 * Read a geometry CLI's argv. Every usage error (an unknown flag, the wrong
 * number of positionals, a missing required flag, a malformed slug, a design
 * file that does not exist) is emitted here, so a caller seeing `null` only
 * returns exit 2.
 */
export function readGeometryFlags<R extends string, O extends string>(
  argv: readonly string[],
  spec: GeometryFlagSpec<R, O>,
  emit: Emit,
): GeometryFlags<R, O> | null {
  const names = [...spec.required, ...spec.optional, ...(spec.design === true ? DESIGN_FLAGS : [])];
  const read = readValueFlags(argv, names, spec.label);
  if (!read.ok) {
    emit(`${read.error}\n${spec.usage}`);
    return null;
  }
  const { values, positional } = read;
  if (positional.length !== spec.positional || spec.required.some((f) => !values.has(f))) {
    emit(spec.usage);
    return null;
  }
  const pick = (flags: readonly string[]) =>
    Object.fromEntries(flags.flatMap((f) => (values.has(f) ? [[f, values.get(f)]] : [])));
  const out: GeometryFlags<R, O> = {
    // Every required flag was checked present above, so the record is complete.
    required: pick(spec.required) as Record<R, string>,
    optional: pick(spec.optional) as Partial<Record<O, string>>,
    positional,
  };
  if (spec.design !== true) return out;
  const design = readDesignFlags(values, spec, emit);
  return design === null ? null : { ...out, design };
}

/** A geometry CLI's entry point: argv in, exit code out, lines to `emit` (stdout by default). */
export type GeometryCommand = (argv: readonly string[], emit?: Emit) => Promise<number>;

/**
 * Wrap a geometry CLI's body in the opening every command shares: read argv
 * per `spec`, and return exit 2 on a usage error (already emitted) without
 * running `body`.
 */
export function geometryCommand<R extends string, O extends string>(
  spec: GeometryFlagSpec<R, O>,
  body: (flags: GeometryFlags<R, O>, emit: Emit) => Promise<number>,
): GeometryCommand {
  return async (argv, emit = stdoutEmit) => {
    const flags = readGeometryFlags(argv, spec, emit);
    return flags === null ? 2 : body(flags, emit);
  };
}

/**
 * {@link geometryCommand} for a command that reads a surface out of a `.pen`:
 * it also takes the design flags, and `body` receives them resolved.
 */
export function designCommand<R extends string, O extends string>(
  spec: Omit<GeometryFlagSpec<R, O>, 'design'>,
  body: (flags: GeometryFlags<R, O>, design: DesignFlags, emit: Emit) => Promise<number>,
): GeometryCommand {
  return geometryCommand({ ...spec, design: true }, async (flags, emit) =>
    flags.design === undefined ? 2 : body(flags, flags.design, emit),
  );
}

function readDesignFlags(
  values: ReadonlyMap<string, string>,
  spec: { label: string; usage: string },
  emit: Emit,
): DesignFlags | null {
  const pen = values.get('--pen');
  const surface = values.get('--surface');
  if (pen === undefined || surface === undefined) {
    emit(spec.usage);
    return null;
  }
  let slug = GEOMETRY_ADHOC_SLUG;
  const slugFlag = values.get('--slug');
  if (slugFlag !== undefined) {
    const parsed = parseSlug(slugFlag);
    if (!parsed.ok) {
      emit(`${spec.label}: ${parsed.error.message}\n${spec.usage}`);
      return null;
    }
    slug = parsed.slug;
  }
  // Absolute: the pencil child runs in its own process and opens exactly this path.
  const penPath = resolve(pen);
  if (!existsSync(penPath)) {
    emit(`${spec.label}: no such design file: ${penPath}`);
    return null;
  }
  const pageSelector = values.get('--page');
  return {
    penPath,
    surface,
    ...(pageSelector !== undefined ? { pageSelector } : {}),
    slug,
  };
}

const list = (xs: readonly number[]): string => xs.map((v) => v.toFixed(2)).join(', ');

/** One line per family: unmatched count, budget, and the values with no counterpart. */
export function emitFamilyLines(cmp: GeometryComparison, emit: Emit): void {
  for (const family of GEOMETRY_FAMILIES) {
    const o = cmp.families[family];
    emit(
      `  ${family}: ${o.unmatched} unmatched (budget ${o.budget})` +
        (o.designOnly.length > 0 ? ` design-only [${list(o.designOnly)}]` : '') +
        (o.implOnly.length > 0 ? ` impl-only [${list(o.implOnly)}]` : ''),
    );
  }
}
