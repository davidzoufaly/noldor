// Structural wiring assertion for the consumer's root `lefthook.yml`.
//
// The root file is a SCAFFOLD_ONLY template: the consumer owns it and appends
// project hooks, so `init` copies it only when absent, `init --update` never
// overwrites it, and template-sync/doctor deliberately report no drift on it.
// The framework's own hook block lives in the template-synced
// `lefthook/noldor.yml` and reaches git only through the root file's
// `extends:` line.
//
// A repo whose root `lefthook.yml` predates adoption therefore never receives
// that line, and every noldor job — trailer injection, commit-msg validation,
// the pre-push summary-body gate — is silently inert while lefthook still
// prints its banner. Zero jobs running looks exactly like zero jobs
// configured, so the failure has no signal at all until a gate that was
// believed armed lets something through.
//
// This module closes that hole by VERIFYING the wiring, never by syncing it:
// it reads the consumer's file and reports, and no caller may rewrite a
// project-owned hook file on its findings.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * Root config filenames lefthook accepts, in its own precedence order. A
 * consumer that writes `lefthook.yaml` (or the dotted or TOML/JSON forms) has
 * a perfectly wired repo, so probing only `lefthook.yml` would report
 * `root-missing` and — now that this check carries an exit code — fail
 * `doctor` while advising an `init` that would drop a SECOND, ignored config
 * beside the real one.
 */
export const ROOT_CANDIDATES: readonly string[] = [
  'lefthook.yml',
  'lefthook.yaml',
  'lefthook.toml',
  'lefthook.json',
  '.lefthook.yml',
  '.lefthook.yaml',
  '.lefthook.toml',
  '.lefthook.json',
];

/** The filename `init` scaffolds, and the one named when none exists. */
export const ROOT_LEFTHOOK = ROOT_CANDIDATES[0];

/** Framework hook block the root file must extend, as written in the template. */
export const NOLDOR_BLOCK = './lefthook/noldor.yml';

/** The one-line repair, quoted verbatim in every failure detail. */
export function repairFor(rootName: string): string {
  return `add '${NOLDOR_BLOCK}' to the 'extends:' list in ${rootName}`;
}

/**
 * Why the wiring is not verified-good. `ok` is the only passing state — every
 * other member is a distinct repair, which is why this is a union and not a
 * boolean: "no root file" and "root file that forgot the line" need different
 * sentences, and a caller that collapses them cannot write either.
 */
export type LefthookWiringStatus =
  | 'ok'
  | 'root-missing'
  | 'root-unparseable'
  | 'root-unreadable-format'
  | 'block-missing'
  | 'not-extended';

export interface LefthookWiringResult {
  readonly status: LefthookWiringStatus;
  /**
   * The root config this result is about — whichever {@link ROOT_CANDIDATES}
   * entry exists, or {@link ROOT_LEFTHOOK} when none does. Callers quote it so
   * the operator is pointed at their actual file, not at a name they never used.
   */
  readonly rootName: string;
  /**
   * True when the finding is a *limitation of this check* rather than a defect
   * in the repo — today only a TOML config, which nothing here can parse.
   * Callers must warn on these and MUST NOT fail: refusing to verify is not
   * evidence of breakage, and a hard exit on one would punish a wired repo.
   */
  readonly advisory: boolean;
  /** Operator-facing sentence: what is inert, and the one-line repair. */
  readonly detail: string;
  /**
   * Hook groups left dead by this finding, `[]` when `ok`. Read from the
   * consumer's own `lefthook/noldor.yml` rather than hardcoded, so the list
   * cannot drift out of date as the framework block gains or loses hooks.
   */
  readonly deadHooks: readonly string[];
}

/** `extends:` accepts a bare string or a list; normalize both to a list. */
function extendsList(doc: unknown): string[] {
  if (doc === null || typeof doc !== 'object') return [];
  const raw = (doc as { extends?: unknown }).extends;
  if (typeof raw === 'string') return [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is string => typeof e === 'string');
}

/** `./lefthook/noldor.yml` and `lefthook/noldor.yml` are the same target. */
function isNoldorBlock(entry: string): boolean {
  const normalized = entry.trim().replace(/^\.\//, '');
  return normalized === NOLDOR_BLOCK.replace(/^\.\//, '');
}

/**
 * Hook groups the framework block defines (`pre-commit`, `commit-msg`, …),
 * each with how many jobs it carries, e.g. `pre-push (4 jobs)`. Returns `[]`
 * when the block is absent or unreadable — a wiring finding must still be
 * reportable when the thing it points at cannot be summarized.
 */
export function frameworkHooks(cwd: string): string[] {
  const path = join(cwd, NOLDOR_BLOCK.replace(/^\.\//, ''));
  if (!existsSync(path)) return [];
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, 'utf8'));
  } catch {
    // An unparseable framework block is template-sync's finding, not this
    // module's — degrade to an unnamed-hooks report rather than masking the
    // wiring result behind a second, unrelated failure.
    return [];
  }
  if (doc === null || typeof doc !== 'object') return [];
  const out: string[] = [];
  for (const [hook, body] of Object.entries(doc as Record<string, unknown>)) {
    const jobs = (body as { jobs?: unknown } | null)?.jobs;
    const count = Array.isArray(jobs) ? jobs.length : 0;
    out.push(count > 0 ? `${hook} (${count} job${count === 1 ? '' : 's'})` : hook);
  }
  return out;
}

/**
 * First existing {@link ROOT_CANDIDATES} entry, or `null` when the consumer has
 * no lefthook config at all.
 */
export function resolveRootConfig(cwd: string): { name: string; path: string } | null {
  for (const name of ROOT_CANDIDATES) {
    const path = join(cwd, name);
    if (existsSync(path)) return { name, path };
  }
  return null;
}

/**
 * Verify the consumer's root lefthook config extends the framework hook block.
 *
 * Read-only by contract — the root file is project-owned, so a caller acting
 * on a non-`ok` result may print and exit non-zero, never rewrite. Callers must
 * also honor {@link LefthookWiringResult.advisory}: a result this check could
 * not verify is not a repo defect and must not fail the caller.
 *
 * @param cwd - Consumer repo root.
 */
export function checkLefthookWiring(cwd: string): LefthookWiringResult {
  const deadHooks = frameworkHooks(cwd);
  const dead = deadHooks.length > 0 ? ` Inert hooks: ${deadHooks.join(', ')}.` : '';
  const root = resolveRootConfig(cwd);

  if (root === null) {
    return {
      status: 'root-missing',
      rootName: ROOT_LEFTHOOK,
      advisory: false,
      detail: `no lefthook config found (looked for ${ROOT_CANDIDATES.join(', ')}), so lefthook loads no noldor jobs at all.${dead} Run 'noldor init' to scaffold ${ROOT_LEFTHOOK}.`,
      deadHooks,
    };
  }

  // TOML is a real lefthook format this module cannot read without adding a
  // parser dependency for one branch. Report it and let the caller warn: the
  // repo may well be wired, and a hard failure on "I did not look" would be a
  // false alarm on a gate that exits non-zero.
  if (root.name.endsWith('.toml')) {
    return {
      status: 'root-unreadable-format',
      rootName: root.name,
      advisory: true,
      // noldor:cut TOML unparsed — add a TOML parser here if consumers adopt it.
      detail: `${root.name} is TOML, which this check cannot parse, so its wiring is unverified — confirm by hand that it ${repairFor(root.name)}.`,
      deadHooks,
    };
  }

  let doc: unknown;
  try {
    // The yaml parser also accepts JSON (JSON is a YAML 1.2 subset), so the
    // .json candidates need no separate branch.
    doc = parse(readFileSync(root.path, 'utf8'));
  } catch (e) {
    return {
      status: 'root-unparseable',
      rootName: root.name,
      advisory: false,
      detail: `${root.name} does not parse (${e instanceof Error ? e.message : String(e)}), so its wiring cannot be verified and lefthook may be loading nothing.${dead} Fix the syntax, then ensure it ${repairFor(root.name)}.`,
      deadHooks,
    };
  }

  if (!existsSync(join(cwd, NOLDOR_BLOCK.replace(/^\.\//, '')))) {
    return {
      status: 'block-missing',
      rootName: root.name,
      advisory: false,
      detail: `${NOLDOR_BLOCK} is absent, so the ${root.name} extends line has nothing to load. Run 'noldor init --update' to restore the framework hook block.`,
      deadHooks,
    };
  }

  if (!extendsList(doc).some(isNoldorBlock)) {
    return {
      status: 'not-extended',
      rootName: root.name,
      advisory: false,
      detail: `${root.name} does not extend ${NOLDOR_BLOCK}, so every noldor hook job is inert while lefthook still prints its banner — zero jobs running reads exactly like a working install.${dead} Repair: ${repairFor(root.name)}.`,
      deadHooks,
    };
  }

  return {
    status: 'ok',
    rootName: root.name,
    advisory: false,
    detail: `${root.name} extends ${NOLDOR_BLOCK}`,
    deadHooks: [],
  };
}
