import type { RunnerName } from '../types.js';
import type { UsageAdapter } from './types.js';
import { claudeUsage } from './claude.js';
import { codexUsage } from './codex.js';
import { opencodeUsage } from './opencode.js';
import { stubUsage } from './stub.js';

export const USAGE_ADAPTERS: Record<RunnerName, UsageAdapter> = {
  claude: claudeUsage,
  codex: codexUsage,
  opencode: opencodeUsage,
  stub: stubUsage,
};
