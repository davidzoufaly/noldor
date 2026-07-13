// `.gitignore` block for transient `.noldor/` state, appended by `noldor init`.
// Without it the very first CR/gate run in a fresh consumer commits
// per-session churn (seen live in the consumer-2 dogfood: session.json and
// agent-events.jsonl landed in the bootstrap commit and had to be untracked).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GITIGNORE_SENTINEL = '# noldor transient state';

export const GITIGNORE_BLOCK = `${GITIGNORE_SENTINEL} (added by noldor init)
.noldor/session.json
.noldor/agent-events.jsonl
.noldor/agent-events.archive.jsonl
.noldor/cr/
.noldor/drain-state.json
.noldor/drain.lock
.noldor/drain-park.json
`;

/**
 * Append the transient-state block to the consumer `.gitignore` (creating the
 * file when absent). Idempotent: a `.gitignore` already carrying the sentinel
 * line is left untouched, so consumer edits inside the block survive re-runs.
 *
 * @param consumerRoot - Consumer repo root (cwd of `noldor init`).
 * @returns `'created'` | `'appended'` | `'unchanged'` for init's summary log.
 */
export function ensureGitignoreBlock(consumerRoot: string): 'created' | 'appended' | 'unchanged' {
  const path = join(consumerRoot, '.gitignore');
  if (!existsSync(path)) {
    writeFileSync(path, GITIGNORE_BLOCK, 'utf8');
    return 'created';
  }
  const existing = readFileSync(path, 'utf8');
  if (existing.includes(GITIGNORE_SENTINEL)) {
    return 'unchanged';
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, existing + sep + GITIGNORE_BLOCK, 'utf8');
  return 'appended';
}
