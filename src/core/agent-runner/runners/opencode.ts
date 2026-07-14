export const OPENCODE_BIN = 'opencode';

/** Prompt rides argv (`opencode run <prompt>`). */
export const OPENCODE_PROMPT_VIA = 'argv' as const;

/**
 * `--auto` auto-approves permissions that are not explicitly denied, still
 * honoring explicit `deny` rules in opencode.json (verified against
 * `opencode run --help`, opencode 1.17.20, 2026-07-14). Replaces the removed
 * 0.6-era `--dangerously-skip-permissions`. `--format json` is opt-in via
 * `jsonEvents`: the registry sets it only for spawns whose stdout it will parse
 * (piped, non-tee, non-inherit), so human/log-facing spawns keep opencode's
 * default formatted output.
 */
export function buildOpencodeArgv(
  prompt: string,
  opts: { model?: string; jsonEvents?: boolean },
): string[] {
  const argv = ['run', prompt, '--auto'];
  if (opts.jsonEvents) argv.push('--format', 'json');
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
