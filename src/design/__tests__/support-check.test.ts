// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Q-0067: a spec whose ledger records no prior art is refused unless the
// operator records an explicit `--support "none: <reason>"`.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isReasonlessNone, supportVerdict } from '../ledger.js';
import { runLog } from '../log-cli.js';
import { runSupportCheck } from '../support-check-cli.js';

const SLUG = 'my-dialogue';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'noldor-support-check-'));
}

function log(cwd: string, ...argv: string[]): { code: number; err: string } {
  let err = '';
  const code = runLog(['--slug', SLUG, ...argv], cwd, (s) => (err += s));
  return { code, err };
}

function check(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  const r = runSupportCheck(argv, cwd);
  return r.stream === 'stdout'
    ? { code: r.code, out: r.text, err: '' }
    : { code: r.code, out: '', err: r.text };
}

describe('supportVerdict', () => {
  it('reads an empty list as missing', () => {
    expect(supportVerdict([])).toEqual({ kind: 'missing' });
  });

  it('counts real anchors, ignoring a none: beside them', () => {
    expect(supportVerdict(['src/a.ts:1 — does X', 'none: n/a'])).toEqual({
      kind: 'anchored',
      anchors: 1,
    });
  });

  it('reads only none: entries as an explicit waiver', () => {
    expect(supportVerdict(['None: greenfield subsystem'])).toEqual({
      kind: 'waived',
      reasons: ['greenfield subsystem'],
    });
  });

  it('does not accept a reasonless none: hand-edited into the ledger', () => {
    expect(supportVerdict(['none:', 'none:   '])).toEqual({ kind: 'missing' });
  });
});

describe('isReasonlessNone', () => {
  it.each(['none', 'NONE', 'none:', ' none :  '])('flags %j', (v) => {
    expect(isReasonlessNone(v)).toBe(true);
  });

  it.each(['none: greenfield', 'nonexistent helper at src/x.ts', 'src/none.ts:3'])(
    'passes %j',
    (v) => {
      expect(isReasonlessNone(v)).toBe(false);
    },
  );
});

describe('design log --support', () => {
  it('refuses a bare none and writes nothing', () => {
    const cwd = repo();
    const r = log(cwd, '--support', 'none:');
    expect(r.code).toBe(1);
    expect(r.err).toContain('none: <why nothing exists to reuse>');
    expect(check(cwd, '--slug', SLUG).code).toBe(2);
  });
});

describe('design support-check', () => {
  it('exits 2 with both remedies when no ledger exists', () => {
    const r = check(repo(), '--slug', SLUG);
    expect(r.code).toBe(2);
    expect(r.out).toContain('no prior art recorded');
    expect(r.out).toContain(`design log --slug ${SLUG} --support "none: <reason>"`);
  });

  it('exits 0 once an anchor is logged', () => {
    const cwd = repo();
    expect(log(cwd, '--support', 'src/foo.ts:12 — already does X').code).toBe(0);
    const r = check(cwd, '--slug', SLUG);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 anchor(s)');
  });

  it('exits 0 on an explicit none: <reason> and echoes the reason', () => {
    const cwd = repo();
    expect(log(cwd, '--support', 'none: no ledger-like store exists yet').code).toBe(0);
    const r = check(cwd, '--slug', SLUG);
    expect(r.code).toBe(0);
    expect(r.out).toContain('no ledger-like store exists yet');
  });

  it('derives the dialogue key from a --spec filename (attach-shaped key)', () => {
    const cwd = repo();
    runLog(['--slug', 'parent-enh', '--support', 'src/a.ts:1 — x'], cwd, () => {});
    expect(check(cwd, '--spec', 'docs/design/specs/2026-09-24-parent-enh-design.md').code).toBe(0);
  });

  it('exits 1 when the spec name carries no dialogue key', () => {
    const r = check(repo(), '--spec', 'docs/design/specs/notes.md');
    expect(r.code).toBe(1);
    expect(r.err).toContain('<date>-<slug>-design.md');
  });

  it('exits 1 on argv that names both or neither target', () => {
    expect(check(repo()).code).toBe(1);
    expect(check(repo(), '--slug', SLUG, '--spec', 'x-design.md').code).toBe(1);
  });

  it('exits 1 rather than 2 when Existing support cannot be parsed', () => {
    const cwd = repo();
    mkdirSync(join(cwd, '.noldor', 'design'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'design', `${SLUG}.md`),
      ['# Design ledger — x', '', '## Existing support', '', 'not a bullet', ''].join('\n'),
    );
    const r = check(cwd, '--slug', SLUG);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot parse 'Existing support'");
  });
});

describe('design support-check slug validation', () => {
  it('refuses a non-slug --slug with the corrected spelling', () => {
    const r = check(repo(), '--slug', 'My Dialogue');
    expect(r.code).toBe(1);
    expect(r.err).toContain("expected 'my-dialogue'");
  });
});

describe('design support-check --spec key validation', () => {
  it('names --spec, not --slug, when a spec filename key is not a slug', () => {
    const r = check(repo(), '--spec', 'docs/design/specs/2026-09-24-Foo_Bar-design.md');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--spec:');
    expect(r.err).not.toContain('--slug:');
  });
});
