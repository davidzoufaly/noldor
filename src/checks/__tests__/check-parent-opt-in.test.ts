// @tests: noldor
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FeatureFrontmatterSchema } from '../../core/feature-schema.js';
import {
  checkParentOptIn,
  isOptInSet,
  knownConsumerRoots,
  renderParentOptInRow,
} from '../check-parent-opt-in.js';

describe('isOptInSet', () => {
  const cfg = {
    consumer: { uiPaths: ['src/app/**'], uiSurfaces: {}, flag: false, name: '' },
    crLanes: { code: ['reviewer', 'render-compare'] },
  };

  it('is set when the path holds a non-empty value', () => {
    expect(isOptInSet(cfg, 'consumer.uiPaths')).toBe(true);
    expect(isOptInSet(cfg, 'crLanes')).toBe(true);
  });

  it('is unset for a missing, empty, false or blank value', () => {
    expect(isOptInSet(cfg, 'consumer.uiBoot')).toBe(false);
    expect(isOptInSet(cfg, 'consumer.uiSurfaces')).toBe(false);
    expect(isOptInSet(cfg, 'consumer.flag')).toBe(false);
    expect(isOptInSet(cfg, 'consumer.name')).toBe(false);
    expect(isOptInSet(cfg, 'consumer.uiPaths.deeper')).toBe(false);
  });

  it('key=value matches an equal scalar or an array member only', () => {
    expect(isOptInSet(cfg, 'crLanes.code=render-compare')).toBe(true);
    expect(isOptInSet(cfg, 'crLanes.code=ui-reviewer')).toBe(false);
    expect(isOptInSet({ a: { mode: 'on' } }, 'a.mode=on')).toBe(true);
    expect(isOptInSet({ a: { mode: 'off' } }, 'a.mode=on')).toBe(false);
  });
});

describe('FeatureFrontmatterSchema opt-in', () => {
  const base = {
    area: 'x',
    category: 'Tooling',
    links: {},
    name: 'X',
    packages: ['core'],
    phase: 'done',
    'noldor-tier': 'full',
  };

  it('accepts dotted keys with an optional =value', () => {
    const r = FeatureFrontmatterSchema.safeParse({
      ...base,
      'opt-in': ['consumer.uiBoot', 'crLanes.code=render-compare'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty list and a malformed key', () => {
    expect(FeatureFrontmatterSchema.safeParse({ ...base, 'opt-in': [] }).success).toBe(false);
    expect(FeatureFrontmatterSchema.safeParse({ ...base, 'opt-in': ['.bad'] }).success).toBe(false);
  });
});

describe('checkParentOptIn', () => {
  let tmp: string;
  let root: string;
  let other: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'parent-opt-in-'));
    root = join(tmp, 'repo');
    other = join(tmp, 'other');
    await mkdir(join(root, 'docs/features'), { recursive: true });
    await mkdir(join(root, '.noldor'), { recursive: true });
    await mkdir(join(other, '.noldor'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const config = (dir: string, body: unknown) =>
    writeFile(join(dir, '.noldor/config.json'), JSON.stringify(body), 'utf8');

  const fd = (slug: string, optIn?: string[]) =>
    writeFile(
      join(root, 'docs/features', `${slug}.md`),
      `---\nname: ${slug}\n${optIn ? `opt-in:\n${optIn.map((k) => `  - ${k}`).join('\n')}\n` : ''}---\n\n## Summary\n`,
      'utf8',
    );

  const roadmap = (blocks: string) =>
    writeFile(join(root, 'docs/roadmap.md'), `# Roadmap\n\n${blocks}`, 'utf8');

  const entry = (name: string, parent?: string) =>
    `### ${name}\n\n- area: tooling\n- size: S\n- impact: med\n${parent ? `- parent: ${parent}\n` : ''}\nBody.\n\n`;

  it('reports a parent no known repo has switched on', async () => {
    await fd('ui-lane', ['crLanes.code=render-compare']);
    await roadmap(entry('Third Lane', 'ui-lane') + entry('Unrelated'));
    await config(root, {
      consumer: { knownConsumers: ['../other'] },
      crLanes: { code: ['reviewer'] },
    });
    await config(other, { consumer: {} });

    const rows = await checkParentOptIn(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parent: 'ui-lane', entries: ['third-lane'] });
    expect(rows[0]?.checked).toEqual([root, other]);
    expect(renderParentOptInRow(rows[0]!)).toContain('switched on in none of 2 known repo(s)');
  });

  it('stays silent when any known repo satisfies any opt-in key', async () => {
    await fd('ui-lane', ['consumer.uiBoot', 'crLanes.code=render-compare']);
    await roadmap(entry('Third Lane', 'ui-lane'));
    await config(root, { consumer: { knownConsumers: [other] } });
    await config(other, { consumer: {}, crLanes: { code: ['render-compare'] } });

    expect(await checkParentOptIn(root)).toEqual([]);
  });

  it('ignores parents whose FD declares no opt-in, or does not exist', async () => {
    await fd('always-on');
    await roadmap(entry('A', 'always-on') + entry('B', 'missing-fd'));
    await config(root, { consumer: {} });

    expect(await checkParentOptIn(root)).toEqual([]);
  });

  it('names unreadable repos and stays silent when none could be read', async () => {
    await fd('ui-lane', ['consumer.uiBoot']);
    await roadmap(entry('Third Lane', 'ui-lane'));
    await config(root, { consumer: { knownConsumers: ['../nowhere'] } });

    const rows = await checkParentOptIn(root);
    expect(rows[0]?.unreadable).toEqual([
      { root: join(tmp, 'nowhere'), reason: 'no .noldor/config.json' },
    ]);

    await writeFile(join(root, '.noldor/config.json'), '{not json', 'utf8');
    expect(await checkParentOptIn(root)).toEqual([]);
  });

  it('knownConsumerRoots de-duplicates and keeps this repo first', async () => {
    await config(root, { consumer: { knownConsumers: ['.', other, '../other', 42] } });
    expect(knownConsumerRoots(root)).toEqual([root, other]);
  });
});
