// @tests: replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
import { validateTriageInputs, type TriageValidationResult } from '../validate-triage.js';

describe(validateTriageInputs, () => {
  const okRoadmap = `### Noldor Framework

#### Entry A

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high

Body.
`;
  const okBacklog = `# Backlog

### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: med

Body.
`;
  // Same shape as okRoadmap but with size + impact stripped — roadmap requires them, so this
  // exercises the missing-required-field path for roadmap entries.
  const roadmapMissingSizeImpact = `### Noldor Framework

#### Entry A

- area: tooling
- type: feat
- since: 2026-05-11

Body.
`;
  // Same shape as okBacklog but with size + impact stripped — backlog keeps them advisory.
  const advisoryBacklog = `# Backlog

### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-11

Body.
`;

  it('returns no issues on a clean roadmap + backlog pair (size + impact present)', () => {
    const result: TriageValidationResult = validateTriageInputs({
      roadmapRaw: okRoadmap,
      backlogRaw: okBacklog,
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.advisories).toEqual([]);
  });

  it('errors on duplicate entry names anywhere in the roadmap (file-wide, no section scope)', () => {
    const raw = `### Dup

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high

First copy.

### Other Entry

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high

Body.

#### Dup

- area: tooling
- type: fix
- since: 2026-05-12
- size: S
- impact: low

Second copy.
`;
    const result = validateTriageInputs({
      roadmapRaw: raw,
      backlogRaw: okBacklog,
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        file: 'docs/roadmap.md',
        rule: 'duplicate-name',
        message: expect.stringContaining('Dup'),
      }),
    );
  });

  it('errors on duplicate entry names within the backlog', () => {
    const raw = `### Dup
- area: tooling
- type: feat
- since: 2026-05-11

Body.

### Dup
- area: tooling
- type: fix
- since: 2026-05-12

Body.
`;
    const result = validateTriageInputs({
      roadmapRaw: okRoadmap,
      backlogRaw: raw,
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'docs/backlog.md', rule: 'duplicate-name' }),
    );
  });

  it('errors on entries missing the required `type` field', () => {
    const raw = `#### Missing Type
- area: tooling
- since: 2026-05-11
- size: M
- impact: high

Body.
`;
    const result = validateTriageInputs({
      roadmapRaw: raw,
      backlogRaw: okBacklog,
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        rule: 'missing-required-field',
        message: expect.stringContaining('type'),
      }),
    );
  });

  it('errors on roadmap entries missing size or impact (required fields on roadmap)', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapMissingSizeImpact,
      backlogRaw: okBacklog,
      strict: false,
      counterExists: false,
    });
    expect(
      result.errors.some((e) => e.rule === 'missing-required-field' && e.message.includes('size')),
    ).toBe(true);
    expect(
      result.errors.some(
        (e) => e.rule === 'missing-required-field' && e.message.includes('impact'),
      ),
    ).toBe(true);
  });

  it('produces an advisory (not an error) when backlog size/impact are missing — until backfill', () => {
    const result = validateTriageInputs({
      roadmapRaw: okRoadmap,
      backlogRaw: advisoryBacklog,
      strict: false,
      counterExists: false,
    });
    expect(result.advisories.some((a) => a.rule === 'missing-optional-field')).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('promotes backlog size/impact advisories to errors in strict mode', () => {
    const result = validateTriageInputs({
      roadmapRaw: okRoadmap,
      backlogRaw: advisoryBacklog,
      strict: true,
      counterExists: false,
    });
    expect(result.errors.some((e) => e.rule === 'missing-optional-field')).toBe(true);
  });
});

describe('entry-id validation', () => {
  const roadmapWithId = (id: string): string => `#### Entry A

- id: ${id}
- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high

Body.
`;
  const backlogWithId = (id: string): string => `# Backlog

### Backlog Entry

- id: ${id}
- area: tooling
- type: feat
- since: 2026-05-11

Body.
`;
  // No `- id:` bullet on either entry.
  const roadmapNoId = `#### Entry A

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high

Body.
`;
  const backlogNoId = `# Backlog

### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-11

Body.
`;

  it('is silent on missing ids when the counter file does not exist', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapNoId,
      backlogRaw: backlogNoId,
      strict: false,
      counterExists: false,
    });
    expect(result.errors.some((e) => e.rule === 'missing-entry-id')).toBe(false);
  });

  it('errors on missing ids once the counter file exists', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapNoId,
      backlogRaw: backlogNoId,
      strict: false,
      counterExists: true,
    });
    expect(result.errors.filter((e) => e.rule === 'missing-entry-id')).toHaveLength(2);
  });

  it('accepts well-formed unique ids across both files', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithId('Q-0001'),
      backlogRaw: backlogWithId('Q-0002'),
      strict: false,
      counterExists: true,
    });
    expect(result.errors).toEqual([]);
  });

  it('errors on a malformed id regardless of the counter file', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithId('Q-42'),
      backlogRaw: backlogWithId('Q-0002'),
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ rule: 'malformed-entry-id', file: 'docs/roadmap.md' }),
    );
  });

  it('errors on the same id appearing in both roadmap and backlog', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithId('Q-0007'),
      backlogRaw: backlogWithId('Q-0007'),
      strict: false,
      counterExists: true,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ rule: 'duplicate-entry-id', file: 'docs/backlog.md' }),
    );
  });
});

describe('blocked-by reference validation', () => {
  const roadmapWithBlockedBy = (ref: string): string => `### Cat

#### Entry A

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: med
- blocked-by: ${ref}

Body.
`;
  const targetBacklog = `# Backlog

### Some Target

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: med

Body.
`;

  it('advises on a blocked-by ref that resolves to no known entry or feature', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithBlockedBy('does-not-exist'),
      backlogRaw: '# Backlog\n',
      strict: false,
      counterExists: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.advisories).toContainEqual(
      expect.objectContaining({ rule: 'unknown-blocked-by-ref', file: 'docs/roadmap.md' }),
    );
  });

  it('promotes an unknown blocked-by ref to an error in strict mode', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithBlockedBy('does-not-exist'),
      backlogRaw: '# Backlog\n',
      strict: true,
      counterExists: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ rule: 'unknown-blocked-by-ref' }),
    );
  });

  it('accepts a blocked-by ref that names another entry by slug', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithBlockedBy('some-target'),
      backlogRaw: targetBacklog,
      strict: true,
      counterExists: false,
    });
    expect(result.errors.filter((e) => e.rule === 'unknown-blocked-by-ref')).toEqual([]);
  });

  it('accepts a blocked-by ref that names a shipped feature (by slug) not in the queue', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithBlockedBy('shipped-thing'),
      backlogRaw: '# Backlog\n',
      strict: true,
      counterExists: false,
      featureSlugs: ['shipped-thing'],
    });
    expect(result.errors.filter((e) => e.rule === 'unknown-blocked-by-ref')).toEqual([]);
  });

  it('accepts a blocked-by ref that names a feature by entry-id', () => {
    const result = validateTriageInputs({
      roadmapRaw: roadmapWithBlockedBy('Q-0099'),
      backlogRaw: '# Backlog\n',
      strict: true,
      counterExists: false,
      featureEntryIds: ['Q-0099'],
    });
    expect(result.errors.filter((e) => e.rule === 'unknown-blocked-by-ref')).toEqual([]);
  });
});
