export const OPENCODE_BIN = 'opencode';

/** Prompt rides argv (`opencode run <prompt>`). */
export const OPENCODE_PROMPT_VIA = 'argv' as const;

/**
 * `--dangerously-skip-permissions` still respects explicit `deny` rules in
 * opencode.json (verified against opencode.ai docs 2026-06-11), so the
 * generated permission template keeps guarding shared files.
 */
export function buildOpencodeArgv(prompt: string, opts: { model?: string }): string[] {
  const argv = ['run', prompt, '--dangerously-skip-permissions'];
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
