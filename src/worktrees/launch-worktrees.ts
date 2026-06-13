import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { loadAgentsConfig, resolveRunner } from '../core/agent-runner/registry.js';
import { CLAUDE_BIN } from '../core/agent-runner/runners/claude.js';
import { CODEX_BIN } from '../core/agent-runner/runners/codex.js';
import { OPENCODE_BIN } from '../core/agent-runner/runners/opencode.js';

const execFileAsync = promisify(execFile);

const PROMPT_TEMPLATE_PATH = '.claude/launch-prompt.md';

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * Parse `git worktree list --porcelain` into typed records.
 *
 * @param porcelain - Raw stdout from the porcelain command
 * @param mainPath - The repo's main worktree path (for marking)
 * @returns One record per worktree
 */
function parseWorktrees(porcelain: string, mainPath: string): Worktree[] {
  const out: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) out.push(current as Worktree);
      const path = line.slice('worktree '.length);
      current = { path, branch: '', isMain: path === mainPath };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current.path) out.push(current as Worktree);
  return out;
}

/**
 * Build the shell command an iTerm2 session runs for one worktree: cd in and
 * start the agent, appending the rendered launch prompt when the template is
 * non-empty. `agentInvocation` is the interactive launch string for the
 * consumer's `agents.default` runner (e.g. `claude --dangerously-skip-permissions`),
 * resolved by the caller via the agent-runner registry — this unit stays pure
 * and never hardcodes a runner. `Worktree` and the `renderPrompt`/`escapeShell`
 * helpers are reused.
 */
export function buildLaunchCommand(w: Worktree, template: string, agentInvocation: string): string {
  const slug = basename(w.path);
  const prompt = renderPrompt(template, { slug, branch: w.branch, path: w.path });
  return prompt
    ? `cd ${escapeShell(w.path)} && ${agentInvocation} ${escapeShell(prompt)}`
    : `cd ${escapeShell(w.path)} && ${agentInvocation}`;
}

/**
 * Resolve the interactive launch invocation for the consumer's configured agent.
 * Reuses the agent-runner registry's per-runner bins so claude/codex/opencode
 * stay the single source of truth. claude is the default → today's behavior.
 * Headless argv (`--print` / `exec` / `run`) is NOT reused here — those are for
 * the drain's non-interactive spawns; the terminal wants an interactive session.
 */
export function resolveAgentInvocation(cwd: string): string {
  const runner = resolveRunner('implementer', loadAgentsConfig(cwd)).runner;
  switch (runner) {
    case 'codex':
      return CODEX_BIN; // interactive codex (no `exec`)
    case 'opencode':
      return OPENCODE_BIN; // interactive opencode (no `run`)
    case 'claude':
    default:
      return `${CLAUDE_BIN} --dangerously-skip-permissions`;
  }
}

/** Open one iTerm2 window for a single worktree running the launch command. */
export async function launchTree(
  w: Worktree,
  template: string,
  agentInvocation: string,
): Promise<void> {
  const command = buildLaunchCommand(w, template, agentInvocation);
  const script = `tell application "iTerm"
      create window with default profile
      tell current session of current window
        write text "${command}"
      end tell
    end tell`;
  await execFileAsync('osascript', ['-e', script]);
}

/**
 * Open one new iTerm2 window per non-main worktree, `cd` into it, and run `claude`.
 *
 * @remarks macOS + iTerm2 only. Skips the main worktree (already where you ran from).
 */
async function main(): Promise<void> {
  const { stdout: porcelain } = await execFileAsync('git', ['worktree', 'list', '--porcelain']);
  const mainPath = resolveMainWorktreePath(porcelain);
  if (mainPath === null) {
    throw new Error('Could not identify main worktree.');
  }
  const worktrees = parseWorktrees(porcelain, mainPath).filter((w) => !w.isMain);

  if (worktrees.length === 0) {
    console.log('No feature worktrees to launch.');
    return;
  }

  // Pre-launch iTerm without activate so its default-window pref doesn't fire
  // a stray empty window before we start placing sessions.
  await execFileAsync('osascript', [
    '-e',
    `tell application "iTerm"
      if not running then
        launch
        delay 0.5
      end if
    end tell`,
  ]);

  const template = await readFile(join(mainPath, PROMPT_TEMPLATE_PATH), 'utf8').catch(() => '');

  console.log(`Launching ${worktrees.length} iTerm2 window(s):`);
  const agentInvocation = resolveAgentInvocation(process.cwd());
  for (const w of worktrees) {
    console.log(`  ${w.branch} → ${w.path}`);
    await launchTree(w, template, agentInvocation);
  }
}

export function resolveMainWorktreePath(porcelain: string): string | null {
  const worktrees = parseWorktrees(porcelain, '');
  return worktrees.find((w) => w.branch === 'main')?.path ?? null;
}

/**
 * Substitute `{{slug}}` / `{{branch}}` / `{{path}}` in the template and collapse
 * to a single line (AppleScript `write text` is line-oriented).
 *
 * @param template - Raw template text (or empty string if no template file)
 * @param vars - Substitution values
 * @returns Single-line prompt, or empty string when template is empty
 */
function renderPrompt(
  template: string,
  vars: { slug: string; branch: string; path: string },
): string {
  if (!template.trim()) return '';
  return template
    .replace(/\{\{slug\}\}/g, vars.slug)
    .replace(/\{\{branch\}\}/g, vars.branch)
    .replace(/\{\{path\}\}/g, vars.path)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quote a string as a single shell argument (safe inside AppleScript-emitted
 * `write text "..."` — escapes both shell metachars and AppleScript quotes).
 *
 * @param s - Raw string
 * @returns Single-quoted shell-safe form
 */
function escapeShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
