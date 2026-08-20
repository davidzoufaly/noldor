// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../check-readme.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'check-readme-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('main', () => {
  it('exits 0 and says skipped when there is no README', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(await repo({}))).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('skipped');
  });

  it('exits 0 on a clean repo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': '[a](docs/adr/)', 'docs/adr/0001-x.md': '# x' });
    expect(await main(root)).toBe(0);
  });

  it('exits 1 and prints each finding', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': 'no links', 'docs/architecture/context.md': '# c' });
    expect(await main(root)).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('docs/architecture');
  });

  it('prints notes prefixed and keeps exit 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const root = await repo({ 'README.md': '[bad](docs/a%zz.md)' });
    expect(await main(root)).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('note:');
  });
});
