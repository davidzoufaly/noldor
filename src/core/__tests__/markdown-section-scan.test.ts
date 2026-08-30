// @tests: consumer-architecture-doc-surface
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  cutReasons,
  docsRelativeDir,
  listMd,
  locateSection,
  visibleProse,
} from '../markdown-section-scan.js';

describe('cutReasons', () => {
  it('distinguishes an absent marker from a bare one', () => {
    // `[]` and `['']` mean different things — no decline at all, versus a
    // decline with no reason — and a caller that collapsed them would let a
    // bare marker suppress a section.
    expect(cutReasons('just prose here')).toEqual([]);
    expect(cutReasons('noldor:cut')).toEqual(['']);
  });

  it('returns the reason after the marker, and ignores a marker inside a longer word', () => {
    expect(cutReasons('noldor:cut a pure function — the signature is the shape')).toEqual([
      'a pure function — the signature is the shape',
    ]);
    expect(cutReasons('noldor:cutlery is not a marker')).toEqual([]);
  });

  it('returns every marker in order, so a bare one cannot mask a well-formed one', () => {
    expect(cutReasons('noldor:cut\nnoldor:cut second reason')).toEqual(['', 'second reason']);
  });
});

describe('comment handling', () => {
  const MERMAID = ['```mermaid', 'flowchart LR', '  a --> b', '```'].join('\n');

  it('still finds a section that follows a commented-out mermaid fence', () => {
    // THE regression this design exists to close: the comment closes at the
    // flowchart arrow (an edge IS `-->`), so blanking-then-tagging left the
    // fence's closing delimiter stray, every later heading read as fenced, and
    // the artifact silently left scope.
    const body = ['## A', '', '<!--', MERMAID, '-->', '', '## Usage', '', 'Run it.'].join('\n');
    expect(locateSection(body, 2, 'Usage', null)?.raw).toContain('Run it.');
  });

  it('survives two commented-out mermaid fences in one document', () => {
    // Two strays pair up into a phantom fence, so a fix that only healed an
    // unclosed tail would lose every section between them.
    const body = [
      '## A',
      '',
      '<!--',
      MERMAID,
      '-->',
      '',
      '## Usage',
      '',
      'Run it.',
      '',
      '<!--',
      MERMAID,
      '-->',
      '',
      '## After',
      '',
      'tail prose',
    ].join('\n');
    expect(locateSection(body, 2, 'Usage', null)?.scanned).toContain('Run it.');
    expect(locateSection(body, 2, 'After', null)?.scanned).toContain('tail prose');
  });

  it('blanks comment content out of both views while preserving line offsets', () => {
    const body = ['## A', '', 'keep', '<!-- hidden -->', 'also keep'].join('\n');
    const a = locateSection(body, 2, 'A', null);
    expect(a?.scanned).toContain('keep');
    expect(a?.scanned).not.toContain('hidden');
    expect(a?.raw).not.toContain('hidden');
    // Offsets index the ORIGINAL body — callers slice it to read what a comment said.
    expect(body.split('\n').slice(a!.startLine, a!.endLine).join('\n')).toContain('hidden');
  });

  it('does not let a commented-out heading open a section', () => {
    const body = ['prose', '', '<!--', '## Diagram', '-->'].join('\n');
    expect(locateSection(body, 2, 'Diagram', null)).toBeNull();
  });

  it('does not let a commented-out heading terminate a section', () => {
    const body = ['## A', '', 'alpha', '', '<!--', '## B', '-->', '', 'omega'].join('\n');
    expect(locateSection(body, 2, 'A', null)?.scanned).toContain('omega');
  });

  it('treats a comment marker inside a code fence as example text', () => {
    // An unterminated `<!--` in a fenced sample must not blank the rest of the
    // document — specs and FDs routinely quote this framework's own scaffolds.
    const doc = ['```markdown', '<!-- TODO: never closed', '```', '', '## Real', '', 'body'].join(
      '\n',
    );
    expect(locateSection(doc, 2, 'Real', null)?.scanned).toContain('body');
  });

  it('blanks to the end when a comment opens outside a fence and never closes', () => {
    // The safe direction: hidden content measures as missing rather than
    // clearing a section — and a renderer hides it the same way.
    const doc = ['before', '<!-- open forever', '```', 'x', '```', '## Real'].join('\n');
    expect(locateSection(doc, 2, 'Real', null)).toBeNull();
  });

  it('heals a lone fence opener hidden in a comment, instead of fencing the rest of the file', () => {
    // The opener is swallowed by the comment and nothing ever closes it. Fence
    // state must not survive on a delimiter the reader cannot see, or every
    // heading to EOF silently leaves scope — the failure class this module
    // exists to close.
    const body = ['## A', '', '<!--', '```mermaid', '-->', '', '## Usage', '', 'Run it.'].join(
      '\n',
    );
    expect(locateSection(body, 2, 'Usage', null)?.scanned).toContain('Run it.');
  });

  it('still lets a visible unclosed fence run to EOF, exactly as CommonMark reads it', () => {
    const body = ['## A', '', '```', '## Usage', '', 'code to EOF'].join('\n');
    expect(locateSection(body, 2, 'Usage', null)).toBeNull();
  });

  it('heals a hidden lone opener that a later visible delimiter would pair with', () => {
    // The phantom fence does not reach EOF here — a visible bare ``` closes it —
    // but it swallows the heading and the reader's real fence in between. The
    // reader sees no delimiter in the comment, so nothing may fence `## Diagram`.
    const body = [
      '<!--',
      '```',
      '-->',
      '## Diagram',
      'prose beside the diagram',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');
    const d = locateSection(body, 2, 'Diagram', null);
    expect(d?.scanned).toContain('prose beside the diagram');
    expect(d?.scanned).not.toContain('const x = 1;');
  });

  it('heals two comments each hiding a lone delimiter', () => {
    const body = [
      '<!--',
      '```',
      '-->',
      '## Usage',
      'Run it.',
      '<!--',
      '```',
      '-->',
      '## After',
      'tail prose',
    ].join('\n');
    expect(locateSection(body, 2, 'Usage', null)?.scanned).toContain('Run it.');
    expect(locateSection(body, 2, 'After', null)?.scanned).toContain('tail prose');
  });

  it('does not heal a commented-out fence whose body is heading-shaped only inside the comment', () => {
    // A `# run this` line in a commented-out bash fence is hidden text, not a
    // visible heading — the hidden fence stays hidden, exactly as before.
    const body = ['## A', '', '<!--', '```bash', '# run this', '```', '-->', 'after'].join('\n');
    const a = locateSection(body, 2, 'A', null);
    expect(a?.scanned).toContain('after');
    expect(a?.raw).not.toContain('run this');
  });

  it('keeps a commented-out mermaid fence out of the raw view', () => {
    // `raw` feeds fence detection and density floors: a fence the reader cannot
    // see must not clear either.
    const body = ['## A', '', '<!--', MERMAID, '-->'].join('\n');
    expect(locateSection(body, 2, 'A', null)?.raw).not.toContain('flowchart');
  });
});

describe('heading indentation', () => {
  it('lets a one-space-indented heading terminate a section', () => {
    // CommonMark allows up to three spaces before an ATX heading. The opener
    // and terminator predicates used to disagree about that.
    const body = ['## A', '', 'alpha', '', ' ## B', '', 'beta'].join('\n');
    expect(locateSection(body, 2, 'A', null)?.scanned).not.toContain('beta');
    expect(locateSection(body, 2, 'B', null)?.scanned).toContain('beta');
  });

  it('treats a four-space-indented heading as indented code, not a heading', () => {
    const body = ['## A', '', 'alpha', '', '    ## B', '', 'still A'].join('\n');
    expect(locateSection(body, 2, 'A', null)?.raw).toContain('still A');
    expect(locateSection(body, 2, 'B', null)).toBeNull();
  });

  it('treats a four-space-indented fence delimiter as indented code, not a fence', () => {
    // CommonMark allows at most three spaces before a fence — the same rule the
    // heading predicate enforces. A doc SHOWING a fence as an indented sample
    // must not mint a phantom fence that swallows every heading after it.
    const body = ['## A', '', '    ```', '', '## Usage', '', 'Run it.'].join('\n');
    expect(locateSection(body, 2, 'Usage', null)?.scanned).toContain('Run it.');
  });
});

describe('visibleProse', () => {
  it('keeps an indented-code heading-shaped line — only real headings are markup', () => {
    expect(visibleProse('real prose\n    # indented code line')).toContain('indented code line');
    expect(visibleProse('real prose\n## Sub')).not.toContain('Sub');
  });
});

describe('listMd', () => {
  const temps: string[] = [];
  afterAll(async () => {
    await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('returns an empty list for a directory that does not exist', async () => {
    expect(await listMd(join(tmpdir(), 'listmd-definitely-absent'))).toEqual([]);
  });

  it('propagates a non-ENOENT failure instead of reporting a clean empty pass', async () => {
    // ENOTDIR stands in for the whole class (EACCES, EIO): swallowing it made
    // both detectors report zero stubs over a tree they never read.
    const dir = await mkdtemp(join(tmpdir(), 'listmd-'));
    temps.push(dir);
    const file = join(dir, 'a-file.md');
    await writeFile(file, 'x', 'utf8');
    await expect(listMd(join(file, 'below'))).rejects.toThrow();
  });
});

describe('docsRelativeDir', () => {
  it('trims to the docs-rooted suffix', () => {
    expect(docsRelativeDir('/home/me/repo/docs/features')).toBe('docs/features');
    expect(docsRelativeDir('C:\\repo\\docs\\design\\specs')).toBe('docs/design/specs');
  });

  it('returns the whole POSIX path when no docs segment exists', () => {
    expect(docsRelativeDir('/home/me/elsewhere')).toBe('/home/me/elsewhere');
  });
});

describe('locateSection', () => {
  it('ends a section at the next same-or-shallower heading, not at a deeper one', () => {
    const body = ['## A', '', 'alpha', '', '### A2', '', 'nested', '', '## B', '', 'beta'].join(
      '\n',
    );
    expect(locateSection(body, 2, 'A', null)?.raw.trim()).toBe(
      ['alpha', '', '### A2', '', 'nested'].join('\n'),
    );
  });

  it('does not let a four-backtick fence be closed by a three-backtick line inside it', () => {
    const body = [
      '## A',
      '',
      '````md',
      '```',
      '## B',
      '```',
      '````',
      '',
      'still in A',
      '',
      '## B',
      '',
      'beta',
    ].join('\n');
    const a = locateSection(body, 2, 'A', null);
    expect(a?.scanned).toContain('still in A');
    expect(a?.scanned).not.toContain('beta');
    expect(locateSection(body, 2, 'B', null)?.raw.trim()).toBe('beta');
  });

  it('honours requireAncestor, so the same heading under a different parent does not match', () => {
    const body = [
      '## Design',
      '',
      '### Unit',
      '',
      'right',
      '',
      '## Other',
      '',
      '### Unit',
      '',
      'wrong',
    ].join('\n');
    expect(locateSection(body, 3, 'Unit', '## Design')?.raw.trim()).toBe('right');
    expect(locateSection(body, 3, 'Unit', '## Nowhere')).toBeNull();
  });
});
