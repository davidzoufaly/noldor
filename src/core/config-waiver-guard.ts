// src/core/config-waiver-guard.ts
// Content guard for the one micro-chore-landable file that can silence a gate,
// plus the single verdict both enforcement points ask for.
import { spawnSync } from 'node:child_process';
import { isMicroChoreAllowed, microChoreOffenders } from './allowlist.js';

/** The consumer config, as both hooks and the allowlist spell it. */
export const CONSUMER_CONFIG_PATH = '.noldor/config.json';

/**
 * Config keys that silence a gate *retroactively* — each names commits already
 * on `main` and waves them past a check they failed.
 *
 * This list is why `.noldor/config.json`'s place on {@link
 * import('./allowlist.js').MICRO_CHORE_GLOBS} needs a content guard on top of
 * its glob. Every other knob in that file looks forward: `crLanes`,
 * `clones.thresholdPct` and `boundaries` change what the *next* check does,
 * exactly as `lefthook.yml` does, and a no-review lane may carry them because
 * the next check still runs. These four reach backwards, and the micro-chore
 * lane is itself exempt from the release CR gate — so a no-review commit
 * appending to `release.crGateExemptCommits` would be waved past the gate by
 * the very list it just extended. That is a self-waiver, not a lane trade, and
 * it is the one thing the glob widening must not buy.
 *
 * Dotted paths rather than top-level blocks on purpose: `release.publish` and
 * `garden` carry ordinary forward-looking knobs, and blocking a whole block
 * would push benign edits onto a code lane for no gain.
 */
export const RETROACTIVE_WAIVER_KEYS = [
  'release.crGateExemptCommits',
  'release.gateComplianceExemptCommits',
  'release.gateComplianceSince',
  'garden.overrideAudit.expected',
  // The count knob belongs with `expected`, not with the tuning knobs: the
  // override audit warns on `unexpectedCount > threshold` over overrides
  // already on `main`, so raising it silences the same findings `expected`
  // silences one at a time. Blocking the per-SHA form while leaving the
  // wholesale form open would be an asymmetry with nothing behind it.
  'garden.overrideAudit.threshold',
] as const;

/**
 * The {@link RETROACTIVE_WAIVER_KEYS} whose value differs between two
 * `.noldor/config.json` texts. `null` means the file does not exist on that
 * side — a first-adoption commit compares against "no waivers declared", so
 * scaffolding a config with empty lists is not an edit.
 *
 * Fail-closed on unparseable input: text that is not JSON cannot be shown to
 * leave the waiver lists alone, so every key is reported rather than none.
 * Reporting "unchanged" there would make the guard skippable by committing
 * invalid JSON, and a malformed config is a broken commit regardless.
 *
 * Comparison is by serialized value, so a reordered array counts as a change.
 * That over-fires on a pure reshuffle, which is the safe direction: the cost is
 * routing a cosmetic edit onto a code lane, and the alternative — a set compare
 * — would treat a re-ordering that changes which exemption matches first as no
 * change at all.
 */
export function retroactiveWaiversTouched(before: string | null, after: string | null): string[] {
  const a = parseConfig(before);
  const b = parseConfig(after);
  if (!a.ok || !b.ok) return [...RETROACTIVE_WAIVER_KEYS];
  return RETROACTIVE_WAIVER_KEYS.filter(
    (key) => serialize(readDotPath(a.value, key)) !== serialize(readDotPath(b.value, key)),
  );
}

/**
 * Refusal message when the staged `.noldor/config.json` moves a retroactive
 * waiver, or `null` when it does not — including when the file is not staged.
 *
 * Reads the index (`:path`) against `HEAD`, never the worktree: the commit is
 * made of what is staged, so an unstaged edit must not enter the comparison in
 * either direction.
 */
export function retroactiveWaiverRefusal(cwd: string, staged: readonly string[]): string | null {
  if (!staged.includes(CONSUMER_CONFIG_PATH)) return null;
  const touched = retroactiveWaiversTouched(
    gitShow(cwd, `HEAD:${CONSUMER_CONFIG_PATH}`),
    gitShow(cwd, `:${CONSUMER_CONFIG_PATH}`),
  );
  if (touched.length === 0) return null;
  return (
    `${CONSUMER_CONFIG_PATH} moves a retroactive waiver (${touched.join(', ')}), ` +
    `which a no-review lane must not carry: those keys wave commits already on main past a gate, ` +
    `and this lane is exempt from that same gate. Land this edit through /noldor-gate fast-track, ` +
    `where it earns a review receipt.`
  );
}

/**
 * The {@link RETROACTIVE_WAIVER_KEYS} a commit that already landed moved — the
 * post-hoc twin of {@link retroactiveWaiverRefusal}, for the audit that reads
 * `main` rather than an index.
 *
 * It exists because both enforcement points are hooks, and a hook is
 * `--no-verify`-bypassable. The glob half of the lane rule is checked after the
 * fact by the allowlist-drift detector; without this the content half would
 * have no such backstop, and admitting `.noldor/config.json` to the lane would
 * have *removed* audit coverage the file had before — every micro-chore commit
 * touching it used to be flagged simply for being off the glob list.
 *
 * `<sha>^:` on a root commit resolves to nothing, which reads as "no waivers
 * declared" — the same reading a first-adoption commit gets at pre-commit.
 */
export function retroactiveWaiversInCommit(cwd: string, sha: string): string[] {
  return retroactiveWaiversTouched(
    gitShow(cwd, `${sha}^:${CONSUMER_CONFIG_PATH}`),
    gitShow(cwd, `${sha}:${CONSUMER_CONFIG_PATH}`),
  );
}

/**
 * Why a micro-chore commit must be refused, or `null` when it may land: the
 * lane's glob rule and its content rule, asked as one question.
 *
 * One function for both enforcement points — pre-commit and the commit-msg
 * re-check that catches a hand-typed trailer — because they were already
 * near-identical branches, and adding the waiver guard to each tipped them into
 * a clone. A second copy is also how the two drift into disagreeing about what
 * the lane admits, which is the exact failure the re-check exists to catch.
 */
export function microChoreRefusal(cwd: string, staged: readonly string[]): string | null {
  const paths = [...staged];
  if (!isMicroChoreAllowed(paths)) {
    return `micro-chore diff escapes allowlist: ${microChoreOffenders(paths).join(', ')}`;
  }
  const waiver = retroactiveWaiverRefusal(cwd, paths);
  return waiver === null ? null : `micro-chore ${waiver}`;
}

/** File content at a git revspec, or `null` when the path does not exist there. */
function gitShow(cwd: string, revspec: string): string | null {
  const r = spawnSync('git', ['show', revspec], { cwd, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '') : null;
}

function parseConfig(text: string | null): { ok: true; value: unknown } | { ok: false } {
  // An absent file declares no waivers — not a parse failure.
  if (text === null) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The value at a dotted path, or `undefined` when any segment is missing. */
function readDotPath(root: unknown, path: string): unknown {
  let cur = root;
  for (const segment of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    if (!Object.hasOwn(cur, segment)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** Stable-enough serialization for equality: `undefined` and `null` collapse together. */
function serialize(value: unknown): string {
  return value === undefined ? 'null' : JSON.stringify(value);
}
