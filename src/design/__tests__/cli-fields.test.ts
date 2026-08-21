// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Unit 5 of the decision-context-depth spec: the new flags on both CLIs, end to
// end against a real ledger and a real artifact on disk.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { digestBody } from '../artifact-locate.js';
import { runContext } from '../context-cli.js';
import { parseLogArgs, runLog } from '../log-cli.js';

const SLUG = 'my-dialogue';
const SPEC = ['## Problem', '', 'the problem', '', '## Design', '', 'design body', ''].join('\n');

function repo(spec = SPEC): string {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-cli-fields-'));
  mkdirSync(join(cwd, 'docs', 'design', 'specs'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'design', 'specs', `2026-08-21-${SLUG}-design.md`), spec);
  return cwd;
}

function log(cwd: string, ...argv: string[]): { code: number; err: string } {
  let err = '';
  const code = runLog(['--slug', SLUG, ...argv], cwd, (s) => (err += s));
  return { code, err };
}

function context(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runContext(
    ['--slug', SLUG, ...argv],
    cwd,
    (s) => (out += s),
    (s) => (err += s),
  );
  return { code, out, err };
}

const ledger = (cwd: string): string =>
  readFileSync(join(cwd, '.noldor', 'design', `${SLUG}.md`), 'utf8');

describe('design log — decision fields', () => {
  it('persists all four values on the minted decision', () => {
    const cwd = repo();
    expect(
      log(
        cwd,
        '--decide',
        'chose A',
        '--because',
        'reason',
        '--instead-of',
        'B',
        '--section',
        'Design',
      ).code,
    ).toBe(0);
    const raw = ledger(cwd);
    expect(raw).toContain('- D1 chose A');
    expect(raw).toContain('  - section: Design');
    expect(raw).toContain('  - why: reason');
    expect(raw).toContain('  - instead-of: B');
  });

  it('applies --section to every record the invocation mints', () => {
    const cwd = repo();
    expect(
      log(cwd, '--decide', 'a', '--decide', 'b', '--open', 'q', '--section', 'Design').code,
    ).toBe(0);
    const raw = ledger(cwd);
    expect(raw.match(/ {2}- section: Design/g)).toHaveLength(3);
  });

  it('rejects --because with more than one --decide', () => {
    const r = parseLogArgs(['--slug', SLUG, '--decide', 'a', '--decide', 'b', '--because', 'w']);
    expect('error' in r && r.error).toMatch(/exactly one --decide/);
  });

  it('rejects --because with no --decide', () => {
    const r = parseLogArgs(['--slug', SLUG, '--open', 'q', '--because', 'w']);
    expect('error' in r && r.error).toMatch(/exactly one --decide/);
  });

  it('rejects the same heading in confirm and unconfirm', () => {
    const r = parseLogArgs([
      '--slug',
      SLUG,
      '--confirm-section',
      'Design',
      '--unconfirm-section',
      'Design',
    ]);
    expect('error' in r && r.error).toMatch(/same heading/);
  });

  it('rejects a heading name the writer would rewrite', () => {
    // normalize collapses `~~` runs and line terminators, so such a name would be
    // looked up raw in the artifact and stored under a different key — the marker
    // never appears and the stale-tag warning sticks forever.
    for (const bad of ['Drop ~~old~~ path', 'two\nlines']) {
      for (const flag of ['--section', '--confirm-section', '--unconfirm-section']) {
        const r = parseLogArgs(['--slug', SLUG, '--decide', 'a', flag, bad]);
        expect('error' in r && r.error).toMatch(/heading names must contain/);
      }
    }
  });

  it('accepts a heading name that is already normalize-stable', () => {
    const r = parseLogArgs(['--slug', SLUG, '--decide', 'a', '--section', 'Unit 3 — location']);
    expect('error' in r).toBe(false);
  });

  it('stores an unknown --section without complaint', () => {
    const cwd = repo();
    expect(log(cwd, '--decide', 'a', '--section', 'Nope').code).toBe(0);
    expect(ledger(cwd)).toContain('  - section: Nope');
  });
});

describe('design log — confirmation', () => {
  it('records the heading with its body digest', () => {
    const cwd = repo();
    expect(log(cwd, '--confirm-section', 'Design').code).toBe(0);
    expect(ledger(cwd)).toContain(`- Design · ${digestBody('design body')}`);
  });

  it('is idempotent on an unchanged body', () => {
    const cwd = repo();
    log(cwd, '--confirm-section', 'Design');
    log(cwd, '--confirm-section', 'Design');
    expect(ledger(cwd).match(/- Design · /g)).toHaveLength(1);
  });

  it('replaces the digest after an edit', () => {
    const cwd = repo();
    log(cwd, '--confirm-section', 'Design');
    writeFileSync(
      join(cwd, 'docs', 'design', 'specs', `2026-08-21-${SLUG}-design.md`),
      SPEC.replace('design body', 'edited body'),
    );
    log(cwd, '--confirm-section', 'Design');
    const raw = ledger(cwd);
    expect(raw.match(/- Design · /g)).toHaveLength(1);
    expect(raw).toContain(`- Design · ${digestBody('edited body')}`);
  });

  it('exits non-zero for a heading the artifact does not carry', () => {
    const cwd = repo();
    const r = log(cwd, '--confirm-section', 'Ghost');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/matches no heading — legal: Problem, Design/);
  });

  it('exits non-zero when no artifact is on disk', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-cli-bare-'));
    const r = log(cwd, '--confirm-section', 'Design');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/nothing to confirm/);
  });

  it('unconfirms without needing an artifact and no-ops when absent', () => {
    const cwd = repo();
    log(cwd, '--confirm-section', 'Design');
    expect(log(cwd, '--unconfirm-section', 'Design').code).toBe(0);
    expect(ledger(cwd)).not.toContain('## Confirmed');
    expect(log(cwd, '--unconfirm-section', 'Design').code).toBe(0);
  });
});

describe('design context — new flags', () => {
  it('renders the focus heading prose from disk', () => {
    const cwd = repo();
    const r = context(cwd, '--section', 'Design');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Design — current draft');
    expect(r.out).toContain('    design body');
    expect(r.out).toContain('heading 2/2');
  });

  it('parses --full with no value', () => {
    const cwd = repo();
    const r = context(cwd, '--full');
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
  });

  it('parses --full in the final argv slot', () => {
    const cwd = repo();
    expect(context(cwd, '--section', 'Design', '--full').code).toBe(0);
  });

  it('warns on an unknown --section and renders no prose', () => {
    const cwd = repo();
    const r = context(cwd, '--section', 'Desgin');
    expect(r.code).toBe(0);
    expect(r.out).toContain("⚠ --section 'Desgin' matches no heading");
    expect(r.out).not.toContain('current draft');
  });

  it('reports an absent artifact and still exits 0', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-cli-bare-'));
    const r = context(cwd);
    expect(r.code).toBe(0);
    expect(r.out).toContain('no spec on disk yet');
    expect(r.out).not.toContain('Headings');
  });

  it('exits 1 naming the reason for a rejected --spec', () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'elsewhere.md'), 'leak');
    const r = context(cwd, '--spec', 'elsewhere.md');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/resolves outside/);
  });

  it('honours a legal --spec override', () => {
    const cwd = repo();
    writeFileSync(
      join(cwd, 'docs', 'design', 'specs', '2026-08-20-other-design.md'),
      '## Only\n\nbody\n',
    );
    const r = context(
      cwd,
      '--spec',
      'docs/design/specs/2026-08-20-other-design.md',
      '--section',
      'Only',
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain('Only — current draft');
    expect(r.out).toContain('    body');
  });

  it('rejects a --section the writer would rewrite', () => {
    const cwd = repo();
    const r = context(cwd, '--section', 'Drop ~~old~~ path');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/heading names must contain/);
  });

  it('accepts a --`--`-leading value, matching design log', () => {
    // A heading literally named `--foo` is confirmable via design log, so it must
    // be focusable here too or the two halves of one loop disagree.
    const cwd = repo();
    const r = context(cwd, '--section', '--foo');
    expect(r.code).toBe(0);
    expect(r.out).toContain("⚠ --section '--foo' matches no heading");
  });

  it('rejects a blank value, matching design log', () => {
    const cwd = repo();
    const r = context(cwd, '--section', '   ');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/must not be blank/);
  });

  it('rejects an unknown flag', () => {
    const cwd = repo();
    expect(context(cwd, '--nope', 'x').code).toBe(1);
  });

  it('marks a confirmed heading stale after its body changes', () => {
    const cwd = repo();
    log(cwd, '--confirm-section', 'Design');
    expect(context(cwd).out).toContain('  ✓ Design');
    writeFileSync(
      join(cwd, 'docs', 'design', 'specs', `2026-08-21-${SLUG}-design.md`),
      SPEC.replace('design body', 'edited body'),
    );
    const r = context(cwd);
    expect(r.out).toContain('  ✎ Design');
    expect(r.out).toContain("⚠ confirmed heading 'Design' has changed since it was confirmed");
  });
});
