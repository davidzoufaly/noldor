import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

import { parseTrailers } from './trailers';

const execFileP = promisify(execFile);

const SUBJECT_RE = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:/;

/** Inputs to {@link validateScope}. */
export interface ValidateScopeInput {
  /** Full commit message (subject + body). Only the first line is parsed. */
  message: string;
  /** Files staged in the commit (`git diff --cached --name-only`). */
  stagedFiles: string[];
  /** Set of valid Noldor page slugs (e.g. `index`, `workflow`). */
  knownSlugs: Set<string>;
}

/** Result of scope validation against a commit. */
export interface ValidateScopeResult {
  /** True when the scope is acceptable for the staged files. */
  success: boolean;
  /** Human-readable error message when {@link success} is false. */
  error?: string;
}

/**
 * Validate that a commit touching `docs/noldor/*.md` carries an
 * appropriate Conventional Commits scope.
 *
 * Rules:
 * - If no noldor docs are staged, any scope passes.
 * - Scope must be either `noldor` (framework-wide) or `noldor:<slug>`.
 * - The slug after `noldor:` must match an existing page (with `index`
 *   reserved for `README.md`).
 *
 * @param input - Commit message, staged files, and the known slug set
 * @returns Result with success flag and any human-readable error
 *
 * @example
 * ```typescript
 * const result = validateScope({
 *   message: 'docs(noldor:workflow): tweak',
 *   stagedFiles: ['docs/noldor/workflow.md'],
 *   knownSlugs: new Set(['workflow']),
 * });
 * ```
 */
/** Map `docs/noldor/<file>.md` → slug (README.md becomes `index`). */
function pathToSlug(path: string): string {
  const filename = path.slice('docs/noldor/'.length);
  return filename === 'README.md' ? 'index' : filename.replace(/\.md$/, '');
}

/**
 * Build a suggested commit-subject prefix that would have passed the gate,
 * given the type token from the offending commit and the noldor files
 * it touched. Returns `<type>(noldor:<slug>)` when exactly one
 * noldor page is touched, or `<type>(noldor)` otherwise.
 */
function buildSuggestion(type: string, noldorFiles: string[]): string {
  const slugs = new Set(noldorFiles.map(pathToSlug));
  if (slugs.size === 1) {
    return `${type}(noldor:${[...slugs][0]})`;
  }
  return `${type}(noldor)`;
}

/** Render the affected `docs/noldor/*.md` files as a short list line. */
function renderAffected(noldorFiles: string[]): string {
  return `affected: ${[...noldorFiles].toSorted().join(', ')}`;
}

/**
 * Build the precise `Noldor-Sibling-Scope` value covering the staged noldor
 * pages — always the enumerated `noldor:<slug>` form (comma-joined, sorted),
 * never bare `noldor`, so the error message doesn't teach laziness.
 */
function buildSiblingTrailerValue(noldorFiles: string[]): string {
  return [...new Set(noldorFiles.map(pathToSlug))]
    .toSorted()
    .map((s) => `noldor:${s}`)
    .join(', ');
}

/**
 * Apply the `Noldor-Sibling-Scope` trailer branch. Called only from the
 * subject-scope FAILURE branches (no scope, or a non-noldor scope): the
 * trailer lets a mixed code+doc commit keep its real code scope while the
 * staged `docs/noldor/` pages are validated as declared siblings.
 *
 * @param input - The full validation input (staged files + known slugs)
 * @param trailerValue - Raw `Noldor-Sibling-Scope` value from parseTrailers
 * @param noldorFiles - The staged `docs/noldor/*.md` files
 * @returns `null` when the trailer is absent (caller falls through to its
 *   normal error); a terminal {@link ValidateScopeResult} otherwise.
 */
function applySiblingTrailer(
  input: ValidateScopeInput,
  trailerValue: string | undefined,
  noldorFiles: string[],
): ValidateScopeResult | null {
  if (trailerValue === undefined) return null;

  // Mixed-diff guard: the trailer exists solely to preserve a meaningful
  // code scope on a mixed diff. Doc-only commits must carry the scope in
  // the subject — otherwise the trailer becomes a general scope bypass.
  const nonNoldorFiles = input.stagedFiles.filter((f) => !noldorFiles.includes(f));
  if (nonNoldorFiles.length === 0) {
    return {
      success: false,
      error:
        'Noldor-Sibling-Scope on a doc-only commit: put the scope in the subject (e.g. "docs(noldor:<slug>): <subject>"), not in the trailer.',
    };
  }

  const tokens = trailerValue
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return {
      success: false,
      error:
        'empty Noldor-Sibling-Scope trailer; expected "noldor" or a comma-separated list of "noldor:<slug>" tokens.',
    };
  }

  // Validate ALL tokens first (a malformed token fails the commit even when
  // a bare `noldor` is also present), then let bare `noldor` accept any
  // staged page set — parity with the subject-scope semantics.
  let bareNoldor = false;
  const covered = new Set<string>();
  for (const token of tokens) {
    if (token === 'noldor') {
      bareNoldor = true;
      continue;
    }
    if (!token.startsWith('noldor:')) {
      return {
        success: false,
        error: `Noldor-Sibling-Scope token "${token}" is not "noldor" or "noldor:<slug>".`,
      };
    }
    const slug = token.slice('noldor:'.length);
    if (!input.knownSlugs.has(slug)) {
      return {
        success: false,
        error: `unknown noldor slug "${slug}" in Noldor-Sibling-Scope; valid slugs: ${[...input.knownSlugs].toSorted().join(', ')}`,
      };
    }
    covered.add(slug);
  }
  if (bareNoldor) return { success: true };

  const uncovered = noldorFiles.filter((f) => !covered.has(pathToSlug(f)));
  if (uncovered.length > 0) {
    const missing = [...new Set(uncovered.map(pathToSlug))]
      .toSorted()
      .map((s) => `noldor:${s}`)
      .join(', ');
    return {
      success: false,
      error: `Noldor-Sibling-Scope does not cover every staged noldor page. ${renderAffected(uncovered)}. Add: ${missing}`,
    };
  }

  return { success: true };
}

export function validateScope(input: ValidateScopeInput): ValidateScopeResult {
  const noldorFiles = input.stagedFiles.filter(
    (f) => f.startsWith('docs/noldor/') && f.endsWith('.md'),
  );
  if (noldorFiles.length === 0) {
    return { success: true };
  }

  // release-automation commits intentionally touch docs/noldor/*.md
  // to stamp `introduced` / `updated` markers across the framework page
  // set. The scope check would force an artificial split; the
  // release-automation trailer is the canonical bypass.
  //
  // Use parseTrailers (git interpret-trailers --parse) so a Path-Override
  // stranded in the body — not in the trailer block — no longer silently
  // bypasses the scope check (the v0.5.0 footgun: override placed above
  // a paragraph followed by a separate Co-Authored-By trailer block).
  // On subprocess error (no git binary, ENOENT), fall back to the legacy
  // regex so the bypass never regresses.
  let trailers: Record<string, string> = {};
  try {
    trailers = parseTrailers(input.message);
  } catch {
    if (/^Noldor-Path:\s*release-automation\s*$/m.test(input.message)) {
      return { success: true };
    }
    if (/^Noldor-Path-Override:/m.test(input.message)) {
      return { success: true };
    }
  }
  if (trailers['Noldor-Path'] === 'release-automation') {
    return { success: true };
  }
  if (trailers['Noldor-Path-Override']) {
    return { success: true };
  }

  const subject = input.message.split('\n')[0];
  const match = SUBJECT_RE.exec(subject);
  if (!match) {
    return {
      success: false,
      error: `commit subject does not match Conventional Commits: "${subject}"`,
    };
  }

  const type = match.groups?.type ?? 'docs';
  const suggestion = buildSuggestion(type, noldorFiles);
  const affected = renderAffected(noldorFiles);

  const scope = match.groups?.scope ?? null;
  if (scope === null) {
    const sibling = applySiblingTrailer(input, trailers['Noldor-Sibling-Scope'], noldorFiles);
    if (sibling) return sibling;
    return {
      success: false,
      error: `commit touches docs/noldor/ but has no scope. ${affected}. Suggested: ${suggestion}: <subject>`,
    };
  }

  if (scope === 'noldor') {
    return { success: true };
  }

  if (!scope.startsWith('noldor:')) {
    const sibling = applySiblingTrailer(input, trailers['Noldor-Sibling-Scope'], noldorFiles);
    if (sibling) return sibling;
    const isMixedDiff = input.stagedFiles.some((f) => !noldorFiles.includes(f));
    const trailerHint = isMixedDiff
      ? `; or keep "${type}(${scope})" and add trailer "Noldor-Sibling-Scope: ${buildSiblingTrailerValue(noldorFiles)}"`
      : '';
    return {
      success: false,
      error: `commit touches docs/noldor/ but scope is "${scope}". ${affected}. Suggested: ${suggestion}: <subject> (or split: keep "${scope}" on non-doc files, retitle the doc-only commit with the suggestion${trailerHint}).`,
    };
  }

  const slug = scope.slice('noldor:'.length);
  if (!input.knownSlugs.has(slug)) {
    return {
      success: false,
      error: `unknown noldor slug "${slug}"; valid slugs: ${[...input.knownSlugs].toSorted().join(', ')}. Suggested: ${suggestion}: <subject>`,
    };
  }

  return { success: true };
}

async function loadKnownSlugs(): Promise<Set<string>> {
  const files = await readdir('docs/noldor');
  const slugs = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    slugs.add(f === 'README.md' ? 'index' : f.replace(/\.md$/, ''));
  }
  return slugs;
}

async function loadStagedFiles(): Promise<string[]> {
  const { stdout } = await execFileP('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMRT',
  ]);
  return stdout.split('\n').filter(Boolean);
}

async function main(): Promise<void> {
  const messageFile = process.argv[2];
  if (!messageFile) {
    console.error('usage: validate-noldor-scope <commit-msg-file>');
    process.exitCode = 2;
    return;
  }

  const message = await readFile(messageFile, 'utf8');
  const stagedFiles = await loadStagedFiles();
  const knownSlugs = await loadKnownSlugs();

  const result = validateScope({ message, stagedFiles, knownSlugs });
  if (!result.success) {
    console.error(`✗ commit-msg gate: ${result.error}`);
    process.exitCode = 1;
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
