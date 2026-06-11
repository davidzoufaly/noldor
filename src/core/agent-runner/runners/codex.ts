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
  return argv;
}
