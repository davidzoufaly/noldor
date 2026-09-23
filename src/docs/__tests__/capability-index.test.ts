// @tests: validate-script-catalog-gate
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, renderCapabilityIndex, replaceCapabilityIndex } from '../capability-index.js';

const START = '<!-- noldor:capabilities:start -->';
const END = '<!-- noldor:capabilities:end -->';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function repoWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cap-index-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(root, rel, '..'), { recursive: true });
    await writeFile(join(root, rel), body);
  }
  return root;
}

describe('renderCapabilityIndex', () => {
  it('lists every group with its subcommands and omits the empty leaf key', () => {
    const out = renderCapabilityIndex({
      milestones: {
        desc: 'Milestone validators',
        subs: { validate: { src: 'a.ts', desc: '' }, show: { src: 'b.ts', desc: '' } },
      },
      doctor: { desc: 'Diff against templates.', subs: { '': { src: 'c.ts', desc: '' } } },
    });
    expect(out.startsWith(START)).toBe(true);
    expect(out.endsWith(END)).toBe(true);
    expect(out).toContain('- `milestones` — Milestone validators: validate, show');
    expect(out).toContain('- `doctor` — Diff against templates\n');
  });

  it('names the milestone commands from the real manifest', () => {
    expect(renderCapabilityIndex()).toMatch(/- `milestones` — .*: validate, show/);
  });
});

describe('replaceCapabilityIndex', () => {
  it('replaces only the marked block', () => {
    const doc = `# Head\n\n${START}\nold\n${END}\n\n## Tail\n`;
    expect(replaceCapabilityIndex(doc, `${START}\nnew\n${END}`)).toBe(
      `# Head\n\n${START}\nnew\n${END}\n\n## Tail\n`,
    );
  });

  it('returns null when the markers are missing or out of order', () => {
    expect(replaceCapabilityIndex('# no block\n', 'x')).toBeNull();
    expect(replaceCapabilityIndex(`${END}\n${START}\n`, 'x')).toBeNull();
  });
});

describe('main', () => {
  it('fails a stale block in check mode and fixes it with --write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = await repoWith({ 'AGENTS.md': `# Rules\n\n${START}\nstale\n${END}\n` });

    expect(await main([], root)).toBe(1);
    expect(await main(['--write'], root)).toBe(0);
    expect(await main([], root)).toBe(0);
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(
      `# Rules\n\n${renderCapabilityIndex()}\n`,
    );
  });

  it('fails when a present file has no markers, and skips absent files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await repoWith({ 'templates/AGENTS.md': '# no block\n' });
    expect(await main(['--write'], root)).toBe(1);
    expect(await main([], await repoWith({}))).toBe(0);
  });

  it("keeps this repo's AGENTS.md and its template current", async () => {
    expect(await main([], process.cwd())).toBe(0);
  });
});
