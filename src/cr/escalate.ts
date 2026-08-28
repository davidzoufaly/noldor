// scripts/cr/escalate.ts
//
// Step-4 failure-path escalation dispatcher. When a code-review lane or a
// test run goes red, `escalate()` decides whether to spawn the deep-review
// standalone lane, prompt the operator, or abort — controlled by the
// `autonomous` flag and the `onFailure` policy.
import { writeFile } from 'node:fs/promises';
import { slugPath } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import type { LaneInput } from './lane-types.js';
import { runStandalone } from './deep-review-spawn.js';
import { promptSelect } from '../core/prompt-stdin.js';

export type EscalateReason = 'test-red' | 'cr-red';
export type OnFailure = 'prompt' | 'spawn-deep-review' | 'abort';

export interface EscalateInput {
  /** Branded: it names the escalation-context path. */
  slug: Slug;
  reason: EscalateReason;
  context: string;
  cwd: string;
  autonomous: boolean;
  onFailure: OnFailure;
  failingArtifact?: string;
}

export type EscalateOutcome = 'retry-implementation' | 'spawned' | 'override' | 'abort';

export interface EscalateResult {
  outcome: EscalateOutcome;
}

async function writeContext(
  cwd: string,
  slug: Slug,
  reason: EscalateReason,
  context: string,
): Promise<void> {
  const built = slugPath(cwd, ['.noldor', 'cr'], slug, { suffix: '-escalation-context.md' });
  // Branded slug in, so the only reachable refusal is repository tampering
  // inside `.noldor/cr` — and writing the context is the last thing standing
  // between a red CR and a silent one, so it fails loudly rather than quietly.
  if (!built.ok) throw new Error(`cannot write escalation context: ${built.error.kind}`);
  const body = `# Escalation context\n\nslug: ${slug}\nreason: ${reason}\n\n## Detail\n\n${context}\n`;
  await writeFile(built.path, body, 'utf8');
}

async function spawnDeepReview(input: EscalateInput): Promise<EscalateResult> {
  const laneInput: LaneInput = {
    slug: input.slug,
    artifact: input.failingArtifact ?? `.noldor/cr/${input.slug}-escalation-context.md`,
    kind: 'code',
    fdPath: `docs/features/${input.slug}.md`,
    artifactSha: 'HEAD',
    repoRoot: input.cwd,
  };
  await runStandalone(laneInput);
  return { outcome: 'spawned' };
}

export async function escalate(input: EscalateInput): Promise<EscalateResult> {
  await writeContext(input.cwd, input.slug, input.reason, input.context);

  if (input.autonomous) {
    if (input.onFailure === 'abort') return { outcome: 'abort' };
    if (input.onFailure === 'spawn-deep-review') return spawnDeepReview(input);
  }

  const choice = await promptSelect({
    message: `Step 4 ${input.reason} for ${input.slug} — escalate?`,
    choices: [
      { name: 'retry-implementation', value: 'retry-implementation' as const },
      { name: 'spawn-deep-review', value: 'spawn-deep-review' as const },
      { name: 'override-with-trailer', value: 'override' as const },
      { name: 'abort', value: 'abort' as const },
    ],
  });

  if (choice === 'spawn-deep-review') return spawnDeepReview(input);
  return { outcome: choice };
}
