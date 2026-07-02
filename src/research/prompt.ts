import { FALLBACK_META, researchMetaSchema, type ResearchMeta, type TaskSpec } from './types.js';

/**
 * Self-contained prompt for one read-only researcher child. Directives ride the
 * prompt, never env/flags (PR #33 rule, enforced at the spawnAgent seam).
 */
export function buildResearchPrompt(task: TaskSpec): string {
  const lines: string[] = [
    'You are a read-only research agent investigating this repository.',
    'Answer ONE question. Do NOT edit, write, create, or delete any file;',
    'do not run state-changing commands (no git commit/push, no installs).',
    'Your entire deliverable is your final message.',
    '',
    `Question: ${task.question}`,
  ];
  if (task.context !== undefined) lines.push('', `Context: ${task.context}`);
  if (task.scope.length > 0) lines.push('', `Start here: ${task.scope.join(', ')}`);
  if (task.expects !== undefined) lines.push('', `A good answer: ${task.expects}`);
  lines.push(
    '',
    'Return contract — your final message MUST be:',
    '1. Markdown findings: the answer first, then evidence citing real file:line paths.',
    '2. Terminated by exactly one fenced ```json block holding:',
    '   {"status":"answered|partial|blocked","headline":"<one-line answer>","confidence":"low|med|high","refs":["<file paths you cite>"]}',
  );
  return lines.join('\n');
}

export interface ParsedResearchOutput {
  readonly findings: string;
  readonly meta: ResearchMeta;
  /** False when the meta fence was missing/invalid — meta is FALLBACK_META. */
  readonly parsed: boolean;
}

const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n\s*```/g;

/**
 * Split a child's stdout into findings + meta. Takes the LAST ```json fence as
 * meta; everything before it is findings. Never throws — unparseable output is
 * preserved verbatim with {@link FALLBACK_META}.
 */
export function parseResearchStdout(stdout: string): ParsedResearchOutput {
  const matches = [...stdout.matchAll(JSON_FENCE_RE)];
  const last = matches.at(-1);
  if (!last) return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]!);
  } catch {
    return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  }
  const meta = researchMetaSchema.safeParse(raw);
  if (!meta.success) return { findings: stdout.trim(), meta: FALLBACK_META, parsed: false };
  return { findings: stdout.slice(0, last.index).trim(), meta: meta.data, parsed: true };
}
