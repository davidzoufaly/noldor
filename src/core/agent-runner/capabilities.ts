import type { RunnerCapabilities, RunnerName } from './types.js';

/** Spec §Unit 2 table. Doc twin: docs/noldor/agent-runtimes.md. */
export const CAPABILITIES: Record<RunnerName, RunnerCapabilities> = {
  claude: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: false,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
    promptDispatch: 'slash-command',
  },
  codex: {
    structuredOutput: 'schema',
    sandbox: 'coarse',
    supportsLocalModels: false,
    questionSuppression: 'non-interactive',
    rulesFile: 'AGENTS.md',
    promptDispatch: 'prose',
  },
  opencode: {
    structuredOutput: 'events',
    sandbox: 'fine',
    supportsLocalModels: true,
    questionSuppression: 'permission-config',
    rulesFile: 'AGENTS.md',
    promptDispatch: 'prose',
  },
  // Hermetic in-repo test double: no LLM, no network, scripted canned work.
  stub: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: true,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
    // Mirrors claude so contract-CI drain fixtures stay byte-identical (spec D5).
    promptDispatch: 'slash-command',
  },
};
