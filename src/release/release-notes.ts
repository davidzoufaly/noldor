import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { CATEGORIES, FeatureFrontmatterSchema } from '../features/feature-schema.js';
import { EMPTY_SUMMARY_PLACEHOLDER } from './release-fd-changelog.js';

import type { Category } from '../features/feature-schema.js';

/**
 * One feature's contribution to a release-notes entry.
 */
export interface ReleaseNotesFeature {
  slug: string;
  name: string;
  category: Category;
  summaryFirstParagraph: string;
  kind: 'introduced' | 'updated';
  /**
   * Pre-rendered `### <version>` block from the FD `## Changelog` section
   * (or `### Initial Release (v<version>)` for first-done FDs). When present,
   * its `#### Summary` overrides {@link summaryFirstParagraph} in the rendered
   * release-notes entry. Null when the FD has no version-specific block for
   * this release (or for callers that don't pre-render one).
   */
  changelogBlock: string | null;
}

/**
 * Inputs to {@link renderReleaseNotesEntry}.
 */
export interface ReleaseNotesInput {
  version: string;
  date: string;
  features: ReleaseNotesFeature[];
}

/**
 * Render a single release-notes entry. Empty `features` produces a compact
 * "No user-facing feature changes" placeholder so internal-only releases
 * still get a section.
 *
 * @param input - Version + date + features touched in this release
 * @returns The rendered Markdown entry
 */
export async function renderReleaseNotesEntry(input: ReleaseNotesInput): Promise<string> {
  const lines: string[] = [`## v${input.version} — ${input.date}`, ''];

  if (input.features.length === 0) {
    lines.push('No user-facing feature changes in this release — internal work only.', '');
    return lines.join('\n');
  }

  for (const category of CATEGORIES) {
    const inCat = input.features.filter((f) => f.category === category);
    if (inCat.length === 0) {
      continue;
    }
    lines.push(`### ${category}`, '');
    for (const f of inCat) {
      const tag = f.kind === 'updated' ? ' *(updated)*' : '';
      lines.push(`#### ${f.name}${tag}`, '');
      // Prefer the version-specific FD Changelog Summary when authored —
      // applies to both `introduced` and `updated`. Falls back to the FD's
      // top-level `## Summary` first paragraph when no version-specific
      // summary is present. Never emit commit bullets — those live in git
      // log + GitHub release pages, not in user-facing release notes.
      const fromChangelog = f.changelogBlock ? extractChangelogSummary(f.changelogBlock) : null;
      const text =
        fromChangelog && fromChangelog.length > 0 ? fromChangelog : f.summaryFirstParagraph;
      lines.push(text, '');
      const featureLink = `[Feature page](/features/${f.slug})`;
      lines.push(featureLink, '');
    }
  }

  return lines.join('\n');
}

/**
 * Insert a new release-notes entry after the `# Release Notes` H1.
 *
 * @param existing - Current `docs/release-notes.md` contents
 * @param entry - Rendered new entry to prepend
 * @returns Updated file contents
 */
export function prependToReleaseNotes(existing: string, entry: string): string {
  const trimmed = existing.trim();
  if (trimmed.length === 0) {
    return `# Release Notes\n\n${entry.trimEnd()}\n`;
  }
  if (!trimmed.startsWith('# Release Notes')) {
    return `# Release Notes\n\n${entry.trimEnd()}\n\n${trimmed}\n`;
  }
  const afterH1 = trimmed.indexOf('\n') + 1;
  const head = trimmed.slice(0, afterH1);
  const tail = trimmed.slice(afterH1).replace(/^\n+/, '');
  return `${head}\n${entry.trimEnd()}\n\n${tail}\n`;
}

function extractChangelogSummary(block: string): string | null {
  const summaryIdx = block.indexOf('#### Summary');
  if (summaryIdx === -1) return null;
  const afterHeading = block.slice(summaryIdx + '#### Summary'.length);
  const nextSub = afterHeading.match(/^####\s/m);
  const text = afterHeading.slice(0, nextSub?.index ?? afterHeading.length).trim();
  if (text === EMPTY_SUMMARY_PLACEHOLDER || text.length === 0) return null;
  return text;
}

function extractFirstParagraph(body: string, heading: string): string {
  const headingIndex = body.indexOf(heading);
  if (headingIndex === -1) {
    return '';
  }
  const afterHeading = body.slice(headingIndex + heading.length);
  const paragraphs = afterHeading
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('##'));
  return paragraphs[0] ?? '';
}

/**
 * Read `docs/features/*.md` and return the ones whose `introduced` or
 * `updated` field equals the new version, as `ReleaseNotesFeature` records
 * ready for render. Sorted by feature name.
 *
 * @param newVersion - Version being released (e.g. `0.2.0`)
 * @param changelogBlocks - Map from feature slug to pre-rendered changelog block
 * @returns Features eligible for the release-notes entry
 */
export async function collectFeaturesForRelease(
  newVersion: string,
  changelogBlocks: Map<string, string>,
): Promise<ReleaseNotesFeature[]> {
  const dir = 'docs/features';
  const entries = await readdir(dir, { withFileTypes: true });
  const results: ReleaseNotesFeature[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const path = join(dir, entry.name);
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const fm = FeatureFrontmatterSchema.parse(parsed.data);

    let kind: 'introduced' | 'updated' | null = null;
    if (fm.introduced === newVersion) {
      kind = 'introduced';
    } else if (fm.updated === newVersion) {
      kind = 'updated';
    }
    if (kind === null) {
      continue;
    }

    const slug = entry.name.replace(/\.md$/, '');
    const summaryFirstParagraph = extractFirstParagraph(parsed.content, '## Summary');
    results.push({
      category: fm.category,
      kind,
      name: fm.name,
      slug,
      summaryFirstParagraph,
      changelogBlock: changelogBlocks.get(slug) ?? null,
    });
  }

  return results.toSorted((a, b) => a.name.localeCompare(b.name));
}
