// `noldor doctor` — three phases:
// 1. presence + version-floor check for every declared stack prerequisite
//    (binaries + consumer package scripts the hooks invoke).
// 2. diff every template-managed file (under the pkg's `templates/` asset
//    dir, filtered to the consumer's `agents.targets`) against the consumer
//    copy at the same relative path under `process.cwd()`.
// 3. presence + version-floor check for every *configured* agent runner.
// 4. structural wiring assertion on the consumer's root `lefthook.yml` — the
//    one adopted surface phases 2-3 cannot see, because it is scaffold-only
//    and so exempt from drift.
// Exit 1 on any prerequisite, drift, runner, or wiring problem; exit 0 with counts on clean.
// Wired into `pnpm verify` at the consumer side (per spec).
import {
  TEMPLATES_ROOT,
  templateFiles,
  SCAFFOLD_ONLY_TEMPLATES,
} from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';
import { checkLefthookWiring } from '../../checks/check-lefthook-wiring.js';
import { loadConsumerConfig } from '../../core/consumer-config.js';
import { evaluateUiDesignFreshness } from '../../release/ui-design-freshness.js';
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { checkRunners } from '../../core/agent-runner/doctor-runners.js';
import {
  MATRIX_LINK,
  checkBinaryPrerequisites,
  checkConsumerScripts,
} from '../../core/prerequisites.js';
import { loadFrameworkVersion } from '../../core/consumer-config.js';
import { frameworkSkewDetail } from '../../core/framework-skew.js';
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

// Hook wiring: the root lefthook.yml is consumer-owned and scaffold-only, so
// the drift pass above skips it by design and would report a comment-only stub
// as healthy. Verify the extends line instead — never rewrite the file.
const wiring = checkLefthookWiring(process.cwd());
let wiringBad = 0;
if (wiring.status !== 'ok') {
  // `advisory` means this check could not read the consumer's config format,
  // not that the repo is broken — warn, never fail, or a wired TOML consumer
  // would go red for a limitation of ours.
  if (wiring.advisory) console.log(`${'warn'.padEnd(12)} hooks: ${wiring.detail}`);
  else {
    wiringBad++;
    console.log(`${'unwired'.padEnd(12)} hooks: ${wiring.detail}`);
  }
}

// Framework-version skew: advisory only (does NOT affect exit code). A consumer
// with synced templates but an un-migrated tree should still pass `doctor`
// green after running `noldor upgrade`.
const skew = frameworkSkewDetail(loadFrameworkVersion(process.cwd()), installedFrameworkVersion());
if (skew !== null) console.log(`warn         framework skew: ${skew}`);

// UI-design baseline freshness: advisory only (does NOT affect exit code).
// The blocking enforcement point is release preflight; doctor just surfaces
// the debt early. Absent consumer config / uiPaths ⇒ silent (not adopted).
try {
  const consumer = loadConsumerConfig(process.cwd());
  const uiVerdict = await evaluateUiDesignFreshness(process.cwd(), {
    uiPaths: consumer.uiPaths,
    uiSurfaces: consumer.uiSurfaces,
  });
  if (uiVerdict.overall === 'stale' || uiVerdict.overall === 'uninitialized') {
    for (const s of uiVerdict.surfaces) {
      if (s.status === 'stale' || s.status === 'uninitialized') {
        console.log(`warn         ui-design: ${s.surface} ${s.status} — ${s.detail}`);
      }
    }
  }
} catch {
  // no consumer config — feature not adopted; nothing to report
}

if (prereqBad === 0 && bad === 0 && runnerBad === 0 && wiringBad === 0) {
  console.log(
    `OK — prerequisites healthy, ${files.length} template files in sync, ${checks.length} runner(s) healthy, hooks wired`,
  );
  process.exit(0);
}

if (prereqBad > 0) {
  console.error(`\n${prereqBad} prerequisite problem(s). See ${MATRIX_LINK} for the full matrix.`);
}
if (bad > 0) {
  console.error(
    `\n${bad} drift entries. Run 'noldor init --update' to re-sync your files from the package templates. (--adopt is a first-party/monorepo maintainer flag that snapshots consumer files back INTO the package templates — never a consumer drift remedy.)`,
  );
}
if (runnerBad > 0) {
  console.error(
    `${runnerBad} runner problem(s). Install the missing CLI or fix agents.versionFloors.`,
  );
}
if (wiringBad > 0) {
  console.error(
    `\nHook wiring is broken, so noldor's gate jobs never run. This is NOT drift — ${wiring.rootName} is yours to own, and 'init --update' will not touch it. Apply the repair above by hand.`,
  );
}
process.exit(1);
