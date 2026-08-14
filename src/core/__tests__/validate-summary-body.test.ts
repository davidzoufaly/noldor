// @tests: pr-summary-body-enforcement
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FILE as SNAPSHOT_FILE } from '../summary-body-rollout.js';
import { provisionalBody, validateSummaryCommit } from '../validate-summary-body.js';

const CODE = ['src/clones/ranges.ts'];
const PROSE = ['docs/noldor/pr-flow.md'];

const GOOD_BODY = [
  'Why — a new file has no git post-image, so the clone gate printed green',
  'for a file whose every line was just written.',
  'How — resolveChangedRanges now unions `git ls-files --others` into the',
  'changed-range map as whole-file spans.',
  'What — src/clones/ranges.ts plus a regression test now make a pasted file',
  'participate in diff-scoped clone detection.',
].join('\n');

/** A stored commit object, with the shape git would have written. */
function commit(over: Partial<Parameters<typeof validateSummaryCommit>[0]> = {}) {
  return validateSummaryCommit({
    sha: 'a'.repeat(40),
    message: `fix(clones): union untracked files\n\n${GOOD_BODY}\n`,
    files: CODE,
    parentCount: 1,
    ...over,
  });
}

describe('validateSummaryCommit — section contract', () => {
  it('accepts a body carrying all three sections', () => {
    expect(commit().success).toBe(true);
  });

  it('reports each missing section by name', () => {
    for (const drop of ['Why', 'How', 'What']) {
      const body = GOOD_BODY.split('\n')
        .filter((l) => !l.startsWith(`${drop} —`))
        .join('\n');
      const r = commit({ message: `subject\n\n${body}\n` });
      expect(r.success).toBe(false);
      expect(r.error).toContain(drop);
    }
  });

  it('treats 24 non-whitespace characters as the floor, not 23', () => {
    const withWhat = (text: string) =>
      commit({
        message: `subject\n\nWhy — ${'w'.repeat(30)}\nHow — ${'h'.repeat(30)}\nWhat — ${text}\n`,
      });

    expect(withWhat('x'.repeat(23)).success).toBe(false);
    expect(withWhat('x'.repeat(24)).success).toBe(true);
  });

  it('measures content, not whitespace padding', () => {
    const padded = `subject\n\nWhy — ${'w'.repeat(30)}\nHow — ${'h'.repeat(30)}\nWhat — ${'x '.repeat(20)}\n`;
    // 20 'x' characters once the spaces are discounted — under the floor.
    expect(commit({ message: padded }).success).toBe(false);
  });

  it('accepts the sections in any order — order is prose convention, not mechanism', () => {
    const reordered = ['What', 'Why', 'How'].map((s) => `${s} — ${'z'.repeat(30)}`).join('\n');
    expect(commit({ message: `subject\n\n${reordered}\n` }).success).toBe(true);
  });

  it('does not let trailers pad the final section', () => {
    const thin = `subject\n\nWhy — ${'w'.repeat(30)}\nHow — ${'h'.repeat(30)}\nWhat — x\n\nNoldor-FD: some-feature\nNoldor-Path: fast-track\n`;
    const r = commit({ message: thin });
    expect(r.success).toBe(false);
    expect(r.error).toContain('What');
  });

  it('hints at the em-dash when the author used a colon', () => {
    const colons = 'Why: reason\nHow: mechanism\nWhat: outcome';
    const r = commit({ message: `subject\n\n${colons}\n` });
    expect(r.success).toBe(false);
    expect(r.error).toContain('interpret-trailers');
  });

  it('returns the subject alongside the verdict, for the rejection list', () => {
    expect(commit({ message: 'feat(x): a subject line\n\nbody\n' }).subject).toBe(
      'feat(x): a subject line',
    );
  });
});

describe('validateSummaryCommit — path scope', () => {
  it('exempts a commit that carries no code', () => {
    expect(commit({ files: PROSE, message: 'docs: tweak\n' }).success).toBe(true);
  });

  it('exempts an empty path set', () => {
    expect(commit({ files: [], message: 'chore: nothing\n' }).success).toBe(true);
  });

  it('requires a body when one code path rides along with prose', () => {
    expect(commit({ files: [...PROSE, ...CODE], message: 'docs: tweak\n' }).success).toBe(false);
  });
});

describe('validateSummaryCommit — object-derived exemptions', () => {
  it('exempts a merge by parent count', () => {
    expect(commit({ parentCount: 2, message: "Merge branch 'x'\n" }).success).toBe(true);
  });

  it('enforces a single-parent commit wearing a Merge subject', () => {
    // The forged-subject hole the parked design could not close: with no
    // MERGE_HEAD to consult, `git commit -m "Merge branch 'x'"` walked past the
    // gate. Parent count is not forgeable.
    expect(commit({ parentCount: 1, message: "Merge branch 'x'\n" }).success).toBe(false);
  });

  it('enforces a single-parent commit wearing a Revert subject', () => {
    expect(commit({ parentCount: 1, message: 'Revert "feat: thing"\n' }).success).toBe(false);
  });

  it('enforces a root commit that carries code', () => {
    expect(commit({ parentCount: 0, message: 'feat: initial\n' }).success).toBe(false);
  });

  it('enforces the autosquash family — a stored fixup is not disappearing', () => {
    // Exempting these at pre-push would make `git commit -m 'fixup! x'` a
    // one-token bypass of the whole gate: the object crosses the boundary
    // unsquashed, and nothing guarantees the rebase it names ever happens. The
    // advisory adapter still exempts them, where the object really is provisional.
    for (const prefix of ['fixup!', 'squash!', 'amend!']) {
      expect(commit({ message: `${prefix} some subject\n` }).success).toBe(false);
    }
  });

  it('exempts release automation through the resolved trailer', () => {
    for (const path of ['release-automation', 'release-sweep']) {
      expect(commit({ noldorPath: path, message: 'chore(release): v1\n' }).success).toBe(true);
    }
  });

  it('grants no exemption for an unrecognised Noldor-Path value', () => {
    expect(commit({ noldorPath: 'fast-track', message: 'feat: thing\n' }).success).toBe(false);
  });

  it('grants no exemption for a Noldor-Path line written in body prose', () => {
    // `noldorPath` is undefined because git's trailer block held no such key —
    // the loader never falls back to a regex over the message, so this line is
    // just text. Forging the exemption would be a one-line bypass otherwise.
    const forged = 'feat: thing\n\nNoldor-Path: release-automation is what I would like\n';
    expect(commit({ message: forged, noldorPath: undefined }).success).toBe(false);
  });
});

describe('provisionalBody — advisory-only cleanup', () => {
  it('drops comment lines and the commit -v diff below the scissors', () => {
    const message = [
      'subject',
      '',
      'Why — real reason that is comfortably long enough to pass',
      '# Please enter the commit message for your changes.',
      '# ------------------------ >8 ------------------------',
      'diff --git a/src/x.ts b/src/x.ts',
      '+const padding = "would otherwise pad the final section";',
    ].join('\n');
    const body = provisionalBody(message);
    expect(body).not.toContain('diff --git');
    expect(body).not.toContain('Please enter');
  });

  it('honours a multi-character comment marker', () => {
    const message = ['subject', '', 'Why — reason', '// a comment line'].join('\n');
    expect(provisionalBody(message, '//')).not.toContain('a comment line');
  });
});

/** A scratch repo with a snapshot present, so the advisory is active. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-summary-advisory-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  return dir;
}

function runAdvisory(dir: string, messageFile: string): { status: number; stderr: string } {
  // spawnSync, not execFileSync: the advisory always exits 0, and execFileSync
  // returns only stdout on success — so its diagnostics, which are the entire
  // point of this adapter, would be invisible to these assertions.
  const entry = join(process.cwd(), 'src/core/validate-summary-body.ts');
  const r = spawnSync('npx', ['tsx', entry, messageFile], { cwd: dir, encoding: 'utf8' });
  return { status: r.status ?? 1, stderr: r.stderr ?? '' };
}

describe('advisory adapter — never blocks', () => {
  it('exits 0 and names the file when the activation snapshot is absent', () => {
    const dir = scratchRepo();
    const msg = join(dir, 'MSG');
    writeFileSync(msg, 'feat: thing\n');
    const r = runAdvisory(dir, msg);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(SNAPSHOT_FILE);
  });

  it('exits 0 on a corrupt snapshot, and still says so', () => {
    const dir = scratchRepo();
    writeFileSync(join(dir, SNAPSHOT_FILE), 'not json');
    const msg = join(dir, 'MSG');
    writeFileSync(msg, 'feat: thing\n');
    const r = runAdvisory(dir, msg);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('corrupt');
  });

  it('exits 0 on a missing message file', () => {
    const dir = scratchRepo();
    expect(runAdvisory(dir, join(dir, 'no-such-file')).status).toBe(0);
  });

  it('exits 0 even when the body is plainly invalid', () => {
    const dir = scratchRepo();
    writeFileSync(
      join(dir, SNAPSHOT_FILE),
      JSON.stringify({ version: 1, grandfatherTips: ['b'.repeat(40)] }),
    );
    writeFileSync(join(dir, 'src.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const msg = join(dir, 'MSG');
    writeFileSync(msg, 'feat: thing with no explanation at all\n');
    // Invalid body, code staged — and still exit 0. Blocking here is exactly
    // what the redesign removed.
    expect(runAdvisory(dir, msg).status).toBe(0);
  });
});
