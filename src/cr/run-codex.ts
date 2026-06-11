import { fileURLToPath } from 'node:url';
import { CODEX_BIN, buildCodexArgv } from '../core/agent-runner/runners/codex.js';
import { CrRecordSchema, type CrRecord } from './sidecar.js';

export type Spawn = (args: {
  cmd: string;
  args: string[];
  stdin: string;
}) => Promise<{ stdout: string; exitCode: number }>;

export interface CodeReviewCtx {
  kind?: 'code';
  diff: string;
  featureMd: string;
  rules: string;
}

export interface ArtifactReviewCtx {
  kind: 'plan' | 'spec';
  artifact: string;
  featureMd: string;
  rules: string;
}

export type ReviewCtx = CodeReviewCtx | ArtifactReviewCtx;

export interface RunCodexInput {
  ctx: ReviewCtx;
  spawn: Spawn;
  cmd?: string;
}

export async function runCodex(input: RunCodexInput): Promise<CrRecord> {
  const cmd = input.cmd ?? CODEX_BIN;
  const stdin = formatPrompt(input.ctx);
  let stdout = '';
  let exitCode = 0;
  try {
    const schemaPath = fileURLToPath(new URL('./cr-record.schema.json', import.meta.url));
    // Argv shape owned by the codex runner module — the CR lane is a registry
    // consumer, not the owner of the spawn (spec D11). Review spawns never
    // write: read-only sandbox.
    const r = await input.spawn({
      cmd,
      args: buildCodexArgv({ needsWrite: false, schemaPath }),
      stdin,
    });
    stdout = r.stdout;
    exitCode = r.exitCode;
  } catch (e) {
    return synthBlocker(`codex spawn failed: ${(e as Error).message}`);
  }
  if (exitCode !== 0) return synthBlocker(`codex exited with exit code ${exitCode}`);
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return synthBlocker(`malformed CR record: codex returned non-JSON output`);
  }
  const parsed = CrRecordSchema.safeParse(json);
  if (!parsed.success) {
    return synthBlocker(
      `malformed CR record: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data;
}

const JSON_ONLY_DIRECTIVE =
  'Respond ONLY with a JSON object matching the provided output schema. Do not call tools, do not read additional files, do not run shell commands.';

function formatPrompt(ctx: ReviewCtx): string {
  if ('artifact' in ctx) return formatArtifactPrompt(ctx);
  return [
    JSON_ONLY_DIRECTIVE,
    '',
    '## Engineering rules',
    ctx.rules,
    '',
    '## Feature MD',
    ctx.featureMd,
    '',
    '## Diff to review',
    ctx.diff,
  ].join('\n');
}

function formatArtifactPrompt(ctx: ArtifactReviewCtx): string {
  const noun = ctx.kind === 'plan' ? 'plan' : 'spec';
  const Noun = ctx.kind === 'plan' ? 'Plan' : 'Spec';
  return [
    JSON_ONLY_DIRECTIVE,
    '',
    `You are reviewing a ${noun} document (markdown, not code). Judge it as a design artifact — do NOT apply code-review heuristics. Surface:`,
    '- missing or unconsidered edge cases',
    '- unclear, unmeasurable, or absent acceptance criteria',
    '- inconsistent or ambiguous function/type signatures',
    '- placeholder / TODO / unfilled content that must be resolved before implementation',
    '- internal contradictions or unstated assumptions',
    `Report gaps that must be fixed before the ${noun} is implementable as blockers; softer improvements as suggestions. For document-level findings with no specific line, set "line": null.`,
    '',
    '## Engineering rules',
    ctx.rules,
    '',
    '## Feature MD',
    ctx.featureMd,
    '',
    `## ${Noun} to review`,
    ctx.artifact,
  ].join('\n');
}

function synthBlocker(message: string): CrRecord {
  return {
    blockers: [{ file: '<codex>', message, severity: 'high', line: null, suggestion: null }],
    suggestions: [],
    summary: message,
  };
}
