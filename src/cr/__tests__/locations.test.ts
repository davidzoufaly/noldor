// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { extractLocations } from '../locations.js';

const CHANGED = ['src/cr/orchestrate.ts', 'src/cr/lanes/subagent.ts', 'docs/roadmap.md'];

describe('extractLocations', () => {
  it('resolves a directory-qualified path with a line', () => {
    expect(extractLocations('`src/cr/orchestrate.ts:475` returns early', CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475 },
    ]);
  });

  it('resolves a bare basename against the changed set', () => {
    expect(extractLocations('`subagent.ts:94` never runs', CHANGED)).toEqual([
      { file: 'src/cr/lanes/subagent.ts', line: 94 },
    ]);
  });

  it('resolves a range to endLine', () => {
    expect(extractLocations('see orchestrate.ts:475-479', CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475, endLine: 479 },
    ]);
  });

  it('is extension-agnostic — markdown counts', () => {
    expect(extractLocations('docs/roadmap.md:12 is stale', CHANGED)).toEqual([
      { file: 'docs/roadmap.md', line: 12 },
    ]);
  });

  it('returns every distinct mention, deduplicated, in first-seen order', () => {
    const msg = 'orchestrate.ts:475 and subagent.ts:94 and orchestrate.ts:475 again';
    expect(extractLocations(msg, CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475 },
      { file: 'src/cr/lanes/subagent.ts', line: 94 },
    ]);
  });

  it('yields nothing for a path outside the changed set', () => {
    expect(extractLocations('src/core/session.ts:10 is wrong', CHANGED)).toEqual([]);
  });

  it('yields nothing for an absolute path or a traversal', () => {
    expect(extractLocations('/etc/passwd:1', CHANGED)).toEqual([]);
    expect(extractLocations('../../orchestrate.ts:1', CHANGED)).toEqual([]);
  });

  it('yields nothing for an ambiguous bare basename', () => {
    const changed = ['a/dup.ts', 'b/dup.ts'];
    expect(extractLocations('dup.ts:3 broke', changed)).toEqual([]);
  });

  it('yields nothing when the message names no location', () => {
    expect(extractLocations('this is simply wrong', CHANGED)).toEqual([]);
  });

  it('yields nothing when the changed set is empty', () => {
    expect(extractLocations('orchestrate.ts:475', [])).toEqual([]);
  });
});
