import { join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { promptSelect, promptText } from '../prompt-stdin.js';

export async function runManual(input: LaneInput): Promise<LaneResult> {
  const sinkPath = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-manual.json`);
  const startedAt = new Date().toISOString();

  const verdict = await promptSelect({
    message: `manual review for ${input.artifact} — verdict?`,
    choices: [
      { name: 'approve', value: 'approve' as const },
      { name: 'blockers-found', value: 'blockers-found' as const },
      { name: 'suggestions-only', value: 'suggestions-only' as const },
    ],
  });

  const blockers: Finding[] = [];
  const suggestions: Finding[] = [];

  if (verdict !== 'approve') {
    while (true) {
      const sev = await promptSelect({
        message: 'severity (or done)?',
        choices: [
          { name: 'high', value: 'high' as const },
          { name: 'med', value: 'med' as const },
          { name: 'low', value: 'low' as const },
          { name: 'done', value: 'done' as const },
        ],
      });
      if (sev === 'done') break;
      const message = await promptText({ message: 'finding message?' });
      const suggestion = await promptText({
        message: 'suggestion (blank to skip)?',
        default: '',
      });
      const finding: Finding = {
        file: input.artifact,
        severity: sev,
        message,
        ...(suggestion ? { suggestion } : {}),
      };
      if (verdict === 'blockers-found') blockers.push(finding);
      else suggestions.push(finding);
    }
  }

  const payload: LaneFindings = {
    lane: 'manual',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers,
    suggestions,
    summary:
      verdict === 'approve'
        ? 'operator approved'
        : `operator found ${blockers.length} blocker(s), ${suggestions.length} suggestion(s)`,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'manual', sinkPath, ok: blockers.length === 0 };
}
