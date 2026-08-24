// @tests: autonomous-queue-drain-runner
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  roadmapSource,
  selectionNotAtRef,
  selectionReason,
  formatNotAtRef,
  NOT_AT_REF_MARKER,
  type DrainCandidate,
  type DrainSource,
} from '../drain-source.js';
import { assertOnlyResolves } from '../queue-drain.js';

/** A roadmap block: `### Name` + field bullets + free-text body (what parseRoadmap wants). */
function block(name: string, size: string, body = 'Something to do.'): string {
  return [
    `### ${name}`,
    '',
    '- area: tooling',
    `- size: ${size}`,
    '- impact: high',
    '',
    body,
    '',
  ].join('\n');
}

/** A repo whose roadmap holds `blocks`, with docs/roadmap.md committed on `main`. */
function tmpRepo(blocks: string, opts: { commit: boolean } = { commit: true }): string {
  const dir = mkdtempSync(join(tmpdir(), 'drain-sel-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'roadmap.md'), blocks, 'utf8');
  if (opts.commit) {
    git('add', 'docs/roadmap.md');
    git('commit', '-m', 'roadmap', '--no-verify');
  }
  return dir;
}

describe('selectionReason', () => {
  it('admits everything when there is no filter', () => {
    expect(selectionReason({ slug: 'a', size: 'XL' }, undefined)).toBeUndefined();
  });

  it('admits a size present in the filter, case-insensitively', () => {
    expect(selectionReason({ slug: 'a', size: 'xs' }, { sizes: new Set(['XS']) })).toBeUndefined();
  });

  it('excludes a size absent from the filter and names both sides', () => {
    const r = selectionReason({ slug: 'a', size: 'S' }, { sizes: new Set(['XS']) });
    expect(r).toContain('S');
    expect(r).toContain('XS');
  });

  it('excludes a size-less entry under a size constraint', () => {
    expect(selectionReason({ slug: 'a' }, { sizes: new Set(['XS']) })).toContain('(none)');
  });

  it('excludes a slug outside --only, and admits one inside it', () => {
    expect(selectionReason({ slug: 'b', size: 'XS' }, { only: new Set(['a']) })).toBe(
      'not in --only selection',
    );
    expect(selectionReason({ slug: 'a', size: 'XS' }, { only: new Set(['a']) })).toBeUndefined();
  });

  it('requires BOTH axes when both are present', () => {
    const filter = { sizes: new Set(['XS']), only: new Set(['a']) };
    expect(selectionReason({ slug: 'a', size: 'S' }, filter)).toContain('--size');
    expect(selectionReason({ slug: 'b', size: 'XS' }, filter)).toContain('--only');
  });
});

describe('roadmapSource selection narrowing', () => {
  it('marks an out-of-selection entry ineligible with the narrowing as its reason', () => {
    // `s-entry` sits ABOVE `xs-entry` in priority order — the exact shape --max-features
    // cannot express: top-N would take the S entry first.
    const dir = tmpRepo(`${block('S entry', 'S')}\n${block('XS entry', 'XS')}`);
    try {
      const src = roadmapSource(dir, { sizes: new Set(['XS']) });
      const first = src.nextItem(new Set()) as DrainCandidate;
      expect(first.slug).toBe('s-entry');
      expect(first.eligible).toBe(false);
      expect(first.reason).toContain('--size');

      const second = src.nextItem(new Set(['s-entry'])) as DrainCandidate;
      expect(second.slug).toBe('xs-entry');
      expect(second.eligible).toBe(true);
      expect(second.reason).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('carries the raw size on the candidate', () => {
    const dir = tmpRepo(block('XS entry', 'XS'));
    try {
      expect(roadmapSource(dir).nextItem(new Set())?.size).toBe('XS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves parseAll() unnarrowed — it is the success oracle, not the selection', () => {
    const dir = tmpRepo(`${block('S entry', 'S')}\n${block('XS entry', 'XS')}`);
    try {
      expect(roadmapSource(dir, { sizes: new Set(['XS']) }).parseAll()).toEqual([
        's-entry',
        'xs-entry',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('roadmapSource.parseAllAtRef', () => {
  it('reads the roadmap as of the ref, not the working tree', () => {
    const dir = tmpRepo(block('Committed entry', 'XS'));
    try {
      writeFileSync(
        join(dir, 'docs', 'roadmap.md'),
        `${block('Committed entry', 'XS')}\n${block('Uncommitted entry', 'XS')}`,
        'utf8',
      );
      const src = roadmapSource(dir);
      expect(src.parseAll()).toEqual(['committed-entry', 'uncommitted-entry']);
      expect(src.parseAllAtRef?.('main')).toEqual(['committed-entry']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for an unreadable ref rather than an empty list', () => {
    const dir = tmpRepo(block('Entry', 'XS'), { commit: false });
    try {
      expect(roadmapSource(dir).parseAllAtRef?.('origin/main')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Minimal source stub: `items` in selection order, `atRef` = what the ref carries. */
function stubSource(
  items: readonly DrainCandidate[],
  atRef: string[] | null | undefined,
): DrainSource {
  return {
    id: 'roadmap',
    nextItem: (skip) => items.find((i) => !skip.has(i.slug)) ?? null,
    parseAll: () => items.map((i) => i.slug),
    gatePrompt: (slug) => slug,
    branchFor: (slug) => `fast/${slug}`,
    ...(atRef === undefined ? {} : { parseAllAtRef: (): string[] | null => atRef }),
  };
}

const cand = (slug: string, eligible: boolean): DrainCandidate => ({
  slug,
  description: '',
  eligible,
});

/** A park-aware stub: `parked` maps slug → park reason, exactly as the wrapper exposes it. */
function parkedSource(
  items: readonly DrainCandidate[],
  parked: Record<string, string>,
): DrainSource {
  return {
    ...stubSource(items, null),
    // Mirrors `parkAwareSource`: `parseAll` still lists the parked slug; only `nextItem`
    // (and now `parkedSlugs`) know it is excluded.
    nextItem: (skip) =>
      items.find((i) => !skip.has(i.slug) && parked[i.slug] === undefined) ?? null,
    parkedSlugs: () => new Map(Object.entries(parked)),
  };
}

describe('selectionNotAtRef', () => {
  it('names an eligible entry the ref does not carry', () => {
    const src = stubSource(
      [cand('local-only', true), cand('shipped-from-main', true)],
      ['shipped-from-main'],
    );
    expect(selectionNotAtRef(src, 'origin/main', 20)).toEqual(['local-only']);
  });

  it('ignores an ineligible entry — it cannot waste a spawn', () => {
    const src = stubSource([cand('local-only', false)], []);
    expect(selectionNotAtRef(src, 'origin/main', 20)).toEqual([]);
  });

  it('is empty when every eligible entry is on the ref', () => {
    const src = stubSource([cand('a', true), cand('b', true)], ['a', 'b']);
    expect(selectionNotAtRef(src, 'origin/main', 20)).toEqual([]);
  });

  it('no-ops when the source cannot answer for a ref', () => {
    expect(selectionNotAtRef(stubSource([cand('a', true)], undefined), 'origin/main', 20)).toEqual(
      [],
    );
    expect(selectionNotAtRef(stubSource([cand('a', true)], null), 'origin/main', 20)).toEqual([]);
  });

  it('stops at the cap — a stale block below --max-features must not abort a clean head', () => {
    // The run ships one entry; `deep-stale` sits below that bound and is never reached.
    const src = stubSource([cand('head', true), cand('deep-stale', true)], ['head']);
    expect(selectionNotAtRef(src, 'origin/main', 1)).toEqual([]);
    expect(selectionNotAtRef(src, 'origin/main', 2)).toEqual(['deep-stale']);
  });

  it('counts only eligible entries against the cap', () => {
    // An ineligible head must not consume the single slot and mask the stale entry behind it.
    const src = stubSource([cand('skipped', false), cand('local-only', true)], []);
    expect(selectionNotAtRef(src, 'origin/main', 1)).toEqual(['local-only']);
  });
});

describe('formatNotAtRef', () => {
  it('carries the marker both entrypoints classify on, and names the ref', () => {
    const msg = formatNotAtRef(['a'], 'origin/main');
    expect(msg).toContain(NOT_AT_REF_MARKER);
    expect(msg).toContain('origin/main');
    expect(msg).toContain('1 selected entry is');
  });

  it('pluralises past one entry', () => {
    expect(formatNotAtRef(['a', 'b'], 'origin/main')).toContain('2 selected entries are');
  });
});

describe('assertOnlyResolves', () => {
  const src = stubSource([cand('real-slug', true)], null);

  it('passes when every --only slug is in the queue', () => {
    expect(() => assertOnlyResolves({ only: new Set(['real-slug']) }, src)).not.toThrow();
  });

  it('throws on a slug the queue does not hold, rather than draining nothing', () => {
    expect(() => assertOnlyResolves({ only: new Set(['typoed-slug']) }, src)).toThrow(
      /not in the queue: typoed-slug/,
    );
  });

  it('is a no-op without --only', () => {
    expect(() => assertOnlyResolves(undefined, src)).not.toThrow();
    expect(() => assertOnlyResolves({ sizes: new Set(['XS']) }, src)).not.toThrow();
  });

  it('throws on a parked slug, naming the reason and the unpark remedy', () => {
    // `parseAll` still lists a parked slug, so the queue check alone passes it — and
    // `nextItem` then never yields it: the run would ship 0 and exit 0, the false green.
    const parked = parkedSource([cand('parked-slug', true)], { 'parked-slug': 'merge-conflict' });
    expect(() => assertOnlyResolves({ only: new Set(['parked-slug']) }, parked)).toThrow(
      /parked-slug \(merge-conflict\)/,
    );
    expect(() => assertOnlyResolves({ only: new Set(['parked-slug']) }, parked)).toThrow(
      /noldor autonomous unpark/,
    );
  });

  it('gives one runnable unpark command per parked slug — unpark takes a single slug', () => {
    const parked = parkedSource([cand('a', true), cand('b', true)], {
      a: 'merge-conflict',
      b: 'retries-exhausted',
    });
    const run = (): void => {
      assertOnlyResolves({ only: new Set(['a', 'b']) }, parked);
    };
    expect(run).toThrow(/noldor autonomous unpark a/);
    expect(run).toThrow(/noldor autonomous unpark b/);
  });

  it('admits an unparked slug while a sibling entry is parked', () => {
    const parked = parkedSource([cand('live', true), cand('dead', true)], {
      dead: 'retries-exhausted',
    });
    expect(() => assertOnlyResolves({ only: new Set(['live']) }, parked)).not.toThrow();
  });

  it('reports an unknown slug ahead of a parked one — a typo is not a park', () => {
    const parked = parkedSource([cand('dead', true)], { dead: 'merge-timeout' });
    expect(() => assertOnlyResolves({ only: new Set(['typo', 'dead']) }, parked)).toThrow(
      /not in the queue: typo/,
    );
  });

  it('is a no-op on a source that cannot report parks', () => {
    // `parkedSlugs` is optional: a bare source must not read as "nothing is parked" ... it
    // reads as "cannot answer", which is the same admit, but for the honest reason.
    expect(() => assertOnlyResolves({ only: new Set(['real-slug']) }, src)).not.toThrow();
  });
});
