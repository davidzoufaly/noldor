// @tests: pendev-ui-design-phase
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findInstalledPenSchema } from '../pen-schema.js';

const SCHEMA_IN_EXTENSION = 'node_modules/@ha/schema/pen.schema.json';

const schemaJson = (version: string) =>
  JSON.stringify({
    title: '.pen design format',
    required: ['version', 'children'],
    properties: { version: { const: version }, variables: {}, children: {} },
  });

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pen-schema-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<string> {
  const abs = join(home, path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return abs;
}

/** Two installs side by side, as VS Code leaves them after an update; the registry names the active one. */
async function installBoth(registry: unknown): Promise<void> {
  await put(
    `.vscode/extensions/highagency.pencildev-0.6.71/${SCHEMA_IN_EXTENSION}`,
    schemaJson('2.17'),
  );
  await put(
    `.vscode/extensions/highagency.pencildev-0.6.73/${SCHEMA_IN_EXTENSION}`,
    schemaJson('2.19'),
  );
  await put('.vscode/extensions/extensions.json', JSON.stringify(registry));
}

describe('findInstalledPenSchema', () => {
  it('reads the schema of the pen.dev install the VS Code registry names, not a leftover one', async () => {
    await installBoth([
      { identifier: { id: 'other.ext' }, relativeLocation: 'other.ext-1.0.0' },
      {
        identifier: { id: 'highagency.pencildev' },
        relativeLocation: 'highagency.pencildev-0.6.73',
      },
    ]);
    const facts = findInstalledPenSchema({ home, env: {} });
    expect(facts).toEqual({
      path: join(home, '.vscode/extensions/highagency.pencildev-0.6.73', SCHEMA_IN_EXTENSION),
      version: '2.19',
      required: ['version', 'children'],
      topLevelKeys: ['version', 'variables', 'children'],
    });
  });

  it('falls back to the absolute location when the registry entry has no relative one', async () => {
    const extDir = join(home, '.vscode/extensions/highagency.pencildev-0.6.71');
    await installBoth([{ identifier: { id: 'highagency.pencildev' }, location: { path: extDir } }]);
    expect(findInstalledPenSchema({ home, env: {} })?.version).toBe('2.17');
  });

  it('prefers NOLDOR_PEN_SCHEMA over the installed extension', async () => {
    await installBoth([
      {
        identifier: { id: 'highagency.pencildev' },
        relativeLocation: 'highagency.pencildev-0.6.73',
      },
    ]);
    const override = await put('ci/pen.schema.json', schemaJson('3.0'));
    expect(findInstalledPenSchema({ home, env: { NOLDOR_PEN_SCHEMA: override } })?.version).toBe(
      '3.0',
    );
  });

  it('moves on to the extension when NOLDOR_PEN_SCHEMA names no readable schema', async () => {
    await installBoth([
      {
        identifier: { id: 'highagency.pencildev' },
        relativeLocation: 'highagency.pencildev-0.6.73',
      },
    ]);
    expect(
      findInstalledPenSchema({ home, env: { NOLDOR_PEN_SCHEMA: join(home, 'missing.json') } })
        ?.version,
    ).toBe('2.19');
  });

  it('reads no schema when pen.dev is not in the registry', async () => {
    await installBoth([{ identifier: { id: 'other.ext' }, relativeLocation: 'other.ext-1.0.0' }]);
    expect(findInstalledPenSchema({ home, env: {} })).toBeNull();
  });

  it('reads no schema when there is no registry at all', () => {
    expect(findInstalledPenSchema({ home, env: {} })).toBeNull();
  });

  it('reads no schema from a corrupt schema file, and never throws', async () => {
    await put(
      '.vscode/extensions/extensions.json',
      JSON.stringify([
        {
          identifier: { id: 'highagency.pencildev' },
          relativeLocation: 'highagency.pencildev-0.6.73',
        },
      ]),
    );
    await put(`.vscode/extensions/highagency.pencildev-0.6.73/${SCHEMA_IN_EXTENSION}`, '{ broken');
    expect(findInstalledPenSchema({ home, env: {} })).toBeNull();
  });

  it('reports a null version for a schema that pins none', async () => {
    const override = await put(
      'ci/pen.schema.json',
      JSON.stringify({ required: ['children'], properties: { children: {} } }),
    );
    expect(findInstalledPenSchema({ home, env: { NOLDOR_PEN_SCHEMA: override } })).toEqual({
      path: override,
      version: null,
      required: ['children'],
      topLevelKeys: ['children'],
    });
  });
});
