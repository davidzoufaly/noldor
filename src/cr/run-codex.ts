import { fileURLToPath } from 'node:url';
import { CrRecordSchema, type CrRecord } from './sidecar.js';

export type Spawn = (args: {
  cmd: string;
  args: string[];
  stdin: string;
}) => Promise<{ stdout: string; exitCode: number }>;

export interface RunCodexInput {
  ctx: { diff: string; featureMd: string; rules: string };
  spawn: Spawn;
  cmd?: string;
}

export async function runCodex(input: RunCodexInput): Promise<CrRecord> {
  const cmd = input.cmd ?? 'codex';
  const stdin = formatPrompt(input.ctx);
  let stdout = '';
  let exitCode = 0;
  try {
    const schemaPath = fileURLToPath(new URL('./cr-record.schema.json', import.meta.url));
    const r = await input.spawn({
      cmd,
      args: [
        'exec',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--output-schema',
        schemaPath,
      ],
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

function formatPrompt(ctx: { diff: string; featureMd: string; rules: string }): string {
  return [
    'Respond ONLY with a JSON object matching the provided output schema. Do not call tools, do not read additional files, do not run shell commands.',
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

function synthBlocker(message: string): CrRecord {
  return {
    blockers: [{ file: '<codex>', message, severity: 'high', line: null, suggestion: null }],
    suggestions: [],
    summary: message,
  };
}
