import { z } from 'zod';

/**
 * CR review lanes. `subagent` is the only lane that runs fully unattended —
 * see DEFAULT_CR_LANES in `./config.ts`. Lives in core (not `cr/`) because
 * the repo-wide config loader validates `crLanes` blocks against it.
 */
export const laneSchema = z.enum(['manual', 'codex', 'subagent', 'standalone', 'verify']);
export type Lane = z.infer<typeof laneSchema>;

/** Reviewable artifact kinds — the keys of a `crLanes` config block. */
export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
