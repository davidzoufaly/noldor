// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import { checkArchDoc } from '../arch-check.js';
import { readArchPen, type ArchDoc } from '../arch-pen.js';

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
const arrow = (name: string): Node => node('path', name);

function doc(...pages: Node[]): ArchDoc {
  const read = readArchPen(JSON.stringify({ version: '2.17', children: pages }));
  if (!read.ok) throw new Error(read.error);
  return read.doc;
}
/** A baseline with the three other views present and empty, and `children` on `modules`. */
const baseline = (...children: Node[]): ArchDoc =>
  doc(
    node('frame', 'context'),
    node('frame', 'containers'),
    node('frame', 'modules', children),
    node('frame', 'flows'),
  );

const MODULES = ['src/core', 'src/cr', 'src/utils'];
const found = (d: ArchDoc): string[][] =>
  checkArchDoc(d, MODULES).findings.map((f) => [f.kind, f.subject]);

describe('arch-check / module coverage', () => {
  it('passes a view that covers every module once', () => {
    expect(
      found(baseline(box('src/core'), box('src/cr + src/utils'), arrow('src/cr -> src/core'))),
    ).toEqual([]);
  });

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
});

describe('arch-check / the file and the other views', () => {
  it('needs exactly one page per view', () => {
    expect(
      checkArchDoc(doc(node('frame', 'modules'), node('frame', 'modules')), []).findings.map(
        (f) => [f.kind, f.subject],
      ),
    ).toEqual([
      ['unreadable', 'context'],
      ['unreadable', 'containers'],
      ['unreadable', 'modules'],
      ['unreadable', 'flows'],
    ]);
  });

  it('checks only that arrow ends resolve on the views with no code truth', () => {
    const d = doc(
      node('frame', 'context', [
        box('noldor CLI'),
        box('git'),
        arrow('noldor CLI -> git'),
        arrow('git -> gh'),
      ]),
      node('frame', 'containers'),
      node('frame', 'modules', [box('src/core'), box('src/cr'), box('src/utils')]),
      node('frame', 'flows'),
    );
    expect(checkArchDoc(d, MODULES).findings.map((f) => [f.kind, f.view, f.subject])).toEqual([
      ['dangling-edge', 'context', 'git -> gh'],
    ]);
  });
});
