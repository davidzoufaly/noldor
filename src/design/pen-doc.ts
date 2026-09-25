// @tests: pendev-ui-design-phase
// Reads a committed `.pen` — plain UTF-8 JSON — and judges it by its content:
// is it a document the editor can render, and does it hold the pages its
// surface declares. The freshness check and `design capture` both call
// `inspectBaseline`, so a baseline the check reds is one capture refuses to vouch for.

import { errMessage } from '../core/err-message.js';

/** A parsed `.pen`. Only the top-level `children` array is guaranteed; everything else is as found. */
export interface PenDocument {
  readonly children: readonly unknown[];
  readonly [key: string]: unknown;
}

/** A top-level node of a `.pen` — a page on the canvas. */
export interface PenPage {
  readonly id: string | undefined;
  readonly name: string | undefined;
}

/** What the installed pen schema says about a document's top level. */
export interface PenSchemaFacts {
  readonly path: string;
  /** `properties.version.const`, or `null` when the schema pins none. */
  readonly version: string | null;
  readonly required: readonly string[];
  readonly topLevelKeys: readonly string[];
}

/** The states, and optionally modes, a surface's baseline must hold as pages. */
export interface CoverageDeclaration {
  readonly states: readonly string[];
  readonly modes?: readonly string[];
}

export type PenFindingCode =
  | 'unparseable'
  | 'missing-required'
  | 'unresolved-variable'
  | 'version-drift'
  | 'unknown-top-level-key'
  | 'schema-required'
  | 'missing-page'
  | 'duplicate-page'
  | 'undeclared-page';

/**
 * One problem with a `.pen`. `red` findings depend only on the file, so they
 * mean the same thing on every machine; `advisory` findings come from the
 * installed schema, which differs between machines and is absent in CI.
 */
export interface PenFinding {
  readonly code: PenFindingCode;
  readonly severity: 'red' | 'advisory';
  readonly message: string;
}

/** The pair every pen schema so far has required; fixed here so a red finding never depends on the machine. */
const CORE_REQUIRED = ['version', 'children'];

/** Keys whose string values are never variable bindings, even when they start with `$`. */
const NON_BINDING_KEYS = new Set(['id', 'name', 'type', 'url', 'ref']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse `.pen` bytes, or say why they are not a `.pen`: not JSON, or no top-level `children` array. */
export function parsePenDocument(
  bytes: Buffer | string,
):
  | { ok: true; doc: PenDocument }
  | { ok: false; reason: 'not-json' | 'no-children'; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'not-json', error: `not JSON (${errMessage(err)})` };
  }
  if (!isRecord(value) || !Array.isArray(value.children)) {
    return { ok: false, reason: 'no-children', error: 'no top-level children array' };
  }
  return { ok: true, doc: value as PenDocument };
}

/** The top-level nodes in file order. An absent or non-string `id` / `name` reads as `undefined`. */
export function topLevelPages(doc: PenDocument): PenPage[] {
  return doc.children.map((node) => ({
    id: isRecord(node) && typeof node.id === 'string' ? node.id : undefined,
    name: isRecord(node) && typeof node.name === 'string' ? node.name : undefined,
  }));
}

/**
 * Every `$`-prefixed string under `value`, in document order. The schema's
 * `variable` def is exactly `pattern: "^\\$"`, reached through each
 * `*OrVariable` property — text `content` included, so a label reading `$5`
 * is a binding to the editor too.
 */
function collectBindings(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('$')) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectBindings(item, out);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!NON_BINDING_KEYS.has(key)) collectBindings(item, out);
    }
  }
}

/** A plain `$name` must be a declared variable; a qualified `$alias:name` needs only its alias imported. */
function unresolvedBindings(doc: PenDocument): string[] {
  const bindings = new Set<string>();
  collectBindings(doc.children, bindings);
  const variables = isRecord(doc.variables) ? doc.variables : {};
  const imports = isRecord(doc.imports) ? doc.imports : {};
  return [...bindings].filter((binding) => {
    const name = binding.slice(1);
    const colon = name.indexOf(':');
    return colon === -1
      ? !Object.hasOwn(variables, name)
      : !Object.hasOwn(imports, name.slice(0, colon));
  });
}

/** One finding naming every offending item, or none when nothing offends. */
function listFinding(
  code: PenFindingCode,
  severity: PenFinding['severity'],
  lead: string,
  items: readonly string[],
): PenFinding[] {
  return items.length === 0 ? [] : [{ code, severity, message: `${lead}: ${items.join(', ')}` }];
}

function schemaAdvisories(doc: PenDocument, schema: PenSchemaFacts): PenFinding[] {
  const drifted =
    schema.version !== null && Object.hasOwn(doc, 'version') && doc.version !== schema.version;
  return [
    ...(drifted
      ? [
          {
            code: 'version-drift' as const,
            severity: 'advisory' as const,
            message: `declares version ${JSON.stringify(doc.version)}; the installed pen schema (${schema.path}) is ${schema.version}`,
          },
        ]
      : []),
    ...listFinding(
      'unknown-top-level-key',
      'advisory',
      'top-level key(s) the installed pen schema does not know',
      Object.keys(doc).filter((key) => !schema.topLevelKeys.includes(key)),
    ),
    ...listFinding(
      'schema-required',
      'advisory',
      'missing top-level key(s) the installed pen schema requires',
      schema.required.filter((key) => !CORE_REQUIRED.includes(key) && !Object.hasOwn(doc, key)),
    ),
  ];
}

/**
 * Is this a `.pen` the editor can render? Red findings: unparseable bytes, a
 * missing `version`, a binding to an undeclared variable. With a schema,
 * advisory findings: version drift, unknown and schema-required top-level keys.
 */
export function validateBaseline(
  bytes: Buffer | string,
  schema: PenSchemaFacts | null,
): PenFinding[] {
  const parsed = parsePenDocument(bytes);
  if (!parsed.ok) {
    return [
      { code: 'unparseable', severity: 'red', message: `not a .pen document: ${parsed.error}` },
    ];
  }
  const { doc } = parsed;
  const unresolved = unresolvedBindings(doc);
  const more = unresolved.length - 1;
  return [
    ...listFinding(
      'missing-required',
      'red',
      'missing required top-level key(s)',
      CORE_REQUIRED.filter((key) => !Object.hasOwn(doc, key)),
    ),
    ...(unresolved.length === 0
      ? []
      : [
          {
            code: 'unresolved-variable' as const,
            severity: 'red' as const,
            message: `binds ${unresolved[0]}${more > 0 ? ` and ${more} more variable(s)` : ''} that the document does not declare`,
          },
        ]),
    ...(schema === null ? [] : schemaAdvisories(doc, schema)),
  ];
}

/**
 * Does the baseline hold exactly the declared pages? Each state, times each
 * mode when modes are declared, names one page id `<state>-<mode>` (`<state>`
 * alone without modes). Red findings: a declared id no top-level node carries,
 * one carried more than once, and a `FINAL:<surface>:` page nobody declared.
 */
export function checkCoverage(
  pages: readonly PenPage[],
  declared: CoverageDeclaration,
  surface: string,
): PenFinding[] {
  const { modes } = declared;
  const ids = new Set(
    modes === undefined
      ? declared.states
      : declared.states.flatMap((s) => modes.map((m) => `${s}-${m}`)),
  );
  const carried = Map.groupBy(
    pages.filter((p) => p.id !== undefined),
    (p) => p.id!,
  );
  const prefix = `FINAL:${surface}:`;
  return [
    ...listFinding(
      'missing-page',
      'red',
      'declared page(s) missing',
      [...ids].filter((id) => !carried.has(id)),
    ),
    ...listFinding(
      'duplicate-page',
      'red',
      'declared page id(s) carried by more than one top-level node',
      [...ids].filter((id) => (carried.get(id)?.length ?? 0) > 1),
    ),
    ...listFinding(
      'undeclared-page',
      'red',
      `${prefix} page(s) no state declares`,
      pages
        .filter(
          (p) => p.name?.startsWith(prefix) === true && (p.id === undefined || !ids.has(p.id)),
        )
        .map((p) => p.id ?? p.name!),
    ),
  ];
}

/**
 * Every finding for one surface's baseline: validity always, coverage when the
 * surface declares it and the bytes parse. The one entry point the freshness
 * check and `design capture` share, so the two cannot disagree about a file.
 */
export function inspectBaseline(
  bytes: Buffer | string,
  opts: { schema: PenSchemaFacts | null; coverage?: CoverageDeclaration; surface: string },
): PenFinding[] {
  const validity = validateBaseline(bytes, opts.schema);
  if (opts.coverage === undefined) return validity;
  const parsed = parsePenDocument(bytes);
  if (!parsed.ok) return validity;
  return [...validity, ...checkCoverage(topLevelPages(parsed.doc), opts.coverage, opts.surface)];
}
