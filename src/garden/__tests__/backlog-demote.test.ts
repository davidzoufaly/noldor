import { demoteStaleBacklog, STALE_BACKLOG_DAYS_DEFAULT } from '../backlog-demote.js';

import { parseBacklog } from '../../utils/parse-blocks.js';

// @tests: noldor

/** 2026-06-11T00:00:00Z — fixed clock so fixtures age deterministically. */
const NOW_MS = Date.parse('2026-06-11T00:00:00Z');

describe(demoteStaleBacklog, () => {
  it('demotes an entry older than the threshold: phase bullet + dated marker', () => {
    const raw = `# Backlog

### Old Idea

- area: tooling
- type: feat
- since: 2025-01-01
- size: S
- impact: low

Description text.
`;
    const { newRaw, demoted } = demoteStaleBacklog(raw, { nowMs: NOW_MS });

    expect(demoted).toEqual([{ name: 'Old Idea', since: '2025-01-01', slug: 'old-idea' }]);
    expect(newRaw).toContain('- impact: low\n- phase: later\n');
    expect(newRaw).toContain(
      `- demoted 2026-06-11: stale (since 2025-01-01, >${STALE_BACKLOG_DAYS_DEFAULT} days) — phase auto-demoted to later`,
    );
    expect(parseBacklog(newRaw)[0].phase).toBe('later');
  });

  it('leaves fresh entries untouched', () => {
    const raw = `# Backlog

### New Idea

- area: tooling
- since: 2026-05-01

Description text.
`;
    const { newRaw, demoted } = demoteStaleBacklog(raw, { nowMs: NOW_MS });
    expect(demoted).toHaveLength(0);
    expect(newRaw).toBe(raw);
  });

  it('is idempotent — a second pass over the output is a no-op', () => {
    const raw = `# Backlog

### Old Idea

- area: tooling
- since: 2025-01-01

Description text.
`;
    const first = demoteStaleBacklog(raw, { nowMs: NOW_MS });
    const second = demoteStaleBacklog(first.newRaw, { nowMs: NOW_MS });
    expect(second.demoted).toHaveLength(0);
    expect(second.newRaw).toBe(first.newRaw);
  });

  it('rewrites an existing phase bullet in place instead of adding a second one', () => {
    const raw = `# Backlog

### Old Idea

- area: tooling
- phase: now
- since: 2025-01-01

Description text.
`;
    const { newRaw, demoted } = demoteStaleBacklog(raw, { nowMs: NOW_MS });
    expect(demoted).toHaveLength(1);
    expect(newRaw.match(/^- phase: /gm)).toHaveLength(1);
    expect(newRaw).toContain('- phase: later');
    expect(newRaw).not.toContain('- phase: now');
  });

  it('skips entries with a malformed since date', () => {
    const raw = `# Backlog

### Broken Idea

- area: tooling
- since: not-a-date

Description text.
`;
    const { newRaw, demoted } = demoteStaleBacklog(raw, { nowMs: NOW_MS });
    expect(demoted).toHaveLength(0);
    expect(newRaw).toBe(raw);
  });

  it('handles a fields-only block followed by another heading', () => {
    const raw = `# Backlog

### Old Idea

- area: tooling
- since: 2025-01-01

### Fresh Idea

- area: tooling
- since: 2026-06-01

Fresh description.
`;
    const { newRaw, demoted } = demoteStaleBacklog(raw, { nowMs: NOW_MS });
    expect(demoted).toEqual([{ name: 'Old Idea', since: '2025-01-01', slug: 'old-idea' }]);

    const entries = parseBacklog(newRaw);
    expect(entries[0].phase).toBe('later');
    expect(entries[1].phase).toBeUndefined();
    // Marker lands inside the Old Idea block, before the Fresh Idea heading.
    expect(newRaw.indexOf('- demoted 2026-06-11:')).toBeLessThan(newRaw.indexOf('### Fresh Idea'));
  });

  it('respects a custom --days threshold', () => {
    const raw = `# Backlog

### Recent-ish Idea

- area: tooling
- since: 2026-05-01

Description text.
`;
    const strict = demoteStaleBacklog(raw, { nowMs: NOW_MS, staleDays: 30 });
    expect(strict.demoted).toHaveLength(1);
    const lax = demoteStaleBacklog(raw, { nowMs: NOW_MS, staleDays: 60 });
    expect(lax.demoted).toHaveLength(0);
  });
});
