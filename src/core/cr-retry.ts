import type { CrPass, CrResultSummary } from './pr-flow.js';

export interface CodexFinding {
  file: string;
  line?: number;
  severity?: 'low' | 'medium' | 'high' | 'blocker';
  message: string;
}

export interface CodexRunResult {
  tipSha: string;
  findings: CodexFinding[];
}

export type CodexRunFn = () => Promise<CodexRunResult>;
export type AddressFindingsFn = (findings: CodexFinding[]) => Promise<void>;

/**
 * `maxRetries` is the total number of codex passes (loop iterations), matching
 * the spec pseudocode `while attempt <= 3`. So `maxRetries: 3` = 3 codex passes
 * with 2 address calls between them (not 4 passes / 3 address calls).
 */
export async function runCrRetryLoop(opts: {
  codex: CodexRunFn;
  address: AddressFindingsFn;
  maxRetries: number;
}): Promise<CrResultSummary> {
  const passes: CrPass[] = [];
  let attempt = 1;

  while (attempt <= opts.maxRetries) {
    const result = await opts.codex();
    if (result.findings.length === 0) {
      passes.push({ reviewer: 'codex', tipSha: result.tipSha, findings: 0, status: 'clean' });
      return { passes, status: 'clean' };
    }
    if (attempt === opts.maxRetries) {
      passes.push({
        reviewer: 'codex',
        tipSha: result.tipSha,
        findings: result.findings.length,
        status: 'addressed',
      });
      return { passes, status: 'exhausted' };
    }
    passes.push({
      reviewer: 'codex',
      tipSha: result.tipSha,
      findings: result.findings.length,
      status: 'addressed',
    });
    await opts.address(result.findings);
    attempt++;
  }
  return { passes, status: 'exhausted' };
}
