// `noldor upgrade` — walk a consumer from its anchored framework version to the
// installed one through ordered codemods. Pure core (`runUpgrade`) is unit
// tested; the CLI tail parses argv and maps the result to stdout + exit code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  loadConsumerConfig,
  loadFrameworkVersion,
  writeFrameworkVersion,
  type ConsumerConfig,
} from '../../core/consumer-config.js';
import { isAnchorLagging } from '../../core/framework-skew.js';
import { installedFrameworkVersion } from '../../migrations/pkg-version.js';
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
      applied,
      report: base,
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
    // `upgrade` applies codemods and the anchor; it never re-pulls the
    // template-managed files, so a stale `lefthook/noldor.yml` survives it and
    // the hooks keep dying on subcommands this version removed. Naming the
    // second half here is the only place the consumer learns it before the next
    // failing commit (bumbu, 2026-08-23).
    if (result.applied || (dryRun && result.steps > 0)) {
      console.log(
        `\n${dryRun ? '[DRY RUN] next: ' : 'Next: '}run 'noldor init --update' to re-sync ` +
          'template-managed files (hook block, docs) from the new package version.',
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
