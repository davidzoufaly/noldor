import { describe, expect, it } from 'vitest';
import { FALLBACK_META, researchMetaSchema, taskSpecSchema, tasksFileSchema } from '../types';

describe('taskSpecSchema', () => {
  it('accepts a minimal task and defaults scope to []', () => {
    const t = taskSpecSchema.parse({ id: 'cr-guard', question: 'How does X work?' });
    expect(t.scope).toEqual([]);
  });

  it('rejects non-kebab ids', () => {
    for (const id of ['Bad Id', 'UPPER', '-lead', 'trail/slash']) {
      expect(taskSpecSchema.safeParse({ id, question: 'q' }).success).toBe(false);
    }
  });

  it('rejects unknown keys (strict)', () => {
    expect(taskSpecSchema.safeParse({ id: 'a', question: 'q', extra: 1 }).success).toBe(false);
  });
});

describe('tasksFileSchema', () => {
  it('requires at least one task', () => {
    expect(tasksFileSchema.safeParse({ tasks: [] }).success).toBe(false);
  });
});

describe('researchMetaSchema', () => {
  it('accepts a full meta and defaults confidence/refs', () => {
    const m = researchMetaSchema.parse({
      status: 'answered',
      headline: 'Uses archive-and-overwrite',
    });
    expect(m.confidence).toBe('med');
    expect(m.refs).toEqual([]);
  });

  it('rejects unknown status', () => {
    expect(researchMetaSchema.safeParse({ status: 'maybe', headline: 'h' }).success).toBe(false);
  });
});

describe('FALLBACK_META', () => {
  it('is itself schema-valid', () => {
    expect(researchMetaSchema.safeParse(FALLBACK_META).success).toBe(true);
  });
});
