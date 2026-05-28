import { describe, expect, it } from 'vitest';

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getSuggestions,
  getTopPriorityNext,
  isWritePendingDeprecated,
  loadInProgressFds,
  loadMilestoneGate,
} from '../next-priority.js';

const ROADMAP_WITH_ENTRIES = `# Roadmap

### Noldor Framework

Some preamble paragraph that does not have an area bullet — acts as the
H3 category container.

#### Top Priority Item

- area: tooling
- type: feat
- since: 2026-05-13
- size: S
- impact: high
- parent: noldor

This is the top entry body.

#### Second Item

- area: tooling
- type: feat
- since: 2026-05-13
- size: M
- impact: high
- parent: noldor

Second entry body.
`;

const ROADMAP_EMPTY = `# Roadmap

(no entries yet)
`;

describe(getTopPriorityNext, () => {
  it('returns the first entry in file order', () => {
    const top = getTopPriorityNext(ROADMAP_WITH_ENTRIES);
    expect(top).not.toBeNull();
    expect(top?.name).toBe('Top Priority Item');
    expect(top?.size).toBe('S');
    expect(top?.parent).toBe('noldor');
    expect(top?.category).toBe('Noldor Framework');
  });

  it('returns null when the roadmap has no entries', () => {
    expect(getTopPriorityNext(ROADMAP_EMPTY)).toBe(null);
  });

  it('returns null when the input is empty', () => {
    expect(getTopPriorityNext('')).toBe(null);
  });

  it('returns the first entry across multiple H3 categories — counter advances across categories', () => {
    const md = `# Roadmap

### Category A

#### A-Item One

- area: tooling
- type: feat
- since: 2026-05-13
- size: S
- impact: high

Body.

### Category B

#### B-Item One

- area: tooling
- type: feat
- since: 2026-05-13
- size: S
- impact: high

Body.
`;
    const top = getTopPriorityNext(md);
    expect(top?.name).toBe('A-Item One');
    expect(top?.category).toBe('Category A');
  });
});

describe(isWritePendingDeprecated, () => {
  it('returns true when --write-pending is present', () => {
    expect(isWritePendingDeprecated(new Set(['--write-pending']))).toBe(true);
  });

  it('returns true when --write-pending appears alongside other flags', () => {
    expect(isWritePendingDeprecated(new Set(['--json', '--write-pending']))).toBe(true);
  });

  it('returns false when --write-pending is absent', () => {
    expect(isWritePendingDeprecated(new Set(['--json']))).toBe(false);
  });

  it('returns false for an empty argv set', () => {
    expect(isWritePendingDeprecated(new Set())).toBe(false);
  });
});

const ROADMAP_FOR_SUGGESTIONS = `# Roadmap

### Noldor Framework

#### Big Top Entry

- area: tooling
- type: feat
- since: 2026-05-13
- size: L
- impact: high

Body 1.

#### Second Top

- area: tooling
- type: feat
- since: 2026-05-13
- size: M
- impact: high

Body 2.

#### Third Top

- area: tooling
- type: feat
- since: 2026-05-13
- size: S
- impact: high

Body 3.

#### Tiny Quick Win

- area: tooling
- type: fix
- since: 2026-05-13
- size: XS
- impact: high

Body 4.

#### Other Quick Win

- area: tooling
- type: fix
- since: 2026-05-13
- size: S
- impact: critical

Body 5.

#### Milestone Match Candidate

- area: tooling
- type: feat
- since: 2026-05-13
- size: M
- impact: high

Body about milestone match candidate shipping fast.
`;

describe(getSuggestions, () => {
  it('returns top 3 file-order entries as topPriority', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [],
      milestoneGate: '',
    });
    expect(result.topPriority.map((e) => e.name)).toEqual([
      'Big Top Entry',
      'Second Top',
      'Third Top',
    ]);
  });

  it('returns 2 small×high-impact entries excluding topPriority', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [],
      milestoneGate: '',
    });
    expect(result.smallHighImpact).toHaveLength(2);
    expect(result.smallHighImpact.map((e) => e.name).toSorted()).toEqual(
      ['Other Quick Win', 'Tiny Quick Win'].toSorted(),
    );
  });

  it('returns null milestoneAligned when gate text is empty', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [],
      milestoneGate: '',
    });
    expect(result.milestoneAligned).toBeNull();
  });

  it('picks milestoneAligned by text overlap with gate paragraph', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [],
      milestoneGate: 'milestone match candidate shipping fast',
    });
    expect(result.milestoneAligned?.name).toBe('Milestone Match Candidate');
  });

  it('excludes topPriority + smallHighImpact entries from milestoneAligned', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [],
      milestoneGate: 'tiny quick win body',
    });
    expect(result.milestoneAligned?.name).not.toBe('Tiny Quick Win');
  });

  it('surfaces inProgress FDs verbatim', () => {
    const result = getSuggestions(ROADMAP_FOR_SUGGESTIONS, {
      inProgressFds: [{ slug: 'foo', name: 'Foo', tier: 'specs-only' }],
      milestoneGate: '',
    });
    expect(result.inProgress).toEqual([{ slug: 'foo', name: 'Foo', tier: 'specs-only' }]);
  });
});

describe(loadInProgressFds, () => {
  it('returns FDs with phase: in-progress, projecting slug/name/tier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inprogress-'));
    try {
      mkdirSync(join(dir, 'docs/features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs/features/alpha.md'),
        `---
name: Alpha Feature
phase: in-progress
area: tooling
category: Tooling
packages: [scripts]
noldor-tier: specs-only
links:
  code: []
  tests: []
---
# body
`,
      );
      writeFileSync(
        join(dir, 'docs/features/beta.md'),
        `---
name: Beta Feature
phase: done
introduced: 0.4.0
area: tooling
category: Tooling
packages: [scripts]
noldor-tier: full
links:
  code: []
  tests: []
  spec: docs/superpowers/specs/x.md
---
# body
`,
      );
      const result = loadInProgressFds(dir);
      expect(result).toEqual([{ slug: 'alpha', name: 'Alpha Feature', tier: 'specs-only' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe(loadMilestoneGate, () => {
  it('returns the ## Gate paragraph from the active milestone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'milestone-'));
    try {
      mkdirSync(join(dir, 'docs/milestones'), { recursive: true });
      writeFileSync(
        join(dir, 'docs/vision.md'),
        `---
current-milestone: public-release
---
# Vision
body
`,
      );
      writeFileSync(
        join(dir, 'docs/milestones/public-release.md'),
        `---
name: public-release
status: active
---

## Gate

Gate paragraph one.

## Success Criteria

other.
`,
      );
      expect(loadMilestoneGate(dir)).toBe('Gate paragraph one.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty string when no current-milestone is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-milestone-'));
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeFileSync(join(dir, 'docs/vision.md'), `# Vision\nbody\n`);
      expect(loadMilestoneGate(dir)).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty string when milestone file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'missing-milestone-'));
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true });
      writeFileSync(
        join(dir, 'docs/vision.md'),
        `---
current-milestone: ghost
---
body
`,
      );
      expect(loadMilestoneGate(dir)).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
