import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { touchesCode } from './allowlist.js';
import { isPostRollout, rolloutMarkerExists } from './rollout-marker.js';
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
 * Subjects whose message is machine-shaped, with no author to ask for prose.
 *
 * Forgeable, unlike the `MERGE_HEAD` signal below — accepted because a forged
 * `fixup!` is squashed away by the rebase it names or ships with a subject that
 * announces itself, and no comparable git state exists for these.
 */
const EXEMPT_SUBJECT_RE = /^(?:fixup!|squash!|Revert ")/;

/** `Noldor-Path` values written by release automation rather than by an author. */
const AUTOMATION_PATHS = new Set(['release-automation', 'release-sweep']);

/**
 * Fallback for the automation check when `git interpret-trailers` is unavailable.
 * `parseTrailers` throws by contract, and failing a release-automation commit
 * closed over a missing git binary would be the wrong trade.
 */
const AUTOMATION_PATH_RE = /^Noldor-Path:\s*(?:release-automation|release-sweep)\s*$/m;

export interface ValidateSummaryBodyInput {
  /** Full commit message (subject + body + trailers). */
  message: string;
  /** Files staged in the commit (`git diff --cached --name-only`, no `--diff-filter`). */
  stagedFiles: string[];
  /**
   * True when a merge is in progress. Resolved by the CLI entry via
   * `git rev-parse -q --verify MERGE_HEAD`; absent or false means "not a merge".
   *
   * Fail-closed by design: a caller that never learned the state must not buy
   * the exemption by omission. Keyed on git's own state rather than a `Merge `
   * subject because a subject is forgeable — `git commit -m "Merge branch 'x'"`
   * with any code staged would otherwise walk past this check, and unlike
   * `--no-verify` it would leave the pre-push receipt gate satisfied.
   */
  mergeInProgress?: boolean;
  /**
   * The repo's `core.commentChar`, resolved by the CLI entry. Defaults to `#`.
   *
   * Hardcoding `#` would reopen the hole `ead33c0` closed for any repo that
   * configures another character: the comment block — and under `commit -v` the
   * whole appended diff — would survive into the body and pad the final section
   * past the length floor.
   */
  commentChar?: string;
}

export interface ValidateSummaryBodyResult {
  success: boolean;
  error?: string;
}

/** Git's default comment character. Overridable via `core.commentChar`. */
const DEFAULT_COMMENT_CHAR = '#';

/**
 * Git's `commit -v` scissors line for a given comment character. Everything
 * below it is the diff git appends for the author to read; not part of the
 * message.
 */
function scissorsRe(commentChar: string): RegExp {
  return new RegExp(`^${commentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-+\\s*>8\\s*-+`);
}

/**
 * The commit's prose: message minus subject, comments, the `-v` diff, and
 * trailers.
 *
 * Dropping git's editor furniture is what makes {@link MIN_SECTION_CHARS} mean
 * anything. `sectionLength` measures a marker to the next marker or the end of
 * the body, so without this the final section absorbs the comment block — and
 * under `git commit -v`, the entire appended diff — and any `What — x` clears
 * the floor. Truncating at the scissors is required on top of dropping `#`
 * lines: the marker itself is a comment, but the diff beneath it is not.
 */
function bodyOf(message: string, commentChar = DEFAULT_COMMENT_CHAR): string {
  const [, ...rest] = message.split('\n');
  const re = scissorsRe(commentChar);
  const scissors = rest.findIndex((l) => re.test(l));
  const lines = scissors === -1 ? rest : rest.slice(0, scissors);
  return stripTrailers(lines.filter((l) => !l.startsWith(commentChar)).join('\n'));
}

/** Is this commit written by release automation rather than an author? */
function isAutomation(message: string): boolean {
  try {
    const path = parseTrailers(message)['Noldor-Path'];
    return path !== undefined && AUTOMATION_PATHS.has(path.trim());
  } catch {
    return AUTOMATION_PATH_RE.test(message);
  }
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

const TEMPLATE = [
  'Why — the problem or motivation, plainly, then the technical detail.',
  'How — the mechanism, and where it hooks in.',
  'What — the concrete outcome: files, commands, behaviour.',
].join('\n');

/**
 * Does this commit message explain itself?
 *
 * Pure: every git-state input arrives via {@link ValidateSummaryBodyInput}, so
 * both merge directions and the whole exemption matrix are unit-testable. The
 * CLI entry below owns the `git` calls.
 *
 * Structure only. Whether a Why section reads plainly or in jargon is the
 * `pr-summary-why-how-what` rule's bar, held by the reviewer and the code-stage
 * CR — a validator can require that a reason exists, never that it is a good one.
 */
export function validateSummaryBody(input: ValidateSummaryBodyInput): ValidateSummaryBodyResult {
  if (input.mergeInProgress === true) return { success: true };

  const subject = input.message.split('\n', 1)[0]?.trim() ?? '';
  if (EXEMPT_SUBJECT_RE.test(subject)) return { success: true };
  if (isAutomation(input.message)) return { success: true };

  // The contract is "a commit that carries code explains itself", so the
  // exemption is the negation of `touchesCode` — not `isBookkeepingOnly`, which
  // would leave the third category (prose that is neither bookkeeping nor code:
  // `docs/noldor/**`, root `*.md`, `.claude/**`, the `templates/` twins)
  // demanding three sections for a README typo. An empty set — `--allow-empty`,
  // or a staged set that could not be read — has nothing to explain either, and
  // `touchesCode([])` is already false.
  if (!touchesCode(input.stagedFiles)) return { success: true };

  const body = bodyOf(input.message, input.commentChar ?? DEFAULT_COMMENT_CHAR);
  const missing: string[] = [];
  const thin: string[] = [];
  for (const section of SECTIONS) {
    const len = sectionLength(body, section);
    if (len === null) missing.push(section);
    else if (len < MIN_SECTION_CHARS) thin.push(section);
  }
  if (missing.length === 0 && thin.length === 0) return { success: true };

  const colonForm = SECTIONS.filter((s) => new RegExp(`^${s}:`, 'm').test(body));
  const hint =
    colonForm.length > 0
      ? ` Found ${colonForm.map((s) => `\`${s}:\``).join(', ')} — use an em dash (\`${colonForm[0]} —\`), since \`${colonForm[0]}:\` is a valid git trailer and interpret-trailers absorbs it.`
      : '';

  const parts = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    thin.length > 0 ? `under ${MIN_SECTION_CHARS} chars: ${thin.join(', ')}` : '',
  ].filter(Boolean);

  return {
    success: false,
    error: `commit body must explain the change (${parts.join('; ')}).${hint}\n\n${TEMPLATE}\n\nBookkeeping-only commits (roadmap, FD, spec/plan) are exempt.`,
  };
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
 * The files the commit being written will carry.
 *
 * Normally the staged set — no `--diff-filter`, since a deletion-only commit is
 * still a code change.
 *
 * `git commit --amend` stages nothing, so the staged set is empty and the
 * empty-set exemption would let a code commit's body be rewritten to nothing.
 * Amend is routine here (CR receipt trailers, `--amend --no-edit`), so the
 * amend shape is detected — index tree identical to HEAD's tree, with a HEAD
 * present — and the commit's own files are used instead.
 *
 * A `--allow-empty` commit on a clean tree has the same shape and is therefore
 * measured against HEAD's files too. That is the accepted trade: an empty
 * commit reusing a code commit's file list may be asked for a body, which is a
 * far cheaper error than a silent bypass of the whole gate.
 */
export async function loadCommitFiles(cwd?: string): Promise<string[] | null> {
  // `-z` and split on NUL, not newline: without it git quotes any path with
  // non-ASCII or special characters (`"src/caf\303\251.ts"`), which then matches
  // no glob — so `touchesCode` says false and a real source rewrite renders
  // "Doc-only change". Same idiom as `src/core/commit-cli.ts`.
  const staged = await git(['diff', '--cached', '--name-only', '-z'], cwd);
  if (staged === null) return null;
  if (staged.length > 0) return staged.split('\0').filter(Boolean);

  // No index-vs-HEAD tree comparison here: `git diff --cached` IS that
  // comparison, so an empty result already proves the trees match. Running
  // `git write-tree` to re-establish it would also write tree objects into
  // .git/objects from what is otherwise a read-only validation path.
  //
  // HEAD vs its parent; on a root commit there is no parent, so list HEAD itself.
  const amended =
    (await git(['diff', '--name-only', '-z', 'HEAD^', 'HEAD'], cwd)) ??
    (await git(['show', '--pretty=', '--name-only', '-z', 'HEAD'], cwd));
  return (amended ?? '').split('\0').filter(Boolean);
}

/** True while a merge is in progress — git's own state, not a subject line. */
async function mergeInProgress(): Promise<boolean> {
  try {
    await execFileP('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
}

export async function main(messageFile: string | undefined): Promise<number> {
  if (messageFile === undefined) {
    console.error('✗ commit-msg gate: no commit-message file passed');
    return 1;
  }

  const cwd = process.cwd();
  // Soft mode, mirroring `validateTrailer`: a consumer that has not armed the
  // rollout marker must not have their first post-upgrade commit rejected.
  if (!rolloutMarkerExists(cwd)) return 0;
  try {
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD']);
    if (!isPostRollout(stdout.trim(), cwd)) return 0;
  } catch {
    return 0; // empty repo / no HEAD — nothing to enforce against
  }

  // Fail open on an unreadable / removed message file, like every other IO
  // failure here — a gate that cannot read its input must not kill the commit.
  let message: string;
  try {
    message = await readFile(messageFile, 'utf8');
  } catch (err) {
    console.error(`commit-msg gate skipped: ${(err as Error).message}`);
    return 0;
  }

  // A git-plumbing failure must never block a commit.
  const stagedFiles = await loadCommitFiles();
  if (stagedFiles === null) return 0;

  // `auto` means git picks a character that starts no line in the message; `#`
  // is its first candidate and the overwhelmingly common outcome.
  // noldor:cut assumes '#' under core.commentChar=auto — resolve the actual
  // character from the message if a repo ever reports a stripped body.
  const configured = await git(['config', '--get', 'core.commentChar']);
  const commentChar =
    configured !== null && configured.length === 1 ? configured : DEFAULT_COMMENT_CHAR;

  const result = validateSummaryBody({
    commentChar,
    message,
    stagedFiles,
    mergeInProgress: await mergeInProgress(),
  });
  if (!result.success) {
    console.error(`✗ commit-msg gate: ${result.error}`);
    return 1;
  }
  return 0;
}

// `pathToFileURL`, not a `file://` template: a repo path needing percent-encoding
// (a space is enough) makes the naive comparison false, `main` never runs, the
// process exits 0, and every commit passes with no diagnostic — a silently
// disabled gate. Consumers install into arbitrary paths. Same form as
// `src/cli/index.ts`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv[2])
    .then((code) => {
      process.exitCode = code;
    })
    // Fail open, matching the rest of this file: an unreadable message file must
    // not kill the commit with an unhandled rejection.
    .catch((err: unknown) => {
      console.error(`commit-msg gate skipped: ${(err as Error).message}`);
      process.exitCode = 0;
    });
}
