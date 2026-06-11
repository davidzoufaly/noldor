export const CLAUDE_BIN = 'claude';

/** Prompt rides argv (`--print <prompt>`); stdin is ignored. */
export const CLAUDE_PROMPT_VIA = 'argv' as const;

/**
 * Canonical headless claude shape (PR #28/#33): bypassPermissions so
 * Edit/Bash run unattended, AskUserQuestion kill-switch so a forgotten
 * prompt fails fast instead of hanging.
 */
export function buildClaudeArgv(prompt: string, opts: { model?: string }): string[] {
  const argv = [
    '--print',
    prompt,
    '--disallowed-tools',
    'AskUserQuestion',
    '--permission-mode',
    'bypassPermissions',
  ];
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
