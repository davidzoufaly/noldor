// @tests: cr-re-round-cap-enforcement-and-oscillation-detector, spec-stage-cr-stopping-rule
import { describe, expect, it } from 'vitest';
import { fingerprintBlocker } from '../fingerprint.js';
import type { Finding } from '../findings-schema.js';
import type { DecidedFinding } from '../lane-types.js';
import {
  applyPriorAnswers,
  isLaneFailureBlocker,
  laneFailureFile,
  renderPriorSection,
  splitSettled,
} from '../re-round.js';

const prior = (message: string, over: Partial<Finding> = {}): Finding => ({
  file: 'docs/x.md',
  severity: 'high',
  message,
  ...over,
});

const decided = (
  finding: Finding,
  over: Partial<Omit<DecidedFinding, 'finding' | 'id'>> = {},
): DecidedFinding => ({
  id: fingerprintBlocker(finding),
  finding,
  disposition: 'rejected',
  reason: 'the operator ruled on it',
  round: 1,
  holds: true,
  ...over,
});

/** The rendered line for decided finding `n`, or undefined. */
const sLine = (section: string, n: number): string | undefined =>
  section.split('\n').find((l) => l.startsWith(`S${n} `));

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

  it('renders the basis bracket after the class only when the prior carries a basis (Q-0263)', () => {
    const s = renderPriorSection({
      mode: 'reexamine',
      blockers: [
        prior('class and basis', { class: 'design', basis: 'risk' }),
        prior('basis only', { basis: 'requirement' }),
        prior('neither'),
      ],
    });
    expect(s).toContain('P1 [high][design][risk] class and basis');
    expect(s).toContain('P2 [high][requirement] basis only');
    expect(s).toContain('P3 [high] neither');
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

describe('renderPriorSection — decided findings (Q-0261)', () => {
  const fixed = decided(prior('the check is missing'), {
    disposition: 'fixed',
    reason: 'added the check',
    round: 2,
    holds: undefined,
  });
  const rejected = decided(prior('rename the flag', { severity: 'med' }), {
    reason: 'the name is the public API',
  });

  it('lists every decided finding as S1..Sm after the priors, with its disposition, round, severity and reason', () => {
    const s = renderPriorSection({
      mode: 'fixes-in-diff',
      blockers: [prior('still open')],
      decided: [fixed, rejected],
    });
    expect(sLine(s, 1)).toBe('S1 [fixed r2][high] the check is missing — added the check');
    expect(sLine(s, 2)).toBe('S2 [rejected r1][med] rename the flag — the name is the public API');
    expect(s.indexOf('P1 [high] still open')).toBeLessThan(s.indexOf('S1 '));
  });

  it('marks an operator decision whose cited content changed, and never a fixed one', () => {
    const s = renderPriorSection({
      mode: 'reexamine',
      blockers: [],
      decided: [
        decided(prior('a'), { holds: false }),
        decided(prior('b'), { holds: true }),
        decided(prior('c'), { disposition: 'fixed', holds: undefined }),
        decided(prior('d'), { disposition: 'deferred', holds: false }),
      ],
    });
    const changed = 'its cited content has changed since the ruling';
    expect(sLine(s, 1)).toContain(changed);
    expect(sLine(s, 2)).not.toContain(changed);
    expect(sLine(s, 3)).not.toContain(changed);
    expect(sLine(s, 4)).toContain(changed);
  });

  it('states the rule for each kind of decision', () => {
    const s = renderPriorSection({ mode: 'reexamine', blockers: [], decided: [rejected] });
    expect(s).toContain('Do not file any of them again');
    expect(s).toContain('A fixed finding blocks again only as a regression');
    expect(s).toContain('raise it again only when the content it cites has changed');
  });

  it('with no priors, carries the decided list without the prior list or the re-round framing', () => {
    const s = renderPriorSection({ mode: 'fixes-in-diff', blockers: [], decided: [rejected] });
    expect(sLine(s, 1)).toBeDefined();
    expect(s).not.toMatch(/^P1 /m);
    expect(s).not.toContain('"prior"');
    expect(s).not.toContain('This is a re-round');
    expect(s).not.toContain('is the fix for these blockers');
    expect(s).not.toContain('regression the fix caused');
  });

  it('leaves the prior section byte-identical when nothing is decided', () => {
    for (const mode of ['fixes-in-diff', 'reexamine'] as const) {
      const blockers = [prior('b', { class: 'design' })];
      expect(renderPriorSection({ mode, blockers, decided: [] })).toBe(
        renderPriorSection({ mode, blockers }),
      );
    }
  });

  it('cuts a decided message and reason to 300 characters on one line', () => {
    const s = renderPriorSection({
      mode: 'reexamine',
      blockers: [],
      decided: [decided(prior('m'.repeat(400)), { reason: `first\n  second ${'r'.repeat(400)}` })],
    });
    const line = sLine(s, 1)!;
    expect(line).toContain('m'.repeat(300));
    expect(line).not.toContain('m'.repeat(301));
    expect(line).toContain('— first second ');
    expect(line).not.toContain('r'.repeat(300));
  });
});

describe('splitSettled — a restated settled finding is filed as a suggestion (Q-0261)', () => {
  const ruled = prior('the fallback hides a failure', { file: 'src/a.ts', severity: 'high' });

  // The direction that loses data is over-firing: demoting a finding that should still block.
  // Every shape that must STILL block gets its own row.
  it.each([
    [
      'a restatement of a fixed decision',
      decided(ruled, { disposition: 'fixed', holds: undefined }),
      ruled,
    ],
    [
      'a restatement of a ruling whose cited content changed',
      decided(ruled, { holds: false }),
      ruled,
    ],
    [
      'a restatement of a ruling with no holds verdict',
      decided(ruled, { holds: undefined }),
      ruled,
    ],
    [
      'the same message at another severity',
      decided(ruled),
      { ...ruled, severity: 'med' as const },
    ],
    ['the same message about another file', decided(ruled), { ...ruled, file: 'src/b.ts' }],
    ['a reworded message', decided(ruled), { ...ruled, message: 'the fallback hides a failure.' }],
    [
      'a different finding in the same file',
      decided(ruled),
      prior('off by one', { file: 'src/a.ts' }),
    ],
  ])('keeps blocking: %s', (_shape, d, finding) => {
    const out = splitSettled([finding], [d]);
    expect(out.blocking).toEqual([finding]);
    expect(out.demoted).toEqual([]);
    expect(out.notes).toEqual([]);
  });

  it.each(['rejected', 'accepted', 'deferred'] as const)(
    'demotes an exact restatement of a %s ruling that still holds, naming its number',
    (disposition) => {
      const other = decided(prior('unrelated'), { disposition: 'fixed', holds: undefined });
      const out = splitSettled([ruled], [other, decided(ruled, { disposition })]);
      expect(out.blocking).toEqual([]);
      expect(out.demoted).toEqual([ruled]);
      expect(out.notes).toHaveLength(1);
      expect(out.notes[0]).toContain('S2');
      expect(out.notes[0]).toContain(disposition);
    },
  );

  it('demotes only the restatement and keeps every other blocker', () => {
    const fresh = prior('a new defect', { file: 'src/a.ts' });
    const out = splitSettled([fresh, ruled], [decided(ruled)]);
    expect(out.blocking).toEqual([fresh]);
    expect(out.demoted).toEqual([ruled]);
  });

  it('with nothing decided, keeps every blocker', () => {
    expect(splitSettled([ruled], [])).toEqual({ blocking: [ruled], demoted: [], notes: [] });
  });
});

describe('applyPriorAnswers', () => {
  const p1 = prior('first', { class: 'design', locations: [{ file: 'src/a.ts', line: 3 }] });
  const p2 = prior('second', { severity: 'med', suggestion: 'do x' });

  it('returns each prior answered resolved, with its why, for the sink (Q-0261)', () => {
    const out = applyPriorAnswers(
      [p1, p2],
      [
        { n: 1, resolved: true, why: 'the check is gone' },
        { n: 2, resolved: false, why: 'still there' },
      ],
    );
    expect(out.resolved).toEqual([{ finding: p1, why: 'the check is gone' }]);
  });

  it('reports nothing resolved for a prior answered both ways or left unanswered', () => {
    const out = applyPriorAnswers(
      [p1, p2],
      [
        { n: 1, resolved: true, why: 'fixed' },
        { n: 1, resolved: false, why: 'not fixed' },
      ],
    );
    expect(out.resolved).toEqual([]);
  });

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
