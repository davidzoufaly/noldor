// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { promptSelect, promptText, runStandalone } = vi.hoisted(() => ({
  promptSelect: vi.fn(),
  promptText: vi.fn(),
  runStandalone: vi.fn(async () => ({ lane: 'standalone', sinkPath: 'x', ok: false })),
}));
vi.mock('../../core/prompt-stdin.js', () => ({ promptSelect, promptText }));
vi.mock('../deep-review-spawn.js', () => ({
  runStandalone,
  claudeSupportsMaxThinking: async () => false,
}));

import { escalate } from '../escalate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'esc-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  promptSelect.mockReset();
  promptText.mockReset();
  runStandalone.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('escalate', () => {
  it('autonomous + onFailure=abort => returns abort, no spawn', async () => {
    const r = await escalate({
      slug: 'x',
      reason: 'cr-red',
      context: 'subagent red: missing test',
      cwd: root,
      autonomous: true,
      onFailure: 'abort',
    });
    expect(r.outcome).toBe('abort');
    expect(runStandalone).not.toHaveBeenCalled();
  });
  it('autonomous + onFailure=spawn-deep-review => spawns standalone', async () => {
    const r = await escalate({
      slug: 'x',
      reason: 'test-red',
      context: 'AssertionError: expected foo',
      cwd: root,
      autonomous: true,
      onFailure: 'spawn-deep-review',
    });
    expect(r.outcome).toBe('spawned');
    expect(runStandalone).toHaveBeenCalledTimes(1);
  });
  it('interactive (default) prompts; retry-implementation returns marker', async () => {
    promptSelect.mockResolvedValueOnce('retry-implementation');
    const r = await escalate({
      slug: 'x',
      reason: 'cr-red',
      context: 'red',
      cwd: root,
      autonomous: false,
      onFailure: 'prompt',
    });
    expect(r.outcome).toBe('retry-implementation');
  });
  it('writes escalation-context.md when reason carries context', async () => {
    promptSelect.mockResolvedValueOnce('abort');
    await escalate({
      slug: 'x',
      reason: 'cr-red',
      context: 'lots of stderr',
      cwd: root,
      autonomous: false,
      onFailure: 'prompt',
    });
    const ctx = await readFile(join(root, '.noldor', 'cr', 'x-escalation-context.md'), 'utf8');
    expect(ctx).toMatch(/lots of stderr/);
    expect(ctx).toMatch(/reason: cr-red/);
  });
});
