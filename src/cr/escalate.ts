// scripts/cr/escalate.ts
//
// Step-4 failure-path escalation dispatcher. When a code-review lane or a
// test run goes red, `escalate()` decides whether to spawn the deep-review
// standalone lane, prompt the operator, or abort — controlled by the
// `autonomous` flag and the `onFailure` policy.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaneInput } from './lane-types.js';
import { runStandalone } from './deep-review-spawn.js';
import { promptSelect } from '../core/prompt-stdin.js';

export type EscalateReason = 'test-red' | 'cr-red';
export type OnFailure = 'prompt' | 'spawn-deep-review' | 'abort';

export interface EscalateInput {
  slug: string;
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
  slug: string,
  reason: EscalateReason,
  context: string,
): Promise<void> {
  const path = join(cwd, '.noldor', 'cr', `${slug}-escalation-context.md`);
  const body = `# Escalation context\n\nslug: ${slug}\nreason: ${reason}\n\n## Detail\n\n${context}\n`;
  await writeFile(path, body, 'utf8');
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
