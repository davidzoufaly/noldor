import type { UsageAdapter } from './types.js';

/**
 * The hermetic stub runner spawns no LLM, so there are never token records to
 * read. Returns null always — measuring nothing beats hallucinating something.
 */
export const stubUsage: UsageAdapter = () => null;
