// @tests: dashboard-roadmap-drag-drop, replace-roadmap-buckets-with-flat-priority-order, roadmap-priority-ordering
import { parseBacklog, parseRoadmap } from '../parse-blocks.js';
import { slugify } from '../slugify.js';

describe(parseBacklog, () => {
  it('records the since field when present', () => {
    const raw = `# Backlog

### Cloud Sync
- area: persistence
- since: 2026-04-27

Description.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.since).toBe('2026-04-27');
  });

  it('leaves since undefined when absent', () => {
    const raw = `# Backlog

### Old Entry
- area: persistence

No since field.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.since).toBeUndefined();
  });

  it('skips blocks without an area field', () => {
    const raw = `### Just a heading

No bullet fields.
`;
    const entries = parseBacklog(raw);
    expect(entries).toHaveLength(0);
  });

  it('records the type field when present', () => {
    const raw = `### Refactor Editor Store
- area: web
- type: refactor
- since: 2026-05-05

Description.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.type).toBe('refactor');
  });

  it('leaves type undefined when absent', () => {
    const raw = `### Old Entry
- area: persistence

No type field.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.type).toBeUndefined();
  });

  it('assigns 1-based priority by file order and picks up size/impact bullets', () => {
    const raw = `# Backlog

### First
- area: persistence
- size: M
- impact: high

First entry.

### Second
- area: persistence
- size: XS

Second entry, missing impact.

### Third
- area: persistence

Third entry, missing size + impact.
`;
    const entries = parseBacklog(raw);
    expect(entries.map((e) => [e.name, e.priority, e.size, e.impact])).toEqual([
      ['First', 1, 'M', 'high'],
      ['Second', 2, 'XS', undefined],
      ['Third', 3, undefined, undefined],
    ]);
    // backlog has no H3 categories — level stays at 3, category stays undefined
    expect(entries.every((e) => e.level === 3)).toBe(true);
    expect(entries.every((e) => e.category === undefined)).toBe(true);
  });
});

describe(parseRoadmap, () => {
  it('parses flat H3 entries in document order across the whole file', () => {
    const raw = `# Roadmap

### First Entry
- area: web
- since: 2026-05-11

First.

### Second Entry
- area: tooling
- since: 2026-05-12

Second.
`;
    const entries = parseRoadmap(raw);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => [e.name, e.priority, e.level])).toEqual([
      ['First Entry', 1, 3],
      ['Second Entry', 2, 3],
    ]);
  });

  it('treats H3 without `- area:` as a category container and stamps the category on following H4 entries', () => {
    const raw = `# Roadmap

### Noldor Framework

Foundation work blurb.

#### Priority Handling

- area: tooling
- type: feat
- since: 2026-05-05

First framework item.

#### Another Item

- area: tooling
- type: fix
- since: 2026-05-06

Second framework item.
`;
    const entries = parseRoadmap(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: 'Priority Handling',
      priority: 1,
      level: 4,
      category: 'Noldor Framework',
    });
    expect(entries[1]).toMatchObject({
      name: 'Another Item',
      priority: 2,
      level: 4,
      category: 'Noldor Framework',
    });
  });

  it('resets the category when a new H3 category container is reached', () => {
    const raw = `# Roadmap

### Category A

#### Entry 1
- area: tooling

Body.

### Category B

#### Entry 2
- area: tooling

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries.map((e) => [e.name, e.category, e.priority])).toEqual([
      ['Entry 1', 'Category A', 1],
      ['Entry 2', 'Category B', 2],
    ]);
  });

  it('priority counter advances across categories — file-wide, not per-section', () => {
    const raw = `# Roadmap

### Category A

#### Entry 1
- area: tooling

Body.

### Category B

#### Entry 2
- area: tooling

Body.

#### Entry 3
- area: tooling

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries.map((e) => [e.name, e.priority])).toEqual([
      ['Entry 1', 1],
      ['Entry 2', 2],
      ['Entry 3', 3],
    ]);
  });

  it('ignores fenced code blocks (does not treat ### inside ``` as a heading)', () => {
    const raw = `### Real Entry
- area: tooling

\`\`\`markdown
### Looks like a heading but is inside a code fence
- area: nope
\`\`\`

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Real Entry');
  });

  it('clears the inherited category when a direct H3 entry (with `- area:`) interrupts a category run', () => {
    const raw = `# Roadmap

### Category A

#### Entry 1
- area: tooling

Body.

### Direct H3 Entry
- area: web
- type: feat
- since: 2026-05-13

Body.

#### Stray H4

- area: tooling

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries.map((e) => [e.name, e.category, e.level])).toEqual([
      ['Entry 1', 'Category A', 4],
      ['Direct H3 Entry', undefined, 3],
      // After a direct H3 entry, category is cleared — the stray H4 below has no category.
      ['Stray H4', undefined, 4],
    ]);
  });

  it('picks up size and impact bullets on H4 entries', () => {
    const raw = `### Noldor Framework

#### Entry With Size And Impact

- area: tooling
- type: feat
- size: M
- impact: critical

Body.

#### Entry Missing Both

- area: tooling
- type: fix

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries.map((e) => [e.name, e.size, e.impact])).toEqual([
      ['Entry With Size And Impact', 'M', 'critical'],
      ['Entry Missing Both', undefined, undefined],
    ]);
  });
});

describe('parse-blocks confidence + deps', () => {
  it('parses confidence bullet from a roadmap H4 entry', () => {
    const raw = `### Category

#### Entry

- area: tooling
- type: feat
- since: 2026-05-14
- size: M
- impact: high
- confidence: med

Body.
`;
    const [entry] = parseRoadmap(raw);
    expect(entry.confidence).toBe('med');
  });

  it('parses deps bullet as a string array on a roadmap entry', () => {
    const raw = `### Cat

#### Entry

- area: tooling
- type: feat
- since: 2026-05-14
- size: S
- impact: med
- deps: foo-slug, bar-slug

Body.
`;
    const [entry] = parseRoadmap(raw);
    expect(entry.deps).toEqual(['foo-slug', 'bar-slug']);
  });

  it('parses confidence + deps from a backlog entry (level-3 direct)', () => {
    const raw = `### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-14
- confidence: high
- deps: alpha, beta

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.confidence).toBe('high');
    expect(entry.deps).toEqual(['alpha', 'beta']);
  });

  it('returns undefined for confidence + deps when bullets are absent', () => {
    const raw = `### Entry

- area: tooling
- type: feat
- since: 2026-05-14

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.confidence).toBeUndefined();
    expect(entry.deps).toBeUndefined();
  });
});

describe('parse-blocks blocked-by alias', () => {
  it('parses a `blocked-by:` bullet into deps on a roadmap entry', () => {
    const raw = `### Cat

#### Entry

- area: tooling
- type: feat
- since: 2026-05-14
- size: S
- impact: med
- blocked-by: foo-slug, Q-0042

Body.
`;
    const [entry] = parseRoadmap(raw);
    expect(entry.deps).toEqual(['foo-slug', 'Q-0042']);
  });

  it('parses a `blocked-by:` bullet into deps on a backlog entry (level-3)', () => {
    const raw = `### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-14
- blocked-by: alpha, beta

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.deps).toEqual(['alpha', 'beta']);
  });

  it('unions `deps:` and `blocked-by:` (dedup, source order) on a roadmap entry', () => {
    const raw = `### Cat

#### Entry

- area: tooling
- type: feat
- since: 2026-05-14
- size: S
- impact: med
- deps: foo, bar
- blocked-by: bar, baz

Body.
`;
    const [entry] = parseRoadmap(raw);
    expect(entry.deps).toEqual(['foo', 'bar', 'baz']);
  });

  it('unions `deps:` and `blocked-by:` (dedup) on a backlog entry', () => {
    const raw = `### Backlog Entry

- area: tooling
- type: feat
- since: 2026-05-14
- deps: alpha, beta
- blocked-by: beta, gamma

Body.
`;
    const [entry] = parseBacklog(raw);
    expect(entry.deps).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe(`${parseBacklog.name} slug derivation`, () => {
  it('emits slug field derived via slugify(name)', () => {
    const raw = `# Backlog

### Cloud Sync
- area: persistence

Body.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.slug).toBe('cloud-sync');
    expect(entries[0]?.slug).toBe(slugify('Cloud Sync'));
  });

  it('suffixes duplicate slugs in source order', () => {
    const raw = `# Backlog

### Auto-Save

- area: web

First.

### Auto-Save

- area: web

Second.

### Auto-Save

- area: web

Third.
`;
    const entries = parseBacklog(raw);
    expect(entries.map((e) => e.slug)).toEqual(['auto-save', 'auto-save-2', 'auto-save-3']);
  });

  it('emits empty slug when heading slugifies to nothing', () => {
    const raw = `# Backlog

### !!!

- area: x

Body.
`;
    // Suppress stderr noise from the expected warning.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const entries = parseBacklog(raw);
    expect(entries[0]?.slug).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('slugifies to empty string'));
    warnSpy.mockRestore();
  });

  it('dedupes repeated collision warnings across multiple parseBacklog calls', () => {
    // Heading name unique to this test so the module-level warnedKeys set isn't
    // pre-populated by earlier tests (the dedupe is process-lifetime by design).
    const raw = `# Backlog

### Dedupe Probe Heading

- area: x

A.

### Dedupe Probe Heading

- area: x

B.
`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    parseBacklog(raw);
    parseBacklog(raw);
    parseBacklog(raw);
    // Only one duplicate-slug warning across the three calls (same name, same block index).
    const dupCalls = warnSpy.mock.calls.filter(([msg]) => String(msg).includes('duplicate slug'));
    expect(dupCalls.length).toBe(1);
    warnSpy.mockRestore();
  });
});

describe(`${parseRoadmap.name} slug derivation`, () => {
  it('emits slug for H4 entries under category containers', () => {
    const raw = `# Roadmap

### Noldor Framework

#### Trailer Scope-Alias Map

- area: tooling
- type: feat

Body.
`;
    const entries = parseRoadmap(raw);
    expect(entries[0]?.slug).toBe('trailer-scope-alias-map');
  });
});

describe('stable entry id parsing', () => {
  it('records the id field on roadmap entries and keeps it out of the description', () => {
    const raw = `# Roadmap

#### Entry A

- id: Q-0042
- area: tooling
- type: feat

Body text.
`;
    const entries = parseRoadmap(raw);
    expect(entries[0]?.id).toBe('Q-0042');
    expect(entries[0]?.description).toBe('Body text.');
  });

  it('records the id field on backlog entries and keeps it out of the description', () => {
    const raw = `# Backlog

### Entry B

- id: Q-0007
- area: tooling
- since: 2026-05-11

Body text.
`;
    const entries = parseBacklog(raw);
    expect(entries[0]?.id).toBe('Q-0007');
    expect(entries[0]?.description).toBe('Body text.');
  });

  it('leaves id undefined when absent', () => {
    const raw = `# Backlog

### No Id Entry

- area: tooling

Body.
`;
    expect(parseBacklog(raw)[0]?.id).toBeUndefined();
  });
});
