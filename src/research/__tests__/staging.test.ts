import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBatchDir, renderIndex } from '../staging';
import type { ResearchManifest } from '../types';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'research-staging-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const NOW = new Date('2026-07-01T14:22:33.000Z');

describe('createBatchDir', () => {
  it('creates .noldor/research/<YYYY-MM-DD-HHMMSS>', () => {
    const b = createBatchDir(cwd, NOW);
    expect(b.rel).toBe(join('.noldor', 'research', '2026-07-01-142233'));
    expect(existsSync(b.abs)).toBe(true);
  });

  it('suffixes -2, -3 on same-second collision', () => {
    const first = createBatchDir(cwd, NOW);
    const second = createBatchDir(cwd, NOW);
    const third = createBatchDir(cwd, NOW);
    expect(first.rel.endsWith('142233')).toBe(true);
    expect(second.rel.endsWith('142233-2')).toBe(true);
    expect(third.rel.endsWith('142233-3')).toBe(true);
  });
});

describe('renderIndex', () => {
  it('renders one row per result and escapes pipes in headlines', () => {
    const manifest: ResearchManifest = {
      startedAt: NOW.toISOString(),
      batchDir: '.noldor/research/2026-07-01-142233',
      results: [
        {
          id: 'cr-guard',
          question: 'How does the guard work?',
          ok: true,
          spawnStatus: 'ok',
          meta: { status: 'answered', headline: 'uses a | pipe', confidence: 'high', refs: [] },
          findingsFile: 'cr-guard.findings.md',
        },
        {
          id: 'drain-rules',
          question: 'Where are eligibility rules?',
          ok: false,
          spawnStatus: 'timeout',
          meta: { status: 'blocked', headline: 'unparsed output', confidence: 'low', refs: [] },
          findingsFile: 'drain-rules.findings.md',
        },
      ],
    };
    const md = renderIndex(manifest);
    expect(md).toContain('| cr-guard | answered | high | uses a \\| pipe |');
    expect(md).toContain('[cr-guard.findings.md](cr-guard.findings.md)');
    expect(md).toContain('| drain-rules | blocked |');
    expect(md).toContain('timeout');
    expect(md).toContain('1/2 ok');
  });
});
