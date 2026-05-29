// scripts/hooks/noldor-validate-trailer.ts
// commit-msg stage: validates Noldor-* trailers in the commit message.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parseTrailers } from '../core/trailers';
import { PATHS } from '../core/session';
import { isMicroChoreAllowed, isReleaseSweepAllowed } from '../core/allowlist';
import { readRolloutMarker, isPostRollout } from '../core/rollout-marker';
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

export function validateTrailer(opts: ValidateOptions): ValidationResult {
  // Soft mode: if no rollout marker or HEAD is pre-rollout, skip enforcement.
  const marker = readRolloutMarker(opts.cwd);
  if (!marker) return { ok: true };

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
  if (!path) return { ok: false, reason: 'Missing Noldor-Path trailer' };
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

  // FDs may live in Charuy product docs (docs/features/) OR framework docs
  // (packages/noldor/docs/features/) after the framework-doc-extraction
  // Phase B migration. Try product first (most consumers), fall back to
  // framework. Phase C eventually retargets every consumer through
  // loadDocRoots(), but the hook runs pre-commit so a self-contained
  // two-path lookup keeps the bootstrap simple.
  const productFdPath = join(opts.cwd, 'docs', 'features', `${slug}.md`);
  const frameworkFdPath = join(opts.cwd, 'packages', 'noldor', 'docs', 'features', `${slug}.md`);
  const fdPath = existsSync(productFdPath)
    ? productFdPath
    : existsSync(frameworkFdPath)
      ? frameworkFdPath
      : null;
  if (fdPath === null) return { ok: false, reason: `FD does not exist: ${slug}` };

  const fd = matter(readFileSync(fdPath, 'utf8'));
  const tier = (fd.data['noldor-tier'] as string) ?? null;
  const isPhaseRevert = t['Noldor-Phase-Revert'] === '1';

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
      const specsDir = join(opts.cwd, 'docs', 'superpowers', 'specs');
      const expectedSuffix = `-${slug}-design.md`;
      if (!existsSync(specsDir)) {
        return {
          ok: false,
          reason: `specs-only-new requires a spec file at docs/superpowers/specs/<date>${expectedSuffix}`,
        };
      }
      const files = readdirSync(specsDir).filter((f) => f.endsWith(expectedSuffix));
      if (files.length === 0) {
        return {
          ok: false,
          reason: `specs-only-new requires a spec file at docs/superpowers/specs/<date>${expectedSuffix}`,
        };
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
        reason: `${path} requires Noldor-Enhancement trailer (session marker's enhancement field). Re-run /gate to scaffold the marker.`,
      };
    }
    // Spec may live in Charuy product specs OR framework specs after Phase B
    // migration. Check both locations.
    const expectedSuffix = `-${slug}-${enhancement}-design.md`;
    const productSpecsDir = join(opts.cwd, 'docs', 'superpowers', 'specs');
    const frameworkSpecsDir = join(opts.cwd, 'packages', 'noldor', 'docs', 'superpowers', 'specs');
    const candidates: string[] = [];
    if (existsSync(productSpecsDir)) {
      candidates.push(...readdirSync(productSpecsDir).filter((f) => f.endsWith(expectedSuffix)));
    }
    if (existsSync(frameworkSpecsDir)) {
      candidates.push(...readdirSync(frameworkSpecsDir).filter((f) => f.endsWith(expectedSuffix)));
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `${path} requires a spec file at docs/superpowers/specs/<date>${expectedSuffix} or packages/noldor/docs/superpowers/specs/<date>${expectedSuffix}`,
      };
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
