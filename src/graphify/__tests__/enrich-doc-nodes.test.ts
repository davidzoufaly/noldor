import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enrichDocNodes, type GraphData } from '../enrich-doc-nodes.js';

// @tests: graphify-plan-of-edges-nodes-for-plans-specs

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'enrich-docs-'));
  await mkdir(join(root, 'docs/features'), { recursive: true });
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true });
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true });
  await mkdir(join(root, 'graphify-out'), { recursive: true });
  return root;
}

function fd(
  name: string,
  opts: { code?: string[]; plan?: string; spec?: string; phase?: string } = {},
): string {
  return [
    '---',
    `name: ${name}`,
    `phase: ${opts.phase ?? 'in-progress'}`,
    'area: test',
    'category: Tooling',
    "packages:\n  - '@acme/web'",
    'noldor-tier: specs-only',
    'links:',
    `  code:${opts.code ? `\n${opts.code.map((c) => `    - ${c}`).join('\n')}` : ' []'}`,
    '  tests: []',
    '  docs: []',
    ...(opts.plan ? [`  plan: ${opts.plan}`] : []),
    ...(opts.spec ? [`  spec: ${opts.spec}`] : []),
    '---',
    'body',
  ].join('\n');
}

const SEED_GRAPH: GraphData = {
  nodes: [{ id: 'code:1', label: 'x', file_type: 'code', source_file: 'src/foo.ts', community: 0 }],
  links: [],
};

async function writeGraph(repo: string, data: GraphData = SEED_GRAPH): Promise<string> {
  const p = join(repo, 'graphify-out/graph.json');
  await writeFile(p, JSON.stringify(data, null, 2));
  return p;
}

describe('enrichDocNodes', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('adds one doc node per FD/plan/spec with deterministic ids; second run is a no-op', async () => {
    await writeFile(join(repo, 'docs/features/alpha.md'), fd('alpha'));
    await writeFile(join(repo, 'docs/superpowers/plans/2026-06-14-alpha.md'), 'plan body');
    await writeFile(join(repo, 'docs/superpowers/specs/2026-06-14-alpha-design.md'), 'spec body');
    const graphPath = await writeGraph(repo);

    const first = enrichDocNodes(repo, graphPath);
    const docNodes = first.nodes.filter((n) => n.file_type === 'doc');
    expect(docNodes.map((n) => n.id).toSorted()).toEqual([
      'doc:docs/features/alpha.md',
      'doc:docs/superpowers/plans/2026-06-14-alpha.md',
      'doc:docs/superpowers/specs/2026-06-14-alpha-design.md',
    ]);
    expect(first.nodes.find((n) => n.id === 'code:1')).toBeDefined(); // code node preserved

    const onDisk1 = await readFile(graphPath, 'utf8');
    enrichDocNodes(repo, graphPath); // second run
    const onDisk2 = await readFile(graphPath, 'utf8');
    expect(onDisk2).toBe(onDisk1); // idempotent
  });

  it('emits an EXTRACTED plan-of edge via links.plan and spec-of via links.spec', async () => {
    await writeFile(
      join(repo, 'docs/features/beta.md'),
      fd('beta', {
        plan: 'docs/superpowers/plans/2026-06-14-multi.md',
        spec: 'docs/superpowers/specs/2026-06-14-multi-design.md',
      }),
    );
    // filenames whose slug (`multi`) does NOT match the FD slug (`beta`) — links.* is the only signal
    await writeFile(join(repo, 'docs/superpowers/plans/2026-06-14-multi.md'), 'plan');
    await writeFile(join(repo, 'docs/superpowers/specs/2026-06-14-multi-design.md'), 'spec');
    const graphPath = await writeGraph(repo);

    const out = enrichDocNodes(repo, graphPath);
    const planEdge = out.links.find((l) => l.relation === 'plan-of');
    const specEdge = out.links.find((l) => l.relation === 'spec-of');
    expect(planEdge).toMatchObject({
      target: 'doc:docs/features/beta.md',
      confidence: 'EXTRACTED',
    });
    expect(specEdge).toMatchObject({
      target: 'doc:docs/features/beta.md',
      confidence: 'EXTRACTED',
    });
  });

  it('emits an INFERRED plan-of edge via a transitive code-neighbor in the body', async () => {
    await writeFile(join(repo, 'docs/features/owner.md'), fd('owner', { code: ['src/widget.ts'] }));
    // plan slug `orphan` matches no FD, no links.plan — only the body code reference connects it
    await writeFile(
      join(repo, 'docs/superpowers/plans/2026-06-14-orphan.md'),
      'This plan touches `src/widget.ts` and nothing else.',
    );
    const graphPath = await writeGraph(repo);

    const out = enrichDocNodes(repo, graphPath);
    const edge = out.links.find((l) => l.relation === 'plan-of');
    expect(edge).toMatchObject({ target: 'doc:docs/features/owner.md', confidence: 'INFERRED' });
  });

  it('emits no edge for a plan matching no slug, link, or owned code path', async () => {
    await writeFile(
      join(repo, 'docs/features/unrelated.md'),
      fd('unrelated', { code: ['src/a.ts'] }),
    );
    await writeFile(
      join(repo, 'docs/superpowers/plans/2026-06-14-lonely.md'),
      'mentions src/nowhere.ts which no FD owns',
    );
    const graphPath = await writeGraph(repo);

    const out = enrichDocNodes(repo, graphPath);
    expect(out.links.filter((l) => l.relation === 'plan-of')).toEqual([]);
  });

  it('places doc nodes in a synthetic community above the current max (not -1)', async () => {
    await writeFile(join(repo, 'docs/features/alpha.md'), fd('alpha'));
    const graphPath = await writeGraph(repo);
    const out = enrichDocNodes(repo, graphPath);
    const docNode = out.nodes.find((n) => n.file_type === 'doc')!;
    expect(docNode.community).toBe(1); // max code community was 0
    expect(out.community_labels?.['1']).toBe('docs');
  });
});
