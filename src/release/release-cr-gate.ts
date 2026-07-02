import { execFileSync } from 'node:child_process';
import { isMicroChoreAllowed } from '../core/allowlist.js';

export interface CrGateOffender {
  sha: string;
  subject: string;
}

/**
 * One configured per-SHA acknowledgment (`release.crGateExemptCommits` in
 * `.noldor/config.json`, schema-validated there — kept structural here so this
 * module needs no `cr/config` import). `sha` is a full-SHA prefix, min 7 hex
 * chars enforced at the schema layer.
 */
export interface CrGateExemption {
  sha: string;
  reason: string;
}

/**
 * A commit waved through by a configured exemption — reported (not silently
 * dropped) so the release log prints what was skipped and why.
 */
export interface CrGateExemptedCommit {
  sha: string;
  subject: string;
  reason: string;
}

export interface CrGateResult {
  ok: boolean;
  offenders: CrGateOffender[];
  /** Commits skipped via {@link CrGateInput.exemptions}; empty when none applied. */
  exempted: CrGateExemptedCommit[];
  reason?: string;
}

export interface CrGateInput {
  from: string;
  to: string;
  cwd: string;
  runGit?: (args: string[]) => string;
  /** Committed per-SHA acknowledgments (`release.crGateExemptCommits`). */
  exemptions?: ReadonlyArray<CrGateExemption>;
}

/**
 * Release-time audit that every commit on main since the previous tag went
 * through the gate's review stage (or carries an explicit override).
 *
 * Main is squash-merge only, so the PR-branch commit messages — including
 * their `Noldor-*` trailers — land embedded in the squash commit BODY, not in
 * its final trailer block (GitHub appends `Co-authored-by` after a `-----`
 * divider, which is all `git interpret-trailers` sees). The gate therefore
 * scans the WHOLE message for trailer-shaped `Noldor-*` lines rather than
 * parsing the final block only.
 *
 * A commit passes when any embedded line shows review evidence:
 *   - a review receipt: `Noldor-Reviewed`, `Noldor-Reviewed-Subagent`, or
 *     `Noldor-Reviewed-Codex` (tree-hash freshness is enforced at pre-push on
 *     the branch tip; the squash commit's tree can legitimately differ, so no
 *     tree comparison happens here — this layer audits that a review happened)
 *   - an override: `Noldor-Path-Override` or `Noldor-CR-Override-Codex` with
 *     a non-empty reason
 * or when the commit is exempt by construction:
 *   - `Noldor-Path: release-automation` / `release-sweep` (allowlist-guarded
 *     no-review paths)
 *   - a diff fully inside the micro-chore allowlist (doc/policy-only)
 *   - a configured per-SHA exemption (`input.exemptions`, sourced from
 *     `release.crGateExemptCommits`) — skipped AND reported in `exempted`
 */
export function checkCrGate(input: CrGateInput): CrGateResult {
  const git =
    input.runGit ?? ((args) => execFileSync('git', args, { cwd: input.cwd, encoding: 'utf8' }));

  const shas = git(['rev-list', `${input.from}..${input.to}`])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const offenders: CrGateOffender[] = [];
  const exemptions = input.exemptions ?? [];
  const exempted: CrGateExemptedCommit[] = [];

  for (const sha of shas) {
    const message = git(['show', '-s', '--format=%B', sha]);
    const t = collectNoldorTrailerLines(message);

    // Exempt only when EVERY embedded Noldor-Path is an exempt path — a mixed
    // squash (one sweep-pathed commit among feature commits) must not launder
    // the feature commits past the review check.
    const paths = t.get('Noldor-Path') ?? [];
    const EXEMPT_PATHS = new Set(['release-automation', 'release-sweep']);
    if (paths.length > 0 && paths.every((p) => EXEMPT_PATHS.has(p))) continue;

    // Per-SHA acknowledgment from committed config: a commit whose full SHA
    // starts with an exemption's prefix is waved through — and collected, so
    // the release log prints what was skipped and why. This replaces the
    // whole-check RELEASE_SKIP_CR_GATE=1 skip for known historical offenders.
    const exemption = exemptions.find((e) => sha.startsWith(e.sha));
    if (exemption) {
      const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
      exempted.push({ sha, subject, reason: exemption.reason });
      continue;
    }

    const files = git(['show', '--name-only', '--format=', sha])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (files.length === 0) continue;
    if (isMicroChoreAllowed(files)) continue;

    const reviewed = REVIEW_RECEIPT_KEYS.some((k) => hasNonEmpty(t, k));
    const overridden = OVERRIDE_KEYS.some((k) => hasNonEmpty(t, k));
    if (reviewed || overridden) continue;

    const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
    offenders.push({ sha, subject });
  }

  if (offenders.length === 0) return { ok: true, offenders: [], exempted };
  return { ok: false, offenders, exempted, reason: formatReason(offenders) };
}

const REVIEW_RECEIPT_KEYS = [
  'Noldor-Reviewed',
  'Noldor-Reviewed-Subagent',
  'Noldor-Reviewed-Codex',
] as const;

const OVERRIDE_KEYS = ['Noldor-Path-Override', 'Noldor-CR-Override-Codex'] as const;

function hasNonEmpty(t: Map<string, string[]>, key: string): boolean {
  return (t.get(key) ?? []).some((v) => v.trim() !== '');
}

function formatReason(offenders: CrGateOffender[]): string {
  return offenders
    .map((o) => `  ${o.sha.slice(0, 10)}: no review receipt or override trailer — ${o.subject}`)
    .join('\n');
}

const NOLDOR_TRAILER_RE = /^(Noldor-[A-Za-z0-9-]+):[ \t]*(.*)$/;

/**
 * Collect every `Noldor-*: value` line anywhere in the message, keyed by
 * trailer name with all occurrences preserved (a squash body carries one set
 * per PR-branch commit).
 */
function collectNoldorTrailerLines(message: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of message.replace(/\r\n/g, '\n').split('\n')) {
    const m = NOLDOR_TRAILER_RE.exec(line.trim());
    if (!m) continue;
    const list = out.get(m[1]) ?? [];
    list.push(m[2].trim());
    out.set(m[1], list);
  }
  return out;
}
