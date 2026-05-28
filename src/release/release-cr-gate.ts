import { execFileSync } from 'node:child_process';
import { isMicroChoreAllowed } from '../core/allowlist.js';

export interface CrGateOffender {
  sha: string;
  missing: Array<'claude' | 'codex'>;
}

export interface CrGateResult {
  ok: boolean;
  offenders: CrGateOffender[];
  reason?: string;
}

export interface CrGateInput {
  from: string;
  to: string;
  cwd: string;
  runGit?: (args: string[]) => string;
}

export function checkCrGate(input: CrGateInput): CrGateResult {
  const git =
    input.runGit ?? ((args) => execFileSync('git', args, { cwd: input.cwd, encoding: 'utf8' }));

  const shas = git(['rev-list', `${input.from}..${input.to}`])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const offenders: CrGateOffender[] = [];

  for (const sha of shas) {
    const message = git(['show', '-s', '--format=%B', sha]);
    const t = parseTrailers(message);

    if (t['Noldor-Path'] === 'release-automation') continue;

    const paths = git(['show', '--name-only', '--format=', sha])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (paths.length === 0) continue;
    if (isMicroChoreAllowed(paths)) continue;

    const tree = git(['rev-parse', `${sha}^{tree}`]).trim();
    const missing: Array<'claude' | 'codex'> = [];

    const claudeReviewed = t['Noldor-Reviewed'];
    const claudeOverride = t['Noldor-Path-Override'];
    const claudeOk =
      (claudeReviewed !== undefined && claudeReviewed === tree) ||
      (claudeOverride !== undefined && claudeOverride.trim() !== '');
    if (!claudeOk) missing.push('claude');

    const codexReviewed = t['Noldor-Reviewed-Codex'];
    const codexOverride = t['Noldor-CR-Override-Codex'];
    const codexOk =
      (codexReviewed !== undefined && codexReviewed === tree) ||
      (codexOverride !== undefined && codexOverride.trim() !== '');
    if (!codexOk) missing.push('codex');

    if (missing.length > 0) offenders.push({ sha, missing });
  }

  if (offenders.length === 0) return { ok: true, offenders: [] };
  return { ok: false, offenders, reason: formatReason(offenders) };
}

function formatReason(offenders: CrGateOffender[]): string {
  return offenders.map((o) => `  ${o.sha}: missing ${o.missing.join(' + ')}`).join('\n');
}

const TRAILER_RE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/;

function parseTrailers(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = TRAILER_RE.exec(lines[i]);
    if (m) {
      out[m[1]] = m[2].trim();
      continue;
    }
    if (lines[i].trim() === '') continue;
    if (Object.keys(out).length > 0) break;
  }
  return out;
}
