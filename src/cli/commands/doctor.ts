// `noldor doctor` — two phases:
// 1. diff every template-managed file (under the pkg's `templates/` asset
//    dir, filtered to the consumer's `agents.targets`) against the consumer
//    copy at the same relative path under `process.cwd()`.
// 2. presence + version-floor check for every *configured* agent runner.
// Exit 1 on any drift or runner problem; exit 0 with counts on clean.
// Wired into `pnpm verify` at the consumer side (per spec).
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { checkRunners } from '../../core/agent-runner/doctor-runners.js';

const agentsCfg = loadAgentsConfig(process.cwd());
const files = filterTemplatesByAgents(templateFiles(), agentsCfg.targets);
const drift = computeDrift(TEMPLATES_ROOT, process.cwd(), files);

let bad = 0;
for (const entry of drift) {
  if (entry.status === 'unchanged') continue;
  bad++;
  console.log(`${entry.status.padEnd(10)} ${entry.path}`);
}

let runnerBad = 0;
const checks = checkRunners(agentsCfg);
for (const c of checks) {
  if (c.status === 'ok') continue;
  runnerBad++;
  console.log(`${c.status.padEnd(12)} runner ${c.runner}: ${c.detail}`);
}

if (bad === 0 && runnerBad === 0) {
  console.log(`OK — ${files.length} template files in sync, ${checks.length} runner(s) healthy`);
  process.exit(0);
}

if (bad > 0) {
  console.error(
    `\n${bad} drift entries. Run 'noldor init --update' to sync consumer paths, or 'noldor init --adopt' if the pkg should adopt consumer state.`,
  );
}
if (runnerBad > 0) {
  console.error(
    `${runnerBad} runner problem(s). Install the missing CLI or fix agents.versionFloors.`,
  );
}
process.exit(1);
