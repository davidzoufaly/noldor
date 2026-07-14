import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeDrift } from '../diff.js';
import { copyTemplate, adoptTemplate } from '../copy.js';
import { templateFiles, TEMPLATES_ROOT, SCAFFOLD_ONLY_TEMPLATES } from '../manifest.js';
import { filterTemplatesByAgents } from '../agent-filter.js';

// @tests: noldor-package-lift

describe('computeDrift', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-drift-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('unchanged when content matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'unchanged' },
    ]);
  });

  it('drifted when content differs', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'mod');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'drifted' },
    ]);
  });

  it('missing when consumer file absent', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'missing' },
    ]);
  });
});

describe('copyTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-copy-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds new files', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false });
    expect(out).toEqual([{ path: 'a.md', status: 'added' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('refuses overwrite without --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    expect(() =>
      copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false }),
    ).toThrow(/Refusing to overwrite/);
  });

  it('updates when --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'updated' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('reports unchanged when content already matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'unchanged' }]);
  });

  it('enumerates ALL conflicts at once and writes nothing when aborting', () => {
    for (const f of ['a.md', 'b.md', 'c.md']) {
      writeFileSync(join(dir, 'tpl', f), 'new');
    }
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old'); // conflict
    writeFileSync(join(dir, 'consumer', 'b.md'), 'old'); // conflict
    // c.md absent → would be added, but the abort must not write it
    let msg = '';
    try {
      copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md', 'b.md', 'c.md'], {
        update: false,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Refusing to overwrite 2 existing file/);
    expect(msg).toContain('a.md');
    expect(msg).toContain('b.md');
    // no partial write: the would-be-added c.md was not created
    expect(existsSync(join(dir, 'consumer', 'c.md'))).toBe(false);
  });
});

describe('adoptTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-adopt-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies consumer files INTO templates dir', () => {
    writeFileSync(join(dir, 'consumer', 'a.md'), 'canonical');
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(readFileSync(join(dir, 'tpl', 'a.md'), 'utf8')).toBe('canonical');
  });

  it('skips paths absent from the consumer', () => {
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(existsSync(join(dir, 'tpl', 'a.md'))).toBe(false);
  });
});

describe('.claude/settings.json template (consumer edit-gating)', () => {
  const rel = '.claude/settings.json';

  it('ships in the template manifest', () => {
    expect(templateFiles()).toContain(rel);
  });

  it('is scaffold-only (consumer owns it; never a force-synced twin)', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
  });

  it('is delivered to claude consumers and withheld from codex-only trees', () => {
    expect(filterTemplatesByAgents([rel], ['claude'])).toEqual([rel]);
    expect(filterTemplatesByAgents([rel], ['codex'])).toEqual([]);
  });

  it('wires the pre-edit-guard PreToolUse hook', () => {
    const cfg = JSON.parse(readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'));
    const preToolUse = cfg.hooks?.PreToolUse ?? [];
    const commands = preToolUse.flatMap((m: { hooks?: { command?: string }[] }) =>
      (m.hooks ?? []).map((h) => h.command ?? ''),
    );
    expect(commands.some((c: string) => c.includes('pre-edit-guard'))).toBe(true);
  });
});
