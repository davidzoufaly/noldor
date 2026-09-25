// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import { checkArchDoc } from '../arch-check.js';
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
const box = (name: string): Node => node('frame', name, [node('text', 'Label')]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);

function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(JSON.stringify({ version: '2.17', children: pages }));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}
const baseline = (...children: Node[]): ArchDoc =>
  doc(
    node('frame', 'context'),
    node('frame', 'containers'),
    node('frame', 'modules', children),
    node('frame', 'flows'),
  );

const MODULES = ['src/core', 'src/cr', 'src/utils'];
const PAIRS = new Set([pairKey('src/cr', 'src/core'), pairKey('src/core', 'src/utils')]);
const found = (d: ArchDoc): string[][] =>
  checkArchDoc(d, MODULES, PAIRS).findings.map((f) => [f.kind, f.subject]);

describe('arch-check / module coverage', () => {
  it('names an uncovered module', () => {
    expect(found(baseline(box('src/core'), box('src/cr')))).toEqual([
      ['missing-module', 'src/utils'],
    ]);
  });

  it('names a box that is not a module, and a module drawn twice', () => {
    expect(
      found(
        baseline(box('src/core'), box('src/cr + src/utils'), box('src/utils'), box('src/ghost')),
      ),
    ).toEqual([
      ['unknown-module', 'src/ghost'],
      ['duplicate-module', 'src/utils'],
    ]);
  });

  it('names an arrow end that resolves to nothing', () => {
    expect(
      found(
        baseline(box('src/core'), box('src/cr'), box('src/utils'), arrow('src/cr -> src/nowhere')),
      ),
    ).toEqual([['dangling-edge', 'src/cr -> src/nowhere']]);
  });

  it('needs exactly one page per view', () => {
    expect(
      checkArchDoc(
        doc(node('frame', 'modules'), node('frame', 'modules')),
        [],
        new Set(),
      ).findings.map((f) => f.subject),
    ).toEqual(['context', 'containers', 'modules', 'flows']);
  });
});

describe('arch-check / arrows', () => {
  it('passes real arrows and advises on an import no arrow draws', () => {
    const result = checkArchDoc(
      baseline(box('src/core'), box('src/cr'), box('src/utils'), arrow('src/cr -> src/core')),
      MODULES,
      PAIRS,
    );
    expect(result.findings).toEqual([]);
    expect(result.advisories.map((a) => [a.kind, a.subject])).toEqual([
      ['undrawn-edge', 'src/core -> src/utils'],
    ]);
  });

  it('names an arrow no import backs, and passes a group arrow one import backs', () => {
    expect(
      found(
        baseline(
          box('src/core'),
          group('Work', box('src/cr')),
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
        baseline(
          box('src/core + src/utils'),
          box('src/cr'),
          arrow('src/cr -> src/core + src/utils'),
        ),
      ),
    ).toEqual([]);
  });

  it('never advises on an import between two modules that share one box', () => {
    const result = checkArchDoc(
      baseline(box('src/core + src/utils'), box('src/cr'), arrow('src/cr -> src/core')),
      MODULES,
      PAIRS,
    );
    expect(result.advisories).toEqual([]);
  });
});
