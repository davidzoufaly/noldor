import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './findings-schema.js';

export const orchestrateArgsSchema = z.object({
  slug: z.string().min(1),
  artifact: z.string().min(1),
  kind: artifactKindSchema,
  lanes: z.array(laneSchema).optional(),
  baseSha: z.string().optional(),
  headSha: z.string().optional(),
  fullReview: z.boolean().default(false),
  autonomous: z.boolean().default(false),
  profile: z.string().optional(),
});
export type OrchestrateArgs = z.infer<typeof orchestrateArgsSchema>;

export function parseArgs(argv: string[]): OrchestrateArgs {
  const a: Record<string, unknown> = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--slug') a.slug = argv[++i];
    else if (t === '--artifact') a.artifact = argv[++i];
    else if (t === '--kind') a.kind = argv[++i];
    else if (t === '--lanes') a.lanes = argv[++i].split(',');
    else if (t === '--base-sha') a.baseSha = argv[++i];
    else if (t === '--head-sha') a.headSha = argv[++i];
    else if (t === '--full-review') a.fullReview = true;
    else if (t === '--autonomous') a.autonomous = true;
    else if (t === '--profile') a.profile = argv[++i];
  }
  return orchestrateArgsSchema.parse(a);
}
