import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { isReleaseSweepAllowed, touchesCode } from './allowlist.js';
import {
  CREATE_COMMAND,
  FILE as SNAPSHOT_FILE,
  readSummaryBodyRolloutSnapshot,
} from './summary-body-rollout.js';
import { parseTrailers, stripTrailers } from './trailers.js';

const execFileP = promisify(execFile);

/** Section markers a summary-worthy commit body must carry. */
const SECTIONS = ['Why', 'How', 'What'] as const;

/**
 * Minimum content per section, in non-whitespace characters.
 *
 * Long enough to reject `Why — x`, short enough never to block an honest
 * one-line reason. Any threshold is arbitrary; this one is cheap to change.
 */
const MIN_SECTION_CHARS = 24;

/**
 * Subjects git generates for the autosquash family: `git commit --fixup`,
 * `--squash`, and the `amend!` that `--fixup=reword:<sha>` writes.
 *
 * Exempt on the **advisory** side only, and that asymmetry is the point. At
 * `commit-msg` the object really is provisional — it exists to be folded into
 * the commit it names, so demanding prose from it is noise. At `pre-push` the
 * same subject is a one-token bypass of the entire gate: `git commit -m
 * 'fixup! x'` over any `src/**` change would push clean, and the object is
 * crossing the boundary *unsquashed*, with nothing to guarantee the rebase it
 * names ever happens or that its target is even in the push. The parked design's
 * rationale ("squashed away by the rebase it names") was true of a provisional
 * message and is false of a stored one, so it does not survive the move.
 *
 * A genuinely in-flight fixup push is the `--no-verify` case, or a rebase away.
 *
 * `Merge ` and `Revert "` are deliberately NOT here at all. Merge identity comes
 * from the object's parent count, which no author can forge; a revert that
 * survives into pushed history is an ordinary single-parent commit and owes the
 * same explanation as any other.
 */
const EXEMPT_SUBJECT_RE = /^(?:fixup!|squash!|amend!)/;

/** `Noldor-Path` values written by release automation rather than by an author. */
const AUTOMATION_PATHS = new Set(['release-automation', 'release-sweep']);

/** The subject `pnpm release` writes; `release-automation` must carry it. */
const RELEASE_SUBJECT_RE = /^chore\(release\): v\d+\.\d+\.\d+$/;

/**
 * Does this object *earn* its automation exemption, rather than merely declare it?
 *
 * At `commit-msg` the trailer is corroborated by `validateReleaseAutomation`:
 * a release subject, and a staged set of release outputs only. None of that
 * survives `git commit --no-verify`, so accepting the bare trailer at pre-push
 * would make `--trailer 'Noldor-Path: release-automation'` on any `src/**`
 * change a one-line bypass of the whole gate — structurally the same hole the
 * autosquash subjects were closed for, and rejected here for the same reason.
 *
 * So the object has to corroborate the claim itself: `release-automation` must
 * carry the release subject, and `release-sweep` must touch sweep outputs only.
 *
 * // noldor:cut subject-only check for release-automation — commit-msg also
 * requires every file to be a release output, which needs `lockstepPackages`
 * from consumer config and would make this function impure. The subject gate
 * already removes the one-line bypass, since a forged trailer now also needs a
 * `chore(release): vX.Y.Z` subject. Upgrade path: thread the resolved package
 * paths in through `SummaryCommitInput` and apply the full allowlist here.
 */
function earnsAutomationExemption(input: {
  message: string;
  files: readonly string[];
  noldorPath?: string;
}): boolean {
  const path = input.noldorPath?.trim();
  if (path === undefined || !AUTOMATION_PATHS.has(path)) return false;

  if (path === 'release-sweep') return isReleaseSweepAllowed([...input.files]);

  const subject = input.message.split('\n', 1)[0]?.trim() ?? '';
  return RELEASE_SUBJECT_RE.test(subject);
}

/** Git's default comment character. Overridable via `core.commentChar`. */
const DEFAULT_COMMENT_CHAR = '#';

const TEMPLATE = [
  'Why — the problem or motivation, plainly, then the technical detail.',
  'How — the mechanism, and where it hooks in.',
  'What — the concrete outcome: files, commands, behaviour.',
].join('\n');

/**
 * One stored commit object, as `pre-push` loads it.
 *
 * Every field is immutable once git has written the commit: changing any of them
 * produces a different SHA. That is the whole point of the redesign — the parked
 * spike judged a provisional message file plus whatever repository state existed
 * during one git invocation, and spent eight review rounds discovering that the
 * set of such states is open-ended.
 */
export interface SummaryCommitInput {
  sha: string;
  message: string;
  files: readonly string[];
  parentCount: number;
  /**
   * `Noldor-Path` from git's own final trailer block, supplied by the caller
   * **only** when that block holds exactly one value for the key.
   *
   * There is no regex fallback over the raw message here, deliberately: a
   * `Noldor-Path: release-automation` line written in body prose would then buy
   * a real exemption, which is the same forgeable-marker hole the merge subject
   * check rejects. Absent means "no automation exemption", never "look harder".
   */
  noldorPath?: string;
}

export interface SummaryCommitResult {
  success: boolean;
  subject: string;
  error?: string;
}

/**
 * Content length of one section: everything from its marker to the next marker
 * (or the end of the body), with the marker itself and all whitespace removed.
 */
function sectionLength(body: string, section: string): number | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${section} —`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => SECTIONS.some((s) => l.startsWith(`${s} —`)));
  const own = [
    lines[start]!.slice(`${section} —`.length),
    ...(end === -1 ? rest : rest.slice(0, end)),
  ];
  return own.join('').replace(/\s/g, '').length;
}

/** Shared section measurement + diagnostic, over an already-cleaned body. */
function measureSections(body: string): { ok: boolean; error?: string } {
  const missing: string[] = [];
  const thin: string[] = [];
  for (const section of SECTIONS) {
    const len = sectionLength(body, section);
    if (len === null) missing.push(section);
    else if (len < MIN_SECTION_CHARS) thin.push(section);
  }
  if (missing.length === 0 && thin.length === 0) return { ok: true };

  const colonForm = SECTIONS.filter((s) => new RegExp(`^${s}:`, 'm').test(body));
  const hint =
    colonForm.length > 0
      ? ` Found ${colonForm.map((s) => `\`${s}:\``).join(', ')} — use an em dash (\`${colonForm[0]} —\`), since \`${colonForm[0]}:\` is a valid git trailer and interpret-trailers absorbs it.`
      : '';

  const parts = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    thin.length > 0 ? `under ${MIN_SECTION_CHARS} chars: ${thin.join(', ')}` : '',
  ].filter(Boolean);

  return { ok: false, error: `${parts.join('; ')}.${hint}` };
}

/**
 * The prose of a **stored** commit: message minus subject, minus trailers.
 *
 * No comment stripping and no scissors handling, because git removed the editor
 * furniture before writing the object. Every `core.commentChar` /
 * `core.commentString` / `commit -v` defect the spike chased lived in the gap
 * between the provisional file and this.
 */
function storedBody(message: string): string {
  const [, ...rest] = message.split('\n');
  return stripTrailers(rest.join('\n'));
}

/**
 * Exemptions decidable from the commit header alone — parent count, subject,
 * and the resolved `Noldor-Path` trailer — with no path set required.
 *
 * Split out so a caller can skip loading paths for an object that is already
 * exempt. It must NOT be conflated with the full check by passing an empty file
 * list: `touchesCode([])` is false, so an empty set reads as "carries no code"
 * and exempts *everything*, silently disabling the gate.
 */
export function isExemptByHeader(input: { parentCount: number }): boolean {
  // Merge identity from the object itself, and nothing else. A single-parent
  // commit whose subject reads `Merge branch 'x'` is an ordinary commit wearing a
  // costume; an autosquash subject belongs to the advisory adapter (see
  // EXEMPT_SUBJECT_RE); and the automation trailer must be corroborated by the
  // commit's own paths or subject, which are not header facts.
  return input.parentCount > 1;
}

/**
 * Does this stored commit explain itself?
 *
 * Pure. Cheapest and most certain discriminators first, so an exempt object is
 * classified without its path set ever being loaded.
 */
export function validateSummaryCommit(input: SummaryCommitInput): SummaryCommitResult {
  const subject = input.message.split('\n', 1)[0]?.trim() ?? '';

  if (isExemptByHeader(input)) return { success: true, subject };
  if (earnsAutomationExemption(input)) return { success: true, subject };

  // The contract is "a commit that carries code explains itself", so the
  // exemption is the negation of `touchesCode` — not `isBookkeepingOnly`, which
  // would leave prose that is neither bookkeeping nor code (`docs/noldor/**`,
  // root `*.md`, `.claude/**`, the `templates/` twins) demanding three sections
  // for a README typo. An empty path set has nothing to explain either.
  if (!touchesCode([...input.files])) return { success: true, subject };

  const measured = measureSections(storedBody(input.message));
  if (measured.ok) return { success: true, subject };

  return {
    success: false,
    subject,
    error: `commit body must explain the change (${measured.error})`,
  };
}

/** The three-line template, for callers rendering a rejection. */
export function summaryBodyTemplate(): string {
  return TEMPLATE;
}

// ---------------------------------------------------------------------------
// Advisory adapter (`pnpm noldor validate summary-body <message-file>`)
//
// Reads the provisional message file and the current index. Its input is exactly
// the transient state the blocking adapter refuses to trust, so it claims no
// authority: every path below returns 0. It exists to make the fix cheap at
// commit time, not to certify anything.
// ---------------------------------------------------------------------------

/**
 * Git's `commit -v` scissors line for a given comment character. Everything
 * below it is the diff git appends for the author to read; not part of the
 * message.
 */
function scissorsRe(commentChar: string): RegExp {
  return new RegExp(`^${commentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-+\\s*>8\\s*-+`);
}

/**
 * Provisional prose: message minus subject, comments, the `-v` diff, and
 * trailers. Best-effort by nature — this is the cleanup whose incompleteness
 * disqualified the provisional file as an enforcement input.
 */
export function provisionalBody(message: string, commentChar = DEFAULT_COMMENT_CHAR): string {
  const [, ...rest] = message.split('\n');
  const re = scissorsRe(commentChar);
  const scissors = rest.findIndex((l) => re.test(l));
  const lines = scissors === -1 ? rest : rest.slice(0, scissors);
  return stripTrailers(lines.filter((l) => !l.startsWith(commentChar)).join('\n'));
}

/** Run a git command, or return null when it fails. */
async function git(args: string[], cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', args, cwd === undefined ? {} : { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Best-effort guess at the files the commit being written will carry.
 *
 * `-z` and split on NUL, not newline: without it git quotes any path with
 * non-ASCII or special characters (`"src/caf\303\251.ts"`), which then matches
 * no glob. Amend stages nothing, so the staged set is empty and HEAD's own diff
 * stands in.
 *
 * Every known gap here — `--amend` with unrelated staged files, `--allow-empty`
 * on a clean tree — is now a false *advisory*, not a false pass of the gate.
 * That is the point of demoting this adapter rather than continuing to patch it.
 */
export async function loadCommitFiles(cwd?: string): Promise<string[] | null> {
  const staged = await git(['diff', '--cached', '--name-only', '-z'], cwd);
  if (staged === null) return null;
  if (staged.length > 0) return staged.split('\0').filter(Boolean);

  const amended =
    (await git(['diff', '--name-only', '-z', 'HEAD^', 'HEAD'], cwd)) ??
    (await git(['show', '--pretty=', '--name-only', '-z', 'HEAD'], cwd));
  return (amended ?? '').split('\0').filter(Boolean);
}

export async function main(messageFile: string | undefined): Promise<number> {
  if (messageFile === undefined) {
    console.error('summary-body advisory: no commit-message file passed');
    return 0;
  }

  const cwd = process.cwd();
  const read = readSummaryBodyRolloutSnapshot(cwd);
  if (read.kind === 'absent') {
    // Never a silent disable: without this line, deleting one tracked file turns
    // the whole gate off with no output — the push-time override the design
    // lists as a non-goal, reachable by `rm`.
    console.error(
      `summary-body advisory: gate inactive — ${SNAPSHOT_FILE} is missing. ` +
        `Run \`${CREATE_COMMAND}\` to activate it.`,
    );
    return 0;
  }
  if (read.kind === 'invalid') {
    // Still advises below: unlike `absent`, the repo *did* opt in — only the
    // grandfathering boundary is unreadable, and body advice never depended on
    // it. pre-push exits 2 on this same file, where the authority lives.
    console.error(
      `summary-body advisory: ${SNAPSHOT_FILE} is corrupt (${read.reason}) — ` +
        `pre-push will reject until it is repaired.`,
    );
  }

  let message: string;
  try {
    message = await readFile(messageFile, 'utf8');
  } catch (err) {
    console.error(`summary-body advisory: skipped (${(err as Error).message})`);
    return 0;
  }

  const files = await loadCommitFiles();
  if (files === null) {
    console.error('summary-body advisory: skipped (could not read the staged paths)');
    return 0;
  }

  const subject = message.split('\n', 1)[0]?.trim() ?? '';
  if (EXEMPT_SUBJECT_RE.test(subject)) return 0;
  if (!touchesCode(files)) return 0;

  let noldorPath: string | undefined;
  try {
    noldorPath = parseTrailers(message)['Noldor-Path'];
  } catch {
    noldorPath = undefined;
  }
  if (noldorPath !== undefined && AUTOMATION_PATHS.has(noldorPath.trim())) return 0;

  // `core.commentString` (git >= 2.45) supersedes `core.commentChar`; both accept
  // multi-character markers. Only `auto` is rejected.
  const configured =
    (await git(['config', '--get', 'core.commentString'])) ??
    (await git(['config', '--get', 'core.commentChar']));
  const commentChar =
    configured !== null && configured.length > 0 && configured !== 'auto'
      ? configured
      : DEFAULT_COMMENT_CHAR;

  const measured = measureSections(provisionalBody(message, commentChar));
  if (!measured.ok) {
    console.error(
      `summary-body advisory: this commit looks like it carries code but does not ` +
        `explain itself (${measured.error})\n\n${TEMPLATE}\n\n` +
        `Not blocking — pre-push checks the stored commit object, which is what counts.`,
    );
  }
  return 0;
}

// `pathToFileURL`, not a `file://` template: a repo path needing percent-encoding
// (a space is enough) makes the naive comparison false, `main` never runs, and the
// process exits 0 with no diagnostic. Consumers install into arbitrary paths.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`summary-body advisory: skipped (${(err as Error).message})`);
      process.exitCode = 0;
    });
}
