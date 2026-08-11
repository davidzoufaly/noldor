import { fileURLToPath } from 'node:url';
import { CODEX_BIN, buildCodexArgv } from '../core/agent-runner/runners/codex.js';
import { describeCodexFailure, probeCodexVersion } from './codex-failure.js';
import { extractJsonObject } from './extract-json.js';
import { CrRecordSchema, type CrRecord } from './sidecar.js';

// Homed in codex-spawn.ts beside its canonical implementation; re-exported here so
// existing importers (and their test stubs) keep working unchanged.
export type { Spawn } from './codex-spawn.js';
import type { Spawn } from './codex-spawn.js';

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
  let stderr = '';
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
    stderr = r.stderr;
    exitCode = r.exitCode;
  } catch (e) {
    return synthBlocker(`codex spawn failed: ${(e as Error).message}`);
  }
  if (exitCode !== 0) {
    // Attribute the failure: which CLI version, and what the child itself said. Probing
    // only here keeps a green review free of the extra spawn, and the version is present
    // exactly where someone debugging CLI drift will look. An expired ChatGPT session used
    // to surface as a bare `exited with exit code 1` with the explanation discarded.
    // Probe the SAME command that failed — `cmd` may be an override, and reporting the
    // version of a binary that was never run misattributes the failure.
    const version = await probeCodexVersion(input.spawn, cmd);
    return synthBlocker(describeCodexFailure({ exitCode, stderr, version }));
  }
  let json: unknown;
  try {
    json = extractJsonObject(stdout);
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
