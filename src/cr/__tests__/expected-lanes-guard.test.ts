// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, type Slug } from '../../core/slug.js';
import { readExpectedLanes, writeExpectedLanes } from '../expected-lanes.js';

function slug(value: string): Slug {
  const parsed = parseSlug(value);
  if (!parsed.ok) throw new Error(`fixture slug is invalid: ${value}`);
  return parsed.slug;
}

let cwd: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'expected-lanes-'));
  cwd = join(base, 'repo');
  outside = join(base, 'outside');
  mkdirSync(join(cwd, '.noldor', 'cr', 'expected'), { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(join(cwd, '..'), { recursive: true, force: true });
});

describe('readExpectedLanes with an unusable sink', () => {
  it('reports it as an error instead of throwing out of aggregate', async () => {
    // This loop's whole contract is to convert environmental failures into
    // `errors` — an uncaught throw here would leave aggregate() fail-open on
    // the very record that exists to close that hole.
    writeFileSync(join(outside, 'stolen.json'), '{}');
    symlinkSync(
      join(outside, 'stolen.json'),
      join(cwd, '.noldor', 'cr', 'expected', 'demo-spec.json'),
    );

    const r = await readExpectedLanes(cwd, slug('demo'), 'spec');

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/unusable|unreadable/);
  });

  it('reports no error when the sink is simply absent', async () => {
    const r = await readExpectedLanes(cwd, slug('never-written'), 'spec');
    expect(r.errors).toEqual([]);
  });
});

describe('writeExpectedLanes with an unusable sink', () => {
  it('fails loudly rather than skipping the record', async () => {
    // A missing expectation is exactly the fail-open this file closes, so the
    // writer must not degrade to "recorded nothing" when the sink is tampered.
    writeFileSync(join(outside, 'stolen.json'), '{}');
    symlinkSync(
      join(outside, 'stolen.json'),
      join(cwd, '.noldor', 'cr', 'expected', 'demo-code.json'),
    );

    await expect(writeExpectedLanes(cwd, slug('demo'), 'code', ['reviewer'])).rejects.toThrow(
      /cannot write expected-lanes/,
    );
  });
});

// The stamp is interpolated into `git rev-parse <headSha>^{tree}`, so it must be
// an object name and not a revision expression — see `src/core/sha.ts`.
describe('the dispatched-head stamp (Q-0211)', () => {
  it('round-trips a real object name', async () => {
    const sha = 'a'.repeat(40);
    await writeExpectedLanes(cwd, slug('demo'), 'code', ['reviewer'], sha);
    const r = await readExpectedLanes(cwd, slug('demo'), 'code');
    expect(r.heads).toEqual([
      {
        kind: 'code',
        headSha: sha,
        file: join(cwd, '.noldor', 'cr', 'expected', 'demo-code.json'),
      },
    ]);
  });

  it('drops a stamp that is not an object name rather than writing a corrupt record', async () => {
    // `HEAD` would resolve to the CURRENT tree and report every stale round as
    // current — the exact failure the field exists to catch.
    await writeExpectedLanes(cwd, slug('demo'), 'code', ['reviewer'], 'HEAD');
    const r = await readExpectedLanes(cwd, slug('demo'), 'code');
    expect(r.errors).toEqual([]);
    expect(r.heads).toEqual([]);
    expect(r.lanes).toEqual(['reviewer']);
  });

  it('rejects a hand-tampered stamp as a corrupt record', async () => {
    writeFileSync(
      join(cwd, '.noldor', 'cr', 'expected', 'demo-code.json'),
      JSON.stringify({ slug: 'demo', kind: 'code', lanes: ['reviewer'], headSha: 'HEAD' }),
    );
    const r = await readExpectedLanes(cwd, slug('demo'), 'code');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/corrupt/);
  });

  it('omits the stamp when git could not answer', async () => {
    await writeExpectedLanes(cwd, slug('demo'), 'code', ['reviewer'], '');
    const r = await readExpectedLanes(cwd, slug('demo'), 'code');
    expect(r.heads).toEqual([]);
  });
});
