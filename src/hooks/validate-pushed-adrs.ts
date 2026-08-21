// @fd: architecture-decision-record-surface
import { parseAdrFrontmatter } from '../docs/adr-schema.js';
import { parseRefLines, type GitRunner } from './pre-push-range.js';

/** Git's all-zero object ID, matched by shape so SHA-256 repos work too. */
const ZERO_SHA_RE = /^0+$/;

/** One blocked mutation of a published record. */
export interface AdrViolation {
  readonly file: string;
  /** What the diff did: deletion, rename, or an illegal modification. */
  readonly change: 'deleted' | 'renamed' | 'modified';
  readonly detail: string;
}

export type AdrScanResult =
  | { kind: 'ok' }
  | { kind: 'violations'; violations: AdrViolation[] }
  | { kind: 'repair'; violations: AdrViolation[] }
  | { kind: 'infra'; message: string };

/**
 * Append-only gate for `docs/adr/` at the push seam.
 *
 * Per pushed ref the checked range is `<remote sha>..<local sha>`; a zero
 * remote sha (new branch) falls back to the merge-base with `origin/main` —
 * replayable author-side via the gate preflight recipe. Runs on every allowed
 * push regardless of remote.
 *
 * Allowed changes: adding a record, and the supersede flip — a modification
 * whose base `status` was `accepted`, whose body is byte-identical, and whose
 * frontmatter delta is exactly `status → superseded` plus a `superseded-by`
 * pointer. Everything else — deletions, renames, body edits, edits to an
 * already-superseded record, any other frontmatter change — is blocked.
 *
 * `NOLDOR_ADR_REPAIR=1` converts the block into `kind: 'repair'`: the push
 * proceeds and the caller writes a receipt line, the same audited-bypass idiom
 * as `NOLDOR_RELEASE_PUSH`. It is the legal path for the repairs append-only
 * cannot express (renumbering a post-merge duplicate, un-wedging a chain).
 */
export function validatePushedAdrs(opts: {
  git: GitRunner;
  refLines: readonly string[];
  env: Record<string, string | undefined>;
}): AdrScanResult {
  const parsed = parseRefLines(opts.refLines);
  if ('error' in parsed) return { kind: 'infra', message: parsed.error };

  const violations: AdrViolation[] = [];
  const seen = new Set<string>();

  for (const update of parsed) {
    // A branch deletion pushes a zero local sha: nothing to scan.
    if (ZERO_SHA_RE.test(update.localSha)) continue;

    const base = resolveBase(opts.git, update.remoteSha, update.localSha);
    if (base.kind === 'infra') return base;
    // No base to compare against (first push of the repo): every record is new.
    if (base.kind === 'none') continue;

    const diff = opts.git.text([
      'diff',
      '--name-status',
      '--no-renames',
      base.sha,
      update.localSha,
      '--',
      'docs/adr/',
    ]);
    if (diff.status !== 0) {
      return {
        kind: 'infra',
        message: `git diff failed for ${update.localRef}: ${diff.stderr.trim()}`,
      };
    }

    for (const line of diff.stdout.split('\n')) {
      if (line.trim().length === 0) continue;
      const [status, file] = line.split('\t');
      if (!file || !file.endsWith('.md') || seen.has(file)) continue;

      if (status === 'A') continue;
      if (status === 'D') {
        seen.add(file);
        violations.push({
          file,
          change: 'deleted',
          detail: `${file} deleted — records are permanent; supersede instead`,
        });
        continue;
      }
      if (status !== 'M') {
        seen.add(file);
        violations.push({
          file,
          change: 'renamed',
          detail: `${file} ${status}-changed — a record is never renamed once published`,
        });
        continue;
      }

      const verdict = judgeModification(opts.git, base.sha, update.localSha, file);
      if (verdict.kind === 'infra') return verdict;
      if (verdict.kind === 'blocked') {
        seen.add(file);
        violations.push({ file, change: 'modified', detail: verdict.detail });
      }
    }
  }

  if (violations.length === 0) return { kind: 'ok' };
  if (opts.env.NOLDOR_ADR_REPAIR === '1') return { kind: 'repair', violations };
  return { kind: 'violations', violations };
}

type BaseResolution =
  | { kind: 'sha'; sha: string }
  | { kind: 'none' }
  | { kind: 'infra'; message: string };

/** Remote tip when it exists, else merge-base with origin/main, else nothing. */
function resolveBase(git: GitRunner, remoteSha: string, localSha: string): BaseResolution {
  if (!ZERO_SHA_RE.test(remoteSha)) return { kind: 'sha', sha: remoteSha };
  const mergeBase = git.text(['merge-base', 'origin/main', localSha]);
  // No origin/main (fresh repo, first push): nothing published yet to protect.
  if (mergeBase.status !== 0) return { kind: 'none' };
  return { kind: 'sha', sha: mergeBase.stdout.trim() };
}

type ModificationVerdict =
  | { kind: 'allowed' }
  | { kind: 'blocked'; detail: string }
  | { kind: 'infra'; message: string };

/** The one legal in-place mutation: the supersede flip, body untouched. */
function judgeModification(
  git: GitRunner,
  baseSha: string,
  tipSha: string,
  file: string,
): ModificationVerdict {
  const baseBlob = git.text(['show', `${baseSha}:${file}`]);
  const tipBlob = git.text(['show', `${tipSha}:${file}`]);
  if (baseBlob.status !== 0 || tipBlob.status !== 0) {
    return {
      kind: 'infra',
      message: `cannot read ${file} blobs: ${(baseBlob.status === 0 ? tipBlob : baseBlob).stderr.trim()}`,
    };
  }

  const base = parseAdrFrontmatter(baseBlob.stdout);
  const tip = parseAdrFrontmatter(tipBlob.stdout);
  if (!base.success) {
    return {
      kind: 'blocked',
      detail: `${file}: base version does not parse — repair via override`,
    };
  }
  if (!tip.success) {
    return {
      kind: 'blocked',
      detail: `${file}: pushed version does not parse: ${tip.errors.join('; ')}`,
    };
  }
  if (base.data.status !== 'accepted') {
    return { kind: 'blocked', detail: `${file}: already-superseded records are immutable` };
  }
  if (base.body !== tip.body) {
    return {
      kind: 'blocked',
      detail: `${file}: body of an accepted record changed — supersede instead`,
    };
  }
  const flipOk =
    tip.data.status === 'superseded' &&
    tip.data['superseded-by'] !== undefined &&
    base.data['superseded-by'] === undefined &&
    tip.data.date === base.data.date &&
    tip.data.supersedes === base.data.supersedes;
  if (!flipOk) {
    return {
      kind: 'blocked',
      detail: `${file}: only the supersede flip (status → superseded, superseded-by added) may mutate an accepted record`,
    };
  }
  return { kind: 'allowed' };
}

/** Render violations for the hook's stderr, with the remedy named. */
export function renderAdrViolations(violations: readonly AdrViolation[]): string {
  const lines = violations.map((v) => `  ${v.detail}`);
  return [
    'Push blocked: docs/adr/ records are append-only.',
    ...lines,
    '',
    'Remedies:',
    '  supersede a decision: noldor adr new <slug> --supersedes NNNN',
    '  audited repair push (renumber, chain fix): NOLDOR_ADR_REPAIR=1 git push …',
  ].join('\n');
}
