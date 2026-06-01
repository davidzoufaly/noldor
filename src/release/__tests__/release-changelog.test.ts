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
