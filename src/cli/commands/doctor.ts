// `noldor doctor` — five phases:
// 1. presence + version-floor check for every declared stack prerequisite
//    (binaries + consumer package scripts the hooks invoke).
// 2. diff every template-managed file (under the pkg's `templates/` asset
//    dir, filtered to the consumer's `agents.targets`) against the consumer
//    copy at the same relative path under `process.cwd()`.
// 3. presence + version-floor check for every *configured* agent runner.
// 4. structural wiring assertion on the consumer's root `lefthook.yml` — the
//    one adopted surface phases 2-3 cannot see, because it is scaffold-only
//    and so exempt from drift.
// 5. lockfile-vs-installed-modules freshness, so a pulled dependency change
//    that was never installed reports itself instead of surfacing later as a
//    typecheck failure that reads like a code bug.
// Exit 1 on any prerequisite, drift, runner, wiring, or install-freshness problem;
// exit 0 with counts on clean.
// Wired into `pnpm verify` at the consumer side (per spec).
import {
  TEMPLATES_ROOT,
  templateFiles,
  SCAFFOLD_ONLY_TEMPLATES,
} from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';
import { checkLefthookWiring } from '../../checks/check-lefthook-wiring.js';
import { REPAIR, checkInstallFreshness } from '../../checks/check-install-freshness.js';
import { checkPenBridge, renderPenBridgeRow } from '../../checks/check-pen-bridge.js';
import { loadUiConfig } from '../../core/consumer-config.js';
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

// Which runtime served THIS process, as decided by bin/runtime-select.mjs and
// recorded by bin/boot.mjs. Every child re-derives its own verdict, so the row
// always describes the process printing it.
const runtime = process.env.NOLDOR_RUNTIME_ACTIVE ?? 'unknown';
const runtimeReason = process.env.NOLDOR_RUNTIME_REASON ?? 'not-set';
console.log(`${'ok'.padEnd(12)} runtime: ${runtime} (${runtimeReason})`);

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

// Install freshness: node_modules must have been installed from the lockfile
// currently on disk. Blocking, because a stale tree makes every other signal in
// the repo — typecheck, tests, this doctor run — describe dependencies nobody
// is actually working with. `advisory` results are the check declining to look
// (no readable marker), which is not evidence of staleness and must not fail.
const freshness = checkInstallFreshness(process.cwd());
let freshnessBad = 0;
if (freshness.status !== 'ok' && freshness.status !== 'no-lockfile') {
  if (freshness.advisory) console.log(`${'warn'.padEnd(12)} install: ${freshness.detail}`);
  else {
    freshnessBad++;
    console.log(`${'stale'.padEnd(12)} install: ${freshness.detail}`);
  }
}

// Pencil bridge wiring: advisory only (does NOT affect exit code). A wrong
// `--app` pin is a real finding for `checks pen-bridge`, which exits 1 on it,
// but it breaks only the UI-design step — failing a whole doctor run on it would
// block every repo that never opens a `.pen`.
//
// Every row prints, not just the findings. Doctor's job is to show the state of
// the machine, and a filtered view is a different diagnostic from the one the
// standalone command gives: an operator who sees nothing cannot tell "healthy"
// from "could not determine" from "this check did not run".
// Three labels, not two: an `ok` beside "could not determine the pencil MCP pin"
// reads as a clean bill of health for a question that was never answered, which
// is the exact confusion this check exists to remove.
for (const row of checkPenBridge(process.cwd())) {
  const level =
    row.kind === 'mcp-app-mismatch' || row.kind === 'app-missing'
      ? 'warn'
      : row.kind === 'mcp-app-ok' || row.kind === 'app-ok'
        ? 'ok'
        : 'unknown';
  console.log(`${level.padEnd(12)} ${renderPenBridgeRow(row)}`);
}

// Framework-version skew: advisory only (does NOT affect exit code). A consumer
// with synced templates but an un-migrated tree should still pass `doctor`
// green after running `noldor upgrade`.
const skew = frameworkSkewDetail(loadFrameworkVersion(process.cwd()), installedFrameworkVersion());
if (skew !== null) console.log(`warn         framework skew: ${skew}`);

// UI-design baseline freshness: advisory only (does NOT affect exit code).
// The blocking enforcement point is release preflight; doctor just surfaces
// the debt early. Absent consumer config / uiPaths ⇒ silent (not adopted).
const uiConfig = loadUiConfig(process.cwd());
if (uiConfig !== null) {
  const uiVerdict = await evaluateUiDesignFreshness(process.cwd(), uiConfig);
  for (const s of uiVerdict.surfaces) {
    if (s.status === 'stale' || s.status === 'uninitialized' || s.status === 'unverified') {
      console.log(`warn         ui-design: ${s.surface} ${s.status} — ${s.detail}`);
    }
  }
}

if (prereqBad === 0 && bad === 0 && runnerBad === 0 && wiringBad === 0 && freshnessBad === 0) {
  console.log(
    `OK — prerequisites healthy, ${files.length} template files in sync, ${checks.length} runner(s) healthy, hooks wired, install fresh`,
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
if (freshnessBad > 0) {
  console.error(
    `\nnode_modules does not match the lockfile, so typecheck/test results here describe a stale dependency tree. Run '${REPAIR}' before trusting any red above.`,
  );
}
if (wiringBad > 0) {
  console.error(
    `\nHook wiring is broken, so noldor's gate jobs never run. This is NOT drift — ${wiring.rootName} is yours to own, and 'init --update' will not touch it. Apply the repair above by hand.`,
  );
}
process.exit(1);
