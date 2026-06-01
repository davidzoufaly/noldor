import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkTemplateSync } from '../check-template-sync.js';

/** Build a templates root + consumer root with the given file contents. */
function makeRoots(
  tpl: Record<string, string>,
  consumer: Record<string, string>,
): { templatesRoot: string; cwd: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'noldor-tsync-'));
  const templatesRoot = join(base, 'templates');
  const cwd = join(base, 'consumer');
  for (const [rel, content] of Object.entries(tpl)) {
    const p = join(templatesRoot, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  for (const [rel, content] of Object.entries(consumer)) {
    const p = join(cwd, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  // ensure both roots exist even when empty
  mkdirSync(templatesRoot, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { templatesRoot, cwd, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe('checkTemplateSync', () => {
  it('passes when a touched templated file is byte-identical to its template', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['lefthook/noldor.yml'] });
      expect(res).toEqual({ ok: true, offenders: [] });
    } finally {
      cleanup();
    }
  });

  it('flags a consumer-only edit as drifted', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 2\n' },
    );
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['lefthook/noldor.yml'] });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'lefthook/noldor.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });

  it('flags a template-only edit (changed path under templates/) on the shared rel-path', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 2\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['templates/lefthook/noldor.yml'],
      });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'lefthook/noldor.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });

  it('ignores changed files that are not templated', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'lefthook/noldor.yml': 'a: 1\n' },
      { 'lefthook/noldor.yml': 'a: 1\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['src/rules/resolve.ts', 'README.md'],
      });
      expect(res).toEqual({ ok: true, offenders: [] });
    } finally {
      cleanup();
    }
  });

  it('flags a missing consumer copy', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots({ 'skills/x.md': 'hi\n' }, {});
    try {
      const res = checkTemplateSync({ cwd, templatesRoot, changedFiles: ['skills/x.md'] });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'skills/x.md', status: 'missing' }]);
    } finally {
      cleanup();
    }
  });

  it('reports only the drifted entry from a mixed changed-file list', () => {
    const { templatesRoot, cwd, cleanup } = makeRoots(
      { 'a.yml': 'x\n', 'b.yml': 'y\n' },
      { 'a.yml': 'x\n', 'b.yml': 'CHANGED\n' },
    );
    try {
      const res = checkTemplateSync({
        cwd,
        templatesRoot,
        changedFiles: ['a.yml', 'b.yml', 'src/unrelated.ts'],
      });
      expect(res.ok).toBe(false);
      expect(res.offenders).toEqual([{ path: 'b.yml', status: 'drifted' }]);
    } finally {
      cleanup();
    }
  });
});
