// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Unit 1 of the decision-context-depth spec: the sub-bullet field grammar and
// the `## Confirmed` section. Kept beside `ledger.test.ts` rather than inside it
// because that file already covers the pre-field grammar and scope resolution.
import { describe, expect, it } from 'vitest';

import { emptyLedger, parseLedger, serializeLedger, type LedgerState } from '../ledger.js';

const LEGACY = [
  '# Design ledger — some-slug',
  '',
  '## Entry',
  '',
  '- entry-slug',
  '',
  '## Scope',
  '',
  '- scope text',
  '',
  '## Decided',
  '',
  '- D1 first',
  '- D2 second',
  '',
  '## Open',
  '',
  '- O1 still open',
  '- O2 ~~answered~~ → D2',
  '',
  '## Existing support',
  '',
  '- src/foo.ts:12 — does X',
  '',
].join('\n');

const WITH_FIELDS = [
  '# Design ledger — some-slug',
  '',
  '## Entry',
  '',
  '## Scope',
  '',
  '## Decided',
  '',
  '- D1 chose A',
  '  - section: Design',
  '  - why: because B',
  '  - instead-of: C',
  '',
  '## Open',
  '',
  '- O1 a question',
  '  - section: Design',
  '',
  '## Existing support',
  '',
  '## Confirmed',
  '',
  '- Design · deadbeef',
  '',
].join('\n');

describe('sub-bullet fields', () => {
  it('round-trips canonical-order fields byte-identically', () => {
    expect(serializeLedger('some-slug', parseLedger(WITH_FIELDS))).toBe(WITH_FIELDS);
  });

  it('parses the fields onto their entries', () => {
    const s = parseLedger(WITH_FIELDS);
    expect(s.unparsed).toEqual([]);
    expect(s.decided[0]).toEqual({
      id: 'D1',
      text: 'chose A',
      section: 'Design',
      why: 'because B',
      insteadOf: 'C',
    });
    expect(s.open[0]).toEqual({
      id: 'O1',
      text: 'a question',
      resolvedBy: null,
      section: 'Design',
    });
    expect(s.confirmed).toEqual([{ name: 'Design', digest: 'deadbeef' }]);
  });

  it('re-serializes out-of-order fields in canonical order', () => {
    const scrambled = WITH_FIELDS.replace(
      ['  - section: Design', '  - why: because B', '  - instead-of: C'].join('\n'),
      ['  - why: because B', '  - instead-of: C', '  - section: Design'].join('\n'),
    );
    expect(serializeLedger('some-slug', parseLedger(scrambled))).toBe(WITH_FIELDS);
  });

  it('leaves a pre-field ledger byte-identical and its fields undefined', () => {
    const s = parseLedger(LEGACY);
    expect(s.unparsed).toEqual([]);
    expect(s.decided[0]!.why).toBeUndefined();
    expect(s.decided[0]!.section).toBeUndefined();
    expect(s.open[0]!.section).toBeUndefined();
    expect(s.confirmed).toEqual([]);
    expect(serializeLedger('some-slug', s)).toBe(LEGACY);
  });

  it('omits an empty Confirmed section on write', () => {
    const s = emptyLedger();
    expect(serializeLedger('x', s)).not.toContain('## Confirmed');
  });

  it('drops a present-but-empty Confirmed section on reserialize', () => {
    const withEmpty = LEGACY.trimEnd() + '\n\n## Confirmed\n';
    const s = parseLedger(withEmpty);
    expect(s.unparsed).toEqual([]);
    expect(serializeLedger('some-slug', s)).toBe(LEGACY);
  });
});

describe('fail-closed conditions', () => {
  const withDecided = (...body: string[]): LedgerState =>
    parseLedger(['## Decided', '', ...body, ''].join('\n'));

  it('rejects an unknown sub-bullet key', () => {
    expect(withDecided('- D1 a', '  - notes: x').unparsed).toContain('Decided');
  });

  it('rejects a duplicate key on one entry', () => {
    expect(withDecided('- D1 a', '  - why: x', '  - why: y').unparsed).toContain('Decided');
  });

  it('rejects an empty value', () => {
    expect(withDecided('- D1 a', '  - why: ').unparsed).toContain('Decided');
  });

  it('rejects indentation other than exactly two spaces', () => {
    expect(withDecided('- D1 a', ' - why: x').unparsed).toContain('Decided');
    expect(withDecided('- D1 a', '   - why: x').unparsed).toContain('Decided');
  });

  it('rejects a sub-bullet with no preceding entry', () => {
    expect(withDecided('  - why: x', '- D1 a').unparsed).toContain('Decided');
  });

  it('rejects why or instead-of under an open thread', () => {
    const s = parseLedger(['## Open', '', '- O1 q', '  - why: x', ''].join('\n'));
    expect(s.unparsed).toContain('Open');
  });

  it('accepts section under an open thread', () => {
    const s = parseLedger(['## Open', '', '- O1 q', '  - section: Design', ''].join('\n'));
    expect(s.unparsed).toEqual([]);
  });

  it('clears the section it rejected so no half-parsed state survives', () => {
    expect(withDecided('- D1 a', '  - notes: x').decided).toEqual([]);
  });

  it('rejects a malformed Confirmed line', () => {
    expect(parseLedger(['## Confirmed', '', '- NoDigest', ''].join('\n')).unparsed).toContain(
      'Confirmed',
    );
    expect(parseLedger(['## Confirmed', '', '- Bad · NOTHEX12', ''].join('\n')).unparsed).toContain(
      'Confirmed',
    );
  });

  it('rejects a duplicate name in Confirmed', () => {
    const s = parseLedger(['## Confirmed', '', '- A · aaaaaaaa', '- A · bbbbbbbb', ''].join('\n'));
    expect(s.unparsed).toContain('Confirmed');
  });

  it('rejects a sub-bullet under a Confirmed line', () => {
    const s = parseLedger(['## Confirmed', '', '- A · aaaaaaaa', '  - why: x', ''].join('\n'));
    expect(s.unparsed).toContain('Confirmed');
  });

  it('keeps tolerating an unparseable pre-field section', () => {
    expect(withDecided('- not-an-id text').unparsed).toContain('Decided');
  });
});
