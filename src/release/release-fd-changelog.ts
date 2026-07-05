// src/release/release-fd-changelog.ts
// @tests: feature-md-links-overhaul

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { NOISE_TYPES, stripBang } from './release-noise-types.js';
import { polishSummary } from './llm-polish-summary.js';
import { commitsForFeature } from './release-fd-commits.js';
import { findFirstPrCommit } from './release-find-first-pr-commit.js';
import { renderPrBullets } from './release-pr-bullets.js';
import type { PolishRunner } from './llm-polish-summary.js';
import type { FeatureCommit } from './release-fd-commits.js';

export const EMPTY_SUMMARY_PLACEHOLDER = '_TBD — release-note copy._';

/** Inputs to {@link renderPerReleaseBlock}. */
export interface RenderPerReleaseBlockInput {
  version: string;
  phase: 'in-progress' | 'done';
  commits: FeatureCommit[];
  repoUrl: string;
  /** Test injection — alternate runner for `polishSummary`. */
  polish?: PolishRunner;
  /** Force deterministic-fallback path inside `polishSummary` (no LLM subprocess). */
  offline?: boolean;
}

/**
 * Render a `### <version>[ (in-progress)]` block (no `v` prefix — matches
 * the existing FD changelog convention used across the 53 done FDs).
 * Summary text is auto-generated from filtered commit subjects via
 * {@link polishSummary} (LLM polish with deterministic fallback). Adds a
 * `#### PRs` sub-section when any commit carries a `(#N)` subject suffix;
 * otherwise just `#### Summary`.
 *
 * Returns `null` when no commits survive the noise-type filter — caller
 * should skip the FD entirely in that case.
 */
export async function renderPerReleaseBlock(
  input: RenderPerReleaseBlockInput,
): Promise<string | null> {
  const visible = input.commits.filter((c) => !NOISE_TYPES.has(stripBang(c.type)));
  if (visible.length === 0) {
    return null;
  }
  const summary = await polishSummary(visible, {
    offline: input.offline,
    runner: input.polish,
  });
  const summaryText = summary.trim().length > 0 ? summary.trim() : EMPTY_SUMMARY_PLACEHOLDER;

  const heading =
    input.phase === 'in-progress' ? `### ${input.version} (in-progress)` : `### ${input.version}`;
  const lines: string[] = [heading, '', '#### Summary', '', summaryText];

  const prBullets = renderPrBullets(visible, input.repoUrl);
  if (prBullets.length > 0) {
    lines.push('', '#### PRs', '', ...prBullets);
  }

  return lines.join('\n');
}

/** Inputs to {@link renderInitialReleaseBlock}. */
export interface RenderInitialReleaseBlockInput {
  cwd: string;
  slug: string;
  /** Version anchor for the heading (= `introduced`, about to be set). */
  version: string;
  repoUrl: string;
  polish?: PolishRunner;
  offline?: boolean;
}

/**
 * Render the special `### Initial Release (v<X>)` block at first-done.
 * Cumulative range = `<first-PR-commit-sha>^..HEAD`. If no slug-matching
 * commit has a PR ref (entirely pre-PR-flow FD), range falls back to
 * repo-start AND `#### PRs` is omitted. Returns null when FD has zero
 * slug-matching commits.
 *
 * The `v` prefix on the version is intentional — this is the ONE heading
 * format in the FD changelog that uses `v<X>` (per-release blocks use
 * `### <X>` to match the existing convention across 53 done FDs).
 */
export async function renderInitialReleaseBlock(
  input: RenderInitialReleaseBlockInput,
): Promise<string | null> {
  const inception = await findFirstPrCommit(input.slug, input.cwd);
  const fromRef = inception ? `${inception}^` : '';
  const commits = await commitsForFeature(input.slug, fromRef, 'HEAD', input.cwd);
  const visible = commits.filter((c) => !NOISE_TYPES.has(stripBang(c.type)));
  if (visible.length === 0) return null;

  const summary = await polishSummary(visible, {
    offline: input.offline,
    runner: input.polish,
  });
  const summaryText = summary.trim().length > 0 ? summary.trim() : EMPTY_SUMMARY_PLACEHOLDER;

  const lines: string[] = [
    `### Initial Release (v${input.version})`,
    '',
    '#### Summary',
    '',
    summaryText,
  ];

  const prBullets = renderPrBullets(visible, input.repoUrl);
  if (prBullets.length > 0) {
    lines.push('', '#### PRs', '', ...prBullets);
  }

  return lines.join('\n');
}

/** Inputs to {@link generateFdChangelogs}. */
export interface GenerateFdChangelogsInput {
  featuresDir: string;
  previousTag: string;
  newVersion: string;
  date: string;
  /** Retained for caller compatibility; no longer used inside (Summary is auto-polished, no commit URLs in FD body). */
  repoUrl: string;
  cwd?: string;
  /** Upper bound for the commit range. Defaults to `HEAD`; pass a tag for backfill. */
  toRef?: string;
  /** Test injection — alternate runner for `polishSummary`. */
  polish?: PolishRunner;
  /** Force deterministic-fallback path inside `polishSummary`. */
  offline?: boolean;
}

/**
 * For every `done`-phase FD with at least one qualifying commit since
 * `previousTag`, prepend a `### <newVersion>` block (with auto-polished
 * `#### Summary`) to its `## Changelog` section in place. Any pre-existing
 * `### Unreleased` block in the FD body is dropped via
 * {@link prependChangelogBlock} — Unreleased is rendered live by the
 * dashboard now, never persisted. Returns a map of `slug -> rendered block`
 * for callers that want to surface the same content elsewhere (release notes).
 */
export async function generateFdChangelogs(
  input: GenerateFdChangelogsInput,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = await readdir(input.featuresDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.replace(/\.md$/, '');
    const path = join(input.featuresDir, entry.name);
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const phase = (parsed.data as { phase?: string }).phase;
    if (phase === 'proposed' || phase === undefined) continue;

    const introduced = (parsed.data as { introduced?: string }).introduced;
    const isFirstDone = phase === 'done' && introduced === undefined;

    let block: string | null;
    if (isFirstDone) {
      block = await renderInitialReleaseBlock({
        cwd: input.cwd ?? process.cwd(),
        slug,
        version: input.newVersion,
        repoUrl: input.repoUrl,
        polish: input.polish,
        offline: input.offline,
      });
    } else {
      const commits = await commitsForFeature(
        slug,
        input.previousTag,
        input.toRef ?? 'HEAD',
        input.cwd,
      );
      block = await renderPerReleaseBlock({
        version: input.newVersion,
        phase: phase as 'in-progress' | 'done',
        commits,
        repoUrl: input.repoUrl,
        polish: input.polish,
        offline: input.offline,
      });
    }
    if (!block) continue;

    const newBody = prependChangelogBlock(parsed.content, block);
    await writeFile(path, matter.stringify(newBody.replace(/^\n/, ''), parsed.data), 'utf8');
    result.set(slug, block);
  }
  return result;
}

const CHANGELOG_HEADING = '## Changelog';
const UNRELEASED_HEADING = '### Unreleased';
const VERSION_HEADING_RE = /^### (?:Unreleased|\d)/m;

/**
 * Pull the `#### Summary` text out of a `### Unreleased` block at the top of
 * the `## Changelog` section. Returns `null` if no `### Unreleased` block
 * exists, empty string if it exists without a `#### Summary` body.
 */
export function extractUnreleasedSummary(body: string): string | null {
  const changelogIdx = body.indexOf(CHANGELOG_HEADING);
  if (changelogIdx === -1) return null;
  const afterChangelog = body.slice(changelogIdx + CHANGELOG_HEADING.length);
  const unreleasedIdx = afterChangelog.indexOf(UNRELEASED_HEADING);
  if (unreleasedIdx === -1) return null;

  const afterUnreleased = afterChangelog.slice(unreleasedIdx + UNRELEASED_HEADING.length);
  const nextHeadingMatch = afterUnreleased.match(VERSION_HEADING_RE);
  const blockEnd = nextHeadingMatch?.index ?? afterUnreleased.length;
  const block = afterUnreleased.slice(0, blockEnd);

  const summaryHeadingIdx = block.indexOf('#### Summary');
  if (summaryHeadingIdx === -1) return '';
  const afterSummary = block.slice(summaryHeadingIdx + '#### Summary'.length);
  const nextSubHeadingMatch = afterSummary.match(/^####\s/m);
  const summaryEnd = nextSubHeadingMatch?.index ?? afterSummary.length;
  return afterSummary.slice(0, summaryEnd).trim();
}

/**
 * Insert `block` at the top of the `## Changelog` section of an FD body.
 * If a `### Unreleased` block is present at the top of the section, it is
 * removed first (the new versioned block supersedes it).
 *
 * Creates the `## Changelog` heading at the end of the body if missing.
 *
 * The heading match is line-anchored (`^## Changelog\s*$/m`) so inline
 * markdown references like `"per-version `## Changelog` > ### <version>"`
 * inside prose don't confuse the locator.
 */
export function prependChangelogBlock(body: string, block: string): string {
  const trimmedBlock = block.replace(/\s+$/, '');
  const headingMatch = body.match(/^## Changelog\b/m);
  if (!headingMatch || headingMatch.index === undefined) {
    const trimmed = body.replace(/\s+$/, '');
    return `${trimmed}\n\n${CHANGELOG_HEADING}\n\n${trimmedBlock}\n`;
  }
  const headingEnd = headingMatch.index + CHANGELOG_HEADING.length;
  const head = body.slice(0, headingEnd);
  let rest = body.slice(headingEnd).replace(/^\n+/, '');
  rest = stripUnreleasedBlock(rest);
  return `${head}\n\n${trimmedBlock}\n\n${rest}`;
}

function stripUnreleasedBlock(changelogBody: string): string {
  if (!changelogBody.startsWith(UNRELEASED_HEADING)) return changelogBody;
  const afterUnreleased = changelogBody.slice(UNRELEASED_HEADING.length);
  const nextHeadingMatch = afterUnreleased.match(VERSION_HEADING_RE);
  if (!nextHeadingMatch || nextHeadingMatch.index === undefined) return '';
  return afterUnreleased.slice(nextHeadingMatch.index);
}
