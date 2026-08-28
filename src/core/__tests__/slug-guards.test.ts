// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadInProgressFds } from '../next-priority.js';
import { parseSlugList, requireFlagValue } from '../slug.js';

describe('parseSlugList', () => {
  it('parses every member, not just the first', () => {
    // The bug a list parser invites: validate entry one, trust the rest. Both
    // members here are path components, so both must be checked.
    expect(() => parseSlugList('good-one,../../../escape')).toThrow(/invalid slug/);
  });

  it('names the offending member in the error', () => {
    expect(() => parseSlugList('a-b, BadSlug')).toThrow(/BadSlug/);
  });

  it('accepts a well-formed list, trimmed, with empties dropped', () => {
    expect(parseSlugList(' a-b , c-d ,')).toEqual(['a-b', 'c-d']);
  });

  it('returns an empty list for an empty string', () => {
    expect(parseSlugList('')).toEqual([]);
  });
});

describe('requireFlagValue', () => {
  it('refuses a missing value rather than coalescing to empty', () => {
    // Coalescing to '' made a trailing `--slugs` read as "no filter requested"
    // instead of a malformed command — a silent change in what runs.
    expect(() => requireFlagValue(undefined, '--slugs')).toThrow(/--slugs requires a value/);
  });

  it('refuses the next flag being consumed as the value', () => {
    expect(() => requireFlagValue('--json', '--slugs')).toThrow(/--slugs requires a value/);
  });

  it('returns a real value', () => {
    expect(requireFlagValue('a-b,c-d', '--slugs')).toBe('a-b,c-d');
  });
});

describe('loadInProgressFds skips an FD whose filename is not a slug', () => {
  it('drops it rather than letting it reach a branch name or a command', () => {
    // The stem becomes `feat/<slug>`, `.worktrees/<slug>` and a rendered drain
    // command. An unfiltered one used to reach the prompt builder and abort a
    // whole drain run, because the loop's catch treats a throw as systemic.
    const cwd = mkdtempSync(join(tmpdir(), 'fds-'));
    mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
    const fd = [
      '---',
      'area: tooling',
      'category: Tooling',
      'deps: []',
      'links:',
      '  code: []',
      '  tests: []',
      'name: Fixture',
      'packages:',
      '  - scripts',
      'phase: in-progress',
      'noldor-tier: full',
      '---',
      '',
    ].join('\n');
    writeFileSync(join(cwd, 'docs', 'features', 'good-slug.md'), fd);
    writeFileSync(join(cwd, 'docs', 'features', 'Bad Name.md'), fd);

    const slugs = loadInProgressFds(cwd).map((f) => f.slug);

    expect(slugs).toContain('good-slug');
    expect(slugs).not.toContain('Bad Name');
    rmSync(cwd, { recursive: true, force: true });
  });
});
