// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import { backed, checkArchDoc, type CodeTruth } from '../arch-check.js';
import { pairKey, readArchPen, type ArchDoc } from '../arch-pen.js';

interface Node {
  id: string;
  type: string;
  name?: string;
  children?: Node[];
}
let seq = 0;
const node = (type: string, name: string, children: Node[] = []): Node => ({
  id: `n${++seq}`,
  type,
  name,
  children,
});
const box = (name: string, ...inside: Node[]): Node =>
  node('frame', name, [node('text', 'Label'), ...inside]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);

function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(JSON.stringify({ version: '2.19', children: pages }));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}
const canvas = (...children: Node[]): ArchDoc => doc(node('frame', 'architecture', children));

const edge = (from: string, to: string): { from: string; to: string } => ({ from, to });
const TRUTH: CodeTruth = {
  modules: ['src/core', 'src/cr', 'src/utils'],
  pairs: new Set([pairKey('src/cr', 'src/core'), pairKey('src/core', 'src/utils')]),
  edges: [
    edge('src/cr/orchestrate.ts', 'src/core/config.ts'),
    edge('src/core/config.ts', 'src/utils/log.ts'),
    edge('src/cr/lanes/review.ts', 'src/cr/orchestrate.ts'),
    edge('src/cr/lanes/review.ts', 'src/cr/lanes/prompt.ts'),
  ],
  parts: new Set(['src/cr/lanes']),
};
const found = (d: ArchDoc): string[][] =>
  checkArchDoc(d, TRUTH).findings.map((f) => [f.kind, f.subject]);
const allModules = (...extra: Node[]): ArchDoc =>
  canvas(box('src/core'), box('src/cr'), box('src/utils'), ...extra);

describe('arch-check / the page', () => {
  it('needs exactly one architecture page, and names arch-draw when there is none', () => {
    const none = checkArchDoc(doc(node('frame', 'modules')), TRUTH).findings;
    expect(none.map((f) => f.kind)).toEqual(['unreadable']);
    expect(none[0]?.message).toContain('arch-draw');
    expect(
      found(doc(node('frame', 'architecture'), node('frame', 'architecture'))).map((f) => f[0]),
    ).toEqual(['unreadable']);
  });
});

describe('arch-check / modules', () => {
  it('names an uncovered module', () => {
    expect(found(canvas(box('src/core'), box('src/cr')))).toEqual([
      ['missing-module', 'src/utils'],
    ]);
  });

  it('names a box that is not a module, and a module drawn twice', () => {
    expect(
      found(canvas(box('src/core'), box('src/cr + src/utils'), box('src/utils'), box('src/ghost'))),
    ).toEqual([
      ['unknown-module', 'src/ghost'],
      ['duplicate-module', 'src/utils'],
    ]);
  });

  it('refuses a part inside a multi-module box name', () => {
    expect(found(canvas(box('src/core'), box('src/cr + src/cr/lanes'), box('src/utils')))).toEqual([
      ['unknown-module', 'src/cr/lanes'],
    ]);
  });

  it('names an arrow end that resolves to nothing', () => {
    expect(found(allModules(arrow('src/cr -> src/nowhere')))).toEqual([
      ['dangling-edge', 'src/cr -> src/nowhere'],
    ]);
  });
});

describe('arch-check / parts', () => {
  it('passes a part that exists inside its module box', () => {
    expect(
      found(canvas(box('src/core'), box('src/cr', box('src/cr/lanes')), box('src/utils'))),
    ).toEqual([]);
  });

  it('names a part that does not exist, and a part outside its module box', () => {
    expect(
      found(
        canvas(
          box('src/core'),
          box('src/cr', box('src/cr/ghost')),
          box('src/utils'),
          box('src/cr/lanes'),
        ),
      ),
    ).toEqual([
      ['unknown-part', 'src/cr/ghost'],
      ['misplaced-part', 'src/cr/lanes'],
    ]);
  });
});

describe('arch-check / arrows', () => {
  it('passes real arrows and advises on an import no arrow draws', () => {
    const result = checkArchDoc(allModules(arrow('src/cr -> src/core')), TRUTH);
    expect(result.findings).toEqual([]);
    expect(result.advisories.map((a) => [a.kind, a.subject])).toEqual([
      ['undrawn-edge', 'src/core -> src/utils'],
    ]);
  });

  it('names an arrow no import backs, and passes a group arrow one import backs', () => {
    expect(
      found(
        canvas(
          box('src/core'),
          group('Work', box('src/cr', box('src/cr/lanes'))),
          box('src/utils'),
          arrow('src/utils -> src/cr'),
          arrow('group: Work -> src/core'),
        ),
      ),
    ).toEqual([['phantom-edge', 'src/utils -> src/cr']]);
  });

  it('passes a multi-module arrow when any expanded pair imports', () => {
    expect(
      found(
        canvas(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core + src/utils')),
      ),
    ).toEqual([]);
  });

  it('never advises on an import between two modules that share one box', () => {
    const result = checkArchDoc(
      canvas(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core')),
      TRUTH,
    );
    expect(result.advisories).toEqual([]);
  });

  it('holds a part arrow to the files, and a nested arrow to the files outside the inner path', () => {
    expect(
      found(
        canvas(
          box('src/core'),
          box('src/cr', box('src/cr/lanes')),
          box('src/utils'),
          arrow('src/cr/lanes -> src/cr'),
          arrow('src/cr -> src/cr/lanes'),
          arrow('src/cr/lanes -> src/core'),
        ),
      ),
    ).toEqual([
      ['phantom-edge', 'src/cr -> src/cr/lanes'],
      ['phantom-edge', 'src/cr/lanes -> src/core'],
    ]);
  });

  it('holds an arrow to an external, container or store to resolving only', () => {
    expect(
      found(
        allModules(
          box('container: CLI'),
          box('external: git'),
          arrow('container: CLI -> external: git'),
          arrow('src/cr -> external:git'),
          arrow('container: CLI -> external: npm'),
        ),
      ),
    ).toEqual([['dangling-edge', 'container: CLI -> external: npm']]);
  });
});

describe('arch-check / backed', () => {
  const edges = TRUTH.edges;
  it('reads imports across two disjoint paths', () => {
    expect(backed(['src/cr'], ['src/core'], edges)).toBe(true);
    expect(backed(['src/core'], ['src/cr'], edges)).toBe(false);
  });

  it('lets imports inside the inner of two nested paths back neither direction', () => {
    expect(backed(['src/cr/lanes'], ['src/cr'], edges)).toBe(true);
    expect(backed(['src/cr'], ['src/cr/lanes'], edges)).toBe(false);
    expect(backed(['src/cr/lanes'], ['src/cr/lanes'], edges)).toBe(false);
  });
});
