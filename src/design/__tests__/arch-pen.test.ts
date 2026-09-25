// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import { arrowEndsOf, moduleRefsOf, pageRoleOf, readArchPen, type ArchPage } from '../arch-pen.js';

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
/** A box the way Part 3 draws one: a frame with a text label inside. */
const box = (name: string): Node => node('frame', name, [node('text', 'Label')]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);
const pen = (...pages: Node[]): string => JSON.stringify({ version: '2.17', children: pages });

function onlyPage(text: string): ArchPage {
  const read = readArchPen(text);
  if (!read.ok) throw new Error(read.error);
  const [page, ...rest] = read.doc.pages;
  if (page === undefined || rest.length > 0) throw new Error('expected exactly one page');
  return page;
}

describe('arch-pen / names', () => {
  it.each([
    ['modules', { view: 'modules', role: 'baseline' }],
    ['BASE:modules: as-built', { view: 'modules', role: 'base' }],
    ['FINAL:containers: add a queue', { view: 'containers', role: 'final' }],
    ['flows: variant b', { view: 'flows', role: 'variant' }],
  ])('reads the page %s', (name, expected) => {
    expect(pageRoleOf(name)).toEqual(expected);
  });

  it.each(['app', 'FINAL:app: rest', 'modulez', 'FINAL:modules'])('ignores the page %s', (name) => {
    expect(pageRoleOf(name)).toBeNull();
  });

  it('reads module references, and refuses what is not one', () => {
    expect(moduleRefsOf('src/cr')).toEqual(['src/cr']);
    expect(moduleRefsOf('src/utils + src/types')).toEqual(['src/utils', 'src/types']);
    for (const name of [
      'Workflow',
      'src',
      'src/cr (review)',
      'src/../etc',
      'src/cr + Notes',
      'src/cr/',
    ]) {
      expect(moduleRefsOf(name)).toEqual([]);
    }
  });

  it('reads arrow names with or without spaces, and refuses what is not one', () => {
    expect(arrowEndsOf('src/cr -> src/core')).toEqual({ from: 'src/cr', to: 'src/core' });
    expect(arrowEndsOf('group: Work->src/core')).toEqual({ from: 'group: Work', to: 'src/core' });
    for (const name of ['src/cr', 'a -> b -> c', ' -> src/core'])
      expect(arrowEndsOf(name)).toBeNull();
  });
});

describe('arch-pen / readArchPen', () => {
  it('refuses what is not a .pen document', () => {
    expect(readArchPen('{ nope').ok).toBe(false);
    expect(readArchPen(JSON.stringify({ version: '2.17' })).ok).toBe(false);
  });

  it('keeps only the pages that name a view, in file order', () => {
    const read = readArchPen(
      pen(node('frame', 'Notes'), node('frame', 'modules'), node('frame', 'FINAL:flows: new')),
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.pages.map((p) => [p.name, p.role])).toEqual([
      ['modules', 'baseline'],
      ['FINAL:flows: new', 'final'],
    ]);
  });

  it('counts frames, rectangles, ellipses and refs as boxes — never text, icons or paths', () => {
    const page = onlyPage(
      pen(
        node('frame', 'modules', [
          box('src/cr'),
          node('rectangle', 'src/core'),
          node('ellipse', 'Store'),
          node('ref', 'src/utils'),
          node('text', 'src/docs'),
          node('icon', 'src/lib'),
          arrow('src/cr -> src/core'),
        ]),
      ),
    );
    expect(page.boxes.map((b) => [b.name, b.refs])).toEqual([
      ['src/cr', ['src/cr']],
      ['src/core', ['src/core']],
      ['Store', []],
      ['src/utils', ['src/utils']],
    ]);
  });

  it('collects every box inside a group, nested groups included', () => {
    const page = onlyPage(
      pen(
        node('frame', 'modules', [group('Work', box('src/cr'), group('Inner', box('src/prep')))]),
      ),
    );
    expect(page.groups.map((g) => [g.name, g.boxIds.length])).toEqual([
      ['group: Work', 2],
      ['group: Inner', 1],
    ]);
  });

  it('resolves an end to a box, to one module of a multi-module box, or to a group', () => {
    const page = onlyPage(
      pen(
        node('frame', 'modules', [
          box('src/cr'),
          box('src/utils + src/types'),
          group('Shared', box('src/core')),
          arrow('src/cr -> src/types'),
          arrow('src/cr -> group:Shared'),
          arrow('src/cr -> src/utils + src/types'),
        ]),
      ),
    );
    expect(
      page.arrows.map((a) => [a.to.kind, a.to.kind === 'unresolved' ? [] : a.to.refs]),
    ).toEqual([
      ['box', ['src/types']],
      ['group', ['src/core']],
      ['box', ['src/utils', 'src/types']],
    ]);
  });

  it('leaves an end unresolved when it names nothing, or more than one box', () => {
    const page = onlyPage(
      pen(node('frame', 'context', [box('git'), box('git'), arrow('git -> gh')])),
    );
    expect(page.arrows[0]?.from).toEqual({ kind: 'unresolved', text: 'git', matches: 2 });
    expect(page.arrows[0]?.to).toEqual({ kind: 'unresolved', text: 'gh', matches: 0 });
  });
});
