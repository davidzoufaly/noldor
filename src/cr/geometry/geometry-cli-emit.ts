// @tests: ui-design-review-lane
// What every `design geometry-*` entrypoint shares: where its lines go, and
// which slug its dispatches file their answers under outside a CR round. Each
// command takes an `emit` so tests read output as strings instead of capturing
// a stream, and each defaults it to stdout — declared once here so the default
// cannot drift per command (and so the repeated signature stops reading as a
// duplicated block to the clone detector).

import { parseSlug, type Slug } from '../../core/slug.js';

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
