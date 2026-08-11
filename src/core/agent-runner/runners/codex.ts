export const CODEX_BIN = 'codex';

/** Prompt rides stdin (`codex exec` reads it); proven by src/cr/run-codex.ts. */
export const CODEX_PROMPT_VIA = 'stdin' as const;

/** Argv shape extracted from src/cr/run-codex.ts (the CR lane now consumes this). */
export function buildCodexArgv(opts: {
  needsWrite?: boolean;
  schemaPath?: string;
  model?: string;
}): string[] {
  const argv = [
    'exec',
    '--sandbox',
    opts.needsWrite ? 'workspace-write' : 'read-only',
    '--skip-git-repo-check',
  ];
  if (opts.schemaPath) argv.push('--output-schema', opts.schemaPath);
  if (opts.model) argv.push('--model', opts.model);
  // Trailing `-` is the documented explicit spelling of "read the prompt from stdin"
  // (`codex exec [OPTIONS] [PROMPT]`: absent PROMPT *or* `-` both mean stdin). Behaviour
  // preserving, since every consumer already delivers the prompt via stdin per
  // CODEX_PROMPT_VIA — but it makes that contract legible at the argv level instead of
  // depending on a reader knowing what an absent positional implies.
  argv.push('-');
  return argv;
}
