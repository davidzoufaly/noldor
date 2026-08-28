// @tests: graphify-plan-of-edges-nodes-for-plans-specs
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ADR_STRUCTURAL_CONTEXT_PLACEHOLDER } from '../../../core/structural-context-contract.js';
import {
  ADR_FLOOR_NUMBER,
  SPEC_FLOOR_DATE,
  detectStructuralContextStubs,
  toGaps,
} from '../structural-context.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'structural-context-'));
  mkdirSync(join(dir, 'docs', 'design', 'specs', 'archive'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'design', 'plans'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'adr'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Prose long enough to clear the floor by itself, carrying no marker. */
const LONG_PROSE =
  'plus a good deal of other prose here that clears the character floor on its own';

/** Real evidence — comfortably past the character floor. */
const REAL =
  'Lands in the detectors community c17 alongside garden-detect.ts; touches no god node.';

function spec(name: string, section: string | null, at = 'specs'): void {
  const body = [
    '# Something — Design',
    '',
    '## Design',
    '',
    ...(section === null ? [] : ['### Structural context', '', section, '']),
    '### U1 — a unit',
    '',
    'Does a thing.',
    '',
  ].join('\n');
  writeFileSync(
    join(dir, 'docs', 'design', at === 'specs' ? 'specs' : 'plans', name),
    body,
    'utf8',
  );
}

function archivedSpec(name: string, section: string | null): void {
  const body = [
    '# Old — Design',
    '',
    '## Design',
    '',
    ...(section === null ? [] : ['### Structural context', '', section, '']),
  ].join('\n');
  writeFileSync(join(dir, 'docs', 'design', 'specs', 'archive', name), body, 'utf8');
}

function adr(name: string, section: string | null): void {
  const body = [
    '---',
    'status: accepted',
    'date: 2026-08-29',
    '---',
    '',
    '# A Decision',
    '',
    '## Context',
    '',
    'Why.',
    '',
    ...(section === null ? [] : ['## Structural context', '', section, '']),
    '## Decision',
    '',
    'What.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'docs', 'adr', name), body, 'utf8');
}

const AFTER = '2026-08-29';
const BEFORE = '2026-08-01';

describe('spec scope floor', () => {
  it('reports a spec at or after the floor whose unit is missing', async () => {
    spec(`${SPEC_FLOOR_DATE}-a-design.md`, null);
    const found = await detectStructuralContextStubs(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ artifactKind: 'spec', rule: 'missing-section' });
  });

  it('ignores a spec dated before the floor — it could not have complied', async () => {
    spec(`${BEFORE}-a-design.md`, null);
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('ignores an archived spec however unfilled', async () => {
    archivedSpec(`${AFTER}-old-design.md`, null);
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('ignores a filename that is not a spec name, rather than reporting it undatable', async () => {
    writeFileSync(join(dir, 'docs', 'design', 'specs', 'notes.md'), '# notes\n', 'utf8');
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('never reports a plan — the evidence belongs one level up', async () => {
    spec(`${AFTER}-a.md`, null, 'plans');
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });
});

describe('stub rule', () => {
  it('passes a unit carrying real evidence', async () => {
    spec(`${AFTER}-a-design.md`, REAL);
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('reports a unit under the character floor', async () => {
    spec(`${AFTER}-a-design.md`, 'TBD.');
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'stub-section' });
  });

  it('counts fenced evidence toward the floor — a digest excerpt is work', async () => {
    spec(`${AFTER}-a-design.md`, ['```', REAL, '```'].join('\n'));
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('ignores a heading that only appears inside a fence', async () => {
    spec(`${AFTER}-a-design.md`, null);
    const path = join(dir, 'docs', 'design', 'specs', `${AFTER}-a-design.md`);
    writeFileSync(
      path,
      ['# S — Design', '', '## Design', '', '```', '### Structural context', REAL, '```', ''].join(
        '\n',
      ),
      'utf8',
    );
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'missing-section' });
  });

  it('counts fenced evidence whose fence contains a heading-shaped line', async () => {
    // The exact regression: a `#` comment inside a ```bash fence terminated the
    // raw section, so the unstripped measure — added precisely to credit fenced
    // evidence — saw nothing and reported a stub.
    spec(
      `${AFTER}-a-design.md`,
      ['```bash', '# pnpm noldor design graph-context --path src/x.ts', REAL, '```'].join('\n'),
    );
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('does not let a shorter nested fence close an outer fence early', async () => {
    // CommonMark: only the same character, at least as long, closes a fence. A
    // char-agnostic toggle let the inner ``` close the outer ```` and exposed
    // the heading-shaped line, truncating the section to nothing.
    spec(
      `${AFTER}-a-design.md`,
      ['````', '```', '# Structural context', '```', REAL, '````'].join('\n'),
    );
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('ignores an H3 that sits outside `## Design`', async () => {
    const path = join(dir, 'docs', 'design', 'specs', `${AFTER}-a-design.md`);
    writeFileSync(
      path,
      ['## Risks', '', '### Structural context', '', REAL, '', '## Design', '', '### U1', ''].join(
        '\n',
      ),
      'utf8',
    );
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'missing-section' });
  });

  it('stops the section at the next heading of the same depth', async () => {
    // `REAL` sits under U1, not under the unit, so the unit is still a stub.
    const path = join(dir, 'docs', 'design', 'specs', `${AFTER}-a-design.md`);
    writeFileSync(
      path,
      ['## Design', '', '### Structural context', '', '### U1', '', REAL, ''].join('\n'),
      'utf8',
    );
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'stub-section' });
  });
});

describe('noldor:cut suppression', () => {
  it('accepts a marker carrying a reason', async () => {
    spec(
      `${AFTER}-a-design.md`,
      'noldor:cut no graph tracked here yet — revisit once graphify runs',
    );
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('still reports a bare marker — the reason is what makes a skip a decision', async () => {
    spec(`${AFTER}-a-design.md`, 'noldor:cut');
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'stub-section' });
  });

  // These two shapes are the only ones that discriminate. Both a bogus marker
  // and a real one end in "not a stub" whenever the section is long, and both
  // end in "stub" whenever it is short — so the tell is a section that is long
  // overall while the marker's own reason is short.
  it('treats a marker-shaped prefix as ordinary prose, not a skip', async () => {
    spec(`${AFTER}-a-design.md`, ['noldor:cutlery x', LONG_PROSE].join('\n'));
    // Not a marker, and the section clears the floor on its own. The bare-prefix
    // bug read `lery x` as the reason and reported a stub here.
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('lets a real marker with a thin reason outrank surrounding prose', async () => {
    spec(`${AFTER}-a-design.md`, ['noldor:cut x', LONG_PROSE].join('\n'));
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'stub-section' });
  });

  it('ignores a marker outside the unit — it says nothing about this section', async () => {
    const path = join(dir, 'docs', 'design', 'specs', `${AFTER}-a-design.md`);
    writeFileSync(
      path,
      [
        '## Design',
        '',
        '### Structural context',
        '',
        '### U1',
        '',
        'noldor:cut this marker belongs to another concern entirely, not the unit',
        '',
      ].join('\n'),
      'utf8',
    );
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'stub-section' });
  });
});

describe('adr scope and rules', () => {
  it('ignores a record at or below the floor', async () => {
    adr(`${ADR_FLOOR_NUMBER}-old.md`, null);
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });

  it('reports a record above the floor whose section is missing', async () => {
    adr('0002-new.md', null);
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ artifactKind: 'adr', rule: 'missing-section' });
  });

  it('reports a record carrying only the template question', async () => {
    adr('0002-new.md', ADR_STRUCTURAL_CONTEXT_PLACEHOLDER);
    const found = await detectStructuralContextStubs(dir);
    expect(found[0]).toMatchObject({ rule: 'placeholder-only' });
  });

  it('accepts a record that keeps the question and answers beneath it', async () => {
    adr('0002-new.md', [ADR_STRUCTURAL_CONTEXT_PLACEHOLDER, '', REAL].join('\n'));
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });
});

describe('graph independence and projection', () => {
  it('behaves identically with no graphify-out present', async () => {
    spec(`${AFTER}-a-design.md`, 'TBD.');
    // No `graphify-out/` exists in the fixture at all.
    expect(await detectStructuralContextStubs(dir)).toHaveLength(1);
  });

  it('projects a stable itemId so repeated runs never duplicate', async () => {
    spec(`${AFTER}-a-design.md`, 'TBD.');
    const gaps = toGaps(await detectStructuralContextStubs(dir));
    expect(gaps[0]?.category).toBe('structural-context');
    expect(gaps[0]?.itemId).toBe(`docs/design/specs/${AFTER}-a-design.md#stub-section`);
  });

  it('returns nothing for a repo with no design dirs at all', async () => {
    rmSync(join(dir, 'docs'), { recursive: true, force: true });
    expect(await detectStructuralContextStubs(dir)).toEqual([]);
  });
});
