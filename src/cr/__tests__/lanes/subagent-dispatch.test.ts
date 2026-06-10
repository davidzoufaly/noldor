import { describe, expect, it } from 'vitest';

import { buildPrompt } from '../../lanes/subagent-dispatch.js';

const input = {
  artifact: 'docs/superpowers/specs/2026-06-10-x-design.md',
  fdSummary: 'summary',
  baseSha: 'abc',
  headSha: 'def',
  description: 'spec for x',
};

describe('buildPrompt', () => {
  it('includes the verify-before-flag protocol', () => {
    const prompt = buildPrompt(input);
    expect(prompt).toContain('run that exact command first');
    expect(prompt).toContain('quote its actual output');
    expect(prompt).toContain('Never assert a failure you have not reproduced');
  });

  it('still carries the artifact path and review range', () => {
    const prompt = buildPrompt(input);
    expect(prompt).toContain(input.artifact);
    expect(prompt).toContain('abc..def');
  });
});
