// @tests: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics, feature-md-links-overhaul

import { describe, expect, it } from 'vitest';

import { codeAdapter } from '../../../sync/adapters/code.js';
import { docsAdapter } from '../../../sync/adapters/docs.js';
import { testsAdapter } from '../../../sync/adapters/tests.js';
import { detectLinksDrift, linksDriftGaps } from '../code-links-drift.js';
import type { CachedLoad, ScanResult } from '../../../sync/projection.js';

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

describe(linksDriftGaps, () => {
  const scanOf = (paths: string[]): ScanResult => ({
    tagged: paths.map((path) => ({ path, tags: ['feat'] })),
    failures: [],
  });
  const cacheOf = (arrays: string[], failures: CachedLoad['failures'] = []): CachedLoad => ({
    byKey: new Map([['tests', new Map([['feat', arrays]])]]),
    failures,
  });

  it('reports drift when every input was readable', () => {
    const gaps = linksDriftGaps(
      new Map([['tests', scanOf(['src/a.test.ts'])]]),
      cacheOf(['src/stale.test.ts']),
      [testsAdapter],
    );
    expect(gaps.map((g) => g.category)).toEqual(['links.tests drift']);
  });

  it('withholds every drift claim when the features directory is unreadable', () => {
    // The cache is unknown, not empty. Diffing against it would call every FD
    // drifted, so the gap names the directory and no comparison runs.
    const gaps = linksDriftGaps(
      new Map([['tests', scanOf(['src/a.test.ts'])]]),
      cacheOf(
        [],
        [
          {
            root: 'docs/features',
            code: 'EACCES',
            kind: 'features-dir',
            what: 'cannot read feature MD directory',
            remedy: 'fix permissions on the feature MD directory',
          },
        ],
      ),
      [testsAdapter],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].itemId).toBe('docs/features');
    expect(gaps[0].message).toContain('cannot read feature MD directory');
  });

  it('scopes an unparseable FD to itself and keeps checking the rest', () => {
    const cached: CachedLoad = {
      byKey: new Map([
        [
          'tests',
          new Map([
            ['feat', ['src/stale.test.ts']],
            ['other', ['src/also-stale.test.ts']],
          ]),
        ],
      ]),
      failures: [
        {
          root: 'docs/features/broken.md',
          code: 'EPARSE',
          kind: 'feature-md',
          what: 'cannot parse feature MD',
          remedy: 'repair the frontmatter of the listed feature MD(s)',
        },
      ],
    };

    const gaps = linksDriftGaps(new Map([['tests', scanOf([])]]), cached, [testsAdapter]);

    expect(gaps.some((g) => g.itemId === 'broken')).toBe(true);
    expect(gaps.some((g) => g.itemId === 'feat' || g.itemId === 'other')).toBe(false);
    // The gap text comes from the failure, so an unreadable FD is never
    // reported as an unparseable one.
    expect(gaps.find((g) => g.itemId === 'broken')?.message).toContain('cannot parse feature MD');
  });

  it('withdraws only the kind whose scan root was unreadable', () => {
    const gaps = linksDriftGaps(
      new Map([
        [
          'tests',
          {
            tagged: [],
            failures: [
              {
                root: 'src',
                code: 'EACCES',
                kind: 'root',
                what: 'cannot read scan root',
                remedy: 'fix permissions on the scan root',
              },
            ],
          },
        ],
        ['code', scanOf(['src/a.ts'])],
      ]),
      { byKey: new Map(), failures: [] },
      [testsAdapter, codeAdapter],
    );
    expect(gaps.filter((g) => g.category === 'links.tests drift')).toHaveLength(1);
    expect(gaps.some((g) => g.message.includes('unreadable'))).toBe(true);
  });
});

describe('gap text follows the failure, not the kind', () => {
  it('reports an unreadable FD as unreadable', () => {
    const gaps = linksDriftGaps(
      new Map(),
      {
        byKey: new Map(),
        failures: [
          {
            root: 'docs/features/locked.md',
            code: 'EACCES',
            kind: 'feature-md',
            what: 'cannot read feature MD',
            remedy: 'fix permissions on the listed feature MD(s)',
          },
        ],
      },
      [],
    );
    expect(gaps[0].message).toContain('cannot read feature MD');
    expect(gaps[0].message).not.toContain('cannot parse');
  });
});

describe('a tag naming no feature MD', () => {
  it('is gated under its own category rather than reported as drift', () => {
    const gaps = linksDriftGaps(
      new Map([['tests', { tagged: [{ path: 'src/a.test.ts', tags: ['ghost'] }], failures: [] }]]),
      { byKey: new Map([['tests', new Map([['real', []]])]]), failures: [] },
      [testsAdapter],
    );
    const missing = gaps.filter((g) => g.category === 'links.tests missing FD');
    expect(missing.map((g) => g.itemId)).toEqual(['ghost']);
    expect(missing[0].message).toContain('does not exist');
    expect(gaps.some((g) => g.category === 'links.tests drift' && g.itemId === 'ghost')).toBe(
      false,
    );
  });
});
