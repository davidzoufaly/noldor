import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST } from './manifest.js';
import { printHelp } from './help.js';
import { installedFrameworkVersion } from '../migrations/pkg-version.js';

const here = dirname(fileURLToPath(import.meta.url));
// `src/cli/` → `src/` (one level up).
const SRC_ROOT = resolve(here, '..');

/** A `--help` / `-h` help request in any argv slot. */
const isHelpFlag = (s: string | undefined): boolean => s === '--help' || s === '-h';

// The manifest names source files (`triage/validate-triage.ts`) because that is
// what the skills and the skill-code-drift / fd-command-rot detectors cite. When
// this router is itself compiled, the sibling it must import is the emitted
// `.js` — SRC_ROOT already points at `dist/`, so only the extension differs.
const ROUTER_IS_SOURCE = import.meta.url.endsWith('.ts');

/**
 * The manifest path as it exists under the runtime actually executing.
 *
 * @param srcRelative - Manifest `src` value, always a `.ts` path.
 * @returns The same path with the extension this runtime emits.
 */
export function runtimeRelative(srcRelative: string): string {
  return ROUTER_IS_SOURCE ? srcRelative : srcRelative.replace(/\.ts$/, '.js');
}

async function dispatch(srcRelative: string, argsAfterModulePath: string[]): Promise<void> {
  const modPath = resolve(SRC_ROOT, runtimeRelative(srcRelative));
  // Reshape process.argv so the dispatched module sees its own invocation
  // (`node <modPath> <args>`). Most entrypoints do `process.argv.slice(2)`;
  // some use `if (import.meta.url === pathToFileURL(process.argv[1]).href)` —
  // both work with this layout. The dynamic import then triggers the module's
  // top-level execution.
  process.argv = [process.argv[0]!, modPath, ...argsAfterModulePath];
  await import(pathToFileURL(modPath).href);
}

/**
 * Print `Unknown command`/`Unknown subcommand` and exit 1, appending the
 * framework-skew diagnosis when the consumer's anchor and the installed package
 * disagree.
 *
 * The skew modules are imported dynamically, not at the top of this router: this
 * is the CLI's front door, every `noldor` invocation pays for its static
 * imports, and the diagnosis is only ever needed on the error path. `main` is
 * already async, so the await costs nothing here.
 */
async function failUnknown(what: string): Promise<never> {
  console.error(what);
  try {
    const [{ missingCommandSkewHint }, { loadFrameworkVersion }] = await Promise.all([
      import('../core/framework-skew.js'),
      import('../core/consumer-config.js'),
    ]);
    const hint = missingCommandSkewHint(
      loadFrameworkVersion(process.cwd()),
      installedFrameworkVersion(),
    );
    if (hint !== null) console.error(`\n${hint}`);
  } catch {
    // A version we cannot read is not a reason to swallow the real error: the
    // `Unknown command` line above is already out, so degrade to it silently
    // rather than burying it under a diagnostic's own stack trace.
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , group, sub, ...rest] = process.argv;

  if (group === '--version') {
    console.log(`noldor v${installedFrameworkVersion()}`);
    return;
  }

  if (group === undefined || isHelpFlag(group)) {
    printHelp();
    return;
  }

  const g = MANIFEST[group];
  if (!g) {
    await failUnknown(`Unknown command: ${group}`);
    return;
  }

  // Leaf command (declares a single '' subcommand, e.g. init/doctor/next-priority
  // /pr-flow/changelog): flags land in the `sub` slot. Dispatch to '' with all
  // remaining argv unless the user explicitly asked for --help. Must precede the
  // generic help/undefined check below — otherwise `noldor init` prints help
  // instead of running, and `noldor init --update` falls through to an unknown
  // subcommand.
  const leaf = g.subs[''];
  if (leaf !== undefined) {
    if (isHelpFlag(sub) || rest.some(isHelpFlag)) {
      printHelp(group);
      return;
    }
    const args = sub === undefined ? rest : [sub, ...rest];
    await dispatch(leaf.src, args);
    return;
  }

  if (sub === undefined || isHelpFlag(sub)) {
    printHelp(group);
    return;
  }

  const subCmd = g.subs[sub];
  if (subCmd === undefined) {
    await failUnknown(`Unknown subcommand: ${group} ${sub}`);
    return;
  }

  // A `--help`/`-h` anywhere in a subcommand's own args prints usage and exits 0
  // BEFORE dispatching — otherwise `noldor autonomous run --help` falls through
  // to queue-drain.ts and launches the real drain (the bug this guards against).
  if (rest.some(isHelpFlag)) {
    printHelp(group, sub);
    return;
  }

  await dispatch(subCmd.src, rest);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
