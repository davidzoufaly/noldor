import { injectBootstrapOverrides } from './bootstrap-immunity.js';

/**
 * `pnpm noldor cr bootstrap --slug <slug> [--range origin/main..HEAD] [--autonomous]`
 *
 * Auto-stamps the bootstrap override on every commit of the worktree branch when
 * the FD declares `introduces-gate`. No-op (exit 0, "skipped" message) otherwise.
 * `--autonomous` is accepted for symmetry with the drain runner; there is no
 * prompt to suppress, so it only affects messaging.
 */
function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function runBootstrapCli(argv: readonly string[], cwd: string): number {
  const slug = flag(argv, '--slug');
  if (!slug) {
    process.stderr.write('cr bootstrap: --slug <slug> is required\n');
    return 1;
  }
  const range = flag(argv, '--range');
  const result = injectBootstrapOverrides({ cwd, slug, ...(range ? { range } : {}) });
  if (!result.gate) {
    process.stdout.write('no introduces-gate — skipped\n');
    return 0;
  }
  process.stdout.write(
    `cr bootstrap: stamped ${result.gate.entry.overrideTrailer} (gate ${result.gate.key}) on ${result.injected.length} commit(s)\n`,
  );
  return 0;
}

process.exit(runBootstrapCli(process.argv.slice(2), process.cwd()));
