import { z } from 'zod';
import type { Stage } from '../core/rules/stage.js';

const STAGES = ['triage', 'code', 'review', 'release'] as const satisfies readonly Stage[];

/** Raw frontmatter as authored in `.noldor/rules/<id>.md` (kebab keys). */
export const RuleFrontmatterSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    'applies-to': z.array(z.string().min(1)).optional(),
    stage: z.array(z.enum(STAGES)).optional(),
    enforce: z.boolean().optional(),
    links: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type RuleFrontmatter = z.infer<typeof RuleFrontmatterSchema>;

/** Normalised, in-memory rule. */
export interface Rule {
  readonly id: string;
  readonly appliesTo: string[];
  readonly stage: Stage[];
  readonly enforce: boolean;
  readonly links: string[];
  readonly body: string;
}

export function frontmatterToRule(fm: RuleFrontmatter, body: string): Rule {
  return {
    id: fm.id,
    appliesTo: fm['applies-to'] ?? [],
    stage: fm.stage ?? [],
    enforce: fm.enforce ?? false,
    links: fm.links ?? [],
    body: body.trim(),
  };
}
