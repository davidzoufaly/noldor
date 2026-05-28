// scripts/release/llm-polish-summary.ts
// @tests: dynamic-fd-changelog

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { FeatureCommit } from './release-fd-commits.js';

const execFileP = promisify(execFile);

const LLM_TIMEOUT_MS = 60_000;

/** Runner contract for {@link polishSummary} — subprocess-call indirection for tests. */
export type PolishRunner = (commits: FeatureCommit[]) => Promise<string>;

/**
 * Render a list of commit subjects into a single readable paragraph for an
 * FD's per-version `#### Summary` block.
 *
 * Modes:
 *
 * - `commits.length === 0` → `''`. Caller should skip the version block.
 * - `options.offline === true` or `process.env.CHARUY_NO_LLM === '1'` →
 *   {@link joinSubjectsDeterministic} (no network, no subprocess).
 * - default → invoke the runner (defaults to `claude -p`); on any failure,
 *   fall back to {@link joinSubjectsDeterministic}.
 *
 * @param commits - Filtered feature commits, ordered as returned by `git log`
 * @param options - `offline` to force fallback; `runner` to inject an alternate runner
 * @returns A single-paragraph polished Summary string
 */
export async function polishSummary(
  commits: FeatureCommit[],
  options: { offline?: boolean; runner?: PolishRunner } = {},
): Promise<string> {
  if (commits.length === 0) return '';
  if (options.offline === true || process.env.CHARUY_NO_LLM === '1') {
    return joinSubjectsDeterministic(commits);
  }
  const runner = options.runner ?? runClaudePolish;
  try {
    return await runner(commits);
  } catch {
    return joinSubjectsDeterministic(commits);
  }
}

/**
 * Fallback summariser: join commit subjects as a single sentence-cased
 * paragraph, preserving order. Output is fully deterministic — same input
 * produces same output every time.
 *
 * @param commits - Filtered feature commits
 * @returns Sentence-joined string (each subject capitalised + terminated with `.`)
 */
export function joinSubjectsDeterministic(commits: FeatureCommit[]): string {
  if (commits.length === 0) return '';
  return commits
    .map((c) => {
      const trimmed = c.subject.trim();
      if (trimmed.length === 0) return '';
      const head = trimmed[0].toUpperCase();
      const tail = trimmed.slice(1);
      const period = trimmed.endsWith('.') ? '' : '.';
      return `${head}${tail}${period}`;
    })
    .filter((s) => s.length > 0)
    .join(' ');
}

async function runClaudePolish(commits: FeatureCommit[]): Promise<string> {
  const prompt = buildPrompt(commits);
  const { stdout } = await execFileP('claude', ['-p', prompt], {
    encoding: 'utf8',
    timeout: LLM_TIMEOUT_MS,
  });
  const out = stdout.trim();
  if (out.length === 0) {
    throw new Error('claude -p returned empty output');
  }
  return out;
}

function buildPrompt(commits: FeatureCommit[]): string {
  const subjects = commits.map((c) => `- ${c.type}: ${c.subject}`).join('\n');
  return [
    'Rewrite the following commit subjects as a single concise paragraph for a release-notes Summary section.',
    'Preserve all technical terms and identifiers verbatim (function names, file paths, flags, package names).',
    'Smooth phrasing only; do not invent details that are not in the subjects.',
    'Return plain prose only — no headings, no bullet list, no preamble.',
    '',
    subjects,
  ].join('\n');
}
