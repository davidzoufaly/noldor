// Does the consumer's `.oxfmtrc.json` exempt the generated knowledge-graph
// report from formatting?
//
// `.oxfmtrc.json` is a SCAFFOLD_ONLY template: `init` writes it once and
// template-sync/doctor deliberately report no drift on it, because which rules
// a repo turns off is a property of ITS code. That is also why a consumer
// scaffolded before the template gained its `graphify-out/**` line never
// receives it, and nothing else in the framework would ever tell them.
//
// The consequence only appears at release. The release sweep stages
// `graphify-out/` (`RELEASE_SWEEP_GLOBS` admits it), so tracking the report is
// the sanctioned shape — but graphify writes markdown headings with no
// following blank line, oxfmt normalizes that, and a format run that ignores
// only *gitignored* paths starts seeing the report the moment it stops being
// gitignored. The sweep then dead-ends between a step that says to track the
// file and a gate that says the file is malformed, with no lane allowlist that
// would let the operator add the exemption as part of the same change.
//
// Read-only and advisory by contract: the file is consumer-owned, so no caller
// may rewrite it on this finding, and no caller may fail on it — a red here
// would fail `pnpm verify` for a repo whose only sin is an older scaffold. The
// result carries no `advisory` flag for that reason: unlike the lefthook and
// install checks, where the flag separates "could not look" from "repo is
// broken" and callers branch on it, EVERY status here is warn-only, so a field
// that never varies would be dead surface. Callers branch on `status`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The consumer-owned formatter config this check reads. */
export const OXFMT_CONFIG = '.oxfmtrc.json';

/**
 * Ignore patterns that exempt the generated graph report, either of which
 * satisfies this check. The root-anchored form is what the template ships; the
 * globstar form is what a monorepo consumer writes when the report lands inside
 * a package, and it covers the root case too.
 */
export const GRAPHIFY_IGNORE_PATTERNS: readonly string[] = [
  'graphify-out/**',
  '**/graphify-out/**',
];

/** The one-line repair, quoted verbatim in the failure detail. */
export const REPAIR = `add '${GRAPHIFY_IGNORE_PATTERNS[0]}' to 'ignorePatterns' in ${OXFMT_CONFIG}`;

/**
 * Why the exemption is not verified-present. `ok` is the only passing state;
 * `no-config` and `unparseable` are this check declining to look, which is never
 * evidence of a defect, while `graphify-not-ignored` is the real finding.
 */
export type OxfmtIgnoresStatus = 'ok' | 'no-config' | 'unparseable' | 'graphify-not-ignored';

export interface OxfmtIgnoresResult {
  readonly status: OxfmtIgnoresStatus;
  /** Operator-facing sentence: what breaks, and the one-line repair. */
  readonly detail: string;
}

/** `ignorePatterns` as a string list, `[]` when absent or the wrong shape. */
function ignorePatterns(doc: unknown): string[] {
  if (doc === null || typeof doc !== 'object') return [];
  const raw = (doc as { ignorePatterns?: unknown }).ignorePatterns;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is string => typeof e === 'string');
}

/**
 * Verify the consumer's oxfmt config exempts `graphify-out/`.
 *
 * @param cwd - Consumer repo root.
 */
export function checkOxfmtIgnores(cwd: string): OxfmtIgnoresResult {
  const path = join(cwd, OXFMT_CONFIG);
  if (!existsSync(path)) {
    return {
      status: 'no-config',
      detail: `no ${OXFMT_CONFIG} — oxfmt is not configured here, so there is nothing to exempt.`,
    };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return {
      status: 'unparseable',
      detail: `${OXFMT_CONFIG} does not parse (${e instanceof Error ? e.message : String(e)}), so its ignore list is unverified — confirm by hand that it exempts ${GRAPHIFY_IGNORE_PATTERNS[0]}.`,
    };
  }

  const patterns = ignorePatterns(doc);
  if (GRAPHIFY_IGNORE_PATTERNS.some((p) => patterns.includes(p))) {
    return { status: 'ok', detail: `${OXFMT_CONFIG} exempts graphify-out/` };
  }

  return {
    status: 'graphify-not-ignored',
    detail: `${OXFMT_CONFIG} does not exempt graphify-out/, so 'pnpm fmt:check' will fail on the generated graph report the moment the release sweep tracks it (the sweep stages graphify-out/ by design). Repair: ${REPAIR}.`,
  };
}
