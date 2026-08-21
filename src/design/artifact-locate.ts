// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Which file is *this* dialogue's spec or plan? The design-context block renders
// the heading under discussion out of that file, so both `design context` (to
// read it) and `design log --confirm-section` (to hash it) resolve through here.
//
// Synchronous and `cwd`-parameterized on purpose, matching the rest of
// `src/design/`. The async `listSpecs`/`listPlans` helpers in `core/fd-load.ts`
// are deliberately unused: they return paths relative to `process.cwd()`, which
// is the wrong anchor inside a worktree and inside a test.

import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { resolveExisting } from '../core/branch-added.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { extractPlanSlug, extractSpecSlug } from '../core/fd-load.js';

export type ArtifactKind = 'spec' | 'plan';

/**
 * Where the dialogue's artifact is, or why there is nothing to read.
 *
 * Three outcomes rather than a nullable path, because the CLIs owe them three
 * different behaviours: render (`found`), report the absent draft and carry on
 * (`none`), or fail loudly (`rejected`). Collapsing the last two would let a
 * mistyped `--spec` read as "no draft yet" and silently suppress the whole
 * checklist.
 */
export type LocateResult =
  | { status: 'found'; paths: string[] }
  | { status: 'none' }
  | { status: 'rejected'; reason: string };

export interface LocateOpts {
  slug: string;
  /** Defaults to `'spec'`, matching `design context --kind`. */
  kind?: ArtifactKind;
  /** `--spec <path>`, absolute or relative to `cwd`. */
  override?: string;
}

/** Part number of a split plan filename; a part-less plan sorts first. */
function partNumber(filename: string): number {
  const m = filename.match(/-part(\d+)\.md$/);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/**
 * True when `candidate` is the root or sits beneath it.
 *
 * The `sep` on the prefix is what separates `docs/design/specs/x.md` from
 * `docs/design/specs-scratch/x.md` — a bare `startsWith` accepts both, and the
 * second one is an arbitrary file whose contents this feature prints into chat.
 */
function contained(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/** A readable regular `.md` file inside `root`, or the reason it is not. */
function vet(
  path: string,
  root: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (!path.endsWith('.md')) return { ok: false, reason: `${path}: not a .md file` };
  const real = resolveExisting(path);
  try {
    if (!statSync(real).isFile()) return { ok: false, reason: `${path}: not a readable file` };
  } catch {
    return { ok: false, reason: `${path}: not a readable file` };
  }
  if (!contained(real, root)) return { ok: false, reason: `${path}: resolves outside ${root}` };
  return { ok: true, path: real };
}

/**
 * Resolve the artifact for a dialogue.
 *
 * An `override` wins when it vets; otherwise the kind's root is scanned for files
 * whose extracted slug equals `slug`. A spec must match exactly one file — two
 * generations of one spec have no defensible winner. A plan may match several,
 * because `extractPlanSlug` strips `^plan\d+-` and `-part\d+` precisely so one
 * slug covers every part of a split plan; those come back in part-number order,
 * since a lexical sort puts `-part10` ahead of `-part2`.
 *
 * Never throws: every filesystem surprise becomes `none` or `rejected`.
 */
export function locateArtifact(cwd: string, opts: LocateOpts): LocateResult {
  const kind = opts.kind ?? 'spec';
  const roots = loadDocRoots(cwd);
  // Both sides of `contained` must be in the same symlink form. `loadDocRoots`
  // builds its paths with `join`, so without this the compare fails for every
  // path whenever `cwd` is reached through a link (macOS `/var` → `/private/var`).
  const root = resolveExisting(kind === 'spec' ? roots.specs : roots.plans);

  if (opts.override !== undefined) {
    const abs = isAbsolute(opts.override) ? opts.override : resolve(cwd, opts.override);
    const vetted = vet(abs, root);
    return vetted.ok
      ? { status: 'found', paths: [vetted.path] }
      : { status: 'rejected', reason: vetted.reason };
  }

  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    // A repo that has never written this kind of artifact has no directory. That
    // is an absence, not a misconfiguration.
    return { status: 'none' };
  }

  const extract = kind === 'spec' ? extractSpecSlug : extractPlanSlug;
  const matches = names.filter((n) => n.endsWith('.md') && extract(n) === opts.slug);
  if (matches.length === 0) return { status: 'none' };

  if (kind === 'spec' && matches.length > 1) {
    return {
      status: 'rejected',
      reason: `${matches.length} spec files match slug '${opts.slug}' (${matches.sort().join(', ')}) — name one with --spec`,
    };
  }

  const ordered = [...matches].sort((a, b) => partNumber(a) - partNumber(b) || a.localeCompare(b));
  const paths: string[] = [];
  for (const name of ordered) {
    const vetted = vet(join(root, name), root);
    if (!vetted.ok) return { status: 'rejected', reason: vetted.reason };
    paths.push(vetted.path);
  }
  return { status: 'found', paths };
}
