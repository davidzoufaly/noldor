// src/features/__tests__/migrate-fd-commits-to-prs.test.ts
// @tests: fd-prs-since-last-release-section

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateFd } from '../migrate-fd-commits-to-prs.js';

const LEGACY_BLOCK = `## Commits

<!-- @commits-since-last-tag: foo -->

[View commits since last release on GitHub](https://github.com/example/repo/commits/main)
`;

const NEW_BLOCK = `## PRs

<!-- @prs-since-last-release: foo -->
`;

describe('migrateFd', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrate-fd-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('replaces legacy block with new block and preserves slug', async () => {
    const path = join(dir, 'foo.md');
    await writeFile(path, `# pre\n\n${LEGACY_BLOCK}\n## Changelog\n`, 'utf8');

    const result = await migrateFd(path);

    expect(result.status).toBe('migrated');
    expect(result.mismatch).toBeUndefined();
    const after = await readFile(path, 'utf8');
    expect(after).toContain(NEW_BLOCK);
    expect(after).not.toContain('@commits-since-last-tag');
    expect(after).toContain('## Changelog');
  });

  it('no-ops when FD already has new block and no legacy block', async () => {
    const path = join(dir, 'foo.md');
    const body = `# pre\n\n${NEW_BLOCK}\n## Changelog\n`;
    await writeFile(path, body, 'utf8');

    const result = await migrateFd(path);

    expect(result.status).toBe('already-migrated');
    expect(await readFile(path, 'utf8')).toBe(body);
  });

  it('no-ops when FD has neither block', async () => {
    const path = join(dir, 'foo.md');
    const body = `# pre\n\n## Summary\n\nx\n\n## Changelog\n`;
    await writeFile(path, body, 'utf8');

    const result = await migrateFd(path);

    expect(result.status).toBe('no-section');
    expect(await readFile(path, 'utf8')).toBe(body);
  });

  it('on slug-mismatch: writes filename-stem block, reports mismatch', async () => {
    const path = join(dir, 'bar.md');
    await writeFile(path, `# pre\n\n${LEGACY_BLOCK}\n`, 'utf8'); // legacy slug "foo", filename "bar"

    const result = await migrateFd(path);

    expect(result.status).toBe('migrated');
    expect(result.mismatch).toEqual({ filenameStem: 'bar', capturedSlug: 'foo' });
    const after = await readFile(path, 'utf8');
    expect(after).toContain('<!-- @prs-since-last-release: bar -->'); // filename wins
  });

  it('is idempotent across two runs', async () => {
    const path = join(dir, 'foo.md');
    await writeFile(path, `# pre\n\n${LEGACY_BLOCK}\n`, 'utf8');

    const first = await migrateFd(path);
    const after1 = await readFile(path, 'utf8');
    const second = await migrateFd(path);
    const after2 = await readFile(path, 'utf8');

    expect(first.status).toBe('migrated');
    expect(second.status).toBe('already-migrated');
    expect(after1).toBe(after2);
  });
});
