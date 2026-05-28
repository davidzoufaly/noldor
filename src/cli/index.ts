import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST } from './manifest.js';
import { printHelp } from './help.js';

const here = dirname(fileURLToPath(import.meta.url));
// `src/cli/` → `src/` (one level up).
const SRC_ROOT = resolve(here, '..');

async function dispatch(srcRelative: string, argsAfterModulePath: string[]): Promise<void> {
  const modPath = resolve(SRC_ROOT, srcRelative);
  // Reshape process.argv so the dispatched module sees its own invocation
  // (`node <modPath> <args>`). Most entrypoints do `process.argv.slice(2)`;
  // some use `if (import.meta.url === pathToFileURL(process.argv[1]).href)` —
  // both work with this layout. The dynamic import then triggers the module's
  // top-level execution.
  process.argv = [process.argv[0]!, modPath, ...argsAfterModulePath];
  await import(pathToFileURL(modPath).href);
}

async function main(): Promise<void> {
  const [, , group, sub, ...rest] = process.argv;

  if (group === '--version') {
    console.log('noldor v0');
    return;
  }

  if (group === '--help' || group === undefined) {
    printHelp();
    return;
  }

  const g = MANIFEST[group];
  if (!g) {
    console.error(`Unknown command: ${group}`);
    process.exit(1);
  }

  // Leaf command (declares a single '' subcommand, e.g. init/doctor/next-priority
  // /pr-flow/changelog): flags land in the `sub` slot. Dispatch to '' with all
  // remaining argv unless the user explicitly asked for --help. Must precede the
  // generic help/undefined check below — otherwise `noldor init` prints help
  // instead of running, and `noldor init --update` falls through to an unknown
  // subcommand.
  const leaf = g.subs[''];
  if (leaf !== undefined) {
    if (sub === '--help') {
      printHelp(group);
      return;
    }
    const args = sub === undefined ? rest : [sub, ...rest];
    await dispatch(leaf.src, args);
    return;
  }

  if (sub === '--help' || sub === undefined) {
    printHelp(group);
    return;
  }

  const subCmd = g.subs[sub];
  if (subCmd === undefined) {
    console.error(`Unknown subcommand: ${group} ${sub}`);
    process.exit(1);
  }

  await dispatch(subCmd.src, rest);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
