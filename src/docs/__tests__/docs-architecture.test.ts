// @tests: consumer-architecture-doc-surface
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ARCHITECTURE_PAGES } from '../architecture-schema.js';
import {
  checkArchitecture,
  fenceKinds,
  listModuleDirs,
  mentionsModule,
} from '../docs-architecture.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** A repo root with a schema-valid `.noldor/config.json` declaring `scanPaths`. */
async function makeRepo(scanPaths: string[] = ['src']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'arch-'));
  roots.push(root);
  await mkdir(join(root, '.noldor'), { recursive: true });
  await writeFile(
    join(root, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture',
        repoUrl: 'https://example.com/fixture',
        lockstepPackages: ['package.json'],
        scanPaths,
        e2ePrefix: 'e2e',
        samplesPath: 'samples',
        packagePrefix: '@fixture/',
        appPathPrefix: 'apps/',
      },
    }),
    'utf8',
  );
  return root;
}

const fence = (kind: string): string => `\`\`\`mermaid\n${kind}\n  a --> b\n\`\`\`\n`;

/** Every registry page written with the given body. */
async function writePages(root: string, body: (id: string) => string): Promise<void> {
  await mkdir(join(root, 'docs', 'architecture'), { recursive: true });
  for (const page of ARCHITECTURE_PAGES) {
    await writeFile(join(root, 'docs', 'architecture', `${page.id}.md`), body(page.id), 'utf8');
  }
}

/** A body that satisfies every rule for `id`. */
const goodBody = (id: string): string => {
  const kind = ARCHITECTURE_PAGES.find((p) => p.id === id)!.allowedKinds[0];
  return `# ${id}\n\n${fence(kind === 'sequencediagram' ? 'sequenceDiagram' : 'flowchart TD')}`;
};

/** `goodBody` still carrying the scaffold marker — what `init` leaves behind. */
const scaffoldBody = (id: string): string =>
  `# ${id}\n\n<!-- TODO: draw it -->\n\n${goodBody(id).split('\n').slice(2).join('\n')}`;

describe(fenceKinds, () => {
  it('reads the graph keyword of a plain fence, lowercased', () => {
    expect(fenceKinds(fence('flowchart TD'))).toStrictEqual(['flowchart']);
    expect(fenceKinds(fence('sequenceDiagram'))).toStrictEqual(['sequencediagram']);
  });

  it('skips a leading YAML frontmatter block inside the fence', () => {
    const md = '```mermaid\n---\ntitle: X\n---\nflowchart TD\n  a --> b\n```\n';
    expect(fenceKinds(md)).toStrictEqual(['flowchart']);
  });

  it('skips init directives and comment lines', () => {
    const md = '```mermaid\n%%{init: {"theme":"dark"}}%%\n%% a comment\n\nclassDiagram\n```\n';
    expect(fenceKinds(md)).toStrictEqual(['classdiagram']);
  });

  it('reports every fence in document order', () => {
    expect(
      fenceKinds(`${fence('flowchart TD')}\ntext\n\n${fence('sequenceDiagram')}`),
    ).toStrictEqual(['flowchart', 'sequencediagram']);
  });

  it('yields nothing for a body with no mermaid fence', () => {
    expect(fenceKinds('# Title\n\n```ts\nconst a = 1;\n```\n')).toStrictEqual([]);
  });

  it('does not consume the document when a YAML block is unterminated', () => {
    const md = '```mermaid\n---\ntitle: X\n```\n\n```mermaid\nflowchart TD\n```\n';
    expect(fenceKinds(md)).toStrictEqual(['flowchart']);
  });
});

describe(mentionsModule, () => {
  it('matches a path token exactly', () => {
    expect(mentionsModule('the src/core module', 'src/core')).toBeTruthy();
  });

  it('matches a token with a trailing slash', () => {
    expect(mentionsModule('see src/core/ for details', 'src/core')).toBeTruthy();
  });

  it('matches inside a mermaid fence, where a module diagram names its modules', () => {
    expect(
      mentionsModule(fence('flowchart TD').replace('a --> b', 'src/core --> src/cr'), 'src/cr'),
    ).toBeTruthy();
  });

  it('does not match a substring of a longer word', () => {
    expect(mentionsModule('apply the change', 'app')).toBeFalsy();
  });

  it('does not let a bare root satisfy a module under it', () => {
    expect(mentionsModule('everything lives in src', 'src/core')).toBeFalsy();
  });
});

describe(listModuleDirs, () => {
  it('returns directories one level inside each scan root, not the roots', async () => {
    const root = await makeRepo(['src']);
    await mkdir(join(root, 'src', 'core'), { recursive: true });
    await mkdir(join(root, 'src', 'cr'), { recursive: true });
    expect(await listModuleDirs(root)).toStrictEqual(['src/core', 'src/cr']);
  });

  it('skips hidden, underscore-prefixed and generated directories', async () => {
    const root = await makeRepo(['src']);
    for (const name of ['core', '.hidden', '_internal', 'node_modules', 'dist', '__tests__']) {
      await mkdir(join(root, 'src', name), { recursive: true });
    }
    expect(await listModuleDirs(root)).toStrictEqual(['src/core']);
  });

  it('ignores files and non-existent roots', async () => {
    const root = await makeRepo(['src', 'packages']);
    await mkdir(join(root, 'src', 'core'), { recursive: true });
    await writeFile(join(root, 'src', 'notes.md'), 'x', 'utf8');
    expect(await listModuleDirs(root)).toStrictEqual(['src/core']);
  });
});

describe(checkArchitecture, () => {
  it('is absent when the folder does not exist', async () => {
    const root = await makeRepo();
    const report = await checkArchitecture(root);
    expect(report.status).toBe('absent');
    expect(report.findings).toStrictEqual([]);
  });

  it('is absent when every page is still exactly as scaffolded', async () => {
    const root = await makeRepo();
    await writePages(root, scaffoldBody);
    expect((await checkArchitecture(root)).status).toBe('absent');
  });

  it('goes live once any one page is edited, reporting the rest', async () => {
    const root = await makeRepo();
    await writePages(root, (id) => (id === 'context' ? goodBody(id) : scaffoldBody(id)));
    const report = await checkArchitecture(root);
    expect(report.status).toBe('incomplete');
    expect(report.findings.map((f) => f.rule)).toStrictEqual([
      'placeholder',
      'placeholder',
      'placeholder',
    ]);
  });

  it('is ok when every page is filled in with an allowed kind', async () => {
    const root = await makeRepo();
    await writePages(root, goodBody);
    await mkdir(join(root, 'src'), { recursive: true });
    const report = await checkArchitecture(root);
    expect(report.status).toBe('ok');
    expect(report.findings).toStrictEqual([]);
  });

  it('reports a missing page', async () => {
    const root = await makeRepo();
    await writePages(root, goodBody);
    await rm(join(root, 'docs', 'architecture', 'flows.md'));
    const report = await checkArchitecture(root);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ rule: 'missing', page: 'docs/architecture/flows.md' }),
    );
  });

  it('reports a page whose fences all declare a disallowed kind', async () => {
    const root = await makeRepo();
    await writePages(root, (id) =>
      id === 'flows' ? `# flows\n\n${fence('flowchart TD')}` : goodBody(id),
    );
    const report = await checkArchitecture(root);
    expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'bad-kind' }));
  });

  it('accepts a page carrying several fences when any one is allowed', async () => {
    const root = await makeRepo();
    await writePages(root, (id) =>
      id === 'flows'
        ? `# flows\n\n${fence('flowchart TD')}\n${fence('sequenceDiagram')}`
        : goodBody(id),
    );
    expect((await checkArchitecture(root)).status).toBe('ok');
  });

  it('reports a page with no mermaid fence', async () => {
    const root = await makeRepo();
    await writePages(root, (id) => (id === 'context' ? '# context\n\nprose only\n' : goodBody(id)));
    const report = await checkArchitecture(root);
    expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'no-fence' }));
  });

  it('reports a folder path that is a file rather than throwing', async () => {
    const root = await makeRepo();
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'architecture'), 'not a directory', 'utf8');
    const report = await checkArchitecture(root);
    expect(report.status).toBe('incomplete');
    expect(report.findings[0].rule).toBe('unreadable');
  });

  it('advises on a module the modules page never names, without changing status', async () => {
    const root = await makeRepo(['src']);
    await mkdir(join(root, 'src', 'core'), { recursive: true });
    await mkdir(join(root, 'src', 'unnamed'), { recursive: true });
    await writePages(root, (id) =>
      id === 'modules'
        ? `# modules\n\n${fence('flowchart TD').replace('a --> b', 'src/core --> x')}`
        : goodBody(id),
    );
    const report = await checkArchitecture(root);
    expect(report.status).toBe('ok');
    expect(report.advisories.map((a) => a.module)).toStrictEqual(['src/unnamed']);
  });

  it('emits no module advisories when the modules page is missing', async () => {
    const root = await makeRepo(['src']);
    await mkdir(join(root, 'src', 'unnamed'), { recursive: true });
    await writePages(root, goodBody);
    await rm(join(root, 'docs', 'architecture', 'modules.md'));
    const report = await checkArchitecture(root);
    expect(report.advisories).toStrictEqual([]);
    expect(report.findings.map((f) => f.rule)).toStrictEqual(['missing']);
  });
});
