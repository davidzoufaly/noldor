import { PR_IN_SUBJECT_RE, type Commit } from './release-commits.js';

/**
 * Inputs to {@link renderChangelogEntry}.
 */
export interface ChangelogInput {
  version: string;
  date: string;
  features: Commit[];
  fixes: Commit[];
  other: Commit[];
  repoUrl: string;
}

function renderCommit(c: Commit, repoUrl: string): string {
  const shortSha = c.sha.slice(0, 7);
  const commitLink = `([${shortSha}](${repoUrl}/commit/${c.sha}))`;
  if (!c.prNumber) {
    return `- ${c.subject} ${commitLink}`;
  }
  // `prNumber` is harvested from the subject's own `(#N)` suffix, so re-emitting
  // it as a link without stripping renders the reference twice. Strip only on
  // this branch: with no link to carry it, a bare suffix is the whole reference.
  const subject = c.subject.replace(PR_IN_SUBJECT_RE, '');
  return `- ${subject} ${commitLink} ([#${c.prNumber}](${repoUrl}/pull/${c.prNumber}))`;
}

/**
 * Render a single CHANGELOG entry. Omits empty sections; the PR reference
 * `(#N)` appears exactly once per commit — as a link when the commit carries a
 * `prNumber`, otherwise as whatever the subject itself says.
 *
 * @param input - Version + date + classified commits
 * @returns The rendered Markdown entry (no surrounding newlines)
 */
export function renderChangelogEntry(input: ChangelogInput): string {
  const lines: string[] = [`## v${input.version} — ${input.date}`, ''];

  if (input.features.length > 0) {
    lines.push('### Features', '');
    for (const c of input.features) {
      lines.push(renderCommit(c, input.repoUrl));
    }
    lines.push('');
  }
  if (input.fixes.length > 0) {
    lines.push('### Fixes', '');
    for (const c of input.fixes) {
      lines.push(renderCommit(c, input.repoUrl));
    }
    lines.push('');
  }
  if (input.other.length > 0) {
    lines.push('### Other changes', '');
    for (const c of input.other) {
      lines.push(renderCommit(c, input.repoUrl));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Insert a new release entry immediately after the `# Changelog` H1. If the
 * file is empty or missing the H1, create the standard structure.
 *
 * @param existing - Current CHANGELOG.md contents (may be empty)
 * @param entry - The rendered new entry to prepend
 * @returns The updated CHANGELOG contents
 */
export function prependToChangelog(existing: string, entry: string): string {
  const trimmed = existing.trim();
  if (trimmed.length === 0) {
    return `# Changelog\n\n${entry.trimEnd()}\n`;
  }
  if (!trimmed.startsWith('# Changelog')) {
    return `# Changelog\n\n${entry.trimEnd()}\n\n${trimmed}\n`;
  }

  const afterH1 = trimmed.indexOf('\n') + 1;
  const head = trimmed.slice(0, afterH1);
  const tail = trimmed.slice(afterH1).replace(/^\n+/, '');
  return `${head}\n${entry.trimEnd()}\n\n${tail}\n`;
}
