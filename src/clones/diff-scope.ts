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

// `+++ b/<path>` — the `b/` prefix is guaranteed by the explicit `--dst-prefix`
// in `resolveChangedRanges`, never inherited from consumer config.
const DST_HEADER = /^\+\+\+ b\/(.+)$/;
// `@@ -<old>[,<count>] +<new>[,<count>] @@` — only the post-image half matters.
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff -U0` output into post-image line ranges per file.
 *
 * A deletion-only hunk (`+<line>,0`) contributes nothing: there are no
 * post-image lines to overlap, and emitting `{ start, end: start - 1 }` would be
 * an inverted range whose overlap behaviour depends on the comparison's
 * accidents. Files left with no ranges are absent from the map rather than
 * present-and-empty.
 */
export function parseUnifiedDiffRanges(diff: string): Map<string, LineRange[]> {
  const out = new Map<string, LineRange[]>();
  let file: string | undefined;
  for (const line of diff.split('\n')) {
    const header = DST_HEADER.exec(line);
    if (header) {
      // `+++ /dev/null` is a deletion: no post-image, so no current file.
      file = header[1];
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = undefined;
      continue;
    }
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
 * Post-image line ranges written since the merge base, or `null` when git
 * cannot answer.
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
  const mergeBase = run(['merge-base', base, 'HEAD']);
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
  return parseUnifiedDiffRanges(diff.stdout);
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

const overlaps = (a: LineRange, b: LineRange): boolean => a.start <= b.end && b.start <= a.end;

/**
 * Clone groups with at least one instance overlapping a changed line.
 *
 * "At least one inside" rather than the roadmap's "one inside and one outside":
 * a group whose instances are *all* inside the diff is a block pasted twice
 * within one change — the purest case the gate exists to stop, and excluding it
 * would be a hole an author can drive through.
 *
 * `detect.ts` has its own `overlaps`, but it is unexported and compares token
 * indices inside the detection pipeline; reaching into it would couple this gate
 * to detection internals for a one-line comparison.
 */
export function flaggedGroups(report: CloneReport, changed: ChangedRanges): readonly CloneGroup[] {
  return report.groups.filter((group) =>
    group.instances.some((instance) => {
      const ranges = changed.get(instance.file);
      if (ranges === undefined) return false;
      const span: LineRange = { start: instance.startLine, end: instance.endLine };
      return ranges.some((range) => overlaps(span, range));
    }),
  );
}
