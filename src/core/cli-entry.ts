// @fd: main-module-guard-fails-on-percent-encoded-paths
/**
 * The direct-invocation tail every `*-cli.ts` module carries: run `main` when
 * this file *is* the entrypoint, exit with its code, and turn a rejection into a
 * labelled stderr line plus exit 1.
 *
 * Extracted when the diff-scoped clone gate flagged the copy in
 * `src/clones/clones-cli.ts` against `src/core/wait-cli.ts` (101 tokens). Around
 * fifty modules still inline the block; they are untouched here and can migrate
 * as they are next edited — the gate surfaces each one as its span is touched.
 */

import { pathToFileURL } from 'node:url';

/** Async CLI body: argv without `node <script>`, resolving to an exit code. */
export type CliMain = (argv: string[]) => Promise<number>;

/**
 * True when this module is the process entrypoint, by comparing its own
 * `import.meta.url` against `argv1` put through the same encoder.
 *
 * `pathToFileURL`, never a `file://` template: `import.meta.url` is a
 * percent-encoded URL while `process.argv[1]` is a raw path, so a repo path
 * needing encoding (one space is enough) makes the naive comparison false — the
 * body never runs, the process exits 0, and the check passes having checked
 * nothing. Resolving `argv1` through the same function also makes a relative
 * path work, since `pathToFileURL` resolves against the cwd.
 *
 * Prefer this over {@link invokedDirectly} wherever the module can name its own
 * URL: this is path-exact, whereas the stem regex matches any file with that
 * basename and so cannot tell `release/index.ts` from `cli/index.ts`.
 *
 * Passing `undefined` explicitly selects the `process.argv[1]` default, exactly
 * as omitting the argument does. The `?? ''` therefore guards only a genuinely
 * absent `process.argv[1]` (a `node -e` process); a test wanting the false
 * branch passes `''`.
 *
 * **It normalises encoding, not symlinks.** Node resolves a module to its
 * realpath, so `import.meta.url` is realpath-based while `argv1` is whatever the
 * caller typed: invoking through a symlink returns `false` — the same silent
 * no-op this replaces, from a different cause. Accepted rather than fixed,
 * because no framework path is exposed. `src/cli/index.ts` derives `SRC_ROOT`
 * from its own `fileURLToPath(import.meta.url)` (already a realpath), builds
 * `modPath` from it, and assigns that to `process.argv[1]` before importing, so
 * both sides of every routed comparison come from one realpath; every hook runs
 * through that router. Only a direct `node <symlinked-path>` invocation is
 * affected. Calling `realpathSync` here would cost an fs call on every guard
 * evaluation in every process — 41 of the 42 evaluate to `false` on any given
 * invocation — plus an ENOENT branch, to buy a case nothing reaches.
 */
export function isEntrypoint(
  moduleUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  return moduleUrl === pathToFileURL(argv1 ?? '').href;
}

/**
 * True when `process.argv[1]` is the module named `stem` — i.e. this file was
 * invoked directly rather than imported. Matches the compiled `.js` / `.mjs`
 * alongside the `.ts` source so the check survives the build.
 *
 * `stem` is interpolated into the pattern unescaped — every call site passes a
 * literal kebab-case module name, and there is no path by which a caller-built
 * or user-supplied string reaches here.
 */
export function invokedDirectly(
  stem: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  return new RegExp(`[\\\\/]${stem}\\.(ts|js|mjs)$`).test(argv1 ?? '');
}

/**
 * Run `main` and exit with its code, reporting a rejection as `<label>: <stack>`
 * and exiting 1. No-op unless the module named `stem` is the entrypoint, so it
 * is safe to call at import time.
 */
export function runIfDirect(stem: string, label: string, main: CliMain): void {
  if (!invokedDirectly(stem)) return;
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      process.stderr.write(
        `${label}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
      );
      process.exit(1);
    });
}

/**
 * An optional string flag's value, as a result rather than a throw: a missing
 * value is user error at a trust boundary, and every `*-cli.ts` reporting it
 * wants the same exit-2-with-a-message shape rather than a stack.
 */
export type OptionalFlag = { ok: true; value: string | undefined } | { ok: false; error: string };

/**
 * Read `--<flag> <value>` out of `argv`. Absent flag ⇒ `{ ok: true, value:
 * undefined }`; flag present as the last token ⇒ an error naming `label` (the
 * command, so the line reads `ui-sync: --surface requires a value`).
 *
 * Extracted when the clone gate flagged the copies in `design/ui-sync-cli.ts`
 * and `design/pen-bridge-cli.ts`. The `--flag=value` form is deliberately not
 * handled: no Noldor CLI accepts it today, and inventing support here would
 * make the two forms disagree per command.
 */
export function optionalFlag(argv: readonly string[], flag: string, label: string): OptionalFlag {
  const idx = argv.indexOf(flag);
  if (idx === -1) return { ok: true, value: undefined };
  const value = argv[idx + 1];
  return value === undefined
    ? { ok: false, error: `${label}: ${flag} requires a value` }
    : { ok: true, value };
}

/** What {@link readValueFlags} produced: the flag values plus the leftovers. */
export type ValueFlagRead =
  | { ok: true; values: Map<string, string>; positional: string[] }
  | { ok: false; error: string };

/**
 * Read every `--flag <value>` pair a command accepts, then hand back what is
 * left. Three rules no single-flag reader gets right on its own, which is why
 * this is shared rather than re-derived per CLI:
 *
 * - a flag-SHAPED value is rejected. {@link optionalFlag} deliberately does not
 *   check the value, so `--surface --out doc.json` would otherwise swallow the
 *   next flag's NAME as the surface;
 * - positionals are found by INDEX, so a path whose text equals a flag's value
 *   is not filtered out with it;
 * - a leftover starting with `--` is an unknown flag, reported rather than
 *   silently ignored.
 *
 * Extracted when the clone gate flagged the copies in
 * `cr/geometry/geometry-validate-cli.ts` and `cr/geometry/geometry-diff-cli.ts`.
 */
export function readValueFlags(
  argv: readonly string[],
  flags: readonly string[],
  label: string,
): ValueFlagRead {
  const values = new Map<string, string>();
  const consumedIdx = new Set<number>();
  for (const flag of flags) {
    const read = optionalFlag(argv, flag, label);
    if (!read.ok) return { ok: false, error: read.error };
    if (read.value !== undefined && read.value.startsWith('--')) {
      return { ok: false, error: `${label}: ${flag} requires a value` };
    }
    if (read.value !== undefined) values.set(flag, read.value);
    const i = argv.indexOf(flag);
    if (i >= 0) consumedIdx.add(i).add(i + 1);
  }
  const positional = argv.filter((a, i) => !consumedIdx.has(i));
  const unknown = positional.find((a) => a.startsWith('--'));
  return unknown === undefined
    ? { ok: true, values, positional }
    : { ok: false, error: `${label}: unknown flag ${unknown}` };
}
