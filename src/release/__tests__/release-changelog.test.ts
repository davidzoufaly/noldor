// @tests: dynamic-fd-changelog, feature-md-links-overhaul
import { prependToChangelog, renderChangelogEntry } from '../release-changelog.js';

import type { Commit } from '../release-commits.js';

function c(subject: string, sha: string, pr?: number): Commit {
  return { body: '', prNumber: pr, sha, subject };
}

const REPO = 'https://github.com/davidzoufaly/acme';

describe(renderChangelogEntry, () => {
  it('groups features / fixes / other with linked commits and PR numbers', () => {
    const entry = renderChangelogEntry({
      date: '2026-05-12',
      features: [c('feat(engine): add torus', 'aaaaaaa1234567', 42)],
      fixes: [c('fix(viewport): grid', 'bbbbbbb1234567', 43)],
      other: [c('refactor(format): split', 'ccccccc1234567')],
      repoUrl: REPO,
      version: '0.2.0',
    });

    expect(entry).toContain('## v0.2.0 — 2026-05-12');
    expect(entry).toContain('### Features');
    expect(entry).toContain(
      `- feat(engine): add torus ([aaaaaaa](${REPO}/commit/aaaaaaa1234567)) ([#42](${REPO}/pull/42))`,
    );
    expect(entry).toContain('### Fixes');
    expect(entry).toContain(
      `- fix(viewport): grid ([bbbbbbb](${REPO}/commit/bbbbbbb1234567)) ([#43](${REPO}/pull/43))`,
    );
    expect(entry).toContain('### Other changes');
    expect(entry).toContain(`- refactor(format): split ([ccccccc](${REPO}/commit/ccccccc1234567))`);
  });

  it('omits empty sections', () => {
    const entry = renderChangelogEntry({
      date: '2026-05-12',
      features: [],
      fixes: [c('fix: safe', 'aaaaaaa1234567', 10)],
      other: [],
      repoUrl: REPO,
      version: '0.1.1',
    });

    expect(entry).not.toContain('### Features');
    expect(entry).toContain('### Fixes');
    expect(entry).not.toContain('### Other changes');
  });

  // A squash merge writes the PR ref into the subject AND `readCommitsSince`
  // harvests it into `prNumber`, so the renderer sees it twice. These four cases
  // table both directions of the strip: what it must remove, and what it must
  // leave alone.
  it('renders the PR reference once when the subject already carries it', () => {
    const entry = renderChangelogEntry({
      date: '2026-09-20',
      features: [c('feat(cr): give arbitration a CLI (#462)', 'b9f66931234567', 462)],
      fixes: [],
      other: [],
      repoUrl: REPO,
      version: '1.11.0',
    });

    expect(entry).toContain(
      `- feat(cr): give arbitration a CLI ([b9f6693](${REPO}/commit/b9f66931234567)) ([#462](${REPO}/pull/462))`,
    );
    expect(entry.match(/#462/g)).toHaveLength(1); // the link's label; the href reads `/pull/462`
  });

  it('keeps a subject that has no PR suffix intact next to its link', () => {
    const entry = renderChangelogEntry({
      date: '2026-09-20',
      features: [],
      fixes: [],
      // `prNumber` came from a `PR-#:` body trailer, so there is nothing to strip.
      other: [c('chore(deps): bump zod', 'ddddddd1234567', 77)],
      repoUrl: REPO,
      version: '1.11.0',
    });

    expect(entry).toContain(
      `- chore(deps): bump zod ([ddddddd](${REPO}/commit/ddddddd1234567)) ([#77](${REPO}/pull/77))`,
    );
  });

  it('leaves a bare subject suffix alone when there is no PR link to carry it', () => {
    const entry = renderChangelogEntry({
      date: '2026-09-20',
      features: [],
      fixes: [],
      other: [c('chore: sync template (#99)', 'eeeeeee1234567')],
      repoUrl: REPO,
      version: '1.11.0',
    });

    expect(entry).toContain(
      `- chore: sync template (#99) ([eeeeeee](${REPO}/commit/eeeeeee1234567))`,
    );
    expect(entry).not.toContain('/pull/');
  });

  it('strips only a trailing reference, not one inside the subject', () => {
    const entry = renderChangelogEntry({
      date: '2026-09-20',
      features: [],
      fixes: [c('fix(core): finish what (#440) started (#481)', 'fffffff1234567', 481)],
      other: [],
      repoUrl: REPO,
      version: '1.11.0',
    });

    expect(entry).toContain(
      `- fix(core): finish what (#440) started ([fffffff](${REPO}/commit/fffffff1234567)) ([#481](${REPO}/pull/481))`,
    );
  });

  it('renders without PR link when prNumber missing', () => {
    const entry = renderChangelogEntry({
      date: '2026-05-12',
      features: [],
      fixes: [],
      other: [c('chore: deps', 'aaaaaaa1234567')],
      repoUrl: REPO,
      version: '0.2.0',
    });
    expect(entry).toContain(`- chore: deps ([aaaaaaa](${REPO}/commit/aaaaaaa1234567))`);
    expect(entry).not.toContain('/pull/');
  });
});

describe(prependToChangelog, () => {
  it('inserts new entry after the H1 heading', () => {
    const existing = `# Changelog

## v0.1.0 — 2026-04-14

Initial release.
`;
    const result = prependToChangelog(existing, '## v0.2.0 — 2026-05-12\n\nNew stuff\n');
    expect(result).toMatch(/^# Changelog\n\n## v0\.2\.0/);
    expect(result).toContain('## v0.1.0 — 2026-04-14');
  });

  it('creates the file structure when no H1 present', () => {
    const result = prependToChangelog('', '## v0.1.0 — 2026-04-14\n\nFirst\n');
    expect(result).toMatch(/^# Changelog\n\n## v0\.1\.0/);
  });
});
