import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeDrift } from '../diff.js';
import { copyTemplate, adoptTemplate } from '../copy.js';

// @tests: noldor-package-lift

describe('computeDrift', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-drift-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('unchanged when content matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'unchanged' },
    ]);
  });

  it('drifted when content differs', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'mod');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'drifted' },
    ]);
  });

  it('missing when consumer file absent', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'missing' },
    ]);
  });
});

describe('copyTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-copy-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds new files', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false });
    expect(out).toEqual([{ path: 'a.md', status: 'added' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('refuses overwrite without --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    expect(() =>
      copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false }),
    ).toThrow(/Refusing to overwrite/);
  });

  it('updates when --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'updated' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('reports unchanged when content already matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'unchanged' }]);
  });
});

describe('adoptTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-adopt-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies consumer files INTO templates dir', () => {
    writeFileSync(join(dir, 'consumer', 'a.md'), 'canonical');
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(readFileSync(join(dir, 'tpl', 'a.md'), 'utf8')).toBe('canonical');
  });

  it('skips paths absent from the consumer', () => {
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(existsSync(join(dir, 'tpl', 'a.md'))).toBe(false);
  });
});
