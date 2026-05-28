/**
 * Cross-tree link audit. Pure logic; consumes a track map + parsed feature
 * data, returns findings. No I/O.
 *
 * Spec: § Phase 0 / cross-tree link audit. Findings drive the Phase 2 inline-
 * downgrade pass.
 */

import type { Track } from './classify.ts';

export interface FeatureLinks {
  readonly spec: string;
  readonly code: readonly string[];
  readonly tests: readonly string[];
}

export interface FeatureRecord {
  readonly slug: string;
  readonly deps: readonly string[];
  readonly links: FeatureLinks;
  readonly body: string;
}

export interface CrossTreeFinding {
  readonly sourceSlug: string;
  readonly sourceTrack: Track;
  readonly targetSlug: string;
  readonly targetTrack: Track;
  readonly field: 'deps' | 'body';
}

export interface AuditInput {
  readonly featureTracks: ReadonlyMap<string, Track>;
  readonly features: readonly FeatureRecord[];
}

const BODY_LINK_RE = /\[\[([a-z0-9-]+)\]\]/g;

/**
 * Find cross-tree links. A link is cross-tree iff source and target are both
 * known FDs and their tracks differ (and neither is 'ambiguous' — those need
 * manual classification before audit can decide).
 *
 * Scope (Phase 0): matches only `[[slug]]`-style body links. Markdown links
 * `[label](../slug.md)` are NOT scanned — extend regex if Phase 2 finds them
 * material.
 */
export function auditCrossTreeLinks(input: AuditInput): CrossTreeFinding[] {
  const findings: CrossTreeFinding[] = [];

  for (const feat of input.features) {
    const sourceTrack = input.featureTracks.get(feat.slug);
    if (sourceTrack === undefined || sourceTrack === 'ambiguous') continue;

    for (const targetSlug of feat.deps) {
      const targetTrack = input.featureTracks.get(targetSlug);
      if (targetTrack === undefined || targetTrack === 'ambiguous') continue;
      if (targetTrack !== sourceTrack) {
        findings.push({
          sourceSlug: feat.slug,
          sourceTrack,
          targetSlug,
          targetTrack,
          field: 'deps',
        });
      }
    }

    for (const match of feat.body.matchAll(BODY_LINK_RE)) {
      const targetSlug = match[1];
      const targetTrack = input.featureTracks.get(targetSlug);
      if (targetTrack === undefined || targetTrack === 'ambiguous') continue;
      if (targetTrack !== sourceTrack) {
        findings.push({
          sourceSlug: feat.slug,
          sourceTrack,
          targetSlug,
          targetTrack,
          field: 'body',
        });
      }
    }
  }

  return findings;
}
