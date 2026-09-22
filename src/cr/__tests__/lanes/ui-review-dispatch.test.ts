// @tests: ui-design-review-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
import { describe, expect, it } from 'vitest';
import { readLaneAnswer } from '../../lane-answer.js';
import {
  UI_REVIEW_ANSWER,
  UI_REVIEW_SHAPE,
  buildUiReviewPrompt,
} from '../../lanes/ui-review-dispatch.js';

const answer = (payload: unknown): string => JSON.stringify(payload);
const read = (text: string): ReturnType<typeof readLaneAnswer> =>
  readLaneAnswer(text, UI_REVIEW_ANSWER);

const EVIDENCE = {
  file: 'src/ui/Panel.tsx',
  severity: 'high' as const,
  message: 'missing',
  designPage: 'FINAL:app: default',
  designElement: 'Submit',
};

const INPUT = {
  penPath: '/tmp/scratch-abc/feat.pen',
  surfaces: ['app', 'settings'],
  baseSha: 'origin/main',
  headSha: 'deadbeef',
  repoRoot: '/repo',
  fdSummary: 'A settings panel.',
};

describe('UI_REVIEW_ANSWER', () => {
  it('reads a whole-file fenced answer whose message quotes a fence', () => {
    const text = `\`\`\`json\n${answer({ verdict: 'fail', findings: [{ ...EVIDENCE, message: 'label reads ```Save``` in code' }] })}\n\`\`\``;
    expect(read(text)).toMatchObject({ ok: true, answer: { verdict: 'fail' } });
  });

  it('accepts each well-formed verdict', () => {
    expect(read(answer({ verdict: 'pass', findings: [] }))).toMatchObject({ ok: true });
    expect(read(answer({ verdict: 'fail', findings: [EVIDENCE] }))).toMatchObject({ ok: true });
    expect(
      read(answer({ verdict: 'cannot-review', findings: [], reason: 'no-final-pages' })),
    ).toMatchObject({ ok: true, answer: { reason: 'no-final-pages' } });
  });

  it('drops a placeholder finding so a padded pass validates', () => {
    expect(
      read(answer({ verdict: 'pass', findings: [{ ...EVIDENCE, message: '(none)' }] })),
    ).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
  });

  it.each([
    ['plain prose', 'I reviewed it and it looks fine'],
    ['unparseable json', '{not json'],
    ['pass carrying findings', answer({ verdict: 'pass', findings: [EVIDENCE] })],
    ['fail carrying none', answer({ verdict: 'fail', findings: [] })],
    ['cannot-review without a reason', answer({ verdict: 'cannot-review', findings: [] })],
    [
      'cannot-review with an unknown reason',
      answer({ verdict: 'cannot-review', findings: [], reason: 'vibes' }),
    ],
    ['unknown verdict', answer({ verdict: 'maybe', findings: [] })],
    [
      'a finding missing its design-side evidence',
      answer({ verdict: 'fail', findings: [{ file: 'a.tsx', severity: 'high', message: 'm' }] }),
    ],
    [
      'a pass that also carries a reason (contradictory, unknown key)',
      answer({ verdict: 'pass', findings: [], reason: 'pen-unreadable' }),
    ],
    [
      'a fail that also carries a reason',
      answer({ verdict: 'fail', findings: [EVIDENCE], reason: 'pen-unreadable' }),
    ],
    [
      'a finding missing its code-side file',
      answer({
        verdict: 'fail',
        findings: [{ severity: 'high', message: 'm', designPage: 'p', designElement: 'e' }],
      }),
    ],
  ])('rejects %s', (_label, text) => {
    expect(read(text).ok).toBe(false);
  });
});

describe('buildUiReviewPrompt', () => {
  it('points the child at the scratch path and the surfaces in scope', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('/tmp/scratch-abc/feat.pen');
    expect(p).toContain('Surfaces in scope: app, settings');
    expect(p).toContain('origin/main..deadbeef');
    expect(p).toContain('A settings panel.');
  });

  it('tells the child to read every FINAL page when no surface was resolved', () => {
    const p = buildUiReviewPrompt({ ...INPUT, surfaces: [] });
    expect(p).toContain('read every `FINAL:` page');
    expect(p).not.toContain('Surfaces in scope:');
  });

  it('routes design reading through pencil MCP and forbids editing', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('execute({ filePath:');
    expect(p).toMatch(/Do not edit it/);
  });

  it('describes the three shapes as prose and keeps the example shape valid JSON', () => {
    expect(buildUiReviewPrompt(INPUT)).toContain('Emit no key beyond the ones your shape lists');
    // The seam renders this example into the answer instruction; a child that echoes it
    // verbatim must still write parseable JSON.
    expect(() => JSON.parse(UI_REVIEW_SHAPE) as unknown).not.toThrow();
  });

  it('states the non-normative properties so unpinned details are not flagged', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('NOT NORMATIVE');
    for (const token of ['pixel geometry', 'localization', 'never a finding']) {
      expect(p).toContain(token);
    }
  });
});
