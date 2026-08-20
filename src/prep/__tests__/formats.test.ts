// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows, plan-runner
import { describe, expect, it } from 'vitest';

import { buildDraftPrompt } from '../draft.js';
import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';
import { SECTIONS, validateSummaryCommit } from '../../core/validate-summary-body.js';

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

  // The contract prescribes the commit an executor produces, so a commit built by
  // following it verbatim must survive the gates that commit meets. Measured on Q-0139
  // (PR #345): three task commits landed in the old prescribed form, the push was
  // refused, and the range had to be reworded with filter-branch before it would go.
  describe('the prescribed commit passes the gates it will meet', () => {
    it('prescribes a message file, not the subject-plus-trailer -m pair the push gate refuses', () => {
      expect(PLAN_FORMAT).toContain('git commit -F <message-file>');
      expect(PLAN_FORMAT).not.toContain('-m "<conventional-commit>" -m "Noldor-FD: <slug>"');
    });

    it('names every section the blocking summary-body validator requires', () => {
      // Sourced from the validator's own list, so adding a section there fails here
      // rather than silently leaving the contract prescribing an unpushable commit.
      for (const section of SECTIONS) expect(PLAN_FORMAT).toContain(section);
    });

    it('warns that a second -m strands the trailers', () => {
      expect(PLAN_FORMAT).toContain('interpret-trailers');
      expect(PLAN_FORMAT).toContain('ONE trailing paragraph');
    });

    it('produces a body the validator accepts when followed', () => {
      // Build the message the contract describes and run the real validator over it.
      const message = [
        'feat(scope): do the thing',
        '',
        'Why — the queue document and the gate disagreed about commit shape, so a plan',
        'executor produced commits its own push gate refused.',
        '',
        'How — the contract now prescribes a message file whose body carries the sections',
        'the validator checks for, with the trailers kept in one trailing paragraph.',
        '',
        'What — one string in the format contract plus the skill step that restates it.',
        '',
        'Noldor-FD: some-slug',
      ].join('\n');
      const r = validateSummaryCommit({
        sha: 'a'.repeat(40),
        message,
        files: ['src/prep/formats.ts'],
        parentCount: 1,
      });
      expect(r.error).toBeUndefined();
    });
  });
});

describe('no plugin coupling', () => {
  // Token assembled at runtime so this guard file itself stays invisible to
  // the repo-wide acceptance grep it enforces.
  const PLUGIN_TOKEN = ['super', 'powers'].join('');

  it('formats carry no plugin token', () => {
    expect(SPEC_FORMAT + PLAN_FORMAT).not.toContain(PLUGIN_TOKEN);
  });

  it('built draft prompt carries the new blockquote, no plugin token', () => {
    const prompt = buildDraftPrompt(entry, '2026-06-11', '/tmp/batch');
    expect(prompt).toContain('Execute this plan task-by-task inline');
    expect(prompt).not.toMatch(new RegExp(`${PLUGIN_TOKEN}:`));
  });
});
