import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isBookkeepingOnly } from './allowlist.js';
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
}

export interface ValidateSummaryBodyResult {
  success: boolean;
  error?: string;
}

/** The commit's prose: message minus subject line, minus trailer lines. */
function bodyOf(message: string): string {
  const [, ...rest] = message.split('\n');
  return stripTrailers(rest.join('\n'));
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

  // Nothing staged (`--allow-empty`, or an unreadable staged set) and pure
  // bookkeeping both mean: no behaviour to explain.
  if (input.stagedFiles.length === 0 || isBookkeepingOnly(input.stagedFiles)) {
    return { success: true };
  }

  const body = bodyOf(input.message);
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

/** Staged paths. No `--diff-filter`: a deletion-only commit is still a code change. */
async function loadStagedFiles(): Promise<string[]> {
  const { stdout } = await execFileP('git', ['diff', '--cached', '--name-only']);
  return stdout.split('\n').filter(Boolean);
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

  const { readFile } = await import('node:fs/promises');
  const message = await readFile(messageFile, 'utf8');

  let stagedFiles: string[];
  try {
    stagedFiles = await loadStagedFiles();
  } catch {
    return 0; // a git-plumbing failure must never block a commit
  }

  const result = validateSummaryBody({
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv[2]).then((code) => {
    process.exitCode = code;
  });
}
