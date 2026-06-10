import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import type { LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';

interface ExecOpts {
  cwd?: string;
  timeout?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

// Hand-rolled promise wrapper around execFile (NOT promisify) — the vitest
// mock in standalone.test.ts replaces execFile directly and would lose
// promisify's custom-promisified symbol.
function execAsync(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
  return new Promise<ExecResult>((resolveP, rejectP) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) rejectP(err);
      else resolveP({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const PROMPT_TEMPLATE_PATH = 'src/cr/lanes/standalone-prompt.md';

export async function claudeSupportsMaxThinking(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('claude', ['--help'], { timeout: 5000 });
    return /--max-thinking/.test(stdout);
  } catch {
    return false;
  }
}

interface MultiterminalProbeOpts {
  cwd?: string;
}

// The multiterminal-flow bug (stale `scripts/cr/` paths from the scripts→src
// migration) shipped as a fast-track fix with no FD, so the probe can't gate
// on FD frontmatter. The runtime precondition the lane actually needs is the
// prompt template on disk at its post-migration path.
export async function multiterminalDepDone(opts: MultiterminalProbeOpts = {}): Promise<boolean> {
  const path = join(opts.cwd ?? process.cwd(), PROMPT_TEMPLATE_PATH);
  try {
    await readFile(path, 'utf8');
    return true;
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
    `cd ${input.repoRoot} && claude --dangerously-skip-permissions${maxThinkingFlag} ` +
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
