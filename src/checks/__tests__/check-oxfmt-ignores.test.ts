// @tests: noldor
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GRAPHIFY_IGNORE_PATTERNS, checkOxfmtIgnores } from '../check-oxfmt-ignores.js';

describe('checkOxfmtIgnores', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'oxfmt-ign-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const write = (body: unknown) =>
    writeFile(join(cwd, '.oxfmtrc.json'), JSON.stringify(body, null, 2), 'utf8');

  it('reports no-config when the consumer has no .oxfmtrc.json', () => {
    expect(checkOxfmtIgnores(cwd).status).toBe('no-config');
  });

  it('is ok when ignorePatterns carries graphify-out/**', async () => {
    await write({ ignorePatterns: ['dist/**', 'graphify-out/**'] });
    expect(checkOxfmtIgnores(cwd).status).toBe('ok');
  });

  it('is ok when only the nested **/graphify-out/** form is present', async () => {
    await write({ ignorePatterns: ['**/graphify-out/**'] });
    expect(checkOxfmtIgnores(cwd).status).toBe('ok');
  });

  it('reports graphify-not-ignored when ignorePatterns omits every graphify form', async () => {
    await write({ ignorePatterns: ['dist/**', '**/*.md'] });
    const r = checkOxfmtIgnores(cwd);
    expect(r.status).toBe('graphify-not-ignored');
    expect(r.detail).toContain('graphify-out/**');
  });

  it('reports graphify-not-ignored when the config has no ignorePatterns key at all', async () => {
    await write({ singleQuote: true });
    expect(checkOxfmtIgnores(cwd).status).toBe('graphify-not-ignored');
  });

  it('reports unparseable on malformed JSON without throwing', async () => {
    await writeFile(join(cwd, '.oxfmtrc.json'), '{ not json', 'utf8');
    expect(checkOxfmtIgnores(cwd).status).toBe('unparseable');
  });

  it('names both accepted patterns', () => {
    expect(GRAPHIFY_IGNORE_PATTERNS).toEqual(['graphify-out/**', '**/graphify-out/**']);
  });
});
