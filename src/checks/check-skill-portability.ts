// @fd: skill-vs-code-drift-detector
// Blocking half of the shipped-skill portability rule (Q-0239). The detector in
// `src/garden/detectors/skill-code-drift.ts` finds the same rows, but garden is
// advisory by construction — its findings are `action: 'investigate'` and are
// read at gardening time. That is how four repo-only command blocks survived in
// `noldor-release-sweep` until an operator hit them mid-release of a consumer.
// A skill is shipped source: the gate for it belongs on the commit that writes
// it, not on a pass somebody remembers to run.
//
// Only `non-portable-script` blocks. The detector's other three classes stay
// advisory — a missing path or a renamed subcommand is rot the author can see
// from the repo, while a non-portable command is invisible here by definition:
// it works in every run of every test in this repo.
import { detectSkillCodeDrift, NON_PORTABLE_SCRIPT } from '../garden/detectors/skill-code-drift.js';
import { runIfDirect } from '../core/cli-entry.js';

/**
 * Report every shipped-skill command block that names a script this repo
 * defines but the framework does not install.
 *
 * @param cwd - Repository root.
 * @returns 0 when every command block runs in a consumer, 1 otherwise.
 */
export async function main(cwd: string = process.cwd()): Promise<number> {
  const findings = (await detectSkillCodeDrift(cwd)).filter((f) => f.kind === NON_PORTABLE_SCRIPT);
  if (findings.length === 0) {
    console.log('skill-portability: every shipped-skill command block runs in a consumer');
    return 0;
  }
  console.error(
    `✗ ${findings.length} shipped-skill command block(s) name a script a consumer does not have:`,
  );
  for (const f of findings) console.error(`    ${f.skillPath}:${f.line} — ${f.detail}`);
  return 1;
}

runIfDirect('check-skill-portability', 'checks skill-portability', async () => main());
