// @tests: noldor
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCommandRegistry,
  commandTokens,
  extractCommandRefs,
  refResolves,
  tableBareNames,
} from '../command-registry.js';

describe('commandTokens', () => {
  it('strips pnpm/noldor launchers and keeps leading command words', () => {
    expect(commandTokens('pnpm noldor garden detect')).toEqual(['garden', 'detect']);
    expect(commandTokens('noldor doctor')).toEqual(['doctor']);
    expect(commandTokens('pnpm release')).toEqual(['release']);
    expect(commandTokens('pnpm noldor:changelog')).toEqual(['noldor:changelog']);
  });

  it('stops at flags, placeholders, and inline shell comments', () => {
    expect(commandTokens('pnpm noldor autonomous run --source plans')).toEqual([
      'autonomous',
      'run',
    ]);
    expect(commandTokens('pnpm noldor worktrees create <slug>')).toEqual(['worktrees', 'create']);
    expect(commandTokens('pnpm validate:milestones # snapshot schema')).toEqual([
      'validate:milestones',
    ]);
    expect(commandTokens('pnpm noldor classify-feature-track [--apply]')).toEqual([
      'classify-feature-track',
    ]);
  });

  it('rejects non-commands and pnpm built-ins', () => {
    expect(commandTokens('some prose text')).toBeNull();
    expect(commandTokens('pnpm install')).toBeNull();
    expect(commandTokens('pnpm pack')).toBeNull();
    expect(commandTokens('pnpm noldor')).toBeNull();
  });

  it('stops at the first flag instead of letting its value slide into the group slot', () => {
    // The Q-0148 regression class: the retired second implementation filtered
    // flags out, so `--filter web` yielded `pnpm web` and `--root .` yielded
    // `pnpm noldor .`.
    expect(commandTokens('pnpm --filter web run build')).toBeNull();
    expect(commandTokens('pnpm noldor --root . checks readme')).toBeNull();
  });

  it('treats the long-tail pnpm built-ins as built-ins', () => {
    for (const b of ['remove', 'publish', 'why', 'dedupe', 'up']) {
      expect(commandTokens(`pnpm ${b}`)).toBeNull();
    }
  });
});

describe('refResolves', () => {
  it('prefers the two-token form, falls back to one, ignores trailing args', () => {
    const registry = new Set(['garden detect', 'doctor']);
    expect(refResolves(['garden', 'detect', 'extra'], registry)).toBe(true);
    expect(refResolves(['doctor'], registry)).toBe(true);
    expect(refResolves(['doctor', 'anything'], registry)).toBe(true);
    expect(refResolves(['garden', 'nope'], registry)).toBe(false);
  });

  it('never demands a subcommand of a resolvable single token', () => {
    // `pnpm noldor docs --help` → tokens ['docs']; the group alone resolves.
    expect(refResolves(['docs'], new Set(['docs', 'docs check']))).toBe(true);
  });
});

describe('extractCommandRefs', () => {
  it('reads inline spans and fenced-block lines, ignores prose', () => {
    const body = [
      'Run `pnpm noldor garden detect` then relax.',
      'Plain prose mentioning pnpm noldor doctor is ignored.',
      '```bash',
      'pnpm noldor upgrade --dry-run',
      '```',
    ].join('\n');
    expect(extractCommandRefs(body).map((r) => r.display)).toEqual(['garden detect', 'upgrade']);
  });
});

describe('buildCommandRegistry', () => {
  it('unions manifest leaves, group names, scripts, and catalog aliases', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'command-registry-'));
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { toon: 'echo' } }));
    mkdirSync(join(repo, 'docs', 'noldor'), { recursive: true });
    writeFileSync(
      join(repo, 'docs', 'noldor', 'script-catalog.md'),
      '# Script Catalog\n\n### garden:detect\n\nTrigger: `pnpm noldor cataloged run`\n',
    );
    const reg = await buildCommandRegistry(repo);
    expect(reg.has('garden')).toBe(true); // manifest group
    expect(reg.has('garden detect')).toBe(true); // manifest leaf
    expect(reg.has('toon')).toBe(true); // package script
    expect(reg.has('garden:detect')).toBe(true); // catalog colon alias
    expect(reg.has('cataloged run')).toBe(true); // catalog backtick trigger
  });
});

describe('tableBareNames', () => {
  it('collects single-word backticked cell names per table, skipping invocations', () => {
    const body = [
      'prose with `pnpm noldor doctor` inline',
      '| Group | What |',
      '| --- | --- |',
      '| `init` | scaffold |',
      '| `pnpm noldor cr orchestrate` | invocation, not a bare name |',
      '| `specs-only-new` / `specs-only-attach` | two spans, one cell |',
      '',
      'gap between tables',
      '',
      '| Platform | Asset |',
      '| `noldor-linux-amd64` | binary |',
    ].join('\n');
    expect(tableBareNames(body)).toEqual([
      ['init', 'specs-only-new', 'specs-only-attach'],
      ['noldor-linux-amd64'],
    ]);
  });
});
