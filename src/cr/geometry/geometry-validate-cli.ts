// @tests: ui-design-review-lane
// noldor design geometry-validate — check one normalized geometry document
// against `geometryDocSchema` and the side-specific rules. A consumer writing a
// `geometryCommand` capture script needs to know their output conforms BEFORE a
// lane exists to consume it; inside a round the same parse produces the
// `geometry-unparseable` sink, so the two can never disagree.

import { readFile } from 'node:fs/promises';

import { optionalFlag, runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import { parseGeometryDoc, type GeometrySide } from './geometry-doc.js';

const LABEL = 'geometry-validate';
const USAGE = `usage: noldor design ${LABEL} <doc.json> --side design|impl --surface <name>`;

/** Narrowing predicate, not a cast: `side` arrives as untrusted argv text. */
const isSide = (s: string): s is GeometrySide => s === 'design' || s === 'impl';
/** Every flag this command takes a value for — an unknown flag is user error. */
const VALUE_FLAGS = ['--side', '--surface'] as const;

/**
 * Exit 0 = conformant, 1 = the document violates the contract, 2 = usage error
 * or the file could not be read. A violation is exit 1 rather than 2 because it
 * is the tool's real answer, not a failure to answer.
 */
export async function runGeometryValidate(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const values = new Map<string, string>();
  for (const flag of VALUE_FLAGS) {
    const read = optionalFlag(argv, flag, LABEL);
    if (!read.ok) {
      emit(read.error);
      return 2;
    }
    // `optionalFlag` deliberately does not check the value's shape, so a
    // forgotten value (`--surface --side impl`) would otherwise swallow the
    // NEXT FLAG's name as the surface. Reject flag-shaped values here.
    if (read.value !== undefined && read.value.startsWith('--')) {
      emit(`${LABEL}: ${flag} requires a value\n${USAGE}`);
      return 2;
    }
    if (read.value !== undefined) values.set(flag, read.value);
  }
  // Positionals are found by INDEX, not by value: a path whose text equals a
  // flag's value must not be swallowed as that value's twin.
  const consumedIdx = new Set<number>();
  for (const flag of VALUE_FLAGS) {
    const i = argv.indexOf(flag);
    if (i >= 0) consumedIdx.add(i).add(i + 1);
  }
  const positional = argv.filter((a, i) => !consumedIdx.has(i));
  const unknownFlag = positional.find((a) => a.startsWith('--'));
  if (unknownFlag !== undefined) {
    emit(`${LABEL}: unknown flag ${unknownFlag}\n${USAGE}`);
    return 2;
  }
  const side = values.get('--side');
  const surface = values.get('--surface');
  // `--surface` is REQUIRED: defaulting it to whatever the document claims would
  // make the surface-equality check self-satisfying, and that check is the whole
  // point of passing a side and a surface separately.
  if (positional.length !== 1 || side === undefined || surface === undefined || !isSide(side)) {
    emit(USAGE);
    return 2;
  }
  let raw: unknown;
  try {
    // Exit 2 covers "there is no document to judge" — the file is unreadable OR
    // its bytes are not JSON. Exit 1 is reserved for a document that parsed and
    // then violated the contract, which is the only case where the tool has an
    // answer ABOUT a document.
    raw = JSON.parse(await readFile(positional[0], 'utf8'));
  } catch (err) {
    emit(`${LABEL}: could not read ${positional[0]} as JSON: ${errMessage(err)}`);
    return 2;
  }
  // `side` is narrowed by `isSide`, never asserted: this is an external-input
  // boundary, and a cast would be a claim rather than a check.
  const parsed = parseGeometryDoc(raw, side, surface);
  if (!parsed.ok) {
    emit(`${LABEL}: ${parsed.detail}`);
    return 1;
  }
  emit(
    `${LABEL}: ${positional[0]} is a valid ${side} document for surface '${surface}' — ${parsed.doc.nodes.length} node(s), viewport ${parsed.doc.viewport.width}x${parsed.doc.viewport.height}`,
  );
  return 0;
}

runIfDirect('geometry-validate-cli', `design ${LABEL}`, (argv) => runGeometryValidate(argv));
