// @tests: pendev-ui-design-phase
// Finds the pen schema the operator's editor actually ships. The format is the
// editor's to version, so the schema is read from the installed pen.dev VS Code
// extension rather than vendored: a vendored copy would drift from what the
// canvas renders.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PENCIL_EXTENSION_ID } from '../core/design-artifact-names.js';
import type { PenSchemaFacts } from './pen-doc.js';

const SCHEMA_IN_EXTENSION = ['node_modules', '@ha', 'schema', 'pen.schema.json'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    // Absent, unreadable and unparseable all mean "no schema here": the caller
    // tries the next place, and a machine with none still gets every red check.
    return { ok: false };
  }
}

function factsFrom(path: string, schema: unknown): PenSchemaFacts | null {
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;
  const { version } = schema.properties;
  return {
    path,
    version: isRecord(version) && typeof version.const === 'string' ? version.const : null,
    required: Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [],
    topLevelKeys: Object.keys(schema.properties),
  };
}

/**
 * The directory of the pen.dev install VS Code considers active. The registry
 * rather than a scan of `highagency.pencildev-*` directories: an update leaves
 * the old version on disk, listed only in `.obsolete`, and its schema is stale.
 */
function activeExtensionDir(extensionsDir: string): string | null {
  const registry = readJsonFile(join(extensionsDir, 'extensions.json'));
  if (!registry.ok || !Array.isArray(registry.value)) return null;
  const entry = registry.value.find(
    (e) => isRecord(e) && isRecord(e.identifier) && e.identifier.id === PENCIL_EXTENSION_ID,
  );
  if (!isRecord(entry)) return null;
  if (typeof entry.relativeLocation === 'string')
    return join(extensionsDir, entry.relativeLocation);
  if (isRecord(entry.location) && typeof entry.location.path === 'string')
    return entry.location.path;
  return null;
}

/**
 * The installed pen schema's top-level facts, or `null` when there is none.
 * Looks at `NOLDOR_PEN_SCHEMA` first (CI, another editor), then the pen.dev
 * extension VS Code's registry names. Never throws.
 */
export function findInstalledPenSchema(
  opts: { env?: NodeJS.ProcessEnv; home?: string } = {},
): PenSchemaFacts | null {
  const override = (opts.env ?? process.env).NOLDOR_PEN_SCHEMA;
  if (override !== undefined && override !== '') {
    const json = readJsonFile(override);
    const facts = json.ok ? factsFrom(override, json.value) : null;
    if (facts !== null) return facts;
  }
  const extDir = activeExtensionDir(join(opts.home ?? homedir(), '.vscode', 'extensions'));
  if (extDir === null) return null;
  const path = join(extDir, ...SCHEMA_IN_EXTENSION);
  const json = readJsonFile(path);
  return json.ok ? factsFrom(path, json.value) : null;
}
