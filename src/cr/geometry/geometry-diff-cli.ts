// @tests: ui-design-review-lane
// noldor design geometry-diff — compare two normalized geometry documents by
// hand. The lane produces them from pencil MCP and a booted app; this exists so
// a consumer can check a capture script's output, and an operator can re-read a
// failing round's evidence, without booting anything.

import { readFile } from 'node:fs/promises';

import { readValueFlags, runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  GEOMETRY_FAMILIES,
} from './geometry-compare-core.js';
import { parseGeometryDoc } from './geometry-doc.js';

const LABEL = 'geometry-diff';
const USAGE = `usage: noldor design ${LABEL} <design.json> <impl.json> --surface <name>`;

/** Viewports may differ by less than a pixel (rounding), never more (spec D4). */
const VIEWPORT_EPSILON = 1;

const list = (xs: readonly number[]): string => xs.map((v) => v.toFixed(2)).join(', ');

/**
 * Exit 0 = within budget, 1 = drift, 2 = usage error or a document that could
 * not be read or parsed. `emit` is injected so tests read lines, not a stream.
 */
export async function runGeometryDiff(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const read = readValueFlags(argv, ['--surface'], LABEL);
  if (!read.ok) {
    emit(`${read.error}\n${USAGE}`);
    return 2;
  }
  const { positional } = read;
  const surface = read.values.get('--surface');
  // Required: defaulting it to a document's own claim self-satisfies the check.
  if (positional.length !== 2 || surface === undefined) {
    emit(USAGE);
    return 2;
  }
  let rawDesign: unknown;
  let rawImpl: unknown;
  try {
    rawDesign = JSON.parse(await readFile(positional[0], 'utf8'));
    rawImpl = JSON.parse(await readFile(positional[1], 'utf8'));
  } catch (err) {
    emit(`${LABEL}: could not read both documents: ${errMessage(err)}`);
    return 2;
  }
  const design = parseGeometryDoc(rawDesign, 'design', surface);
  const impl = parseGeometryDoc(rawImpl, 'impl', surface);
  if (!design.ok || !impl.ok) {
    if (!design.ok) emit(`${LABEL}: ${design.detail}`);
    if (!impl.ok) emit(`${LABEL}: ${impl.detail}`);
    return 2;
  }
  // Comparability preconditions, before any verdict: the lane reports these as
  // `geometry-empty` and `viewport-mismatch` cannot-review rows, and this
  // command must not turn either into a green. Two empty documents agree about
  // nothing, and a design measured at one viewport against a capture at another
  // makes every edge drift by a constant.
  if (design.doc.nodes.length === 0 || impl.doc.nodes.length === 0) {
    emit(
      `${LABEL}: geometry-empty — ${design.doc.nodes.length === 0 ? 'design' : 'impl'} document reports zero nodes, so there is nothing to compare`,
    );
    return 2;
  }
  const dv = design.doc.viewport;
  const iv = impl.doc.viewport;
  if (
    Math.abs(dv.width - iv.width) > VIEWPORT_EPSILON ||
    Math.abs(dv.height - iv.height) > VIEWPORT_EPSILON
  ) {
    emit(
      `${LABEL}: viewport-mismatch — design is ${dv.width}x${dv.height}, impl is ${iv.width}x${iv.height}`,
    );
    return 2;
  }
  const cmp = compareGeometry(design.doc, impl.doc, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
  emit(`surface '${surface}' — ${cmp.verdict}`);
  for (const family of GEOMETRY_FAMILIES) {
    const o = cmp.families[family];
    emit(
      `  ${family}: ${o.unmatched} unmatched (budget ${o.budget})` +
        (o.designOnly.length > 0 ? ` design-only [${list(o.designOnly)}]` : '') +
        (o.implOnly.length > 0 ? ` impl-only [${list(o.implOnly)}]` : ''),
    );
  }
  return cmp.verdict === 'fail' ? 1 : 0;
}

runIfDirect('geometry-diff-cli', `design ${LABEL}`, (argv) => runGeometryDiff(argv));
