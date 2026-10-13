// @tests: gate-flow-rework
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { citedNames, findSourceBullets, main } from '../source-cli.js';

const IDEAS = [
  '# Ideas',
  '',
  '## Triaged',
  '',
  '- Hover in light mode uses `hoverToken`, and `FloorAreaCard` needs it too. [triaged 2026-10-12 → light-hover, other-entry]',
  '- An unrelated idea. [triaged 2026-10-12 → other-entry]',
  '- A wrapped idea about `pnpm build && go` that',
  '  continues here. [triaged 2026-10-11 → wrapped-entry]',
  '- Names light-hover only in prose, no marker.',
  '',
].join('\n');

describe('findSourceBullets', () => {
  it('returns the bullet whose marker lists the slug among several', () => {
    const found = findSourceBullets(IDEAS, 'light-hover');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 5, triaged: '2026-10-12' });
    expect(found[0]?.text).toContain('`hoverToken`');
  });

  it('returns every bullet a merge stamped with the same slug', () => {
    expect(findSourceBullets(IDEAS, 'other-entry').map((b) => b.line)).toEqual([5, 6]);
  });

  it('reads a marker on a bullet continuation line', () => {
    const [b] = findSourceBullets(IDEAS, 'wrapped-entry');
    expect(b?.line).toBe(7);
    expect(b?.text).toContain('continues here.');
  });

  it('never matches a slug that appears outside a marker or as a prefix', () => {
    expect(findSourceBullets(IDEAS, 'light')).toEqual([]);
  });
});

describe('citedNames', () => {
  it('keeps identifier-shaped spans and drops commands and short spans', () => {
    expect(citedNames('`hoverToken`, `pnpm build && go`, `x`, `hoverToken`, `a/b.ts`')).toEqual([
      'hoverToken',
      'a/b.ts',
    ]);
  });
});

describe('main', () => {
  let repo: string;
  let out: string;
  let err: string;

  beforeEach(async () => {
    repo = realpathSync(await mkdtemp(join(tmpdir(), 'triage-source-')));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src/card.ts'), 'export const FloorAreaCard = 1;\n');
    writeFileSync(join(repo, 'ideas.md'), IDEAS);
    git('add', '.');
    git('commit', '-q', '-m', 'root');
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => ((err += String(s)), true));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repo, { recursive: true, force: true });
  });

  it('prints the bullet and flags a name the code does not hold', () => {
    expect(main(['light-hover'], repo)).toBe(0);
    expect(out).toContain(`source: ${join(repo, 'ideas.md')}:5 (triaged 2026-10-12)`);
    expect(out).toContain('found    `FloorAreaCard` (1 files)');
    expect(out).toContain('MISSING  `hoverToken`');
  });

  it('emits the same facts as JSON', () => {
    expect(main(['light-hover', '--json'], repo)).toBe(0);
    expect(JSON.parse(out).names).toEqual([
      { name: 'hoverToken', files: 0 },
      { name: 'FloorAreaCard', files: 1 },
    ]);
  });

  it('exits 1 when no marker names the slug', () => {
    expect(main(['unknown-entry'], repo)).toBe(1);
    expect(err).toContain('no bullet');
  });

  it('exits 2 without a slug', () => {
    expect(main([], repo)).toBe(2);
    expect(err).toContain('usage');
  });
});
