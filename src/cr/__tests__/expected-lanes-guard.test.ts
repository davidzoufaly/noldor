// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, type Slug } from '../../core/slug.js';
import { readExpectedLanes } from '../expected-lanes.js';

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
