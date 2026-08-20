// @fd: root-readme-content-validator
// CLI wrapper for the README content checks. Advisory or blocking is the
// CALLER's choice: the pre-push job neutralizes the exit code with `|| true`,
// and release preflight renders the row at `warn`. This binary only reports.

import { runIfDirect } from '../core/cli-entry.js';
import { checkReadme } from '../docs/readme-content.js';

export async function main(cwd: string = process.cwd()): Promise<number> {
  const report = await checkReadme(cwd);
  if (report.status === 'absent') {
    console.log('readme: skipped (no readable README.md)');
    for (const note of report.notes) console.log(`note: ${note}`);
    return 0;
  }
  for (const finding of report.findings) console.log(finding.message);
  for (const note of report.notes) console.log(`note: ${note}`);
  console.log(`readme: ${report.findings.length} finding(s)`);
  return report.findings.length > 0 ? 1 : 0;
}

runIfDirect('check-readme', 'checks readme', async () => main());
