import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

/** The stub runner spawns the current node binary against an in-repo entrypoint. */
export const STUB_BIN = process.execPath;

/** Prompt rides argv; the entrypoint parses the slug from it / the session marker. */
export function buildStubArgv(prompt: string, _opts: { model?: string }): string[] {
  // runners/ -> agent-runner/ -> core/ -> src/ -> repo root; bin/ holds the entrypoint.
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, '..', '..', '..', '..', 'bin', 'noldor-stub-gate.mjs');
  return [entry, prompt];
}
