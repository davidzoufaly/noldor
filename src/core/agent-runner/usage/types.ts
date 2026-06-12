export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  /** Names the artifact the numbers came from: 'claude-jsonl' | 'codex-session' | 'opencode-session'. */
  source: string;
}

export interface UsageLookup {
  /** Worktree the agent ran in (transcript/session stores key off it or off mtime). */
  cwd: string;
  /** Spawn start, epoch ms — sessions modified before this are not ours. */
  startedAtMs: number;
  /** Override for the store root (tests inject a fixture dir; prod = os.homedir()). */
  homeDir?: string;
}

/**
 * A usage adapter reads the runner's OWN usage records and returns them
 * verbatim, or null when no trustworthy record is found. HARD RULE: no
 * estimation, no tokenizer fallback, no text-length heuristics — measuring
 * nothing beats hallucinating something. Adapters never throw (fail-open).
 */
export type UsageAdapter = (lookup: UsageLookup) => TokenUsage | null;
