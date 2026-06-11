import { describe, expect, it } from 'vitest';

import { buildDraftPrompt } from '../draft.js';
import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';

import type { PrepEntry } from '../types.js';

const entry: PrepEntry = {
  slug: 'foo-bar',
  name: 'Foo Bar',
  size: 'L',
  tier: 'full',
  area: 'tooling',
  deps: [],
  body: 'Does a thing.',
};

describe('SPEC_FORMAT', () => {
  it('carries the required section contract', () => {
    expect(SPEC_FORMAT).toContain('# <Human Name> — Design');
    expect(SPEC_FORMAT).toContain('## Problem / ## Goals / ## Non-goals');
    expect(SPEC_FORMAT).toContain('## Open questions (resolved)');
    expect(SPEC_FORMAT).toContain('## User Story (REQUIRED');
  });
});

describe('PLAN_FORMAT', () => {
  it('carries the inline-execution header and TDD contract', () => {
    expect(PLAN_FORMAT).toContain('Execute this plan task-by-task inline');
    expect(PLAN_FORMAT).toContain('Do not delegate execution to a sub-skill or separate executor');
    expect(PLAN_FORMAT).toContain('TDD order per task');
    expect(PLAN_FORMAT).not.toContain('REQUIRED SUB-SKILL');
  });
});

describe('no plugin coupling', () => {
  it('formats carry no superpowers token', () => {
    expect(SPEC_FORMAT + PLAN_FORMAT).not.toMatch(/superpowers/);
  });

  it('built draft prompt carries the new blockquote, no plugin token', () => {
    const prompt = buildDraftPrompt(entry, '2026-06-11', '/tmp/batch');
    expect(prompt).toContain('Execute this plan task-by-task inline');
    expect(prompt).not.toMatch(/superpowers:/);
  });
});
