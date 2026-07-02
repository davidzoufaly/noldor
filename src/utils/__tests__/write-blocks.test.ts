// @tests: dashboard-roadmap-drag-drop, parallel-drain-roadmapmd-conflict-auto-resolution
import { countEntries, insertBlock, moveBlock, removeBlock } from '../write-blocks.js';

const ROADMAP_FIX = `# Roadmap

### Noldor Framework

#### Alpha

- area: tooling
- type: feat

Alpha body.

#### Beta

- area: tooling
- type: feat

Beta body.

### Direct Entry

- area: web
- type: feat

Direct body.
`;

const BACKLOG_FIX = `# Backlog

### One

- area: web
- type: feat

One body.

### Two

- area: web
- type: feat

Two body.
`;

describe(moveBlock, () => {
  it('moves a roadmap H4 entry to a new entry position (last → first within category)', () => {
    const out = moveBlock(ROADMAP_FIX, 'beta', 0);
    const order = out.match(/^####? .+$/gm) ?? [];
    expect(order).toEqual(['### Noldor Framework', '#### Beta', '#### Alpha', '### Direct Entry']);
  });

  it('moves a backlog H3 entry to last position', () => {
    const out = moveBlock(BACKLOG_FIX, 'one', 1);
    const order = out.match(/^### .+$/gm) ?? [];
    expect(order).toEqual(['### Two', '### One']);
  });

  it('throws on unknown slug', () => {
    expect(() => moveBlock(BACKLOG_FIX, 'missing', 0)).toThrow(/slug.*missing/i);
  });

  it('throws on out-of-range targetIndex', () => {
    expect(() => moveBlock(BACKLOG_FIX, 'one', 99)).toThrow(/range/i);
  });

  it('is a no-op when targetIndex equals current index', () => {
    expect(moveBlock(BACKLOG_FIX, 'one', 0)).toBe(BACKLOG_FIX);
  });
});

describe(removeBlock, () => {
  it('removes a block + returns it', () => {
    const { newRaw, removedBlock } = removeBlock(BACKLOG_FIX, 'one');
    expect(newRaw).not.toContain('One body.');
    expect(removedBlock).toContain('### One');
    expect(removedBlock).toContain('One body.');
  });
});

describe(insertBlock, () => {
  it('inserts at top of an H3-only file with destDepth=3', () => {
    const { removedBlock } = removeBlock(ROADMAP_FIX, 'beta');
    const out = insertBlock(BACKLOG_FIX, removedBlock, 0, 3);
    const order = out.match(/^### .+$/gm) ?? [];
    expect(order).toEqual(['### Beta', '### One', '### Two']);
  });

  it('inserts at bottom of an H3-only file', () => {
    const { removedBlock } = removeBlock(ROADMAP_FIX, 'beta');
    const out = insertBlock(BACKLOG_FIX, removedBlock, 2, 3);
    const order = out.match(/^### .+$/gm) ?? [];
    expect(order).toEqual(['### One', '### Two', '### Beta']);
  });

  it('preserves bullet metadata and body when promoting via destDepth=3', () => {
    const { removedBlock } = removeBlock(ROADMAP_FIX, 'beta');
    const out = insertBlock(BACKLOG_FIX, removedBlock, 0, 3);
    expect(out).toContain('- area: tooling');
    expect(out).toContain('Beta body.');
  });

  it('throws on out-of-range index', () => {
    const { removedBlock } = removeBlock(ROADMAP_FIX, 'beta');
    expect(() => insertBlock(BACKLOG_FIX, removedBlock, 99, 3)).toThrow(/range/i);
  });

  it('skips fenced-code-block headings (does not treat ### inside fences as entries)', () => {
    const FENCED = `# Backlog

\`\`\`markdown
### NOT_AN_ENTRY

- area: doc
\`\`\`

### Real

- area: web

Body.
`;
    // moveBlock targetIndex=0 with only one real entry should be a no-op.
    expect(moveBlock(FENCED, 'real', 0)).toBe(FENCED);
  });

  it('inserts with destDepth=4 — heading rewritten to H4', () => {
    const { removedBlock } = removeBlock(BACKLOG_FIX, 'one');
    // Insert "One" (originally H3) into ROADMAP_FIX at position 0 with destDepth=4.
    const out = insertBlock(ROADMAP_FIX, removedBlock, 0, 4);
    // Expect "#### One" (H4) somewhere in the output — the depth was rewritten.
    expect(out).toMatch(/^#### One\b/m);
    // Original block heading was "### One"; should not survive as H3 inside the output's relocated block.
    // (Other H3s from ROADMAP_FIX are unrelated and stay H3.)
    const h3OneCount = (out.match(/^### One\b/gm) ?? []).length;
    expect(h3OneCount).toBe(0);
  });
});

describe('write-blocks contract edge cases', () => {
  it('moveBlock normalizes input missing trailing newline (no heading collision after splice)', () => {
    const NO_TRAILING = `### A

- area: x

Body A.

### B

- area: x

Body B.`; // intentionally no trailing newline
    const out = moveBlock(NO_TRAILING, 'a', 1);
    // After the move there must be exactly one blank line between blocks; the
    // two headings must not run together as "Body A.\n### A\n".
    expect(out).toMatch(/Body B\.\n\n### A\n/);
    expect(out).not.toMatch(/Body B\.\n### A/);
  });

  it('insertBlock normalizes input missing trailing newline', () => {
    const NO_TRAILING_DEST = `### A

- area: x

Body A.`; // no trailing newline
    const BLOCK = `### B

- area: x

Body B.
`;
    const out = insertBlock(NO_TRAILING_DEST, BLOCK, 1, 3);
    expect(out).toMatch(/Body A\.\n\n### B\n/);
  });

  it('moveBlock resolves slug collisions by suffix (auto-save vs auto-save-2)', () => {
    const COLLIDE = `# F

### Auto-Save

- area: x

A.

### Auto-Save

- area: x

B.

### Auto-Save

- area: x

C.
`;
    // Move the third "Auto-Save" (slug "auto-save-3") to position 0.
    const out = moveBlock(COLLIDE, 'auto-save-3', 0);
    // After move, the new first block's body should be "C." (the one we
    // moved); the new second block's body should be "A." (original first).
    const headings = out.match(/^### .+$/gm) ?? [];
    expect(headings.length).toBe(3);
    // Order check via body presence: "C." should appear before "A." now.
    expect(out.indexOf('C.')).toBeLessThan(out.indexOf('A.'));
    expect(out.indexOf('A.')).toBeLessThan(out.indexOf('B.'));
  });
});

describe('countEntries', () => {
  it('counts area-bearing blocks (H3 + H4) and skips category containers', () => {
    // Alpha, Beta (H4) + Direct Entry (H3) = 3; "### Noldor Framework" is a
    // container (no `- area:` bullet) and is not counted.
    expect(countEntries(ROADMAP_FIX)).toBe(3);
  });

  it('counts flat H3 entries', () => {
    expect(countEntries(BACKLOG_FIX)).toBe(2);
  });

  it('returns 0 for a file with no entries', () => {
    expect(countEntries('# Roadmap\n\nJust prose, no blocks.\n')).toBe(0);
  });

  it('is the append index insertBlock uses for end-of-file insertion', () => {
    const n = countEntries(BACKLOG_FIX);
    const out = insertBlock(BACKLOG_FIX, '### Three\n\n- area: web\n\nThree body.\n', n, 3);
    // New entry lands after the last existing entry.
    expect(out.indexOf('Three body.')).toBeGreaterThan(out.indexOf('Two body.'));
  });
});
