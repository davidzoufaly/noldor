// @tests: cr-lane-verdicts-blocked-by-serialization-not-substance
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  dropPlaceholders,
  isPlaceholderText,
  readLaneAnswer,
  unwrapWholeFence,
} from '../lane-answer.js';

describe('isPlaceholderText', () => {
  it.each(['(none)', '- None.', '**N/A**', '[]', '', '  nothing  ', 'No findings.', 'no issues'])(
    'treats %j as a placeholder',
    (text) => {
      expect(isPlaceholderText(text)).toBe(true);
    },
  );
  it.each([
    'none of the tests assert the exit code',
    'N/A until the cap is fixed',
    'nothing checks the exit code',
  ])('keeps %j as a finding', (text) => {
    expect(isPlaceholderText(text)).toBe(false);
  });
});

describe('dropPlaceholders', () => {
  it('drops placeholder entries from the named object and string lists only', () => {
    const raw = {
      findings: [{ message: '(none)' }, { message: 'real finding' }],
      mismatches: ['n/a', 'object promised, array observed'],
      untouched: ['(none)'],
    };
    expect(
      dropPlaceholders(raw, [{ list: 'findings', text: 'message' }, { list: 'mismatches' }]),
    ).toEqual({
      findings: [{ message: 'real finding' }],
      mismatches: ['object promised, array observed'],
      untouched: ['(none)'],
    });
  });
  it('passes anything that is not a plain object through untouched', () => {
    expect(dropPlaceholders(['(none)'], [{ list: 'findings' }])).toEqual(['(none)']);
    expect(dropPlaceholders(null, [{ list: 'findings' }])).toBeNull();
  });
});

describe('unwrapWholeFence', () => {
  it('removes one fence around the whole file and nothing inside it', () => {
    const inner = '{"observed":"```bash\\npnpm release\\n```"}';
    expect(unwrapWholeFence(`\`\`\`json\n${inner}\n\`\`\`\n`)).toBe(inner);
  });
  it('leaves an unfenced answer as it is, trimmed', () => {
    expect(unwrapWholeFence('  {"a":1}\n')).toBe('{"a":1}');
  });
});

describe('readLaneAnswer', () => {
  const schema = z
    .object({ verdict: z.enum(['pass', 'fail']), mismatches: z.array(z.string()).default([]) })
    .refine((v) => (v.verdict === 'pass' ? v.mismatches.length === 0 : v.mismatches.length > 0));
  const contract = { lane: 'verifier', schema, placeholderFields: [{ list: 'mismatches' }] };

  it('reads a verdict whose evidence quotes a fenced block (Q-0239)', () => {
    const text =
      '```json\n{"verdict":"pass","mismatches":[],"note":"ran ```bash\\npnpm release\\n``` fine"}\n```';
    expect(readLaneAnswer(text, contract)).toEqual({
      ok: true,
      answer: { verdict: 'pass', mismatches: [] },
    });
  });
  it('validates a pass padded with a placeholder as the clean pass it is', () => {
    expect(readLaneAnswer('{"verdict":"pass","mismatches":["(none)"]}', contract)).toMatchObject({
      ok: true,
    });
  });
  it('rejects a fail whose only mismatches are placeholders', () => {
    expect(readLaneAnswer('{"verdict":"fail","mismatches":["n/a"]}', contract)).toMatchObject({
      ok: false,
    });
  });
  it('reports a missing file, bad JSON and a schema mismatch as errors', () => {
    expect(readLaneAnswer(null, contract)).toEqual({
      ok: false,
      error: 'no answer file was written',
    });
    expect(readLaneAnswer('Verified end-to-end.', contract)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^answer is not valid JSON/),
    });
    expect(readLaneAnswer('{"verdict":"maybe"}', contract)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^answer does not match the verifier schema/),
    });
  });
});
