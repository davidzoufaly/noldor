// @tests: cr-re-round-cap-enforcement-and-oscillation-detector
import { describe, expect, it } from 'vitest';
import type { Finding } from '../findings-schema.js';
import {
  applyPriorAnswers,
  isLaneFailureBlocker,
  laneFailureFile,
  renderPriorSection,
} from '../re-round.js';

const prior = (message: string, over: Partial<Finding> = {}): Finding => ({
  file: 'docs/x.md',
  severity: 'high',
  message,
  ...over,
});

describe('renderPriorSection', () => {
  it('numbers every prior P1..Pn in sink order, with no cap and no overflow line', () => {
    const blockers = Array.from({ length: 25 }, (_, i) => prior(`blocker ${i + 1}`));
    const s = renderPriorSection({ mode: 'fixes-in-diff', blockers });
    expect(s).toContain('P1 [high] blocker 1\n');
    expect(s).toContain('P25 [high] blocker 25\n');
    expect(s.indexOf('P1 [high]')).toBeLessThan(s.indexOf('P2 [high]'));
    expect(s).not.toContain('more prior blockers');
  });

  it('renders the class bracket only when the prior carries a class', () => {
    const s = renderPriorSection({
      mode: 'reexamine',
      blockers: [
        prior('with class', { class: 'mechanical' }),
        prior('no class', { severity: 'med' }),
      ],
    });
    expect(s).toContain('P1 [high][mechanical] with class');
    expect(s).toContain('P2 [med] no class');
  });

  it('truncates each message to 300 chars and collapses newlines, in both modes', () => {
    for (const mode of ['fixes-in-diff', 'reexamine'] as const) {
      const s = renderPriorSection({
        mode,
        blockers: [prior('x'.repeat(400)), prior('line one\n   line two')],
      });
      expect(s).toContain('x'.repeat(300));
      expect(s).not.toContain('x'.repeat(301));
      expect(s).toContain('P2 [high] line one line two');
    }
  });

  it('asks for a numbered prior answer and states the re-round blocking rule in both modes', () => {
    for (const mode of ['fixes-in-diff', 'reexamine'] as const) {
      const s = renderPriorSection({ mode, blockers: [prior('b')] });
      expect(s).toContain('"prior"');
      expect(s).toContain('"n"');
      expect(s).toContain('"resolved"');
      expect(s).toContain('regression the fix caused');
      expect(s).toContain('blocking definition');
      expect(s).toContain('suggestion');
    }
  });

  it('frames fixes-in-diff as the fix and reexamine as unverified', () => {
    const fix = renderPriorSection({ mode: 'fixes-in-diff', blockers: [prior('b')] });
    const re = renderPriorSection({ mode: 'reexamine', blockers: [prior('b')] });
    expect(fix).toContain('is the fix for these blockers');
    expect(fix).not.toContain('Do not assume');
    expect(re).toContain('Do not assume any of these blockers were addressed');
    expect(re).not.toContain('is the fix for these blockers');
  });
});

describe('applyPriorAnswers', () => {
  const p1 = prior('first', { class: 'design', locations: [{ file: 'src/a.ts', line: 3 }] });
  const p2 = prior('second', { severity: 'med', suggestion: 'do x' });

  it('drops a prior answered resolved and records the reason in notes', () => {
    const out = applyPriorAnswers([p1, p2], [{ n: 1, resolved: true, why: 'the check is gone' }]);
    expect(out.carried).toEqual([p2]);
    expect(out.notes).toContain('prior P1 resolved: the check is gone');
  });

  it('carries a prior answered not resolved as the unchanged prior finding', () => {
    const out = applyPriorAnswers(
      [p1],
      [{ n: 1, resolved: false, why: 'still reads the old key' }],
    );
    expect(out.carried).toEqual([
      {
        file: 'docs/x.md',
        severity: 'high',
        message: 'first',
        class: 'design',
        locations: [{ file: 'src/a.ts', line: 3 }],
      },
    ]);
    expect(out.notes).toContain('prior P1 still stands: still reads the old key');
  });

  it('carries an unanswered prior', () => {
    const out = applyPriorAnswers([p1, p2], [{ n: 2, resolved: true, why: 'fixed' }]);
    expect(out.carried).toEqual([p1]);
    expect(out.notes).toContain('prior P1 unanswered — carried');
  });

  it('carries a prior whose only answer is malformed', () => {
    const out = applyPriorAnswers([p1], [{ n: 1, resolved: 'yes', why: 'fixed' }, 'P1 fixed']);
    expect(out.carried).toEqual([p1]);
    expect(out.notes).toContain('prior P1 unanswered — carried');
    expect(out.notes.filter((n) => n.startsWith('prior answer ignored — malformed'))).toHaveLength(
      2,
    );
  });

  it('carries a prior answered both ways', () => {
    const out = applyPriorAnswers(
      [p1],
      [
        { n: 1, resolved: true, why: 'fixed' },
        { n: 1, resolved: false, why: 'not fixed' },
      ],
    );
    expect(out.carried).toEqual([p1]);
    expect(out.notes).toContain('prior P1 answered both ways — carried');
  });

  it('accepts a repeated consistent answer as one', () => {
    const out = applyPriorAnswers(
      [p1],
      [
        { n: 1, resolved: true, why: 'fixed' },
        { n: 1, resolved: true, why: 'fixed again' },
      ],
    );
    expect(out.carried).toEqual([]);
  });

  it('ignores an answer for a prior that does not exist, with a note', () => {
    const out = applyPriorAnswers([p1], [{ n: 7, resolved: true, why: 'x' }]);
    expect(out.carried).toEqual([p1]);
    expect(out.notes).toContain('prior answer ignored — no P7');
  });

  it('with no answers at all, carries every prior', () => {
    expect(applyPriorAnswers([p1, p2], []).carried).toEqual([p1, p2]);
  });
});

describe('isLaneFailureBlocker', () => {
  it('reports a blocker filed against a lane sentinel', () => {
    expect(laneFailureFile('reviewer')).toBe('<reviewer>');
    expect(laneFailureFile('codex')).toBe('<codex>');
    expect(isLaneFailureBlocker({ file: '<reviewer>' })).toBe(true);
    expect(isLaneFailureBlocker({ file: '<codex>' })).toBe(true);
  });

  it('never reports a blocker filed against an artifact or a source path', () => {
    for (const file of [
      'docs/design/specs/x.md',
      'src/cr/re-round.ts',
      '<manual>',
      'src/<codex>.ts',
      '<codex> ',
      '',
    ]) {
      expect(isLaneFailureBlocker({ file })).toBe(false);
    }
  });
});
