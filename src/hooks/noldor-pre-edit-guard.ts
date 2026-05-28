// scripts/hooks/noldor-pre-edit-guard.ts
import { readSession } from '../core/session';
import { readRolloutMarker } from '../core/rollout-marker';

export interface PreEditResult {
  ok: boolean;
  reason?: string;
}

export function runPreEditGuard(opts: { cwd: string; filePath?: string }): PreEditResult {
  if (!readRolloutMarker(opts.cwd)) return { ok: true }; // soft mode pre-rollout

  const session = readSession(opts.cwd);
  if (session) return { ok: true }; // gate already engaged

  const target = opts.filePath ?? '<unknown>';
  return {
    ok: false,
    reason: `edits to "${target}" require /gate. Run /gate before editing.`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runPreEditGuard({ cwd: process.cwd(), filePath: process.argv[2] });
  if (!result.ok) {
    console.error(`Noldor gate: ${result.reason}`);
    process.exit(1);
  }
}
