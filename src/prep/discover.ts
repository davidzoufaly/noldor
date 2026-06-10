import { existsSync, readdirSync } from 'node:fs';

import { loadDocRoots } from '../core/doc-roots.js';
import { sizeToTier } from '../core/size-routing.js';
import { parseRoadmap } from '../utils/parse-blocks.js';

import type { PrepEntry } from './types.js';

const M_PLUS = new Set(['M', 'L', 'XL']);

/**
 * Roadmap entries eligible for parallel prep: size M/L/XL, and not already designed
 * (no `*-<slug>-design.md` spec and no `docs/features/<slug>.md` FD). Pure — the
 * caller passes the spec filenames and FD slugs it read from disk.
 */
export function discoverPrepEntries(
  roadmapRaw: string,
  specFiles: readonly string[],
  fdSlugs: readonly string[],
): PrepEntry[] {
  const fdSet = new Set(fdSlugs);
  // Anchored slug parse: a bare endsWith would false-match a slug that is a hyphen-suffix of a
  // longer spec slug (e.g. "drain" vs a "...-queue-drain-design.md" file).
  const SPEC_RE = /^\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/;
  const specced = new Set(
    specFiles.map((f) => SPEC_RE.exec(f)?.[1]).filter((s): s is string => Boolean(s)),
  );
  const out: PrepEntry[] = [];
  for (const e of parseRoadmap(roadmapRaw)) {
    const size = (e.size ?? '').toUpperCase();
    if (!M_PLUS.has(size)) continue;
    if (fdSet.has(e.slug) || specced.has(e.slug)) continue;
    out.push({
      slug: e.slug,
      name: e.name,
      size,
      tier: sizeToTier(size),
      area: e.area,
      ...(e.parent !== undefined ? { parent: e.parent } : {}),
      deps: e.deps ?? [],
      body: e.description,
    });
  }
  return out;
}

export function listSpecFiles(cwd: string): string[] {
  const dir = loadDocRoots(cwd).specs;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md'));
}

export function listFdSlugs(cwd: string): string[] {
  const dir = loadDocRoots(cwd).features;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}
