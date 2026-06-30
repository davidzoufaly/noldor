import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isBootstrapReason } from '../../cr/gate-registry.js';

export type Finding =
  | { kind: 'frequency'; count: number; windowDays: number }
  | { kind: 'short-reason'; reason: string; ts: string }
  | { kind: 'repeated'; reason: string; count: number };

export interface AuditInput {
  cwd: string;
  windowDays?: number;
  freqThreshold?: number;
  minReasonLength?: number;
}

export function auditCodexCrOverrides(input: AuditInput): Finding[] {
  const path = join(input.cwd, '.noldor', 'cr-overrides.log');
  if (!existsSync(path)) return [];
  const windowDays = input.windowDays ?? 14;
  const freqThreshold = input.freqThreshold ?? 3;
  const minLen = input.minReasonLength ?? 10;
  const cutoff = Date.now() - windowDays * 86_400_000;

  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ts, ...rest] = line.split('\t');
      return { ts, reason: rest.join('\t') };
    });

  const findings: Finding[] = [];
  // Exclude legitimate bootstrap-immunity overrides: a gate-introducing feature
  // stamps its whole branch (could be 20+ commits), which would always trip the
  // frequency/repeated counters. The dedicated bootstrap-override-audit detector
  // audits their legitimacy (backing introduces-gate FD) instead.
  const recent = rows.filter((r) => Date.parse(r.ts) >= cutoff && !isBootstrapReason(r.reason));

  if (recent.length >= freqThreshold) {
    findings.push({ kind: 'frequency', count: recent.length, windowDays });
  }
  for (const r of recent) {
    if (r.reason.trim().length < minLen) {
      findings.push({ kind: 'short-reason', reason: r.reason, ts: r.ts });
    }
  }
  const counts = new Map<string, number>();
  for (const r of recent) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  for (const [reason, count] of counts) {
    if (count >= freqThreshold && reason.trim().length >= minLen) {
      findings.push({ kind: 'repeated', reason, count });
    }
  }
  return findings;
}
