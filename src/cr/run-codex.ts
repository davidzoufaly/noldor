import { CODEX_BIN } from '../core/agent-runner/runners/codex.js';
import { describeCodexFailure, probeCodexVersion } from './codex-failure.js';
import { extractJsonObject } from './extract-json.js';
import { CrRecordSchema, type CrRecord } from './sidecar.js';

// Homed in codex-adapter.ts beside the registry-backed implementation; re-exported here so
// existing importers (and their test stubs) keep working unchanged.
export type { Spawn } from './codex-adapter.js';
import type { Spawn } from './codex-adapter.js';

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
  /**
   * Injection point for the version probe's child-spawner (failure path only). Defaults to
   * the real one. This sits where `cmd` used to: binary selection now belongs to the agent
   * registry, so a caller can no longer point the review at a different binary — and the
   * misattribution the old `cmd` override guarded against is unreachable.
   */
  probe?: (bin: string) => Promise<string>;
  /** The cap that was armed, so a timeout can name itself in the failure message. */
  timeoutMs?: number;
}

export async function runCodex(input: RunCodexInput): Promise<CrRecord> {
  const stdin = formatPrompt(input.ctx);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let timedOut = false;
  try {
    const r = await input.spawn({ stdin });
    stdout = r.stdout;
    stderr = r.stderr;
    exitCode = r.exitCode;
    timedOut = r.timedOut;
  } catch (e) {
    return synthBlocker(`codex spawn failed: ${(e as Error).message}`);
  }
  if (exitCode !== 0) {
    // Attribute the failure: which CLI version, and what the child itself said. Probing
    // only here keeps a green review free of the extra spawn, and the version is present
    // exactly where someone debugging CLI drift will look. An expired ChatGPT session used
    // to surface as a bare `exited with exit code 1` with the explanation discarded.
    const version = await (input.probe ?? probeCodexVersion)(CODEX_BIN);
    return synthBlocker(
      describeCodexFailure({
        exitCode,
        stderr,
        version,
        ...(timedOut
          ? { timedOut, ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }) }
          : {}),
      }),
    );
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
