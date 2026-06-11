import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_BIN } from '../core/agent-runner/runners/claude.js';
import { writeJsonAtomic } from './atomic-write.js';
import type { LaneFindings } from './findings-schema.js';
import type { LaneInput, LaneResult } from './lane-types.js';

interface ExecOpts {
  cwd?: string;
  timeout?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

// Hand-rolled promise wrapper around execFile (NOT promisify) — the vitest
// mock in deep-review-spawn.test.ts replaces execFile directly and would lose
// promisify's custom-promisified symbol.
function execAsync(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
  return new Promise<ExecResult>((resolveP, rejectP) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) rejectP(err);
      else resolveP({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const PROMPT_TEMPLATE_PATH = 'src/cr/standalone-prompt.md';

export async function claudeSupportsMaxThinking(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(CLAUDE_BIN, ['--help'], { timeout: 5000 });
    return /--max-thinking/.test(stdout);
  } catch {
    return false;
  }
}

async function templateSha(repoRoot: string): Promise<string> {
  const contents = await readFile(join(repoRoot, PROMPT_TEMPLATE_PATH), 'utf8').catch(() => '');
  return createHash('sha1').update(contents).digest('hex');
}

async function osascriptSpawn(repoRoot: string, command: string): Promise<void> {
  // Preflight: iTerm exists. Throws if osascript or iTerm is unavailable.
  await execAsync('osascript', ['-e', 'tell application "iTerm" to exists']);
  // Open a new window and write the command into the new session.
  const script = `
    tell application "iTerm"
      create window with default profile
      tell current session of current window
        write text "${command.replace(/"/g, '\\"')}"
      end tell
    end tell
  `;
  await execAsync('osascript', ['-e', script], { cwd: repoRoot });
}

/**
 * Escalate-only deep-review spawn: opens an interactive Claude session in a
 * fresh iTerm2 window. No longer an orchestrate lane — `noldor cr escalate`
 * (spawn-deep-review) is the single consumer. Claude + macOS/iTerm coupling
 * is deliberate here: this is the operator-facing escalation seam, not a
 * headless lane (see docs/noldor/agent-runtimes.md). The binary name is
 * single-sourced from the claude runner module.
 */
export async function runStandalone(input: LaneInput): Promise<LaneResult> {
  const sinkPath = join(
    input.repoRoot,
    '.noldor',
    'cr',
    `${input.slug}-${input.kind}-standalone.json`,
  );
  const startedAt = new Date().toISOString();

  const supportsMaxThinking = await claudeSupportsMaxThinking();
  const maxThinkingFlag = supportsMaxThinking ? ' --max-thinking' : '';
  const command =
    `cd ${input.repoRoot} && ${CLAUDE_BIN} --dangerously-skip-permissions${maxThinkingFlag} ` +
    `"Read the markdown artifact at ${input.artifact}. ` +
    `Apply the spec-review rubric in ${PROMPT_TEMPLATE_PATH}. ` +
    `Emit a JSON object conforming to LaneFindings in src/cr/findings-schema.ts. ` +
    `Write the JSON to ${sinkPath}.tmp then mv it to ${sinkPath}. ` +
    `Set finishedAt before writing. Preserve templateSha. Do not modify any other files."`;

  // osascript preflight + spawn. Throws on failure; no stub written so the
  // aggregator can distinguish "spawn failed" from "lane still running".
  await osascriptSpawn(input.repoRoot, command);

  // Only after spawn succeeded do we drop the stub.
  const stub: LaneFindings = {
    lane: 'standalone',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers: [],
    suggestions: [],
    summary: 'standalone-claude running',
    startedAt,
    templateSha: await templateSha(input.repoRoot),
  };
  await writeJsonAtomic(sinkPath, stub);

  return { lane: 'standalone', sinkPath, ok: false };
}
