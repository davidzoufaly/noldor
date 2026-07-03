// @tests: decouple-milestones-from-semver
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMilestones } from '../validate-milestones.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'milestones-validate-'));
  mkdirSync(join(tmp, 'docs', 'milestones'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeVision(slug: string | undefined): void {
  const fm = slug ? `current-milestone: ${slug}\n` : '';
  writeFileSync(join(tmp, 'docs/vision.md'), `---\n${fm}---\n`);
}

describe('validateMilestones', () => {
  it('passes when no milestones exist and vision omits current-milestone', () => {
    writeVision(undefined);
    expect(validateMilestones(tmp)).toEqual([]);
  });

  it('passes for a valid single active milestone matching vision', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: active\n---\n`);
    writeVision('foo');
    expect(validateMilestones(tmp)).toEqual([]);
  });

  it('fails when name mismatches filename stem', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: bar\nstatus: draft\n---\n`);
    writeVision(undefined);
    const errors = validateMilestones(tmp);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/name.*does not match filename stem/);
  });

  it('fails when two files have status: active', () => {
    writeFileSync(join(tmp, 'docs/milestones/a.md'), `---\nname: a\nstatus: active\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/b.md'), `---\nname: b\nstatus: active\n---\n`);
    writeVision('a');
    const errors = validateMilestones(tmp);
    expect(errors.some((e) => /multiple active/i.test(e))).toBe(true);
  });

  it('fails when vision current-milestone points at missing slug', () => {
    writeVision('ghost');
    const errors = validateMilestones(tmp);
    expect(errors.some((e) => /current-milestone.*ghost.*not found/i.test(e))).toBe(true);
  });

  it('fails when vision current-milestone points at a non-active slug', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: draft\n---\n`);
    writeVision('foo');
    const errors = validateMilestones(tmp);
    expect(errors.some((e) => /current-milestone.*foo.*status.*active/i.test(e))).toBe(true);
  });

  it('fails on missing required frontmatter field', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nstatus: draft\n---\n`);
    writeVision(undefined);
    const errors = validateMilestones(tmp);
    expect(errors).toHaveLength(1);
  });
});
