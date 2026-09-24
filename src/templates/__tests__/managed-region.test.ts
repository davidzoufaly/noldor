// @tests: scaffold-one-agent-rules-file-not-two
import { describe, expect, it } from 'vitest';
import {
  REGION_END,
  REGION_START,
  appendRegion,
  planRegionSync,
  readRegion,
  replaceRegion,
  requireRegion,
} from '../managed-region.js';

const region = (body: string): string => `${REGION_START}\n${body}\n${REGION_END}`;
const TEMPLATE = `# Agent Rules\n\nstarter prose\n\n${region('framework v2')}\n`;

describe('readRegion', () => {
  it('reads a document with no markers as absent', () => {
    expect(readRegion('# Mine\n\nmy rules\n')).toEqual({ kind: 'absent' });
  });

  it('returns the region with both marker lines and its line span', () => {
    expect(readRegion(`# Mine\n${region('a\nb')}\ntail\n`)).toEqual({
      kind: 'present',
      region: `${REGION_START}\na\nb\n${REGION_END}`,
      startLine: 1,
      endLine: 4,
    });
  });

  it('matches markers as whole lines, so prose that quotes one is not a marker', () => {
    expect(readRegion(`see the ${REGION_START} marker\n`)).toEqual({ kind: 'absent' });
  });

  it.each([
    ['a start without an end', `${REGION_START}\nx\n`],
    ['an end without a start', `x\n${REGION_END}\n`],
    ['a second region', `${region('a')}\n${region('b')}\n`],
    ['the end before the start', `${REGION_END}\nx\n${REGION_START}\n`],
  ])('refuses %s as malformed', (_label, doc) => {
    expect(readRegion(doc).kind).toBe('malformed');
  });
});

describe('replaceRegion and appendRegion', () => {
  it('replaceRegion swaps only the region and keeps every other line', () => {
    const doc = `# Mine\nabove\n${region('old')}\nbelow\n`;
    const read = readRegion(doc);
    if (read.kind !== 'present') throw new Error('fixture has a region');
    expect(replaceRegion(doc, read, region('new'))).toBe(
      `# Mine\nabove\n${REGION_START}\nnew\n${REGION_END}\nbelow\n`,
    );
  });

  it('appendRegion keeps the document as a byte-identical prefix', () => {
    expect(appendRegion('# Mine\nrules', region('x'))).toBe(`# Mine\nrules\n\n${region('x')}\n`);
    expect(appendRegion('# Mine\n', region('x'))).toBe(`# Mine\n\n${region('x')}\n`);
    expect(appendRegion('', region('x'))).toBe(`${region('x')}\n`);
  });
});

describe('requireRegion', () => {
  it('throws for a template without a region, which is a packaging bug', () => {
    expect(() => requireRegion('# no region\n', 'AGENTS.md')).toThrow(/AGENTS\.md/);
  });
});

describe('planRegionSync', () => {
  it('appends the template region to a consumer file that has none', () => {
    expect(planRegionSync('# Mine\n', TEMPLATE, 'AGENTS.md')).toEqual({
      kind: 'append',
      content: `# Mine\n\n${region('framework v2')}\n`,
    });
  });

  it('is unchanged when the regions match, whatever surrounds them', () => {
    expect(
      planRegionSync(`# Mine\nown text\n${region('framework v2')}\n`, TEMPLATE, 'AGENTS.md'),
    ).toEqual({ kind: 'unchanged' });
  });

  it('replaces a drifted region and keeps the consumer text around it', () => {
    expect(
      planRegionSync(`top\n${region('framework v1')}\nbottom\n`, TEMPLATE, 'AGENTS.md'),
    ).toEqual({ kind: 'replace', content: `top\n${region('framework v2')}\nbottom\n` });
  });

  it('passes a malformed consumer file through without planning a write', () => {
    expect(planRegionSync(`${REGION_START}\nx\n`, TEMPLATE, 'AGENTS.md').kind).toBe('malformed');
  });
});
