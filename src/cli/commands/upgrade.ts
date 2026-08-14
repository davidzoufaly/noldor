// `noldor upgrade` — walk a consumer from its anchored framework version to the
// installed one through ordered codemods. Pure core (`runUpgrade`) is unit
// tested; the CLI tail parses argv and maps the result to stdout + exit code.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  loadConsumerConfig,
  loadFrameworkVersion,
  writeFrameworkVersion,
  type ConsumerConfig,
} from '../../core/consumer-config.js';
import { isAnchorLagging } from '../../core/framework-skew.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
import {
  FILE as SUMMARY_BODY_ROLLOUT_FILE,
  ensureSummaryBodyRolloutSnapshot,
  snapshotPath,
} from '../../core/summary-body-rollout.js';
import { MIGRATIONS } from '../../migrations/registry.js';
import { resolveChain, runChain, renderSteps } from '../../migrations/chain.js';
import type { Migration } from '../../migrations/types.js';

export interface UpgradeInput {
  readonly cwd: string;
  readonly migrations: readonly Migration[];
  readonly installed: string;
  readonly from?: string; // override anchor (bootstrap a pre-feature tree)
  readonly dryRun: boolean;
  readonly force: boolean;
}

export interface UpgradeResult {
  readonly from: string;
  readonly to: string;
  readonly steps: number;
  readonly applied: boolean;
  readonly report: string;
}

function isDirty(cwd: string): boolean {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return out.trim().length > 0;
}

/**
 * Load the consumer config, tolerantly. A valid config is validated by the
 * strict schema; a partial/pre-feature tree (which `upgrade` must still be able
 * to migrate) falls back to its raw `consumer` block — migrations that need a
 * specific field validate it themselves.
 */
function loadConfigTolerant(cwd: string): ConsumerConfig {
  try {
    return loadConsumerConfig(cwd);
  } catch {
    const raw = JSON.parse(readFileSync(join(cwd, '.noldor/config.json'), 'utf8')) as {
      consumer?: unknown;
    };
    return (raw.consumer ?? {}) as ConsumerConfig;
  }
}

/**
 * Create the summary-body activation snapshot if this consumer has none.
 *
 * Deliberately outside the semver migration chain: the snapshot arms a *runtime*
 * gate rather than transforming files, so keying it to a version gap would mean
 * inventing a migration whose only job is to run a side effect — and would strand
 * every consumer whose chain happens to be empty at upgrade time. Both chain
 * paths call this instead.
 *
 * Creating it observes the same clean-tree preflight as any other upgrade write:
 * the file must be committed to take effect, and writing it into a dirty tree
 * invites it being swept into an unrelated commit. Returns a report line, or null
 * when there was nothing to do.
 */
function snapshotStep(input: UpgradeInput): string | null {
  if (existsSync(snapshotPath(input.cwd))) return null;
  if (input.dryRun) {
    return `[DRY RUN] would create ${SUMMARY_BODY_ROLLOUT_FILE} (grandfathering all current commit-ref tips)`;
  }
  if (!input.force && isDirty(input.cwd)) {
    throw new Error(
      `refusing to write ${SUMMARY_BODY_ROLLOUT_FILE} on a dirty git tree — commit/stash first, ideally on a fresh branch (\`git switch -c chore/noldor-upgrade\`)`,
    );
  }
  const status = ensureSummaryBodyRolloutSnapshot(input.cwd);
  if (status === 'skipped-no-git') {
    return `skipped ${SUMMARY_BODY_ROLLOUT_FILE} (no commit-bearing ref yet — the summary-body gate stays advisory-only; re-run after the first commit)`;
  }
  if (status === 'created') {
    return `created ${SUMMARY_BODY_ROLLOUT_FILE} — pre-push enforces the Why/How/What body from here. Commit it with this upgrade; until it is committed, a fresh clone stays advisory-only.`;
  }
  return null;
}

/** Resolve + run the chain. Pure w.r.t. process state; throws on guard failures. */
export function runUpgrade(input: UpgradeInput): UpgradeResult {
  const config = loadConfigTolerant(input.cwd);
  const onDiskAnchor = loadFrameworkVersion(input.cwd);
  const from = input.from ?? onDiskAnchor;
  if (from === null) {
    throw new Error(
      'no frameworkVersion anchor in `.noldor/config.json` (field: `consumer.frameworkVersion`) — run `noldor init`, or pass --from <version> to bootstrap an existing tree',
    );
  }
  const chain = resolveChain(input.migrations, from, input.installed);
  if (chain.length === 0) {
    // Nothing to migrate, but the on-disk anchor may still lag the installed
    // version — and `writeFrameworkVersion` below is unreachable for an empty
    // chain. Two ways to get here with a lagging anchor: a fresh adopt via
    // `upgrade --from <installed>` (e.g. after `init --update`, which does not
    // stamp the anchor) leaves it UNSET; a patch/minor release with no codemod
    // registered between the two versions leaves it STALE. Both otherwise strand
    // the consumer — `doctor` warns skew forever with no command that ever
    // advances the anchor, leaving hand-editing `.noldor/config.json` as the
    // only exit. Write it here for either case; `--from` does not enter the
    // decision, since it overrides the chain start, not what is on disk.
    // A semver compare, not `!==`: an anchor *ahead* of installed must be left
    // alone rather than silently rewritten backwards, matching the
    // `downgrade unsupported` guard `resolveChain` applies to `from` (which
    // never sees `onDiskAnchor` when `--from` overrides it). Shared with
    // `doctor`, which needs the same three-way answer to word its skew warning.
    const lagging = isAnchorLagging(onDiskAnchor, input.installed);
    const applied = lagging && !input.dryRun;
    // Before the anchor write, so a refusal on a dirty tree does not leave the
    // anchor advanced past an activation that never happened.
    const snapshot = snapshotStep(input);
    if (applied) writeFrameworkVersion(input.cwd, input.installed);
    const dry = input.dryRun ? '[DRY RUN] ' : '';
    const base = !lagging
      ? `already at ${input.installed} — nothing to do`
      : onDiskAnchor === null
        ? `${dry}already at ${input.installed} — anchor bootstrapped (consumer.frameworkVersion → ${input.installed})`
        : `${dry}already at ${input.installed} — anchor advanced ${onDiskAnchor} → ${input.installed} (no migration registered between them)`;
    return {
      from,
      to: input.installed,
      steps: 0,
      applied: applied || snapshot !== null,
      report: snapshot === null ? base : `${base}\n${snapshot}`,
    };
  }
  if (!input.dryRun && !input.force && isDirty(input.cwd)) {
    throw new Error(
      'refusing to upgrade on a dirty git tree — commit/stash first, ideally on a fresh branch (`git switch -c chore/noldor-upgrade`)',
    );
  }
  const results = runChain(chain, input.cwd, config, { dryRun: input.dryRun });
  const lines: string[] = [];
  let stepCount = 0;
  for (const r of results) {
    lines.push(`\n## ${r.migration.from} → ${r.migration.to}: ${r.migration.description}`);
    stepCount += r.steps.length;
    lines.push(r.steps.length ? renderSteps(r.steps) : '  (no file changes)');
  }
  const snapshot = snapshotStep(input);
  if (snapshot !== null) lines.push(`\n${snapshot}`);
  if (!input.dryRun) writeFrameworkVersion(input.cwd, input.installed);
  return {
    from,
    to: input.installed,
    steps: stepCount,
    applied: !input.dryRun,
    report: lines.join('\n'),
  };
}

function parseFrom(argv: string[]): string | undefined {
  const i = argv.indexOf('--from');
  const inline = argv.find((a) => a.startsWith('--from='));
  return inline ? inline.slice('--from='.length) : i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  try {
    const result = runUpgrade({
      cwd: process.cwd(),
      migrations: MIGRATIONS,
      installed: installedFrameworkVersion(),
      from: parseFrom(argv),
      dryRun,
      force,
    });
    console.log(result.report);
    if (result.steps > 0) {
      console.log(
        `\n${dryRun ? '[DRY RUN] ' : ''}${result.steps} step(s) across the chain ${result.from} → ${result.to}` +
          (dryRun ? ' — re-run without --dry-run to apply' : `; anchor advanced to ${result.to}`),
      );
    }
    process.exit(0);
  } catch (err) {
    console.error(`upgrade failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('upgrade');
if (invokedDirect) main();
