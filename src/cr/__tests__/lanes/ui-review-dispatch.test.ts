// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { buildUiReviewPrompt, parseUiReviewReport } from '../../lanes/ui-review-dispatch.js';

const fence = (payload: unknown): string =>
  `words\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
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

describe('parseUiReviewReport', () => {
  it('reads the last fenced block', () => {
    const md = `${fence({ verdict: 'fail', findings: [EVIDENCE] })}${fence({ verdict: 'pass', findings: [] })}`;
    expect(parseUiReviewReport(md)?.verdict).toBe('pass');
  });

  it('accepts each well-formed verdict', () => {
    expect(parseUiReviewReport(fence({ verdict: 'pass', findings: [] }))?.verdict).toBe('pass');
    expect(
      parseUiReviewReport(fence({ verdict: 'fail', findings: [EVIDENCE] }))?.findings,
    ).toHaveLength(1);
    expect(
      parseUiReviewReport(
        fence({ verdict: 'cannot-review', findings: [], reason: 'no-final-pages' }),
      ),
    ).toMatchObject({ reason: 'no-final-pages' });
  });

  it.each([
    ['no fence at all', 'I reviewed it and it looks fine'],
    ['unparseable json', '```json\n{not json\n```'],
    ['pass carrying findings', fence({ verdict: 'pass', findings: [EVIDENCE] })],
    ['fail carrying none', fence({ verdict: 'fail', findings: [] })],
    ['cannot-review without a reason', fence({ verdict: 'cannot-review', findings: [] })],
    [
      'cannot-review with an unknown reason',
      fence({ verdict: 'cannot-review', findings: [], reason: 'vibes' }),
    ],
    ['unknown verdict', fence({ verdict: 'maybe', findings: [] })],
    [
      'a finding missing its design-side evidence',
      fence({ verdict: 'fail', findings: [{ file: 'a.tsx', severity: 'high', message: 'm' }] }),
    ],
    [
      'a pass that also carries a reason (contradictory, unknown key)',
      fence({ verdict: 'pass', findings: [], reason: 'pen-unreadable' }),
    ],
    [
      'a fail that also carries a reason',
      fence({ verdict: 'fail', findings: [EVIDENCE], reason: 'pen-unreadable' }),
    ],
    [
      'a finding missing its code-side file',
      fence({
        verdict: 'fail',
        findings: [{ severity: 'high', message: 'm', designPage: 'p', designElement: 'e' }],
      }),
    ],
  ])('rejects %s', (_label, md) => {
    expect(parseUiReviewReport(md)).toBeNull();
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

  it('shows one shape per verdict, so a copied template cannot carry a stray key', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('{"verdict": "pass", "findings": []}');
    // The `pass` shape must not print `reason` — a child echoing it would emit a
    // key `.strict()` rejects, turning a substantively fine report into
    // malformed-output.
    const passLine = p.split('\n').find((l) => l.includes('"verdict": "pass"')) ?? '';
    expect(passLine).not.toContain('reason');
    expect(p).toContain('Emit no key beyond the ones its shape lists');
  });

  it('states the non-normative properties so unpinned details are not flagged', () => {
    const p = buildUiReviewPrompt(INPUT);
    expect(p).toContain('NOT NORMATIVE');
    for (const token of ['pixel geometry', 'localization', 'never a finding']) {
      expect(p).toContain(token);
    }
  });
});
