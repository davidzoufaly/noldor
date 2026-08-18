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

/** Consumer-root file that must carry the `extends` line. */
export const ROOT_LEFTHOOK = 'lefthook.yml';

/** Framework hook block the root file must extend, as written in the template. */
export const NOLDOR_BLOCK = './lefthook/noldor.yml';

/** The one-line repair, quoted verbatim in every failure detail. */
export const REPAIR = `add '${NOLDOR_BLOCK}' to the 'extends:' list in ${ROOT_LEFTHOOK}`;

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
  | 'block-missing'
  | 'not-extended';

export interface LefthookWiringResult {
  readonly status: LefthookWiringStatus;
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
 * Verify the consumer's root `lefthook.yml` extends the framework hook block.
 *
 * Read-only by contract — the root file is project-owned, so a caller acting
 * on a non-`ok` result may print and exit non-zero, never rewrite.
 *
 * @param cwd - Consumer repo root.
 */
export function checkLefthookWiring(cwd: string): LefthookWiringResult {
  const rootPath = join(cwd, ROOT_LEFTHOOK);
  const deadHooks = frameworkHooks(cwd);
  const dead = deadHooks.length > 0 ? ` Inert hooks: ${deadHooks.join(', ')}.` : '';

  if (!existsSync(rootPath)) {
    return {
      status: 'root-missing',
      detail: `${ROOT_LEFTHOOK} is absent, so lefthook loads no noldor jobs at all.${dead} Run 'noldor init' to scaffold it, or ${REPAIR}.`,
      deadHooks,
    };
  }

  let doc: unknown;
  try {
    doc = parse(readFileSync(rootPath, 'utf8'));
  } catch (e) {
    return {
      status: 'root-unparseable',
      detail: `${ROOT_LEFTHOOK} is not valid YAML (${e instanceof Error ? e.message : String(e)}), so its wiring cannot be verified and lefthook may be loading nothing.${dead} Fix the syntax, then ensure it ${REPAIR}.`,
      deadHooks,
    };
  }

  if (!existsSync(join(cwd, NOLDOR_BLOCK.replace(/^\.\//, '')))) {
    return {
      status: 'block-missing',
      detail: `${NOLDOR_BLOCK} is absent, so the ${ROOT_LEFTHOOK} extends line has nothing to load. Run 'noldor init --update' to restore the framework hook block.`,
      deadHooks,
    };
  }

  if (!extendsList(doc).some(isNoldorBlock)) {
    return {
      status: 'not-extended',
      detail: `${ROOT_LEFTHOOK} does not extend ${NOLDOR_BLOCK}, so every noldor hook job is inert while lefthook still prints its banner — zero jobs running reads exactly like a working install.${dead} Repair: ${REPAIR}.`,
      deadHooks,
    };
  }

  return {
    status: 'ok',
    detail: `${ROOT_LEFTHOOK} extends ${NOLDOR_BLOCK}`,
    deadHooks: [],
  };
}
