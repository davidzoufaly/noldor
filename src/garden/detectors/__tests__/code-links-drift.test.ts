// @tests: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics, feature-md-links-overhaul

import { describe, expect, it } from 'vitest';

import { codeAdapter } from '../../../sync/adapters/code.js';
import { docsAdapter } from '../../../sync/adapters/docs.js';
import { testsAdapter } from '../../../sync/adapters/tests.js';
import { detectLinksDrift } from '../code-links-drift.js';

describe('detectLinksDrift', () => {
  it('emits a gap for an FD whose cached array is stale', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/old.ts']]]);
    const gaps = detectLinksDrift(scanned, cached, codeAdapter);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('foo');
  });

  it('returns no gaps when arrays match', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(detectLinksDrift(m, new Map(m), codeAdapter)).toEqual([]);
  });

  it.each([
    [codeAdapter, 'links.code drift', 'sync code-links'],
    [testsAdapter, 'links.tests drift', 'sync test-links'],
    [docsAdapter, 'links.docs drift', 'sync doc-links'],
  ])('names the kind and its repair command (%#)', (adapter, category, command) => {
    const scanned = new Map<string, string[]>([['foo', ['a']]]);
    const cached = new Map<string, string[]>([['foo', ['b']]]);
    const [gap] = detectLinksDrift(scanned, cached, adapter);
    expect(gap.category).toBe(category);
    expect(gap.message).toContain(command);
  });

  it('emits nothing for an FD the write path would skip', () => {
    // No tag matched, but the cache still holds owned entries: the write path
    // declines to clear these, so calling them drift would be a permanent red.
    const scanned = new Map<string, string[]>();
    const cached = new Map<string, string[]>([['foo', ['docs/user/how-to/a.md']]]);
    expect(detectLinksDrift(scanned, cached, docsAdapter)).toEqual([]);
  });
});
