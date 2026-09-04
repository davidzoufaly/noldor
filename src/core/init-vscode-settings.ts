// @tests: pendev-ui-design-phase
// The `.pen` editor association in the consumer's `.vscode/settings.json`,
// ensured by `noldor init`.
//
// A `.pen` is plain UTF-8 JSON. That single fact is the whole reason this file
// exists: with no association VS Code has nothing to stop it, so it opens the
// design in the text editor and renders several thousand nodes of coordinates —
// no binary warning, no custom editor, no hint that a canvas was meant. An
// operator who clicks a `.pen` in the explorer or a search result gets that,
// while pencil MCP goes on reporting a dead bridge, because a text buffer is not
// an open design.
//
// A merge rather than a template copy. `.vscode/settings.json` is a file
// consumers already own and fill with unrelated keys, so a scaffold-only
// template — copied only when absent — would skip exactly the repos that have
// been worked in, which are the repos with `.pen` files in them.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync } from './atomic-write.js';
import { PENCIL_VIEW_TYPE } from './design-artifact-names.js';

/** The consumer-relative settings file, as it appears in init's summary log. */
export const VSCODE_SETTINGS_PATH = '.vscode/settings.json';

/** The settings key VS Code reads for per-glob editor selection. */
export const EDITOR_ASSOCIATIONS_KEY = 'workbench.editorAssociations';

/** The glob this framework claims — every `.pen`, wherever it sits. */
export const PEN_GLOB = '*.pen';

/**
 * What ensuring the association did.
 *
 * `conflict` is the case worth naming: an association for `*.pen` already
 * exists and names something else. That is an operator decision — they may be
 * pointing at a fork of the extension, or deliberately reading the JSON — so it
 * is reported and never overwritten. `blocked` covers a settings file that is
 * present but unusable (unreadable, or not a JSON object); rewriting it from
 * scratch would discard whatever it holds.
 */
export type VscodeSettingsOutcome =
  | { kind: 'created' }
  | { kind: 'added' }
  | { kind: 'unchanged' }
  | { kind: 'conflict'; found: string }
  | { kind: 'blocked'; reason: string };

/** A plain nested object at `key`, or `undefined` when the value is not one. */
function objectAt(host: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = host[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Point `*.pen` at the pen.dev custom editor in the consumer's VS Code settings,
 * creating the file when absent and merging into it when present.
 *
 * Never overwrites: an existing `*.pen` association that names another editor is
 * returned as `conflict` for init to report. JSON with comments (`jsonc`, which
 * VS Code accepts here) does not parse and comes back as `blocked` rather than
 * being replaced — a settings file this cannot read is a settings file it has no
 * business rewriting.
 *
 * @param consumerRoot - Consumer repo root (cwd of `noldor init`).
 */
export function ensureVscodeEditorAssociation(consumerRoot: string): VscodeSettingsOutcome {
  const path = join(consumerRoot, VSCODE_SETTINGS_PATH);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(
      path,
      render({ [EDITOR_ASSOCIATIONS_KEY]: { [PEN_GLOB]: PENCIL_VIEW_TYPE } }),
    );
    return { kind: 'created' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return {
      kind: 'blocked',
      reason: `${VSCODE_SETTINGS_PATH} is not parseable JSON (${String(e)}) — add "${PEN_GLOB}": "${PENCIL_VIEW_TYPE}" under "${EDITOR_ASSOCIATIONS_KEY}" by hand`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      kind: 'blocked',
      reason: `${VSCODE_SETTINGS_PATH} is not a JSON object — add the association by hand`,
    };
  }

  const settings = parsed as Record<string, unknown>;
  const existing = settings[EDITOR_ASSOCIATIONS_KEY];
  const associations = objectAt(settings, EDITOR_ASSOCIATIONS_KEY);
  // A key that exists but is not an object is the operator's, malformed or not.
  if (existing !== undefined && associations === undefined) {
    return {
      kind: 'blocked',
      reason: `${VSCODE_SETTINGS_PATH} has a non-object "${EDITOR_ASSOCIATIONS_KEY}" — fix it, then re-run init`,
    };
  }
  const current = associations?.[PEN_GLOB];
  if (current === PENCIL_VIEW_TYPE) return { kind: 'unchanged' };
  if (current !== undefined) return { kind: 'conflict', found: String(current) };

  atomicWriteFileSync(
    path,
    render({
      ...settings,
      [EDITOR_ASSOCIATIONS_KEY]: { ...associations, [PEN_GLOB]: PENCIL_VIEW_TYPE },
    }),
  );
  return { kind: 'added' };
}

/** Two-space JSON with a trailing newline — the shape VS Code itself writes. */
function render(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Init's summary line for an outcome, or `undefined` when there is nothing to say. */
export function renderVscodeSettingsOutcome(outcome: VscodeSettingsOutcome): string | undefined {
  switch (outcome.kind) {
    case 'created':
      return `created    ${VSCODE_SETTINGS_PATH} ("${PEN_GLOB}" → ${PENCIL_VIEW_TYPE}, so a .pen opens as a canvas and not as raw JSON)`;
    case 'added':
      return `updated    ${VSCODE_SETTINGS_PATH} ("${PEN_GLOB}" → ${PENCIL_VIEW_TYPE}, so a .pen opens as a canvas and not as raw JSON)`;
    case 'unchanged':
      return undefined;
    case 'conflict':
      return `warn       ${VSCODE_SETTINGS_PATH}: "${PEN_GLOB}" already opens in '${outcome.found}' — left alone. A .pen must open in ${PENCIL_VIEW_TYPE} for pencil MCP to see it.`;
    case 'blocked':
      return `warn       ${outcome.reason}`;
  }
}
