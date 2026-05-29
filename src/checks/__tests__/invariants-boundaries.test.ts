// @tests: architecture-invariants

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeBoundariesInvariant } from '../../invariants/boundaries.js';

const TEST_CONFIG = {
  consumer: {
    name: 'test',
    repoUrl: 'https://github.com/test/test',
    lockstepPackages: ['package.json'],
    scanPaths: [
      'packages/engine/src',
      'packages/format/src',
      'packages/test-fixtures/src',
      'apps/web/src',
    ],
    boundaries: [
      {
        name: 'engine-no-web',
        severity: 'error',
        from: { path: '^packages/engine/src' },
        to: { path: '^apps/web/' },
      },
      {
        name: 'format-no-non-format',
        severity: 'error',
        from: { path: '^packages/format/src' },
        to: { path: '^(packages/(?!format(?:/|$))|apps/)' },
      },
    ],
    deprecatedPackages: [],
    e2ePrefix: 'e2e/',
    samplesPath: 'samples',
    packagePrefix: '@test/',
    pnpmStderrPrefix: 'test@',
    appPathPrefix: 'apps/web/',
  },
};

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'inv-bnd-'));
  await mkdir(join(root, 'packages/engine/src'), { recursive: true });
  await mkdir(join(root, 'packages/format/src'), { recursive: true });
  await mkdir(join(root, 'packages/test-fixtures/src'), { recursive: true });
  await mkdir(join(root, 'apps/web/src'), { recursive: true });
  await mkdir(join(root, '.noldor'), { recursive: true });
  await writeFile(join(root, '.noldor/config.json'), JSON.stringify(TEST_CONFIG));
  return root;
}

describe('boundaries plugin', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('passes on clean tree (no forbidden imports)', async () => {
    await writeFile(join(repo, 'packages/engine/src/index.ts'), `export const x = 1;\n`);
    await writeFile(
      join(repo, 'apps/web/src/index.ts'),
      `import { x } from '../../../packages/engine/src/index.js';\nexport const y = x;\n`,
    );
    const inv = makeBoundariesInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('flags forbidden engine -> web import', async () => {
    await writeFile(join(repo, 'apps/web/src/index.ts'), `export const y = 1;\n`);
    await writeFile(
      join(repo, 'packages/engine/src/index.ts'),
      `import { y } from '../../../apps/web/src/index.js';\nexport const x = y;\n`,
    );
    const inv = makeBoundariesInvariant(repo);
    const result = await inv.run();
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]?.message).toMatch(/engine.*web|forbidden/i);
  });

  it('flags format imports from any other internal package', async () => {
    await writeFile(
      join(repo, 'packages/test-fixtures/src/index.ts'),
      `export const fixture = 1;\n`,
    );
    await writeFile(
      join(repo, 'packages/format/src/index.ts'),
      `import { fixture } from '../../test-fixtures/src/index.js';\nexport const x = fixture;\n`,
    );
    const inv = makeBoundariesInvariant(repo);
    const result = await inv.run();
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]?.message).toMatch(/format.*non-format|forbidden/i);
  });
});
