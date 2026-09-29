// @tests: portable-gate-entrypoint-for-non-claude-runners
import { describe, expect, it } from 'vitest';
import {
  buildDrainGatePrompt,
  buildFinishGatePrompt,
  buildResumeGatePrompt,
} from '../gate-prompt.js';

// Today's plansSource literal (drain-source.ts pre-extraction) — the
// slash-command branch must return it byte-identically.
const RESUME_SLASH_LITERAL = [
  '/noldor-gate --resume designed --autonomous',
  '',
  'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
  'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
  'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
  'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
  '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
  'lane picker or PR approval.',
].join('\n');

describe('buildDrainGatePrompt', () => {
  it("slash-command returns today's drain literal verbatim", () => {
    expect(buildDrainGatePrompt('alpha', 'slash-command')).toBe('/noldor-gate --drain alpha');
  });

  it('prose is a pointer: slug, fast/<slug>, drain-mode.md, headless rule, no /noldor-gate token', () => {
    const p = buildDrainGatePrompt('alpha', 'prose');
    expect(p).toContain("'alpha'");
    expect(p).toContain('fast/alpha');
    expect(p).toContain('docs/noldor/drain-mode.md');
    expect(p).toContain('ZERO interactive questions');
    expect(p).not.toContain('/noldor-gate');
  });
});

describe('buildResumeGatePrompt', () => {
  it("slash-command returns today's resume literal verbatim", () => {
    expect(buildResumeGatePrompt('designed', 'slash-command')).toBe(RESUME_SLASH_LITERAL);
  });

  it('prose is self-contained: slug, feat/<slug>, drain-mode.md, autonomous directives, no /noldor-gate token', () => {
    const p = buildResumeGatePrompt('designed', 'prose');
    expect(p).toContain("'designed'");
    expect(p).toContain('feat/designed');
    expect(p).toContain('docs/noldor/drain-mode.md (Resume path)');
    expect(p).toContain('ZERO interactive questions');
    expect(p).not.toContain('/noldor-gate');
  });
});

describe('buildFinishGatePrompt', () => {
  it('slash-command carries the --finish flag plus the delivery-only directives', () => {
    const p = buildFinishGatePrompt('alpha', 'slash-command');
    expect(p.split('\n')[0]).toBe('/noldor-gate --drain alpha --finish');
    expect(p).toContain('Finish-mode drain context.');
  });

  it('prose is a pointer: slug, branch, drain-mode.md Finish path, no /noldor-gate token', () => {
    const p = buildFinishGatePrompt('alpha', 'prose');
    expect(p).toContain("'alpha'");
    expect(p).toContain('fast/alpha');
    expect(p).toContain('docs/noldor/drain-mode.md (Finish path)');
    expect(p).toContain('ZERO interactive questions');
    expect(p).not.toContain('/noldor-gate');
  });

  it('both dispatches forbid branch recreation, forbid re-implementation, and require the PR before returning', () => {
    for (const dispatch of ['slash-command', 'prose'] as const) {
      const p = buildFinishGatePrompt('alpha', dispatch);
      expect(p).toContain('Do NOT force-recreate or delete the branch');
      expect(p).toContain('do NOT re-implement the entry');
      expect(p).toContain('FOREGROUND');
      expect(p).toContain('Do NOT end your turn before `pr-flow` has');
    }
  });
});

// Every prompt that points at drain-mode.md must leave the steps to the page: a step restated here
// drifted from it twice — an unconditional branch force-recreate (the page runs `branch-state`
// first) and a CR command missing the first pass's mandatory `--base-sha origin/main`.
describe('prompts restate no drain-mode step', () => {
  const pointers = [
    ['drain prose', buildDrainGatePrompt('alpha', 'prose')],
    ['finish prose', buildFinishGatePrompt('alpha', 'prose')],
    ['finish slash-command', buildFinishGatePrompt('alpha', 'slash-command')],
    ['resume prose', buildResumeGatePrompt('designed', 'prose')],
  ] as const;

  it.each(pointers)('%s carries no CR command and no unconditional force-recreate', (_label, p) => {
    expect(p).not.toContain('cr orchestrate');
    expect(p).not.toContain('Force-recreate the branch');
  });
});
