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

/** Async CLI body: argv without `node <script>`, resolving to an exit code. */
export type CliMain = (argv: string[]) => Promise<number>;

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
