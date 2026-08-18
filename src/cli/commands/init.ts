// `noldor init` — scaffold/sync framework files into the consumer repo, OR
// (with --adopt) snapshot the consumer's current files INTO the pkg's
// templates dir (first-party-dev bootstrap, monorepo only).
//
// Flags:
//   --update                         re-copy templates and overwrite any drifted consumer files
//   --adopt                          reverse direction: copy consumer files INTO
//                                    the package's own templates/ dir (writes the pkg's
//                                    templates from the live consumer state)
//   --agents claude,codex,opencode   select which driver shim sets to write
//                                    (default: agents.targets from config, else claude)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEMPLATES_ROOT,
  templateFiles,
  SCAFFOLD_ONLY_TEMPLATES,
} from '../../templates/manifest.js';
import { copyTemplate, adoptTemplate } from '../../templates/copy.js';
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { RUNNER_NAMES, type RunnerName } from '../../core/agent-runner/types.js';
import { loadFrameworkVersion, writeFrameworkVersion } from '../../core/consumer-config.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
import { ensureRolloutMarker } from '../../core/rollout-marker.js';
import {
  FILE as SUMMARY_BODY_ROLLOUT_FILE,
  ensureSummaryBodyRolloutSnapshot,
} from '../../core/summary-body-rollout.js';
import { ensureGitignoreBlock } from '../../core/init-gitignore.js';
import { checkLefthookWiring } from '../../checks/check-lefthook-wiring.js';

const argv = process.argv.slice(2);
const args = new Set(argv);
const update = args.has('--update');
const adopt = args.has('--adopt');
const consumer = process.cwd();

function parseAgents(): RunnerName[] {
  const i = argv.indexOf('--agents');
  const inline = argv.find((a) => a.startsWith('--agents='));
  const rawList = inline ? inline.slice('--agents='.length) : i >= 0 ? argv[i + 1] : undefined;
  if (rawList === undefined) return loadAgentsConfig(consumer).targets;
  const list = rawList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of list) {
    if (!(RUNNER_NAMES as readonly string[]).includes(name)) {
      console.error(`init failed: unknown agent '${name}' (valid: ${RUNNER_NAMES.join(', ')})`);
      process.exit(1);
    }
  }
  if (list.length === 0) {
    console.error('init failed: --agents requires a non-empty comma-separated list');
    process.exit(1);
  }
  return list as RunnerName[];
}

if (adopt) {
  // Adopt snapshots pkg templates from the live consumer — it must see the
  // full unfiltered manifest regardless of agent targets. Scaffold-only
  // starters are excluded: the live file holds consumer-specific values that
  // must never overwrite the generic starter.
  const all = templateFiles().filter((f) => !SCAFFOLD_ONLY_TEMPLATES.has(f));
  adoptTemplate(TEMPLATES_ROOT, consumer, all);
  console.log(`adopt: snapshotted ${all.length} consumer files into ${TEMPLATES_ROOT}`);
  process.exit(0);
}

const manifest = filterTemplatesByAgents(templateFiles(), parseAgents());
const files = manifest.filter((f) => !SCAFFOLD_ONLY_TEMPLATES.has(f));
const scaffoldOnly = manifest.filter((f) => SCAFFOLD_ONLY_TEMPLATES.has(f));

try {
  const results = copyTemplate(TEMPLATES_ROOT, consumer, files, { update });
  // Starters: copy only when absent — never overwrite, never `--update`, never throw.
  for (const rel of scaffoldOnly) {
    if (!existsSync(join(consumer, rel))) {
      results.push(...copyTemplate(TEMPLATES_ROOT, consumer, [rel], { update: false }));
    }
  }
  const counts = { added: 0, updated: 0, unchanged: 0 } as const as {
    added: number;
    updated: number;
    unchanged: number;
  };
  for (const r of results) {
    counts[r.status]++;
    if (r.status !== 'unchanged') console.log(`${r.status.padEnd(10)} ${r.path}`);
  }
  console.log(`\n${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged`);
  // Transient .noldor state (session marker, CR sinks, drain state) must never
  // land in consumer commits — append the ignore block before hooks go live.
  const ignore = ensureGitignoreBlock(consumer);
  if (ignore !== 'unchanged') {
    console.log(`${ignore.padEnd(10)} .gitignore (.noldor transient-state block)`);
  }
  // Arm the gate validators (trailer / receipt / session hard wall) from the
  // next commit onward. Without a committed marker every validator stays in
  // soft mode — enforcement prose without enforcement.
  const marker = ensureRolloutMarker(consumer);
  if (marker === 'created') {
    console.log(
      'created    .noldor/rollout-marker — gate validators enforce from here. Commit it via a ' +
        "micro-chore /noldor-gate session (the marker path is micro-chore-allowlisted), or NOLDOR_PATH_OVERRIDE='arm rollout marker' git commit.",
    );
  } else if (marker === 'skipped-no-git') {
    console.log(
      'skipped    .noldor/rollout-marker (no git HEAD yet — validators stay in soft mode; re-run init after the first commit)',
    );
  }
  // Separate from the marker above: that one may predate this gate by months and
  // cannot say which commits existed on side branches when the summary-body
  // check armed. This snapshot records every current commit-ref tip, so exactly
  // their history is grandfathered and the next commit on any branch enforces.
  // Never rewritten once present — advancing the tips would launder every commit
  // made since activation past the gate.
  const summarySnapshot = ensureSummaryBodyRolloutSnapshot(consumer);
  if (summarySnapshot === 'created') {
    console.log(
      `created    ${SUMMARY_BODY_ROLLOUT_FILE} — pre-push enforces the Why/How/What body from here. ` +
        'Commit it with this framework update (the path is micro-chore-allowlisted); until it is committed, ' +
        'a fresh clone stays advisory-only.',
    );
  } else if (summarySnapshot === 'skipped-no-git') {
    console.log(
      `skipped    ${SUMMARY_BODY_ROLLOUT_FILE} (no commit-bearing ref yet — the summary-body gate stays advisory-only; re-run init after the first commit)`,
    );
  }
  // Hook wiring, checked on every run and REPORTED ONLY. The root lefthook.yml
  // is a scaffold-only starter the consumer owns: copyTemplate above wrote it
  // only if it was absent, and `--update` deliberately left an existing one
  // alone. That ownership is exactly why an adopted repo can end up with a
  // pre-adoption root file that never gained the extends line — and why the
  // remedy here is a named diagnostic, never a rewrite that would clobber the
  // project's own hooks.
  const wiring = checkLefthookWiring(consumer);
  if (wiring.status !== 'ok') {
    const label = wiring.advisory ? 'warn' : 'unwired';
    console.log(`${label.padEnd(10)} ${wiring.rootName}: ${wiring.detail}`);
  }
  // Stamp the framework version ONLY on a fresh scaffold — a tree with no
  // existing anchor, scaffolded (not `--update`). A fresh scaffold is by
  // definition current, so it owes no migrations. `init --update` (re-pull on
  // an existing tree) and any tree that already carries an anchor must NOT be
  // advanced here: that would skip the migration chain and silently mark a
  // behind consumer as current. Advancing an existing anchor is `upgrade`'s
  // job; a pre-feature tree (no anchor) bootstraps via `upgrade --from <v>`.
  if (
    !update &&
    existsSync(join(consumer, '.noldor/config.json')) &&
    loadFrameworkVersion(consumer) === null
  ) {
    writeFrameworkVersion(consumer, installedFrameworkVersion());
  }
  process.exit(0);
} catch (err) {
  console.error(`init failed: ${(err as Error).message}`);
  process.exit(1);
}
