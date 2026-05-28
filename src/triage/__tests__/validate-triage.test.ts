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
    const result = validateTriageInputs({ roadmapRaw: raw, backlogRaw: okBacklog, strict: false });
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
    const result = validateTriageInputs({ roadmapRaw: okRoadmap, backlogRaw: raw, strict: false });
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
    const result = validateTriageInputs({ roadmapRaw: raw, backlogRaw: okBacklog, strict: false });
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
    });
    expect(result.advisories.some((a) => a.rule === 'missing-optional-field')).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('promotes backlog size/impact advisories to errors in strict mode', () => {
    const result = validateTriageInputs({
      roadmapRaw: okRoadmap,
      backlogRaw: advisoryBacklog,
      strict: true,
    });
    expect(result.errors.some((e) => e.rule === 'missing-optional-field')).toBe(true);
  });
});
