import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../core/doc-roots.js';
import { BOOTSTRAP_REASON, gateEntry, type GateRegistryEntry } from './gate-registry.js';

/**
 * Bootstrap-immunity: a feature that introduces a release-time gate cannot
 * satisfy that gate with its own commits (the enforcement code didn't exist when
 * they were authored). This module auto-stamps the matching override trailer
 * (from the gate registry) on every commit of the still-private worktree branch
 * so the gate the feature adds can't block its own merge — replacing the blanket
 * `RELEASE_SKIP_CR_GATE=1` bypass for the gate-introducing cycle.
 */

export interface ResolvedGate {
  key: string;
  entry: GateRegistryEntry;
}

/**
 * Read `docs/features/<slug>.md` frontmatter and resolve its `introduces-gate`
 * value to a {@link GateRegistryEntry}. Returns null when the field is unset, the
 * FD is unreadable, or the key is unknown.
 */
export function resolveIntroducedGate(cwd: string, slug: string): ResolvedGate | null {
  const fdPath = join(loadDocRoots(cwd).features, `${slug}.md`);
  let key: unknown;
  try {
    key = (matter(readFileSync(fdPath, 'utf8')).data as { 'introduces-gate'?: unknown })[
      'introduces-gate'
    ];
  } catch {
    return null;
  }
  if (typeof key !== 'string') return null;
  const entry = gateEntry(key);
  return entry ? { key, entry } : null;
}

export interface InjectOptions {
  cwd: string;
  slug: string;
  /** Commit range to rewrite. Default `origin/main..HEAD`. */
  range?: string;
  /** Git seam — defaults to execFileSync in `cwd`. */
  runGit?: (args: string[]) => string;
  /** Override the reason (tests). Defaults to BOOTSTRAP_REASON. */
  reason?: string;
}

export interface InjectResult {
  gate: ResolvedGate | null;
  /** Pre-rewrite SHAs that lacked the trailer and were stamped (empty = no-op). */
  injected: string[];
}

/**
 * Rewrite every commit in `range` that lacks the gate's override trailer to carry
 * `<overrideTrailer>: <reason>`. Message-only (`filter-branch --msg-filter`), so
 * commit trees — and any `Noldor-Reviewed*: <tree>` receipt amended earlier — stay
 * valid. Idempotent: a commit already carrying the trailer is skipped, and an
 * all-already-stamped range is a no-op (filter-branch is not invoked).
 *
 * Safety: refuses to run on `main` (history rewrite belongs only on a private
 * worktree branch; `pr-flow` force-pushes with `--force-with-lease`).
 */
export function injectBootstrapOverrides(opts: InjectOptions): InjectResult {
  const cwd = opts.cwd;
  const range = opts.range ?? 'origin/main..HEAD';
  const reason = opts.reason ?? BOOTSTRAP_REASON;
  const git = opts.runGit ?? ((args) => execFileSync('git', args, { cwd, encoding: 'utf8' }));

  const gate = resolveIntroducedGate(cwd, opts.slug);
  if (!gate) return { gate: null, injected: [] };

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch === 'main') {
    throw new Error('bootstrap-immunity: refusing to rewrite history on main');
  }

  const trailer = gate.entry.overrideTrailer;
  const shas = git(['rev-list', range])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Plan: only commits that don't already carry the trailer (idempotence).
  const toInject = shas.filter((sha) => {
    const msg = git(['show', '-s', '--format=%B', sha]);
    return !new RegExp(`^${trailer}:`, 'm').test(msg);
  });
  if (toInject.length === 0) return { gate, injected: [] };

  // Message-only rewrite over the range. `interpret-trailers --if-exists doNothing`
  // makes the filter itself idempotent per-commit; trees are preserved.
  const msgFilter = `git interpret-trailers --if-exists doNothing --trailer "${trailer}: ${reason}"`;
  execFileSync('git', ['filter-branch', '-f', '--msg-filter', msgFilter, range], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Breadcrumb into the gate's audit ledger (same format validateTrailer writes).
  const logPath = join(cwd, '.noldor', gate.entry.log);
  try {
    for (const _sha of toInject)
      appendFileSync(logPath, `${new Date().toISOString()}\t${reason}\n`);
  } catch {
    /* log-write failure must not fail the injection */
  }

  return { gate, injected: toInject };
}
