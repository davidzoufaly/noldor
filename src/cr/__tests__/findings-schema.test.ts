// @tests: noldor
import { describe, expect, it } from 'vitest';
import {
  artifactKindSchema,
  findingSchema,
  laneFindingsSchema,
  laneSchema,
  severitySchema,
} from '../findings-schema.js';

describe('Severity', () => {
  it('accepts high|med|low', () => {
    for (const s of ['high', 'med', 'low']) expect(severitySchema.parse(s)).toBe(s);
  });
  it('rejects unknown', () => {
    expect(severitySchema.safeParse('critical').success).toBe(false);
  });
});

describe('Lane', () => {
  it('exposes options', () => {
    expect(laneSchema.options).toEqual(['manual', 'codex', 'subagent', 'standalone', 'verify']);
  });
});

describe('ArtifactKind', () => {
  it('includes spec, plan, code', () => {
    expect(artifactKindSchema.options).toEqual(['spec', 'plan', 'code']);
  });
});

describe('Finding', () => {
  it('accepts minimal valid', () => {
    expect(findingSchema.safeParse({ file: 'a.md', severity: 'high', message: 'x' }).success).toBe(
      true,
    );
  });
  it('accepts optional line + suggestion', () => {
    expect(
      findingSchema.safeParse({
        file: 'a.md',
        line: 12,
        severity: 'med',
        message: 'y',
        suggestion: 'z',
      }).success,
    ).toBe(true);
  });
  it('rejects empty file', () => {
    expect(findingSchema.safeParse({ file: '', severity: 'low', message: 'x' }).success).toBe(
      false,
    );
  });
  it('rejects negative line', () => {
    expect(
      findingSchema.safeParse({ file: 'a', line: -1, severity: 'low', message: 'x' }).success,
    ).toBe(false);
  });
});

describe('LaneFindings', () => {
  const base = {
    lane: 'manual' as const,
    artifact: 'docs/x.md',
    kind: 'spec' as const,
    slug: 'foo',
    summary: 'ok',
    startedAt: '2026-05-25T00:00:00.000Z',
  };
  it('accepts minimal with empty blocker/suggestion arrays defaulted', () => {
    const parsed = laneFindingsSchema.parse(base);
    expect(parsed.blockers).toEqual([]);
    expect(parsed.suggestions).toEqual([]);
  });
  it('accepts optional templateSha + baseSha + fullReview + finishedAt + notes', () => {
    const r = laneFindingsSchema.safeParse({
      ...base,
      templateSha: 'abc123',
      baseSha: 'deadbeef',
      fullReview: true,
      finishedAt: '2026-05-25T00:01:00.000Z',
      notes: ['strength: clear summary'],
    });
    expect(r.success).toBe(true);
  });
  it('rejects missing summary', () => {
    const { summary: _omit, ...rest } = base;
    expect(laneFindingsSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects unknown lane', () => {
    expect(laneFindingsSchema.safeParse({ ...base, lane: 'mystery' }).success).toBe(false);
  });
});

describe('verify lane extensions', () => {
  it('laneSchema accepts verify', () => {
    expect(laneSchema.parse('verify')).toBe('verify');
  });

  it('laneFindingsSchema accepts verdict/evidence/mismatches', () => {
    const parsed = laneFindingsSchema.parse({
      lane: 'verify',
      artifact: '.',
      kind: 'code',
      slug: 's',
      summary: 'verified',
      startedAt: new Date().toISOString(),
      verdict: 'fail',
      evidence: [{ command: 'curl localhost:4000/x', observed: '[]' }],
      mismatches: ['promised object, observed array'],
    });
    expect(parsed.verdict).toBe('fail');
    expect(parsed.evidence?.[0].command).toContain('curl');
  });
});
