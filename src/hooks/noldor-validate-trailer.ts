// scripts/hooks/noldor-validate-trailer.ts
// commit-msg stage: validates Noldor-* trailers in the commit message.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parseTrailers, detectDroppedTrailers } from '../core/trailers';
import { ARCHIVE_DIR } from '../core/design-artifact-names';
import { renameDestExists, toRepoRelative } from '../core/branch-added';
import { loadDocRoots } from '../core/doc-roots';
import { PATHS, sessionMarkerExists } from '../core/session';
import { isMicroChoreAllowed, isReleaseSweepAllowed } from '../core/allowlist';
import { rolloutMarkerExists, isPostRollout } from '../core/rollout-marker';
import { loadConsumerConfig } from '../core/consumer-config';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface ValidateOptions {
  message: string;
  cwd: string;
}

const RELEASE_SUBJECT_RE = /^chore\(release\): v\d+\.\d+\.\d+$/;

function getReleasePackageFiles(cwd: string): Set<string> {
  return new Set(loadConsumerConfig(cwd).lockstepPackages);
}

function getStagedPaths(cwd: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' });
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

function isReleaseAutomationFile(file: string, cwd: string): boolean {
  return (
    file === 'CHANGELOG.md' ||
    file === 'docs/release-notes.md' ||
    // sdd-report regen is folded into the release commit when only the
    // review-skip count line changed (see release/index.ts).
    file === 'docs/sdd-report.md' ||
    getReleasePackageFiles(cwd).has(file) ||
    (file.startsWith('docs/features/') && file.endsWith('.md')) ||
    (file.startsWith('docs/noldor/') && file.endsWith('.md'))
  );
}

function validateReleaseAutomation(opts: ValidateOptions): ValidationResult {
  const subject = opts.message.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!RELEASE_SUBJECT_RE.test(subject)) {
    return {
      ok: false,
      reason: 'release-automation requires release subject: chore(release): vX.Y.Z',
    };
  }

  const staged = getStagedPaths(opts.cwd);
  const disallowed = staged.filter((file) => !isReleaseAutomationFile(file, opts.cwd));
  if (staged.length === 0 || disallowed.length > 0) {
    return {
      ok: false,
      reason: `release-automation files must be release outputs only: ${disallowed.join(', ')}`,
    };
  }

  return { ok: true };
}

/**
 * Reason for a commit message that carries no `Noldor-Path` trailer.
 *
 * The dominant cause is a hand-driven fast-track/sweep in a worktree where
 * `.noldor/session.json` was never scaffolded: `noldor-inject-trailers` silently
 * no-ops without a marker, so the first visible failure is this trailer check —
 * which, said bare, points at the commit message rather than at the missing
 * marker. Name the marker when it is absent; when one exists the marker is not
 * the culprit, so keep the trailer-centric message and point at the injection
 * hook instead.
 */
function missingPathReason(cwd: string): string {
  if (!sessionMarkerExists(cwd)) {
    return (
      'no .noldor/session.json — did you skip the gate scaffold? ' +
      'Run /noldor-gate (or write the session marker) before committing.'
    );
  }
  return (
    'Missing Noldor-Path trailer — .noldor/session.json exists, so the ' +
    'prepare-commit-msg trailer injection did not run (lefthook hooks installed?).'
  );
}

export function validateTrailer(opts: ValidateOptions): ValidationResult {
  // Soft mode: if no rollout marker file or HEAD is pre-rollout, skip enforcement.
  if (!rolloutMarkerExists(opts.cwd)) return { ok: true };

  let head: string;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: opts.cwd, encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout.trim()) return { ok: true }; // empty repo
    head = r.stdout.trim();
  } catch {
    return { ok: true };
  }
  if (!isPostRollout(head, opts.cwd)) return { ok: true };

  const t = parseTrailers(opts.message);

  // A value wrapped to an unindented line makes git drop the WHOLE trailer
  // block (v0.4.0: two Noldor-Path-Override values vanished this way and the
  // override never took effect). Reject before any branch reads `t`, so the
  // operator fixes the message instead of the gate acting on missing trailers.
  const dropped = detectDroppedTrailers(opts.message, t);
  if (dropped.length > 0) {
    return {
      ok: false,
      reason: `trailer(s) invisible to git interpret-trailers — a value wrapped to an unindented line invalidates the whole trailer block: ${dropped.join(', ')}. Keep each value on a single line, or indent continuation lines with whitespace.`,
    };
  }

  if (t['Noldor-Path-Override']) {
    const logPath = join(opts.cwd, '.noldor', 'overrides.log');
    try {
      appendFileSync(logPath, `${new Date().toISOString()}\t${t['Noldor-Path-Override']}\n`);
    } catch {
      // Ignore logging errors — the override itself is valid
    }
    return { ok: true };
  }

  if (t['Noldor-CR-Override-Codex'] !== undefined) {
    const reason = t['Noldor-CR-Override-Codex'].trim();
    if (reason === '') {
      return { ok: false, reason: 'Noldor-CR-Override-Codex: empty reason rejected' };
    }
    const logPath = join(opts.cwd, '.noldor', 'cr-overrides.log');
    try {
      appendFileSync(logPath, `${new Date().toISOString()}\t${reason}\n`);
    } catch {
      // log-write failures should not block the override itself
    }
    return { ok: true };
  }

  const path = t['Noldor-Path'];
  if (!path) return { ok: false, reason: missingPathReason(opts.cwd) };
  if (path === 'release-automation') return validateReleaseAutomation(opts);
  if (!PATHS.includes(path as (typeof PATHS)[number])) {
    return { ok: false, reason: `Unknown Noldor-Path: ${path}` };
  }

  if (path === 'micro-chore') {
    // Re-validate staged diff vs allowlist as defense-in-depth: pre-commit may have been bypassed,
    // and a hand-typed trailer should not be able to launder a code change as micro-chore.
    const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
      cwd: opts.cwd,
      encoding: 'utf8',
    });
    const staged = (r.stdout ?? '').split('\n').filter(Boolean);
    if (!isMicroChoreAllowed(staged)) {
      return { ok: false, reason: `micro-chore diff escapes allowlist: ${staged.join(', ')}` };
    }
    return { ok: true };
  }

  if (path === 'release-sweep') {
    // Mirrors the micro-chore branch: re-validate staged diff against the
    // release-sweep allowlist as defense-in-depth.
    const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
      cwd: opts.cwd,
      encoding: 'utf8',
    });
    const staged = (r.stdout ?? '').split('\n').filter(Boolean);
    if (!isReleaseSweepAllowed(staged)) {
      return { ok: false, reason: `release-sweep diff escapes allowlist: ${staged.join(', ')}` };
    }
    return { ok: true };
  }

  // Note: Noldor-Reviewed is NOT required at commit-msg. Interim implementation commits
  // ship without a review trailer; review happens at end-of-flow and amends the tip commit.
  // The pre-push hook (`enforce-review-receipt`) is the authoritative gate for review presence
  // and tree-hash freshness.

  if (path === 'fast-track') return { ok: true };

  // specs-only-* / full-*
  const slug = t['Noldor-FD'];
  if (!slug) return { ok: false, reason: 'Missing Noldor-FD trailer (paths 3–6)' };

  // FDs live in the consumer's feature-MD directory. Resolved directly rather
  // than via loadDocRoots(): unlike specs/plans, `docs/features/` was never
  // renamed, so there is no transition alias to honour here.
  const fdPath = join(opts.cwd, 'docs', 'features', `${slug}.md`);
  if (!existsSync(fdPath)) return { ok: false, reason: `FD does not exist: ${slug}` };

  const fd = matter(readFileSync(fdPath, 'utf8'));
  const tier = (fd.data['noldor-tier'] as string) ?? null;
  const isPhaseRevert = t['Noldor-Phase-Revert'] === '1';
  /** Specs dir, resolved once (honours the 1.0.0 `docs/superpowers` alias). */
  const specsDirAbs = loadDocRoots(opts.cwd).specs;

  /**
   * Repo-relative specs dir for user-facing messages. Falls back to the absolute
   * path if git cannot report the prefix — a label must never fail a commit.
   */
  const specsDirLabel = (): string => {
    try {
      return toRepoRelative(specsDirAbs, opts.cwd);
    } catch {
      return specsDirAbs;
    }
  };

  /**
   * Does a spec matching `suffix` exist for this session?
   *
   * The live directory always counts. An archived spec counts only when THIS
   * BRANCH renamed it there — `/noldor-gate` Step 4 runs `noldor design archive`
   * immediately before the phase-flip commit, so that commit (and every
   * code-stage CR fix after it) sees the spec already under `archive/` and would
   * otherwise be unlandable on every `specs-only-*` / `full-attach` session. A
   * fresh session on a slug some earlier branch archived still needs a live spec,
   * and a file merely *added* into `archive/` never counts — see
   * {@link renameDestExists}.
   */
  function specExists(cwd: string, suffix: string): { found: boolean; unverifiable?: string } {
    if (existsSync(specsDirAbs) && readdirSync(specsDirAbs).some((f) => f.endsWith(suffix))) {
      return { found: true };
    }
    const archiveDir = join(specsDirAbs, ARCHIVE_DIR);
    if (!existsSync(archiveDir)) return { found: false };
    if (!readdirSync(archiveDir).some((f) => f.endsWith(suffix))) return { found: false };
    // An archived candidate exists; only a rename by this branch makes it count.
    // A git failure here is NOT "no rename" — fail closed, but say which it was.
    try {
      const destDirRel = toRepoRelative(archiveDir, cwd);
      return { found: renameDestExists({ cwd, destDirRel, suffix }) };
    } catch (error) {
      return {
        found: false,
        unverifiable: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Gate reason for a missing spec, naming a verification failure when that is the real cause. */
  function missingSpecReason(
    label: string,
    suffix: string,
    result: { unverifiable?: string },
  ): string {
    const base = `${label} requires a spec file at ${specsDirLabel()}/<date>${suffix}`;
    return result.unverifiable === undefined
      ? base
      : `${base} — an archived copy exists but the archival rename could not be verified: ${result.unverifiable}`;
  }

  if (path === 'specs-only-new' || path === 'full-new') {
    const expected = path === 'full-new' ? 'full' : 'specs-only';
    if (tier !== expected) {
      return {
        ok: false,
        reason: `FD ${slug} has tier ${tier ?? '<unset>'}, expected ${expected}`,
      };
    }
    if (path === 'full-new' && !fd.data?.links?.spec) {
      return { ok: false, reason: `FD ${slug} requires links.spec for full-new path` };
    }
    if (path === 'specs-only-new') {
      if (isPhaseRevert) return { ok: true };
      const expectedSuffix = `-${slug}-design.md`;
      const found = specExists(opts.cwd, expectedSuffix);
      if (!found.found) {
        return { ok: false, reason: missingSpecReason('specs-only-new', expectedSuffix, found) };
      }
    }
    return { ok: true };
  }

  if (path === 'specs-only-attach' || path === 'full-attach') {
    if (isPhaseRevert) return { ok: true };
    const enhancement = t['Noldor-Enhancement'];
    if (!enhancement) {
      return {
        ok: false,
        reason: `${path} requires Noldor-Enhancement trailer (session marker's enhancement field). Re-run /noldor-gate to scaffold the marker.`,
      };
    }
    const expectedSuffix = `-${slug}-${enhancement}-design.md`;
    const found = specExists(opts.cwd, expectedSuffix);
    if (!found.found) {
      return { ok: false, reason: missingSpecReason(path, expectedSuffix, found) };
    }
  }

  return { ok: true };
}

// CLI entry: invoked by lefthook commit-msg with the message file path as argv[2]
if (import.meta.url === `file://${process.argv[1]}`) {
  const msgFile = process.argv[2];
  const message = readFileSync(msgFile, 'utf8');
  const result = validateTrailer({ message, cwd: process.cwd() });
  if (!result.ok) {
    console.error(`Noldor gate: ${result.reason}`);
    process.exit(1);
  }
}
