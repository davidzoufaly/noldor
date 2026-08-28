// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows, plan-runner
import { describe, expect, it } from 'vitest';

import { buildDraftPrompt } from '../draft.js';
import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';
import { STRUCTURAL_CONTEXT_HEADING } from '../../core/structural-context-contract.js';
import {
  MIN_SECTION_CHARS,
  SECTIONS,
  SECTION_SEPARATOR,
  measureSections,
} from '../../core/summary-body-contract.js';

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

describe('SPEC_FORMAT structural context', () => {
  it('prescribes the Structural context H3 inside ## Design', () => {
    expect(SPEC_FORMAT).toContain(`### ${STRUCTURAL_CONTEXT_HEADING}`);
  });

  it('names the command that produces the evidence', () => {
    expect(SPEC_FORMAT).toContain('design graph-context');
  });

  it('offers the recorded skip, so the section is never honestly empty', () => {
    expect(SPEC_FORMAT).toContain('noldor:cut');
  });
});

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

  // The contract prescribes the commit an executor produces, so a summary body built
  // by following it verbatim must survive the PR gate it meets (`validatePrSummary`
  // measures the same sections via measureSections). Measured on Q-0139 (PR #345):
  // commits landed in the old prescribed form and the delivery was refused.
  describe('the prescribed summary passes the gate it will meet', () => {
    it('prescribes a message file, not the subject-plus-trailer -m pair the push gate refuses', () => {
      expect(PLAN_FORMAT).toContain('git commit -F <message-file>');
      expect(PLAN_FORMAT).not.toContain('-m "<conventional-commit>" -m "Noldor-FD: <slug>"');
    });

    it('prescribes each section as the MARKER the gate matches, not the bare word', () => {
      // The gate matches `Why —` literally (`sectionLength`), so a contract naming the
      // bare word admits `Why:` and the commit is then refused. Asserting the marker is
      // what makes this guard able to catch that class — the bare-word form passed while
      // the contract said "Why / How / What" and an executor could still write `Why:`.
      for (const section of SECTIONS) {
        expect(PLAN_FORMAT).toContain(`${section} ${SECTION_SEPARATOR}`);
      }
      expect(PLAN_FORMAT).toContain('em dash');
    });

    it('states the per-section length floor the gate enforces', () => {
      expect(PLAN_FORMAT).toContain(String(MIN_SECTION_CHARS));
    });

    it('warns that a second -m strands the trailers', () => {
      expect(PLAN_FORMAT).toContain('interpret-trailers');
      expect(PLAN_FORMAT).toContain('ONE trailing paragraph');
    });

    it('produces a body the gate accepts when followed', () => {
      // Build the body the contract describes and run the real measurement over it.
      const body = [
        'Why — the queue document and the gate disagreed about summary shape, so a plan',
        'executor produced a PR its own delivery gate refused.',
        '',
        'How — the contract now prescribes a summary body whose sections carry the markers',
        'the gate checks for, measured at PR-open by validatePrSummary.',
        '',
        'What — one string in the format contract plus the skill step that restates it.',
      ].join('\n');
      expect(measureSections(body)).toEqual({ ok: true });
    });

    it('and the colon form the contract now forbids is genuinely refused', () => {
      // Proves the marker requirement is load-bearing rather than stylistic: swap the
      // em dashes for colons in an otherwise-identical body and the gate rejects it.
      const colonBody = [
        'Why: the queue document and the gate disagreed about summary shape, so a plan',
        'executor produced a PR its own delivery gate refused.',
        '',
        'How: the contract now prescribes a summary body whose sections carry the markers',
        'the gate checks for, measured at PR-open by validatePrSummary.',
        '',
        'What: one string in the format contract plus the skill step that restates it.',
      ].join('\n');
      const r = measureSections(colonBody);
      if (r.ok) throw new Error('expected the colon form to be refused');
      expect(r.error).toMatch(/missing Why, How, What/);
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
