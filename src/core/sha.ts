/**
 * A git object name in hex, 4–40 chars — the shape `git rev-parse` prints.
 *
 * Shared because shas travel: they are printed by one command, copied by the
 * gate controller, stored in the autofix ledger, and interpolated back into a
 * `git diff <sha>..HEAD` ARGUMENT. Anything not matching this can be an option
 * rather than a rev — `git diff --shortstat '--output=x..HEAD'` exits 0 and
 * WRITES the file `x..HEAD` — so every rung that feeds a sha into a git argument
 * has to apply the same check, wherever the value came from.
 *
 * Deliberately narrower than a general revision (`origin/main`, `HEAD~1`,
 * `v1.2.3`), which is a separate contract — see `REV_RE` in `src/cr/cli-args.ts`.
 * Only use this one where the value must be a concrete object name.
 */
export const SHA_RE = /^[0-9a-fA-F]{4,40}$/;

/** Whether `value` is a hex object name per {@link SHA_RE}. */
export function isSha(value: string): boolean {
  return SHA_RE.test(value);
}
