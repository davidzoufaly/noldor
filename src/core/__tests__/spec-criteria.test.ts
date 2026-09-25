// @tests: feature-pen-coverage-from-acceptance-criteria
import { describe, expect, it } from 'vitest';

import { readCriteria } from '../spec-criteria.js';

const spec = (...lines: string[]): string => lines.join('\n');

describe('readCriteria', () => {
  it('numbers the top-level items by position and keeps the number each one typed', () => {
    const md = spec('# S', '', '## Acceptance criteria', '', '1. one', '2. two', '3. three');
    expect(readCriteria(md)).toEqual([
      { position: 1, typed: 1 },
      { position: 2, typed: 2 },
      { position: 3, typed: 3 },
    ]);
  });

  it('keeps a number typed out of step rather than renumbering it', () => {
    const md = spec('## Acceptance criteria', '1. one', '2. two', '4. three');
    expect(readCriteria(md)).toEqual([
      { position: 1, typed: 1 },
      { position: 2, typed: 2 },
      { position: 3, typed: 4 },
    ]);
  });

  it('reads a bulleted list by position, with no typed number', () => {
    const md = spec('## Acceptance criteria', '- one', '- two');
    expect(readCriteria(md)).toEqual([
      { position: 1, typed: null },
      { position: 2, typed: null },
    ]);
  });

  it('matches a bare or lower-case Acceptance heading', () => {
    expect(readCriteria(spec('## Acceptance', '- a'))).toHaveLength(1);
    expect(readCriteria(spec('## acceptance criteria', '- a', '- b'))).toHaveLength(2);
  });

  it('skips nested items and stops at the next ## heading', () => {
    const md = spec(
      '## Acceptance criteria',
      '1. one',
      '   - a detail',
      '  2. nested',
      '2. two',
      '## Risks',
      '- not a criterion',
    );
    expect(readCriteria(md)).toEqual([
      { position: 1, typed: 1 },
      { position: 2, typed: 2 },
    ]);
  });

  it('does not count list lines inside a fence, nor end the section at a fenced heading', () => {
    const md = spec(
      '## Acceptance criteria',
      '1. one',
      '```md',
      '- fenced',
      '## Fenced heading',
      '2. fenced',
      '```',
      '2. two',
    );
    expect(readCriteria(md)).toEqual([
      { position: 1, typed: 1 },
      { position: 2, typed: 2 },
    ]);
  });

  it('ignores an Acceptance heading that sits inside a fence', () => {
    const md = spec(
      '```',
      '## Acceptance criteria',
      '- fenced',
      '```',
      '## Acceptance criteria',
      '- a',
      '- b',
    );
    expect(readCriteria(md)).toHaveLength(2);
  });

  it('counts items under the Acceptance section only, and nothing without one', () => {
    expect(readCriteria(spec('## Goals', '- g', '- g', '## Acceptance criteria', '- a'))).toEqual([
      { position: 1, typed: null },
    ]);
    expect(readCriteria(spec('## Goals', '- a', '- b'))).toEqual([]);
  });

  it('reads a CRLF document like an LF one', () => {
    expect(readCriteria('## Acceptance criteria\r\n1. one\r\n2. two\r\n')).toHaveLength(2);
  });
});
