// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NO_SCOPE,
  ledgerPath,
  loadScope,
  normalize,
  parseLedger,
  readLedger,
  serializeLedger,
  validateSlug,
} from '../ledger.js';
import { runContext } from '../context-cli.js';
import { runLog } from '../log-cli.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'noldor-design-'));
}

function log(cwd: string, ...argv: string[]): { code: number; err: string } {
  let err = '';
  const code = runLog(argv, cwd, (s) => {
    err += s;
  });
  return { code, err };
}

function context(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runContext(
    argv,
    cwd,
    (s) => {
      out += s;
    },
    (s) => {
      err += s;
    },
  );
  return { code, out, err };
}

function ledgerText(cwd: string, slug: string): string {
  return readFileSync(ledgerPath(cwd, slug), 'utf8');
}

describe('normalize', () => {
  it('collapses newline-bearing whitespace runs to one space', () => {
    expect(normalize('line one\n## Open\nforged')).toBe('line one ## Open forged');
  });

  it('collapses tilde runs so the resolved-thread marker cannot be forged', () => {
    expect(normalize('thread ~~done~~ → D3')).toBe('thread ~done~ → D3');
    // The recombination case a `~~` → `~ ~` substitution would leak.
    expect(normalize('~~~done~~~ →')).toBe('~done~ →');
  });

  it('collapses every JS line terminator, not just \\n', () => {
    // A surviving bare \r / U+2028 / U+2029 serializes fine but fails every
    // bullet regex on re-read, which would brick the ledger permanently.
    for (const sep of ['\r', '\r\n', '\u2028', '\u2029']) {
      expect(normalize(`a${sep}b`)).toBe('a b');
    }
  });

  it('is non-reintroducing: output never matches the removed patterns', () => {
    for (const input of ['a\nb', 'a\rb', 'a\u2028b', '~~~x~~~ →', 'a \n\n ~~ b', '~~']) {
      const once = normalize(input);
      expect(once).not.toMatch(/~{2,}/);
      expect(once).not.toMatch(/[\n\r\u2028\u2029]/);
      expect(normalize(once)).toBe(once);
    }
  });
});

describe('validateSlug', () => {
  it('rejects path-escaping values', () => {
    expect(validateSlug('../escape', '--slug')).toContain('--slug');
    expect(validateSlug('../../etc/passwd', '--slug')).toContain('--slug');
    expect(validateSlug('', '--slug')).toContain('must not be empty');
  });

  it('accepts a plain slug', () => {
    expect(validateSlug('parent-enh', '--slug')).toBeNull();
  });
});

describe('design log', () => {
  it('assigns D1, D2 in order and appends D3 on a later invocation', () => {
    const cwd = repo();
    expect(log(cwd, '--slug', 's', '--decide', 'a', '--decide', 'b').code).toBe(0);
    expect(log(cwd, '--slug', 's', '--decide', 'c').code).toBe(0);
    const state = readLedger(cwd, 's');
    expect(state.decided).toEqual([
      { id: 'D1', text: 'a' },
      { id: 'D2', text: 'b' },
      { id: 'D3', text: 'c' },
    ]);
  });

  it('resolves an open thread and links it to the decision minted in the same call', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--open', 'x', '--open', 'y');
    expect(readLedger(cwd, 's').open.map((o) => o.id)).toEqual(['O1', 'O2']);
    expect(log(cwd, '--slug', 's', '--resolve', 'O1', '--decide', 'z').code).toBe(0);
    const state = readLedger(cwd, 's');
    expect(state.open[0]).toEqual({ id: 'O1', text: 'x', resolvedBy: 'D1' });
    expect(state.open[1].resolvedBy).toBeNull();
  });

  it('exits 1 listing known ids on an unknown --resolve, leaving the ledger unchanged', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--open', 'x');
    const before = ledgerText(cwd, 's');
    const r = log(cwd, '--slug', 's', '--resolve', 'O9');
    expect(r.code).toBe(1);
    expect(r.err).toContain('O1');
    expect(ledgerText(cwd, 's')).toBe(before);
  });

  it('treats a D id handed to --resolve as an unknown id', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', 'a');
    const before = ledgerText(cwd, 's');
    expect(log(cwd, '--slug', 's', '--resolve', 'D1').code).toBe(1);
    expect(ledgerText(cwd, 's')).toBe(before);
  });

  it('is a no-op when resolving an already-resolved thread', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--open', 'x');
    expect(log(cwd, '--slug', 's', '--resolve', 'O1', '--decide', 'first').code).toBe(0);
    expect(log(cwd, '--slug', 's', '--resolve', 'O1', '--decide', 'second').code).toBe(0);
    const state = readLedger(cwd, 's');
    expect(state.open).toHaveLength(1);
    expect(state.open[0].resolvedBy).toBe('D1');
  });

  it('overwrites the single Entry bullet instead of appending', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--entry', 'e1');
    log(cwd, '--slug', 's', '--entry', 'e2');
    const raw = ledgerText(cwd, 's');
    const entryBody = raw.split('## Entry')[1].split('## ')[0];
    expect(entryBody.match(/^- /gm)).toHaveLength(1);
    expect(readLedger(cwd, 's').entry).toBe('e2');
  });

  it('rejects a path-escaping --slug without creating a file', () => {
    const cwd = repo();
    expect(log(cwd, '--slug', '../escape', '--decide', 'a').code).toBe(1);
    expect(() => readFileSync(join(cwd, '..', 'escape.md'), 'utf8')).toThrow();
  });

  it('cannot forge a section heading via --decide', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', 'line one\n## Open\nforged');
    const state = readLedger(cwd, 's');
    expect(state.decided).toHaveLength(1);
    expect(state.open).toHaveLength(0);
    expect(ledgerText(cwd, 's').match(/^## /gm)).toHaveLength(5);
  });

  it('cannot forge a section heading via --scope', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--scope', '## Open');
    expect(ledgerText(cwd, 's').match(/^## /gm)).toHaveLength(5);
    const { out } = context(cwd, '--slug', 's');
    expect(out).toContain('- ## Open');
    expect(out).toContain('Open (0)');
  });

  it('cannot forge a resolution via --open', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--open', 'thread ~~done~~ → D3');
    log(cwd, '--slug', 's', '--open', '~~~done~~~ →');
    const state = readLedger(cwd, 's');
    expect(state.open.every((o) => o.resolvedBy === null)).toBe(true);
    const { out } = context(cwd, '--slug', 's');
    expect(out).toContain('Open (2)');
  });

  it('cannot close the fence the caller wraps the block in', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', '``` end');
    const { out } = context(cwd, '--slug', 's');
    // Every value line keeps its `- ` prefix, and a closing fence may be preceded
    // only by up to three spaces of indent — never by other characters.
    for (const line of out.split('\n')) expect(line.trimStart().startsWith('```')).toBe(false);
  });

  it('refuses to write when a duplicate heading would hide earlier decisions', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', 'a', '--decide', 'b');
    const p = ledgerPath(cwd, 's');
    writeFileSync(p, `${readFileSync(p, 'utf8')}\n## Decided\n\n- D9 injected\n`, 'utf8');
    const before = readFileSync(p, 'utf8');

    // Without the duplicate-heading guard this parsed to `decided: []` with an
    // empty `unparsed`, so the next append re-minted D1 over existing ids.
    expect(parseLedger(before).unparsed).toContain('Decided');
    const r = log(cwd, '--slug', 's', '--decide', 'c');
    expect(r.code).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  it('refuses to write when a non-critical section is unparseable, rather than erasing it', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--support', 'src/foo.ts:1 — does X');
    const p = ledgerPath(cwd, 's');
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replace('- src/foo.ts:1 — does X', 'src/foo.ts:1 (hand-mangled)'),
      'utf8',
    );
    const before = readFileSync(p, 'utf8');

    const r = log(cwd, '--slug', 's', '--decide', 'a');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Existing support');
    expect(readFileSync(p, 'utf8')).toBe(before);
    // The hand-written line survives, and rendering still works.
    expect(readFileSync(p, 'utf8')).toContain('src/foo.ts:1 (hand-mangled)');
    expect(context(cwd, '--slug', 's').code).toBe(0);
  });

  it('flags a multi-bullet Entry section instead of honouring only the first line', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--entry', 'e1');
    const p = ledgerPath(cwd, 's');
    writeFileSync(p, readFileSync(p, 'utf8').replace('- e1', '- e1\n- e2'), 'utf8');
    expect(parseLedger(readFileSync(p, 'utf8')).unparsed).toContain('Entry');
    expect(log(cwd, '--slug', 's', '--decide', 'a').code).toBe(1);
  });

  it('reports each unparseable section once even when two detectors trip', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--open', 'x');
    const p = ledgerPath(cwd, 's');
    writeFileSync(p, `${readFileSync(p, 'utf8')}\n## Open\n\nnot-a-bullet\n`, 'utf8');
    const unparsed = parseLedger(readFileSync(p, 'utf8')).unparsed;
    expect(unparsed.filter((s) => s === 'Open')).toHaveLength(1);
  });

  it('records text that starts with a double dash', () => {
    const cwd = repo();
    expect(log(cwd, '--slug', 's', '--decide', '--fd is validated too').code).toBe(0);
    expect(readLedger(cwd, 's').decided[0].text).toBe('--fd is validated too');
  });

  it('reports a missing value when the next argv item is a known flag', () => {
    const cwd = repo();
    const r = log(cwd, '--slug', 's', '--decide', '--open', 'x');
    expect(r.code).toBe(1);
    expect(r.err).toContain('missing value');
  });

  it('reports a trailing unknown flag as unknown, not as a missing value', () => {
    const cwd = repo();
    const r = log(cwd, '--slug', 's', '--typo');
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown flag');
  });

  it('rejects a blank --decide rather than storing an empty bullet', () => {
    const cwd = repo();
    const r = log(cwd, '--slug', 's', '--decide', '   ');
    expect(r.code).toBe(1);
    expect(r.err).toContain('must not be blank');
  });

  it('skips a duplicate section body instead of merging it into the first', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', 'first');
    const p = ledgerPath(cwd, 's');
    writeFileSync(p, `${readFileSync(p, 'utf8')}\n## Decided\n\n- D1 injected duplicate\n`, 'utf8');
    const state = parseLedger(readFileSync(p, 'utf8'));
    expect(state.unparsed).toContain('Decided');
    // Merged bodies would surface two `D1`s in the rendered block.
    expect(state.decided.map((d) => d.id)).toEqual(['D1']);
    expect(state.decided[0].text).toBe('first');
  });

  it('fails closed on a mangled Decided section while rendering still works', () => {
    const cwd = repo();
    log(cwd, '--slug', 's', '--decide', 'a');
    const p = ledgerPath(cwd, 's');
    writeFileSync(p, readFileSync(p, 'utf8').replace('- D1 a', 'D1 a (hand-mangled)'), 'utf8');
    const before = readFileSync(p, 'utf8');

    const r = log(cwd, '--slug', 's', '--decide', 'b');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Decided');
    expect(readFileSync(p, 'utf8')).toBe(before);

    const rendered = context(cwd, '--slug', 's');
    expect(rendered.code).toBe(0);
    expect(rendered.out).toContain('⚠ ledger section unparsed: Decided');
  });
});

describe('parseLedger / serializeLedger', () => {
  it('round-trips every section', () => {
    const state = parseLedger(
      serializeLedger('s', {
        entry: 'e',
        scope: 'sc',
        decided: [{ id: 'D1', text: 'a' }],
        open: [
          { id: 'O1', text: 'x', resolvedBy: null },
          { id: 'O2', text: 'y', resolvedBy: 'D1' },
        ],
        support: ['src/foo.ts:1 — does X'],
        unparsed: [],
      }),
    );
    expect(state.entry).toBe('e');
    expect(state.scope).toBe('sc');
    expect(state.decided).toHaveLength(1);
    expect(state.open[1].resolvedBy).toBe('D1');
    expect(state.support).toEqual(['src/foo.ts:1 — does X']);
    expect(state.unparsed).toEqual([]);
  });
});

describe('loadScope', () => {
  const roadmap = [
    '# Roadmap',
    '',
    '### Some Entry Slug',
    '',
    '- area: tooling',
    '- size: M',
    '- impact: med',
    '',
    'Roadmap-derived scope text.',
    '',
  ].join('\n');

  function seedRoadmap(cwd: string): void {
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'roadmap.md'), roadmap, 'utf8');
  }

  function seedFd(cwd: string, slug: string, summary: string): void {
    mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(cwd, 'docs', 'features', `${slug}.md`),
      `---\nname: X\n---\n## Summary\n\n${summary}\n\n## Usage\n\nn/a\n`,
      'utf8',
    );
  }

  it('prefers the ledger Scope over every repo source', () => {
    const cwd = repo();
    seedRoadmap(cwd);
    log(cwd, '--slug', 'some-entry-slug', '--scope', 'ledger wins');
    expect(
      loadScope(cwd, { slug: 'some-entry-slug', state: readLedger(cwd, 'some-entry-slug') }),
    ).toBe('ledger wins');
  });

  it('resolves an attach dialogue from the roadmap via the Entry key', () => {
    const cwd = repo();
    seedRoadmap(cwd);
    log(cwd, '--slug', 'parent-enh', '--entry', 'some-entry-slug');
    const state = readLedger(cwd, 'parent-enh');
    expect(state.entry).toBe('some-entry-slug');
    expect(loadScope(cwd, { slug: 'parent-enh', state })).toBe('Roadmap-derived scope text.');
  });

  it('falls back to the dialogue slug as entry key on *-new paths', () => {
    const cwd = repo();
    seedRoadmap(cwd);
    const state = readLedger(cwd, 'some-entry-slug');
    expect(loadScope(cwd, { slug: 'some-entry-slug', state })).toBe('Roadmap-derived scope text.');
  });

  it('resolves an attach dialogue from the parent FD via the session marker', () => {
    const cwd = repo();
    seedFd(cwd, 'p', 'FD summary for the parent.');
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'session.json'),
      JSON.stringify({
        path: 'specs-only-attach',
        parent: 'p',
        enhancement: 'enh',
        startedAt: '2026-08-03T00:00:00Z',
        markerVersion: 2,
      }),
      'utf8',
    );
    const state = readLedger(cwd, 'p-enh');
    expect(loadScope(cwd, { slug: 'p-enh', state })).toBe('FD summary for the parent.');
  });

  it('resolves the same FD via --fd with no session marker present', () => {
    const cwd = repo();
    seedFd(cwd, 'p', 'FD summary for the parent.');
    const state = readLedger(cwd, 'p-enh');
    expect(loadScope(cwd, { slug: 'p-enh', state, fdSlug: 'p' })).toBe(
      'FD summary for the parent.',
    );
  });

  it('rejects a blank --scope at the CLI and still resolves from the repo', () => {
    const cwd = repo();
    seedRoadmap(cwd);
    // Two layers: the CLI refuses a blank value, and `loadScope` treats an
    // already-stored empty scope as absent — neither route yields a blank Scope.
    const r = log(cwd, '--slug', 'some-entry-slug', '--scope', '   ');
    expect(r.code).toBe(1);
    expect(r.err).toContain('must not be blank');
    expect(
      loadScope(cwd, {
        slug: 'some-entry-slug',
        state: { ...readLedger(cwd, 'some-entry-slug'), scope: '' },
      }),
    ).toBe('Roadmap-derived scope text.');
  });

  it('ignores a session-marker parent that is not slug-shaped', () => {
    const cwd = repo();
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'session.json'),
      JSON.stringify({
        path: 'specs-only-attach',
        parent: '../escape',
        enhancement: 'enh',
        startedAt: '2026-08-03T00:00:00Z',
        markerVersion: 2,
      }),
      'utf8',
    );
    expect(loadScope(cwd, { slug: 'p-enh', state: readLedger(cwd, 'p-enh') })).toBe(NO_SCOPE);
  });

  it('falls through an empty FD Summary instead of rendering a blank scope', () => {
    const cwd = repo();
    mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(cwd, 'docs', 'features', 'p.md'),
      '---\nname: X\n---\n## Summary\n\n## Usage\n\nn/a\n',
      'utf8',
    );
    expect(loadScope(cwd, { slug: 'p-enh', state: readLedger(cwd, 'p-enh'), fdSlug: 'p' })).toBe(
      NO_SCOPE,
    );
  });

  it('returns the placeholder when nothing resolves', () => {
    const cwd = repo();
    expect(loadScope(cwd, { slug: 'nothing', state: readLedger(cwd, 'nothing') })).toBe(NO_SCOPE);
  });
});

describe('design context', () => {
  it('exits 0 with the roadmap-derived scope when no ledger exists', () => {
    const cwd = repo();
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(
      join(cwd, 'docs', 'roadmap.md'),
      '# Roadmap\n\n### Some Entry Slug\n\n- area: tooling\n\nRoadmap-derived scope text.\n',
      'utf8',
    );
    const r = context(cwd, '--slug', 'some-entry-slug');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Roadmap-derived scope text.');
    expect(r.out).toContain('(no decisions recorded yet)');
  });

  it('rejects path-escaping --slug and --fd without printing a block', () => {
    const cwd = repo();
    for (const argv of [
      ['--slug', '../../etc/passwd'],
      ['--slug', 's', '--fd', '../secret'],
    ]) {
      const r = context(cwd, ...argv);
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
    }
  });
});
