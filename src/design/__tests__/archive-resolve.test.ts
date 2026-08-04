// @tests: doc-gardening-skill
// Unit coverage of the flip-time archival resolver: dialogue-key derivation over
// every session path, and the ownership gate that keeps a filename match from
// reaching an artifact this branch does not own.

import { describe, expect, it } from 'vitest';

import { PATHS, type SessionMarker } from '../../core/session.js';
import { dialogueKeyFromSession, resolveArchivePlan } from '../archive-resolve.js';

const STARTED = '2026-08-04T00:00:00.000Z';

function marker(over: Partial<SessionMarker>): SessionMarker {
  return { path: 'specs-only-new', startedAt: STARTED, ...over } as SessionMarker;
}

/** readdir seam over a `{ dir: entries }` map; unknown dirs throw like ENOENT. */
function fakeReaddir(tree: Record<string, string[]>) {
  return (path: string): Promise<string[]> => {
    const key = path.split('\\').join('/');
    const entries = tree[key];
    if (entries === undefined) return Promise.reject(new Error(`ENOENT: ${key}`));
    return Promise.resolve(entries);
  };
}

const REPO = '/repo';
const SPECS = '/repo/docs/design/specs';
const PLANS = '/repo/docs/design/plans';

describe(dialogueKeyFromSession, () => {
  it('keys *-new paths on the feature slug', () => {
    expect(dialogueKeyFromSession(marker({ path: 'specs-only-new', slug: 'my-feat' }))).toBe(
      'my-feat',
    );
    expect(dialogueKeyFromSession(marker({ path: 'full-new', slug: 'my-feat' }))).toBe('my-feat');
  });

  it('keys *-attach paths on <parent>-<enhancement>', () => {
    const m = marker({
      enhancement: 'archive-at-done-flip',
      markerVersion: 2,
      parent: 'doc-gardening-skill',
      path: 'specs-only-attach',
    });
    expect(dialogueKeyFromSession(m)).toBe('doc-gardening-skill-archive-at-done-flip');
  });

  it('returns null for paths that run no design dialogue', () => {
    for (const path of ['fast-track', 'micro-chore', 'release-sweep', 'release-automation']) {
      expect(dialogueKeyFromSession(marker({ path } as Partial<SessionMarker>))).toBe(null);
    }
  });

  it('returns null when the marker lacks the fields its path needs', () => {
    expect(dialogueKeyFromSession(marker({ path: 'full-new' }))).toBe(null);
    expect(
      dialogueKeyFromSession(marker({ markerVersion: 2, parent: 'p', path: 'specs-only-attach' })),
    ).toBe(null);
  });

  it('handles every member of PATHS (no silent fallthrough)', () => {
    const full = {
      enhancement: 'enh',
      markerVersion: 2,
      parent: 'parent',
      slug: 'slug',
    } as Partial<SessionMarker>;
    for (const path of PATHS) {
      const key = dialogueKeyFromSession(marker({ ...full, path }));
      expect(key === null || key.length > 0).toBe(true);
    }
  });
});

describe(resolveArchivePlan, () => {
  const key = 'parent-enh';
  const ownSpec = `docs/design/specs/2026-08-04-${key}-design.md`;

  it('selects this session key and leaves a sibling enhancement alone', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [ownSpec, 'docs/design/specs/2026-08-04-parent-other-design.md'],
      key,
      readdir: fakeReaddir({
        [PLANS]: [],
        [SPECS]: [
          `2026-08-04-${key}-design.md`,
          '2026-08-04-parent-other-design.md',
          '2026-08-01-parent-design.md',
        ],
      }),
      repo: REPO,
    });
    expect(plan?.moves.map((m) => m.from)).toEqual([ownSpec]);
    expect(plan?.moves[0]?.to).toBe(`docs/design/specs/archive/2026-08-04-${key}-design.md`);
  });

  it('refuses a filename match that this branch did not add (foreign slug collision)', async () => {
    // A separate feature literally slugged `parent-enh`, shipped long ago: same
    // parsed slug, different date, NOT in branchAdded.
    const plan = await resolveArchivePlan({
      branchAdded: [],
      key,
      readdir: fakeReaddir({ [PLANS]: [], [SPECS]: [`2026-01-01-${key}-design.md`] }),
      repo: REPO,
    });
    expect(plan?.moves).toEqual([]);
  });

  it('refuses a -partN plan belonging to a feature slugged <key>-part1', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [],
      key,
      readdir: fakeReaddir({ [PLANS]: [`2026-02-02-${key}-part1.md`], [SPECS]: [] }),
      repo: REPO,
    });
    expect(plan?.moves).toEqual([]);
  });

  it('selects every -partN plan this branch added', async () => {
    const p1 = `docs/design/plans/2026-08-04-${key}-part1.md`;
    const p2 = `docs/design/plans/2026-08-04-${key}-part2.md`;
    const plan = await resolveArchivePlan({
      branchAdded: [p1, p2],
      key,
      readdir: fakeReaddir({
        [PLANS]: [`2026-08-04-${key}-part1.md`, `2026-08-04-${key}-part2.md`],
        [SPECS]: [],
      }),
      repo: REPO,
    });
    expect(plan?.moves.map((m) => m.from)).toEqual([p1, p2]);
    expect(plan?.moves.every((m) => m.kind === 'plan')).toBe(true);
  });

  it('reports a collision instead of overwriting an archived artifact', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [ownSpec],
      key,
      readdir: fakeReaddir({
        [PLANS]: [],
        [SPECS]: [`2026-08-04-${key}-design.md`, 'archive'],
        [`${SPECS}/archive`]: [`2026-08-04-${key}-design.md`],
      }),
      repo: REPO,
    });
    expect(plan?.moves).toEqual([]);
    expect(plan?.skipped).toEqual([{ from: ownSpec, reason: 'collision' }]);
  });

  it('never re-selects entries already inside archive/', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [`docs/design/specs/archive/2026-08-04-${key}-design.md`],
      key,
      readdir: fakeReaddir({
        [PLANS]: [],
        [SPECS]: ['archive'],
        [`${SPECS}/archive`]: [`2026-08-04-${key}-design.md`],
      }),
      repo: REPO,
    });
    expect(plan?.moves).toEqual([]);
    expect(plan?.skipped).toEqual([]);
  });

  it('treats a missing specs/plans directory as empty', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [ownSpec],
      key,
      readdir: fakeReaddir({}),
      repo: REPO,
    });
    expect(plan).toEqual({ key, moves: [], skipped: [] });
  });

  it('returns null when the session path carries no artifacts', async () => {
    const plan = await resolveArchivePlan({
      branchAdded: [ownSpec],
      readdir: fakeReaddir({ [PLANS]: [], [SPECS]: [] }),
      repo: REPO,
      session: marker({ path: 'fast-track' }),
    });
    expect(plan).toBe(null);
  });
});
