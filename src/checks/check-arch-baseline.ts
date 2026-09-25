// @fd: architecture-design-phase
// `noldor checks arch-baseline` — the architecture baseline held to the code.
// Exit 0 when there is no baseline (absent) or it is clean, 1 on any finding;
// advisories print and never change the exit code. Gate Step 4 runs it
// advisorily; release preflight blocks on it (the `arch-baseline` row).

import { runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { checkArchBaseline, type ArchBaselineReport } from '../design/arch-baseline.js';

export function row(kind: string, view: string, subject: string, message: string): string {
  return `  ${kind.padEnd(17)} ${view.padEnd(11)} ${subject} — ${message}`;
}

export function renderReport(report: ArchBaselineReport): string {
  if (report.status === 'absent')
    return `arch-baseline: absent — no ${ARCH_BASELINE_PATH}, nothing to check`;
  const lines = [
    report.status === 'ok'
      ? `arch-baseline: ok — ${ARCH_BASELINE_PATH} matches the code`
      : `arch-baseline: ${report.findings.length} finding(s) in ${ARCH_BASELINE_PATH}`,
    ...report.findings.map((f) => row(f.kind, f.view, f.subject, f.message)),
  ];
  if (report.advisories.length > 0) {
    lines.push(`advisory (${report.advisories.length}, exit unaffected):`);
    lines.push(...report.advisories.map((a) => row(a.kind, a.view, a.subject, a.message)));
  }
  return lines.join('\n');
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  const report = await checkArchBaseline(cwd);
  console.log(renderReport(report));
  return report.status === 'incomplete' ? 1 : 0;
}

runIfDirect('check-arch-baseline', 'checks arch-baseline', async () => main());
