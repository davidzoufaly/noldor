// @tests: architecture-design-phase
import { describe, expect, it } from 'vitest';

import {
  arrowEndsOf,
  canonicalName,
  pageRoleOf,
  pathRefsOf,
  readArchPen,
  type ArchPage,
} from '../arch-pen.js';

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
/** A box the way `design arch-draw` draws one: a frame with a text label, and any boxes inside it. */
const box = (name: string, ...inside: Node[]): Node =>
  node('frame', name, [node('text', 'Label'), ...inside]);
const group = (name: string, ...children: Node[]): Node =>
  node('frame', `group: ${name}`, children);
const arrow = (name: string): Node => node('path', name);
const pen = (...pages: Node[]): string => JSON.stringify({ version: '2.19', children: pages });
const canvas = (...children: Node[]): string => pen(node('frame', 'architecture', children));

function onlyPage(text: string): ArchPage {
  const read = readArchPen(text);
  if (!read.ok) throw new Error(read.error);
  const [page, ...rest] = read.doc.pages;
  if (page === undefined || rest.length > 0) throw new Error('expected exactly one page');
  return page;
}

describe('arch-pen / names', () => {
  it.each([
    ['architecture', 'baseline'],
    ['BASE:architecture: as-built', 'base'],
    ['FINAL:architecture: add a queue', 'final'],
    ['architecture: variant b', 'variant'],
  ])('reads the page %s', (name, expected) => {
    expect(pageRoleOf(name)).toBe(expected);
  });

  it.each(['modules', 'FINAL:modules: split', 'architecturez', 'FINAL:architecture', 'app'])(
    'ignores the page %s',
    (name) => {
      expect(pageRoleOf(name)).toBeNull();
    },
  );

  it('reads path references, and refuses what is not one', () => {
    expect(pathRefsOf('src/cr')).toEqual(['src/cr']);
    expect(pathRefsOf('src/cr/orchestrate.ts')).toEqual(['src/cr/orchestrate.ts']);
    expect(pathRefsOf('src/utils + src/types')).toEqual(['src/utils', 'src/types']);
    for (const name of [
      'Workflow',
      'src',
      'src/cr (review)',
      'src/../etc',
      'src/cr + Notes',
      'src/cr/',
    ])
      expect(pathRefsOf(name)).toEqual([]);
  });

  it('reads arrow names with or without spaces, and refuses what is not one', () => {
    expect(arrowEndsOf('src/cr -> src/core')).toEqual({ from: 'src/cr', to: 'src/core' });
    expect(arrowEndsOf('group: Work->src/core')).toEqual({ from: 'group: Work', to: 'src/core' });
    for (const name of ['src/cr', 'a -> b -> c', ' -> src/core'])
      expect(arrowEndsOf(name)).toBeNull();
  });

  it('spells every prefix with one space before its label', () => {
    expect(canonicalName('container:CLI')).toBe('container: CLI');
    expect(canonicalName('  group:   Work ')).toBe('group: Work');
    expect(canonicalName('external:')).toBe('external:');
    expect(canonicalName('src/cr')).toBe('src/cr');
  });
});

describe('arch-pen / readArchPen', () => {
  it('refuses what is not a .pen document', () => {
    expect(readArchPen('{ nope').ok).toBe(false);
    expect(readArchPen(JSON.stringify({ version: '2.19' })).ok).toBe(false);
  });

  it('keeps only the pages that name the architecture surface, in file order', () => {
    const read = readArchPen(
      pen(
        node('frame', 'Notes'),
        node('frame', 'architecture'),
        node('frame', 'FINAL:architecture: new'),
        node('frame', 'modules'),
      ),
    );
    if (!read.ok) throw new Error(read.error);
    expect(read.doc.pages.map((p) => [p.name, p.role])).toEqual([
      ['architecture', 'baseline'],
      ['FINAL:architecture: new', 'final'],
    ]);
  });

  it('counts frames, rectangles, ellipses and refs as boxes, each with its kind', () => {
    const page = onlyPage(
      canvas(
        box('src/cr'),
        node('rectangle', 'src/core'),
        node('ellipse', 'Store'),
        node('ref', 'src/utils'),
        node('frame', 'container:CLI'),
        node('text', 'src/docs'),
        node('icon', 'src/lib'),
        arrow('src/cr -> src/core'),
      ),
    );
    expect(page.boxes.map((b) => [b.name, b.kind, b.refs])).toEqual([
      ['src/cr', 'path', ['src/cr']],
      ['src/core', 'path', ['src/core']],
      ['Store', 'plain', []],
      ['src/utils', 'path', ['src/utils']],
      ['container: CLI', 'container', []],
    ]);
  });

  it('gives each path box the paths of the path boxes around it', () => {
    const page = onlyPage(
      canvas(group('Work', box('src/cr', box('src/cr/lanes', box('src/cr/lanes/review.ts'))))),
    );
    expect(page.boxes.map((b) => [b.name, b.within])).toEqual([
      ['src/cr', []],
      ['src/cr/lanes', ['src/cr']],
      ['src/cr/lanes/review.ts', ['src/cr', 'src/cr/lanes']],
    ]);
  });

  it('collects every box inside a group, nested groups included', () => {
    const page = onlyPage(canvas(group('Work', box('src/cr'), group('Inner', box('src/prep')))));
    expect(page.groups.map((g) => [g.name, g.boxIds.length])).toEqual([
      ['group: Work', 2],
      ['group: Inner', 1],
    ]);
  });

  it('resolves an end to a box, to one module of a multi-module box, or to a group of modules', () => {
    const page = onlyPage(
      canvas(
        box('src/cr'),
        box('src/utils + src/types'),
        group('Shared', box('src/core', box('src/core/rules'))),
        arrow('src/cr -> src/types'),
        arrow('src/cr -> group:Shared'),
        arrow('src/cr -> src/utils + src/types'),
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

  it('resolves an outer-layer end whatever its spacing, to a box with no refs', () => {
    const page = onlyPage(
      canvas(box('src/cr'), box('external: git'), arrow('src/cr -> external:git')),
    );
    expect(page.arrows[0]?.to).toMatchObject({ kind: 'box', refs: [] });
  });

  it('leaves an end unresolved when it names nothing, or more than one box', () => {
    const page = onlyPage(canvas(box('git'), box('git'), arrow('git -> gh')));
    expect(page.arrows[0]?.from).toEqual({ kind: 'unresolved', text: 'git', matches: 2 });
    expect(page.arrows[0]?.to).toEqual({ kind: 'unresolved', text: 'gh', matches: 0 });
  });
});
