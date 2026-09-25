// @tests: scaffold-one-agent-rules-file-not-two, version-aware-upgrade-and-migration-chain
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TEMPLATES_ROOT } from '../../templates/manifest.js';
import { migration_1_13_0 } from '../1.13.0.js';

const ROUTE_TABLE =
  "`docs/noldor/README.md` is the framework's route table — every workflow has a dedicated page. Before any change open the matching page from there. `.claude/engineering-rules.md` carries the Noldor baseline (single source; the old `docs/noldor/engineering-principles.md` page is dropped — its content lives here now).";
const GOTCHAS =
  'On any weird or opaque failure (commit rejected with no clear message, gate abort, tool exit that makes no sense), grep `docs/noldor/gotchas.md` and the area runbook BEFORE debugging from scratch — known traps are documented there.';
const GATE =
  '`/gate` mandatory before any code edit. Bypass via `Noldor-Path-Override: <reason>` only when a hook genuinely cannot run.';
const HEAD = '# Noldor Framework\n\n@docs/noldor/README.md\n@.claude/engineering-rules.md\n\n';
/** The two `.claude/noldor.md` versions noldor shipped, byte for byte. */
const SHIPPED_V1 = `${HEAD}${ROUTE_TABLE}\n\n## Gate\n\n${GATE}\n`;
const SHIPPED_V2 = `${HEAD}${ROUTE_TABLE}\n\n${GOTCHAS}\n\n## Gate\n\n${GATE}\n`;

const TEMPLATE = readFileSync(join(TEMPLATES_ROOT, 'AGENTS.md'), 'utf8');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-mig-1130-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8');

describe('migration_1_13_0', () => {
  it('moves a charuy-shaped tree onto AGENTS.md', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      '.claude/CLAUDE.md': '# Project Rules\n\n@charuy-overlay.md\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/noldor.md'))).toBe(false);
    expect(read(dir, '.claude/CLAUDE.md')).toBe(
      '@../AGENTS.md\n\n# Project Rules\n\n@charuy-overlay.md\n',
    );
    expect(read(dir, 'AGENTS.md')).toBe(TEMPLATE);
  });

  it('removes the first shipped version too', () => {
    const dir = tree({ '.claude/noldor.md': SHIPPED_V1 });
    migration_1_13_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/noldor.md'))).toBe(false);
  });

  it('repoints a noldor.md import in place instead of adding a second import', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '# Project\n@.claude/noldor.md\nmore\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('# Project\n@AGENTS.md\nmore\n');
  });

  it('repoints a noldor.md import in a CRLF file, keeping its line endings', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '# Project\r\n@.claude/noldor.md\r\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('# Project\r\n@AGENTS.md\r\n');
  });

  it('repoints a mid-sentence noldor.md import in place', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '# Project\nRead @.claude/noldor.md before editing.\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('# Project\nRead @AGENTS.md before editing.\n');
  });

  it('adds nothing when a CLAUDE file already imports AGENTS.md mid-sentence', () => {
    const files = { 'CLAUDE.md': '# Project\nFollow @AGENTS.md first.\n' };
    const dir = tree(files);
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe(files['CLAUDE.md']);
  });

  it('turns a later mid-sentence noldor.md import into a plain path once AGENTS.md is imported', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '@AGENTS.md\nSee @.claude/noldor.md for the gate.\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('@AGENTS.md\nSee AGENTS.md for the gate.\n');
  });

  it('writes one import when both CLAUDE files imported noldor.md', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '@.claude/noldor.md\nroot\n',
      '.claude/CLAUDE.md': '@noldor.md\nnested\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('@AGENTS.md\nroot\n');
    expect(read(dir, '.claude/CLAUDE.md')).toBe('nested\n');
  });

  it('leaves AGENTS.md imports the consumer already has in both files', () => {
    const files = {
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '@AGENTS.md\nroot\n',
      '.claude/CLAUDE.md': '@../AGENTS.md\nnested\n',
    };
    const dir = tree(files);
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe(files['CLAUDE.md']);
    expect(read(dir, '.claude/CLAUDE.md')).toBe(files['.claude/CLAUDE.md']);
  });

  it('keeps a modified noldor.md with its import, and still wires AGENTS.md', () => {
    const modified = `${SHIPPED_V2}\nOur own addition.\n`;
    const dir = tree({
      '.claude/noldor.md': modified,
      'CLAUDE.md': '@.claude/noldor.md\n',
    });
    const steps = migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, '.claude/noldor.md')).toBe(modified);
    expect(read(dir, 'CLAUDE.md')).toBe('@AGENTS.md\n\n@.claude/noldor.md\n');
    expect(steps.find((s) => s.path === '.claude/noldor.md')?.before).toContain('left as-is');
  });

  it('touches no CLAUDE file when claude is not an agent target', () => {
    const dir = tree({
      '.noldor/config.json': JSON.stringify({ agents: { targets: ['codex'] } }),
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '@.claude/noldor.md\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(read(dir, 'CLAUDE.md')).toBe('@.claude/noldor.md\n');
    expect(existsSync(join(dir, '.claude/noldor.md'))).toBe(false);
  });

  it('appends the region to a consumer AGENTS.md, keeping its content first', () => {
    const own = '# Our agent rules\n\nUse tabs.\n';
    const dir = tree({ 'AGENTS.md': own });
    migration_1_13_0.migrate(dir, {} as never);
    const after = read(dir, 'AGENTS.md');
    expect(after.startsWith(own)).toBe(true);
    expect(after).toContain('\n<!-- noldor:rules:start -->\n');
    expect(after.endsWith('<!-- noldor:rules:end -->\n')).toBe(true);
  });

  it('refuses unpaired AGENTS.md markers in both modes, writing nothing', () => {
    const files = {
      '.claude/noldor.md': SHIPPED_V2,
      'AGENTS.md': '# Ours\n<!-- noldor:rules:start -->\n',
    };
    const dir = tree(files);
    expect(() => migration_1_13_0.dryRun(dir, {} as never)).toThrow(/noldor:rules markers/);
    expect(() => migration_1_13_0.migrate(dir, {} as never)).toThrow(/noldor:rules markers/);
    expect(read(dir, '.claude/noldor.md')).toBe(SHIPPED_V2);
    expect(read(dir, 'AGENTS.md')).toBe(files['AGENTS.md']);
  });

  it('lists in --dry-run exactly the steps a real run takes, and writes nothing', () => {
    const files = {
      '.claude/noldor.md': SHIPPED_V2,
      'CLAUDE.md': '# Project\n@.claude/noldor.md\n',
      '.claude/CLAUDE.md': '# Nested\n',
    };
    const dry = tree(files);
    const real = tree(files);
    const planned = migration_1_13_0.dryRun(dry, {} as never);
    const applied = migration_1_13_0.migrate(real, {} as never);
    expect(planned).toEqual(applied);
    expect(planned.map((s) => s.path)).toEqual(['.claude/noldor.md', 'CLAUDE.md', 'AGENTS.md']);
    for (const [rel, content] of Object.entries(files)) expect(read(dry, rel)).toBe(content);
    expect(existsSync(join(dry, 'AGENTS.md'))).toBe(false);
  });

  it('lists no steps on a second run', () => {
    const dir = tree({
      '.claude/noldor.md': SHIPPED_V2,
      '.claude/CLAUDE.md': '# Project\n',
    });
    migration_1_13_0.migrate(dir, {} as never);
    expect(migration_1_13_0.migrate(dir, {} as never)).toEqual([]);
  });
});
