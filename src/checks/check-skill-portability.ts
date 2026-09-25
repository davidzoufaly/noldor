// @fd: skill-vs-code-drift-detector
// Blocking half of the shipped-skill portability rule (Q-0239). The detector in
// `src/garden/detectors/skill-code-drift.ts` finds the same rows, but garden is
// advisory by construction — its findings are `action: 'investigate'` and are
// read at gardening time. That is how four repo-only command blocks survived in
// `noldor-release-sweep` until an operator hit them mid-release of a consumer.
// A skill is shipped source: the gate for it belongs on the commit that writes
// it, not on a pass somebody remembers to run.
//
// Two things block. `non-portable-script` is invisible here by definition: it
// works in every run of every test in this repo. A broken router is the other
// (`skill-router.ts`): a read-now link to a missing file, or a branch file no
// read-now chain reaches, silently drops that branch's rules from every session
// that takes it. The detector's other classes stay advisory — a missing path or
// a renamed subcommand is rot the author can see from the repo.
import { detectSkillCodeDrift, NON_PORTABLE_SCRIPT } from '../garden/detectors/skill-code-drift.js';
import { runIfDirect } from '../core/cli-entry.js';
import { checkSkillRouters } from './skill-router.js';

/**
 * Report every shipped-skill command block that names a script this repo
 * defines but the framework does not install, and every shipped-skill router
 * whose read-now links miss a file or leave one unreachable.
 *
 * @param cwd - Repository root.
 * @returns 0 when every command block runs in a consumer and every router is whole, 1 otherwise.
 */
export async function main(cwd: string = process.cwd()): Promise<number> {
  const scripts = (await detectSkillCodeDrift(cwd)).filter((f) => f.kind === NON_PORTABLE_SCRIPT);
  const routers = checkSkillRouters(cwd);
  if (scripts.length === 0 && routers.length === 0) {
    console.log(
      'skill-portability: every shipped-skill command block runs in a consumer, and every read-now link resolves',
    );
    return 0;
  }
  if (scripts.length > 0) {
    console.error(
      `✗ ${scripts.length} shipped-skill command block(s) name a script a consumer does not have:`,
    );
    for (const f of scripts) console.error(`    ${f.skillPath}:${f.line} — ${f.detail}`);
  }
  if (routers.length > 0) {
    console.error(`✗ ${routers.length} shipped-skill router finding(s):`);
    for (const f of routers) console.error(`    ${f.skillPath}:${f.line} — ${f.kind}: ${f.detail}`);
  }
  return 1;
}

runIfDirect('check-skill-portability', 'checks skill-portability', async () => main());
