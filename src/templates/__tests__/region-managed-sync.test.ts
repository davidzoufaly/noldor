// @tests: scaffold-one-agent-rules-file-not-two
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filterTemplatesByAgents } from '../agent-filter.js';
import { adoptTemplate, copyTemplate } from '../copy.js';
import { computeDrift } from '../diff.js';
import { REGION_END, REGION_START, readRegion } from '../managed-region.js';
import { REGION_MANAGED_TEMPLATES, TEMPLATES_ROOT, templateFiles } from '../manifest.js';

const ROOT = join(__dirname, '..', '..', '..');
const region = (body: string): string => `${REGION_START}\n${body}\n${REGION_END}`;
const TEMPLATE = `# Agent Rules\n\nstarter prose\n\n${region('framework v2')}\n`;

let dir: string;
let tpl: string;
let consumer: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-region-'));
  tpl = join(dir, 'tpl');
  consumer = join(dir, 'consumer');
  mkdirSync(tpl);
  mkdirSync(consumer);
  writeFileSync(join(tpl, 'AGENTS.md'), TEMPLATE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const consumerFile = (): string => readFileSync(join(consumer, 'AGENTS.md'), 'utf8');
const copy = (update: boolean) => copyTemplate(tpl, consumer, ['AGENTS.md'], { update });

describe('copyTemplate on a region-managed path', () => {
  it('writes the whole template when the consumer has no AGENTS.md', () => {
    expect(copy(false)).toEqual([{ path: 'AGENTS.md', status: 'added' }]);
    expect(consumerFile()).toBe(TEMPLATE);
  });

  it('appends the region to a consumer AGENTS.md without --update, keeping its bytes first', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), '# Our rules\n\nUse tabs.');
    expect(copy(false)).toEqual([{ path: 'AGENTS.md', status: 'updated' }]);
    expect(consumerFile()).toBe(`# Our rules\n\nUse tabs.\n\n${region('framework v2')}\n`);
  });

  it('reports unchanged when only text outside the region differs', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), `# Ours\n${region('framework v2')}\nmore\n`);
    expect(copy(false)).toEqual([{ path: 'AGENTS.md', status: 'unchanged' }]);
  });

  it('refuses a drifted region without --update, naming the file and writing nothing', () => {
    const before = `# Ours\n${region('framework v1')}\n`;
    writeFileSync(join(consumer, 'AGENTS.md'), before);
    expect(() => copy(false)).toThrow(/Refusing to overwrite 1 existing file[\s\S]*AGENTS\.md/);
    expect(consumerFile()).toBe(before);
  });

  it('replaces only the region under --update', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), `above\n${region('framework v1')}\nbelow\n`);
    expect(copy(true)).toEqual([{ path: 'AGENTS.md', status: 'updated' }]);
    expect(consumerFile()).toBe(`above\n${region('framework v2')}\nbelow\n`);
  });

  it('refuses unpaired markers even under --update', () => {
    const before = `# Ours\n${REGION_START}\nhalf a region\n`;
    writeFileSync(join(consumer, 'AGENTS.md'), before);
    expect(() => copy(true)).toThrow(/AGENTS\.md — noldor:rules markers/);
    expect(consumerFile()).toBe(before);
  });
});

describe('computeDrift on a region-managed path', () => {
  const drift = () => computeDrift(tpl, consumer, ['AGENTS.md'])[0]?.status;

  it('is unchanged when the regions match, whatever the consumer wrote around it', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), `# Ours\nown rules\n${region('framework v2')}\n`);
    expect(drift()).toBe('unchanged');
  });

  it.each([
    ['a drifted region', `${region('framework v1')}\n`],
    ['no region', '# Ours\n'],
    ['unpaired markers', `${REGION_END}\n`],
  ])('is drifted for %s', (_label, content) => {
    writeFileSync(join(consumer, 'AGENTS.md'), content);
    expect(drift()).toBe('drifted');
  });

  it('is missing when the consumer has no AGENTS.md', () => {
    expect(drift()).toBe('missing');
  });
});

describe('adoptTemplate on a region-managed path', () => {
  it('snapshots only the consumer region into the template', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), `# First-party only\n${region('framework v3')}\n`);
    adoptTemplate(tpl, consumer, ['AGENTS.md']);
    expect(readFileSync(join(tpl, 'AGENTS.md'), 'utf8')).toBe(
      `# Agent Rules\n\nstarter prose\n\n${region('framework v3')}\n`,
    );
  });

  it('leaves the template alone when the consumer has no region to give', () => {
    writeFileSync(join(consumer, 'AGENTS.md'), '# Ours\n');
    adoptTemplate(tpl, consumer, ['AGENTS.md']);
    expect(readFileSync(join(tpl, 'AGENTS.md'), 'utf8')).toBe(TEMPLATE);
  });
});

describe('the shipped rules files', () => {
  it('ship AGENTS.md to every agent target and no .claude/noldor.md or CLAUDE.md', () => {
    const files = templateFiles();
    expect(files).not.toContain('.claude/noldor.md');
    expect(files.filter((f) => f.endsWith('CLAUDE.md'))).toEqual([]);
    expect(filterTemplatesByAgents(files, ['claude'])).toContain('AGENTS.md');
  });

  it('declare AGENTS.md region-managed, with exactly one region in the template', () => {
    expect([...REGION_MANAGED_TEMPLATES]).toEqual(['AGENTS.md']);
    expect(readRegion(readFileSync(join(TEMPLATES_ROOT, 'AGENTS.md'), 'utf8')).kind).toBe(
      'present',
    );
  });

  it('keep this repo AGENTS.md region identical to the template region', () => {
    const regionOf = (path: string) => {
      const read = readRegion(readFileSync(path, 'utf8'));
      return read.kind === 'present' ? read.region : read.kind;
    };
    expect(regionOf(join(ROOT, 'AGENTS.md'))).toBe(regionOf(join(TEMPLATES_ROOT, 'AGENTS.md')));
  });
});
