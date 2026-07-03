// @tests: decouple-milestones-from-semver
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  milestoneFrontmatterSchema,
  readMilestone,
  loadMilestones,
  loadMilestoneBySlug,
  draftMilestone,
  activateMilestone,
} from '../lib.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'milestones-test-'));
  mkdirSync(join(tmp, 'docs', 'milestones'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('milestoneFrontmatterSchema', () => {
  it('accepts minimal valid frontmatter', () => {
    const result = milestoneFrontmatterSchema.parse({ name: 'foo', status: 'draft' });
    expect(result).toEqual({ name: 'foo', status: 'draft' });
  });

  it('accepts optional description', () => {
    const result = milestoneFrontmatterSchema.parse({
      name: 'foo',
      status: 'active',
      description: 'a one-liner',
    });
    expect(result.description).toBe('a one-liner');
  });

  it('rejects missing name', () => {
    expect(() => milestoneFrontmatterSchema.parse({ status: 'draft' })).toThrow();
  });

  it('rejects missing status', () => {
    expect(() => milestoneFrontmatterSchema.parse({ name: 'foo' })).toThrow();
  });

  it('rejects unknown status value', () => {
    expect(() => milestoneFrontmatterSchema.parse({ name: 'foo', status: 'archived' })).toThrow();
  });
});

describe('readMilestone', () => {
  it('parses a valid milestone file', () => {
    const path = join(tmp, 'docs/milestones/public-release.md');
    writeFileSync(
      path,
      `---\nname: public-release\nstatus: active\ndescription: test\n---\n\n## Gate\nbody\n`,
    );
    const m = readMilestone(path);
    expect(m.frontmatter.name).toBe('public-release');
    expect(m.frontmatter.status).toBe('active');
    expect(m.frontmatter.description).toBe('test');
    expect(m.body).toContain('## Gate');
  });

  it('throws on missing file', () => {
    expect(() => readMilestone(join(tmp, 'missing.md'))).toThrow();
  });
});

describe('loadMilestones', () => {
  it('returns empty array when docs/milestones absent', () => {
    rmSync(join(tmp, 'docs/milestones'), { recursive: true });
    expect(loadMilestones(tmp)).toEqual([]);
  });

  it('returns empty array when docs/milestones empty', () => {
    expect(loadMilestones(tmp)).toEqual([]);
  });

  it('returns all milestone files', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: draft\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/bar.md'), `---\nname: bar\nstatus: active\n---\n`);
    const result = loadMilestones(tmp);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.frontmatter.name).toSorted()).toEqual(['bar', 'foo']);
  });
});

describe('loadMilestoneBySlug', () => {
  it('returns parsed milestone for existing slug', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: draft\n---\n`);
    const m = loadMilestoneBySlug('foo', tmp);
    expect(m?.frontmatter.name).toBe('foo');
  });

  it('returns null for missing slug', () => {
    expect(loadMilestoneBySlug('missing', tmp)).toBeNull();
  });
});

describe('draftMilestone', () => {
  it('creates a draft file with required frontmatter and body stubs', () => {
    draftMilestone('foo', undefined, tmp);
    const path = join(tmp, 'docs/milestones/foo.md');
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(raw).toMatch(/^---\n/);
    expect(raw).toMatch(/name: foo/);
    expect(raw).toMatch(/status: draft/);
    expect(raw).not.toMatch(/description:/);
    expect(raw).toContain('## Gate');
    expect(raw).toContain('## Success Criteria');
    expect(raw).toContain('## Out of Scope');
    expect(raw).toContain('<!-- TODO');
  });

  it('writes description when provided', () => {
    draftMilestone('bar', 'a one-liner', tmp);
    const raw = readFileSync(join(tmp, 'docs/milestones/bar.md'), 'utf8');
    expect(raw).toMatch(/description: a one-liner/);
  });

  it('throws if slug file already exists', () => {
    draftMilestone('foo', undefined, tmp);
    expect(() => draftMilestone('foo', undefined, tmp)).toThrow(/already exists/);
  });

  it('creates docs/milestones directory if absent', () => {
    rmSync(join(tmp, 'docs/milestones'), { recursive: true });
    draftMilestone('foo', undefined, tmp);
    expect(existsSync(join(tmp, 'docs/milestones/foo.md'))).toBe(true);
  });

  it('quotes description when value contains YAML special chars', () => {
    draftMilestone('with-colon', 'Build: ship it', tmp);
    const raw = readFileSync(join(tmp, 'docs/milestones/with-colon.md'), 'utf8');
    expect(raw).toMatch(/description: "Build: ship it"/);
    const m = readMilestone(join(tmp, 'docs/milestones/with-colon.md'));
    expect(m.frontmatter.description).toBe('Build: ship it');
  });
});

function visionAt(cwd: string): string {
  return readFileSync(join(cwd, 'docs/vision.md'), 'utf8');
}

function writeVision(cwd: string, currentMilestone: string | undefined, body = ''): void {
  const fm = currentMilestone ? `current-milestone: ${currentMilestone}\n` : '';
  writeFileSync(join(cwd, 'docs/vision.md'), `---\n${fm}---\n\n${body}`);
}

describe('activateMilestone', () => {
  it('promotes a draft to active when no previous active exists', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: draft\n---\n`);
    writeVision(tmp, undefined);

    activateMilestone('foo', tmp);

    const foo = readMilestone(join(tmp, 'docs/milestones/foo.md'));
    expect(foo.frontmatter.status).toBe('active');
    expect(visionAt(tmp)).toMatch(/current-milestone: foo/);
  });

  it('flips previous active to shipped and target to active; updates vision', () => {
    writeFileSync(join(tmp, 'docs/milestones/old.md'), `---\nname: old\nstatus: active\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/new.md'), `---\nname: new\nstatus: draft\n---\n`);
    writeVision(tmp, 'old');

    activateMilestone('new', tmp);

    expect(readMilestone(join(tmp, 'docs/milestones/old.md')).frontmatter.status).toBe('shipped');
    expect(readMilestone(join(tmp, 'docs/milestones/new.md')).frontmatter.status).toBe('active');
    expect(visionAt(tmp)).toMatch(/current-milestone: new/);
  });

  it('no-op early return when target is already active', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: active\n---\n`);
    writeVision(tmp, 'foo');
    const before = readFileSync(join(tmp, 'docs/milestones/foo.md'), 'utf8');
    const beforeVision = visionAt(tmp);

    activateMilestone('foo', tmp);

    expect(readFileSync(join(tmp, 'docs/milestones/foo.md'), 'utf8')).toBe(before);
    expect(visionAt(tmp)).toBe(beforeVision);
  });

  it('throws when target file is missing — filesystem unchanged', () => {
    writeFileSync(join(tmp, 'docs/milestones/old.md'), `---\nname: old\nstatus: active\n---\n`);
    writeVision(tmp, 'old');
    const oldBefore = readFileSync(join(tmp, 'docs/milestones/old.md'), 'utf8');
    const visionBefore = visionAt(tmp);

    expect(() => activateMilestone('missing', tmp)).toThrow(/not found/);

    expect(readFileSync(join(tmp, 'docs/milestones/old.md'), 'utf8')).toBe(oldBefore);
    expect(visionAt(tmp)).toBe(visionBefore);
  });

  it('throws when target is shipped — filesystem unchanged', () => {
    writeFileSync(join(tmp, 'docs/milestones/old.md'), `---\nname: old\nstatus: active\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/done.md'), `---\nname: done\nstatus: shipped\n---\n`);
    writeVision(tmp, 'old');
    const oldBefore = readFileSync(join(tmp, 'docs/milestones/old.md'), 'utf8');
    const doneBefore = readFileSync(join(tmp, 'docs/milestones/done.md'), 'utf8');
    const visionBefore = visionAt(tmp);

    expect(() => activateMilestone('done', tmp)).toThrow(/shipped is terminal/);

    expect(readFileSync(join(tmp, 'docs/milestones/old.md'), 'utf8')).toBe(oldBefore);
    expect(readFileSync(join(tmp, 'docs/milestones/done.md'), 'utf8')).toBe(doneBefore);
    expect(visionAt(tmp)).toBe(visionBefore);
  });

  it('throws when multiple files are already active — filesystem unchanged', () => {
    writeFileSync(join(tmp, 'docs/milestones/a.md'), `---\nname: a\nstatus: active\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/b.md'), `---\nname: b\nstatus: active\n---\n`);
    writeFileSync(
      join(tmp, 'docs/milestones/target.md'),
      `---\nname: target\nstatus: draft\n---\n`,
    );
    writeVision(tmp, 'a');
    const targetBefore = readFileSync(join(tmp, 'docs/milestones/target.md'), 'utf8');
    const visionBefore = visionAt(tmp);

    expect(() => activateMilestone('target', tmp)).toThrow(/multiple active/);

    expect(readFileSync(join(tmp, 'docs/milestones/target.md'), 'utf8')).toBe(targetBefore);
    expect(visionAt(tmp)).toBe(visionBefore);
  });

  it('throws when vision.md is missing — filesystem unchanged', () => {
    writeFileSync(join(tmp, 'docs/milestones/foo.md'), `---\nname: foo\nstatus: draft\n---\n`);
    const fooBefore = readFileSync(join(tmp, 'docs/milestones/foo.md'), 'utf8');

    expect(() => activateMilestone('foo', tmp)).toThrow(/vision/i);

    expect(readFileSync(join(tmp, 'docs/milestones/foo.md'), 'utf8')).toBe(fooBefore);
  });
});

import { listMilestones } from '../lib.js';

describe('listMilestones', () => {
  it('returns empty result when no milestones exist', () => {
    const result = listMilestones(tmp);
    expect(result).toEqual({ active: [], draft: [], shipped: [] });
  });

  it('groups milestones by status', () => {
    writeFileSync(join(tmp, 'docs/milestones/a.md'), `---\nname: a\nstatus: active\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/d1.md'), `---\nname: d1\nstatus: draft\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/d2.md'), `---\nname: d2\nstatus: draft\n---\n`);
    writeFileSync(join(tmp, 'docs/milestones/s.md'), `---\nname: s\nstatus: shipped\n---\n`);

    const result = listMilestones(tmp);

    expect(result.active.map((m) => m.slug)).toEqual(['a']);
    expect(result.draft.map((m) => m.slug).toSorted()).toEqual(['d1', 'd2']);
    expect(result.shipped.map((m) => m.slug)).toEqual(['s']);
  });
});
