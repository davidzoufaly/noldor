// `noldor doctor` — three phases:
// 1. presence + version-floor check for every declared stack prerequisite
//    (binaries + consumer package scripts the hooks invoke).
// 2. diff every template-managed file (under the pkg's `templates/` asset
//    dir, filtered to the consumer's `agents.targets`) against the consumer
//    copy at the same relative path under `process.cwd()`.
// 3. presence + version-floor check for every *configured* agent runner.
// Exit 1 on any prerequisite, drift, or runner problem; exit 0 with counts on clean.
// Wired into `pnpm verify` at the consumer side (per spec).
import {
  TEMPLATES_ROOT,
  templateFiles,
  SCAFFOLD_ONLY_TEMPLATES,
} from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { checkRunners } from '../../core/agent-runner/doctor-runners.js';
import {
  MATRIX_LINK,
  checkBinaryPrerequisites,
  checkConsumerScripts,
} from '../../core/prerequisites.js';
import { loadFrameworkVersion } from '../../core/consumer-config.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';

let prereqBad = 0;
for (const c of [...checkBinaryPrerequisites(), ...checkConsumerScripts(process.cwd())]) {
  if (c.status === 'ok') continue;
  prereqBad++;
  console.log(`${c.status.padEnd(12)} prerequisite ${c.id}: ${c.detail}`);
}

const agentsCfg = loadAgentsConfig(process.cwd());
// Scaffold-only starters (e.g. .noldor/config.json) legitimately diverge.
const files = filterTemplatesByAgents(templateFiles(), agentsCfg.targets).filter(
  (f) => !SCAFFOLD_ONLY_TEMPLATES.has(f),
);
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

// Framework-version skew: advisory only (does NOT affect exit code). A consumer
// with synced templates but an un-migrated tree should still pass `doctor`
// green after running `noldor upgrade`.
const anchored = loadFrameworkVersion(process.cwd());
const installed = installedFrameworkVersion();
if (anchored !== installed) {
  console.log(
    `warn         framework skew: anchored ${anchored ?? '(unset)'} ≠ installed ${installed} — run 'noldor upgrade'`,
  );
}

if (prereqBad === 0 && bad === 0 && runnerBad === 0) {
  console.log(
    `OK — prerequisites healthy, ${files.length} template files in sync, ${checks.length} runner(s) healthy`,
  );
  process.exit(0);
}

if (prereqBad > 0) {
  console.error(`\n${prereqBad} prerequisite problem(s). See ${MATRIX_LINK} for the full matrix.`);
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
