import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOpencodeEvents } from '../opencode-events.js';

// @tests: make-noldor-agent-agnostic

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'opencode-events.ndjson'), 'utf8');

describe('parseOpencodeEvents', () => {
  it('returns the complete text of a single (multiline) type:text part', () => {
    expect(parseOpencodeEvents(FIXTURE)).toBe('alpha\nbravo\ncharlie');
  });

  it('concatenates distinct-id text parts in first-seen order (multi-step run)', () => {
    const s =
      '{"type":"text","part":{"id":"a","type":"text","text":"Hel"}}\n' +
      '{"type":"text","part":{"id":"b","type":"text","text":"lo"}}\n';
    expect(parseOpencodeEvents(s)).toBe('Hello');
  });

  it('keeps the LAST value for a repeated part.id (defends against cumulative re-emit)', () => {
    const s =
      '{"type":"text","part":{"id":"a","type":"text","text":"Hel"}}\n' +
      '{"type":"text","part":{"id":"a","type":"text","text":"Hello world"}}\n';
    expect(parseOpencodeEvents(s)).toBe('Hello world');
  });

  it('is fail-open: skips malformed/blank lines and non-text events, never throws', () => {
    const s =
      '\nnot json\n{"type":"step_start","part":{"id":"s"}}\n' +
      '{"type":"text","part":{"id":"x","text":"X"}}\n{bad\n';
    expect(parseOpencodeEvents(s)).toBe('X');
  });

  it('returns empty for no text events / empty input', () => {
    expect(
      parseOpencodeEvents(
        '{"type":"step_finish","part":{"id":"f","tokens":{"input":9,"output":1}}}',
      ),
    ).toBe('');
    expect(parseOpencodeEvents('')).toBe('');
  });
});
