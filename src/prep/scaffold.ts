import matter from 'gray-matter';

import { loadAreaCategories } from '../core/consumer-config.js';
import { extractTouches } from '../core/extract-touches.js';
import { areaToCategory } from '../lib/area-category.js';

import type { PrepEntry } from './types.js';

export interface ScaffoldOpts {
  /** repo-root-relative spec path, e.g. docs/design/specs/2026-06-10-foo-design.md */
  readonly specRel: string;
  /** repo-root-relative plan path, or null/undefined for specs-only */
  readonly planRel?: string | null;
  readonly cwd: string;
  /** non-empty FD `packages:`; defaults to ['scripts'] */
  readonly packages?: readonly string[];
}

/**
 * Line bounds [start, end) of a `## <heading>` section, fence-aware: a `## ` line inside a fenced
 * code block is NOT a heading (mirrors parse-blocks/write-blocks). null if the heading is absent.
 */
function sectionBounds(lines: string[], heading: string): { start: number; end: number } | null {
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (start === -1) {
      if (lines[i]!.trim() === `## ${heading}`) start = i;
    } else if (/^##\s/.test(lines[i]!)) {
      return { start, end: i };
    }
  }
  return start === -1 ? null : { start, end: lines.length };
}

/** Return the markdown body of a `## <heading>` section (trimmed), or null if absent. */
export function getSectionBody(md: string, heading: string): string | null {
  const lines = md.split('\n');
  const b = sectionBounds(lines, heading);
  if (!b) return null;
  return lines
    .slice(b.start + 1, b.end)
    .join('\n')
    .trim();
}

/** Replace the body under `## <heading>` with newBody, preserving the heading. No-op if absent. */
export function replaceSectionBody(md: string, heading: string, newBody: string): string {
  const lines = md.split('\n');
  const b = sectionBounds(lines, heading);
  if (!b) return md;
  const before = lines.slice(0, b.start + 1);
  const after = lines.slice(b.end);
  return [...before, '', newBody.trim(), '', ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Copy the spec's `## User Story` and `## Usage` into the FD, replacing the TODO stubs. */
export function liftSpecSections(specMd: string, fdMd: string): string {
  let out = fdMd;
  for (const heading of ['User Story', 'Usage']) {
    const body = getSectionBody(specMd, heading);
    if (body && body.length > 0) out = replaceSectionBody(out, heading, body);
  }
  return out;
}

/** Build a feature MD (frontmatter + body stubs) for a roadmap entry. Mirrors /noldor-promote. */
export function scaffoldFd(entry: PrepEntry, opts: ScaffoldOpts): string {
  const { paths, stripped } = extractTouches(entry.body);
  const category = areaToCategory(entry.area, loadAreaCategories(opts.cwd));
  const links: Record<string, unknown> = {
    code: [...paths],
    docs: [],
    tests: [],
    spec: opts.specRel,
  };
  if (opts.planRel) links.plan = opts.planRel;
  const data: Record<string, unknown> = {
    area: entry.area,
    category,
    deps: [...entry.deps],
    links,
    name: entry.name,
    packages: opts.packages && opts.packages.length > 0 ? [...opts.packages] : ['scripts'],
    phase: 'in-progress',
    'noldor-tier': entry.tier,
  };
  const body = [
    '## Summary',
    '',
    stripped.trim() || entry.name,
    '',
    '## User Story',
    '',
    '<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->',
    '',
    '## Usage',
    '',
    '<!-- TODO: UI steps, keyboard shortcut, agent API call. -->',
    '',
    '## PRs',
    '',
    `<!-- @prs-since-last-release: ${entry.slug} -->`,
    '',
    '## Changelog',
    '',
  ].join('\n');
  return matter.stringify(body, data);
}
