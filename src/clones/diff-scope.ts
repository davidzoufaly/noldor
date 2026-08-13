/**
 * Diff-scoping for `noldor clones check`: which clone groups does *this change*
 * touch? The whole-corpus `clones.thresholdPct` gate needs a number nobody can
 * pick, so it stays unset and never fires; "did you just write a copy of
 * something that already exists?" needs no tuning at all.
 *
 * Two pure units (`parseUnifiedDiffRanges`, `flaggedGroups`) plus one that talks
 * to git behind the `RunGit` seam from `../core/branch-added.js`.
 *
 * See `docs/design/specs/2026-08-12-code-clone-detector-diff-scoped-clone-gate-design.md`.
 */
import { defaultRunGit, resolveDefaultBase } from '../core/branch-added.js';
import type { RunGit } from '../core/branch-added.js';
import type { CloneGroup, CloneReport } from './detect.js';

/** A 1-based inclusive line span — same convention as `CloneInstance`. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** Repo-relative path → post-image spans this change wrote. */
export type ChangedRanges = ReadonlyMap<string, readonly LineRange[]>;

/**
 * The span an UNTRACKED file contributes: every line of it is new, but its
 * length is not knowable from git plumbing alone, so the end is a sentinel that
 * any instance span clips down to exactly (see `coveredLines`). Q-0123: without
 * this, `git diff` has no post-image for an untracked file and the diff-scoped
 * verdict printed green for a file whose every line was just written.
 */
const WHOLE_FILE: LineRange = { start: 1, end: Number.MAX_SAFE_INTEGER };

// `+++ b/<path>` — the `b/` prefix is guaranteed by the explicit `--dst-prefix`
// in `resolveChangedRanges`, never inherited from consumer config. Git appends a
// TAB when the path contains whitespace (`+++ b/a b.ts\t`), so trailing tabs are
// stripped; without that the key carries the tab and matches no corpus entry.
const DST_HEADER = /^\+\+\+ b\/(.+)$/;
// `@@ -<old>[,<count>] +<new>[,<count>] @@` — only the post-image half matters.
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff -U0` output into post-image line ranges per file.
 *
 * File headers are only honoured in the header block that follows a
 * `diff --git` line, before that file's first `@@`. Under `-U0` every body line
 * carries a `+`/`-` prefix, so an ADDED line whose content is `++ b/evil.ts`
 * renders as `+++ b/evil.ts` and would otherwise be read as a header — silently
 * re-attributing the rest of the real file's hunks. `diff --git` at column 0
 * cannot be forged that way, so it is the anchor. (`@@` at column 0 is
 * unforgeable for the same reason, which is why it is safe to key on directly.)
 *
 * A deletion-only hunk (`+<line>,0`) contributes nothing: there are no
 * post-image lines to overlap, and emitting `{ start, end: start - 1 }` would be
 * an inverted range whose overlap behaviour depends on the comparison's
 * accidents. Files left with no ranges are absent from the map rather than
 * present-and-empty.
 *
 * Known gap: `core.quotepath=false` only stops NON-ASCII paths being C-quoted.
 * A path containing `"`, a tab, or a control character is still emitted quoted
 * (`+++ "b/we\tird.ts"`), fails this match, and is skipped — fail-open, like any
 * other shape the parser does not recognize.
 */
export function parseUnifiedDiffRanges(diff: string): Map<string, LineRange[]> {
  const out = new Map<string, LineRange[]>();
  let file: string | undefined;
  let inHeader = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = undefined;
      inHeader = true;
      continue;
    }
    if (line.startsWith('@@')) {
      inHeader = false;
      if (file === undefined) continue;
      const hunk = HUNK_HEADER.exec(line);
      if (!hunk) continue;
      const start = Number(hunk[1]);
      // The count is optional in the unified format: `@@ -1 +1 @@` means one line.
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count === 0) continue;
      const ranges = out.get(file);
      const range: LineRange = { start, end: start + count - 1 };
      if (ranges) ranges.push(range);
      else out.set(file, [range]);
      continue;
    }
    // Past the header block every line is body content — never a header.
    if (!inHeader) continue;
    const header = DST_HEADER.exec(line);
    if (header) file = header[1].replace(/\t+$/, '');
    // `+++ /dev/null` is a deletion: no post-image, so no current file.
    else if (line.startsWith('+++ ')) file = undefined;
  }
  return out;
}

export interface ResolveChangedRangesOptions {
  /** Working directory for the git calls. Default: `process.cwd()`. */
  cwd?: string;
  /** Explicit base from `--against`. Default: upstream, else the remote head. */
  against?: string;
  /** Test seam. */
  runGit?: RunGit;
}

/**
 * Post-image line ranges written since the merge base — unioned with a
 * whole-file span for every untracked file, which `git diff` cannot see — or
 * `null` when git cannot answer.
 *
 * `null` means "unknown" — the caller skips the diff-scoped verdict and stays
 * green with a stderr note. An empty map means "nothing changed" and is a
 * legitimate green. Conflating the two would let a broken git report a pass it
 * never performed.
 *
 * An unresolvable *explicit* ref never reaches here: `validateAgainstRef` in the
 * CLI rejects it with exit 3 first, so this unit keeps one return contract and
 * imports no CLI error type. A ref that resolves but has no merge base with
 * `HEAD` (truncated history) does reach here, and is `null`.
 */
export function resolveChangedRanges(
  options: ResolveChangedRangesOptions = {},
): Map<string, LineRange[]> | null {
  const { cwd, against } = options;
  const run = options.runGit ?? defaultRunGit(cwd);

  const base = against ?? autoBase(run);
  // `--end-of-options` so a `-`-prefixed base is read as a ref, not a flag. The
  // CLI pre-validates `--against`, but this unit is exported and a library
  // caller can hand it anything.
  const mergeBase = run(['merge-base', '--end-of-options', base, 'HEAD']);
  if (mergeBase.status !== 0) return null;
  const sha = mergeBase.stdout.trim();
  if (sha.length === 0) return null;

  // `git diff` is porcelain and honours consumer config, and this parser is
  // fail-open — a header shape it does not recognize yields zero files, which
  // reads as a legitimate green. So every setting that can reshape the output is
  // pinned rather than trusted:
  // - `core.quotepath=false`: non-ASCII paths would otherwise arrive C-quoted
  //   (`"src/caf\303\251.ts"`) and never match a corpus key.
  // - `diff.relative=false`: paths would otherwise be relative to `cwd`.
  // - `--src-prefix`/`--dst-prefix`: explicit options beat `diff.noprefix`,
  //   `diff.mnemonicPrefix` and `diff.srcPrefix`/`diff.dstPrefix` alike, so
  //   `+++ b/<path>` is guaranteed without pinning four more settings.
  // - `--no-ext-diff`: `diff.external` would otherwise replace the output.
  // `-M` matches `discoverAddedFiles`: a renamed file reports at its new path,
  // which is the key the corpus uses.
  // A single ref (no `..HEAD`) makes the post-image the WORKING TREE, which is
  // what `loadCorpus` reads off disk; `<sha>...HEAD` would compare against HEAD
  // and misalign every line number whenever the tree is dirty.
  const diff = run([
    '-c',
    'core.quotepath=false',
    '-c',
    'diff.relative=false',
    'diff',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-M',
    sha,
  ]);
  if (diff.status !== 0) return null;
  const changed = parseUnifiedDiffRanges(diff.stdout);

  // Union in every untracked file as a whole-file span: `git diff <sha>` has no
  // post-image for a file the index has never seen, so a brand-new file — the
  // likeliest place for a paste — would otherwise be invisible to the verdict
  // until after its first commit. `-z` emits raw NUL-separated paths, immune to
  // the C-quoting that `core.quotepath` applies to `--others` output too.
  const untracked = run(['ls-files', '--others', '--exclude-standard', '-z']);
  // Same contract as the calls above: a git that cannot list untracked files
  // has not answered, and "unknown" must never read as "clean".
  if (untracked.status !== 0) return null;
  for (const path of untracked.stdout.split('\0')) {
    if (path.length === 0) continue;
    const ranges = changed.get(path);
    if (ranges) ranges.push(WHOLE_FILE);
    else changed.set(path, [WHOLE_FILE]);
  }
  return changed;
}

/**
 * The base to diff against when `--against` was not passed: the configured
 * upstream when there is one (on a feature branch that is the honest base),
 * else the remote's default branch.
 */
function autoBase(run: RunGit): string {
  const upstream = run(['rev-parse', '--abbrev-ref', '@{upstream}']);
  const ref = upstream.status === 0 ? upstream.stdout.trim() : '';
  return ref.length > 0 ? ref : resolveDefaultBase(run);
}

/**
 * Fraction of an instance's lines the change must have written before the
 * instance counts as "this change wrote a copy". Picked against the recorded
 * adjacency false positives (25%, 37%, ~55% coverage — a `desc:` edit inside a
 * data table, import lines landing in a matching import block, a new function
 * abutting a pre-existing clone) and a real paste (100%): 0.7 clears the worst
 * recorded graze by 15 points and still catches a paste diluted by detection
 * grouping in surrounding code by 30.
 */
export const COVERAGE_THRESHOLD = 0.7;

/** Lines of `span` covered by `ranges` — clipped to the span, overlap-safe. */
function coveredLines(span: LineRange, ranges: readonly LineRange[]): number {
  const clipped = ranges
    .map((r) => ({ start: Math.max(r.start, span.start), end: Math.min(r.end, span.end) }))
    .filter((r) => r.start <= r.end)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  // Merge as we sum so two hunks over the same lines count them once.
  let cursor = 0; // last counted line; 0 = none (lines are 1-based)
  for (const r of clipped) {
    const start = Math.max(r.start, cursor + 1);
    if (start > r.end) continue;
    covered += r.end - start + 1;
    cursor = r.end;
  }
  return covered;
}

/**
 * Clone groups where the change wrote a substantial fraction of some instance.
 *
 * Mere overlap is not enough: "any changed line inside an instance" flagged a
 * one-line edit in a data table the same as pasting the whole block (Q-0095),
 * blocking legitimate change with no override. Requiring ≥2 overlapping
 * instances would be wrong the other way — pasting an existing block into a new
 * file changes exactly one instance. Coverage is the predicate that separates
 * them: "I wrote this copy" clears {@link COVERAGE_THRESHOLD}, "my edit lands
 * inside a pre-existing clone" does not. A group whose instances are *all*
 * inside the diff (a block pasted twice within one change) still fires — each
 * instance is fully covered.
 */
export function flaggedGroups(report: CloneReport, changed: ChangedRanges): readonly CloneGroup[] {
  return report.groups.filter((group) =>
    group.instances.some((instance) => {
      const ranges = changed.get(instance.file);
      if (ranges === undefined) return false;
      const span: LineRange = { start: instance.startLine, end: instance.endLine };
      const total = span.end - span.start + 1;
      if (total <= 0) return false;
      return coveredLines(span, ranges) / total >= COVERAGE_THRESHOLD;
    }),
  );
}
