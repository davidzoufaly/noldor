// @tests: consumer-architecture-doc-surface
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  FD_DIAGRAM_PLACEHOLDER,
  MIN_FD_DIAGRAM_PROSE_CHARS,
} from '../../../core/fd-diagram-contract.js';
import { PLACEHOLDER_MARKER } from '../../../docs/architecture-schema.js';
import { detectFdDiagramStubs } from '../fd-diagram.js';

/**
 * Every temp repo this file creates, removed in `afterAll`.
 *
 * A suite-scoped owner, so `using` has no scope to bind to — the
 * `deterministic-cleanup` rule's `try/finally` carve-out for a release that must
 * outlive the block. Without it each run leaves one directory per case behind.
 */
const tempRepos: string[] = [];

afterAll(async () => {
  await Promise.all(tempRepos.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A real repo on disk with `docs/features/<name>.md` per entry — no fs shim. */
async function repoWith(features: Record<string, string>): Promise<string> {
  const repo = await newTempRepo();
  await mkdir(join(repo, 'docs', 'features'), { recursive: true });
  for (const [name, body] of Object.entries(features)) {
    await writeFile(join(repo, 'docs', 'features', `${name}.md`), body, 'utf8');
  }
  return repo;
}

async function newTempRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'fd-diagram-'));
  tempRepos.push(repo);
  return repo;
}

const FENCE = ['```mermaid', 'flowchart LR', '  gate --> worktree', '```'].join('\n');
/** 46 non-whitespace characters — comfortably over the floor. */
const PROSE = 'The gate creates the worktree that pr-flow later removes.';

function fd(diagramSection: string | null): string {
  const head = ['---', 'name: X', '---', '', '## Summary', '', 'A thing.', ''];
  const tail = ['## User Story', '', 'As a user...', ''];
  const mid = diagramSection === null ? [] : ['## Diagram', '', diagramSection, ''];
  return [...head, ...mid, ...tail].join('\n');
}

describe('detectFdDiagramStubs', () => {
  it('is silent on an FD that carries no Diagram heading, whatever else it holds', async () => {
    const repo = await repoWith({ legacy: fd(null) });
    expect(await detectFdDiagramStubs(repo)).toEqual([]);
  });

  it('reports a section holding only the scaffolded placeholder as placeholder-only', async () => {
    const repo = await repoWith({ fresh: fd(FD_DIAGRAM_PLACEHOLDER) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rule).toBe('placeholder-only');
    expect(rows[0]!.file).toBe('docs/features/fresh.md');
    expect(rows[0]!.message).toContain('placeholder');
  });

  it('reports prose with no mermaid fence as no-fence', async () => {
    const repo = await repoWith({ wordy: fd(PROSE) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['no-fence']);
  });

  it('reports a fence with too little prose beside it as stub-section', async () => {
    const repo = await repoWith({ terse: fd(`${FENCE}\n\nShape.`) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['stub-section']);
  });

  it('reports an empty section as stub-section', async () => {
    const repo = await repoWith({ hollow: fd('') });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['stub-section']);
  });

  it('accepts a fence plus sufficient prose, while its prose-less twin still reports', async () => {
    const repo = await repoWith({ good: fd(`${FENCE}\n\n${PROSE}`), bad: fd(FENCE) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/bad.md']);
  });

  it('accepts a leftover placeholder beside a real diagram, but not one standing alone', async () => {
    const repo = await repoWith({
      messy: fd(`${FD_DIAGRAM_PLACEHOLDER}\n\n${FENCE}\n\n${PROSE}`),
      alone: fd(FD_DIAGRAM_PLACEHOLDER),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => [r.file, r.rule])).toEqual([
      ['docs/features/alone.md', 'placeholder-only'],
    ]);
  });

  it('accepts a cut whose reason clears the floor, and rejects a bare marker', async () => {
    const repo = await repoWith({
      declined: fd('noldor:cut a single pure function — the signature is the shape'),
      bare: fd('noldor:cut'),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/bare.md']);
  });

  it('does not let a fence hidden inside an HTML comment clear the section', async () => {
    // Deliberately a fence with no `-->` in it: a mermaid arrow would close the
    // comment early, which is what HTML actually does and is covered below.
    const arrowless = ['```mermaid', 'sequenceDiagram', '  a->>b: go', '```'].join('\n');
    const repo = await repoWith({ sneaky: fd(`<!--\n${arrowless}\n-->\n\n${PROSE}`) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['no-fence']);
  });

  it('does not let an arrow-bearing fence hidden inside a comment clear the section', async () => {
    // A flowchart edge IS `-->`, so the comment closes mid-fence exactly as
    // HTML reads it — but whatever leaks past that close is junk, never a
    // fence: the reader was shown no diagram, so the verdict is no-fence.
    const repo = await repoWith({ arrowy: fd(`<!--\n${FENCE}\n-->\n\n${PROSE}`) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['no-fence']);
  });

  it('keeps scanning the headings that follow a commented-out arrow-bearing fence', async () => {
    // The section-loss regression: the stray ``` the mid-fence comment close
    // left behind used to read as a fence opener, so every heading to EOF
    // vanished and the FD silently left scope instead of reporting its stub.
    const doc = [
      '---',
      'name: X',
      '---',
      '',
      '## Summary',
      '',
      `<!--\n${FENCE}\n-->`,
      '',
      '## Diagram',
      '',
      '## Usage',
      '',
      'Run it.',
      '',
    ].join('\n');
    const repo = await repoWith({ blocked: doc });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['stub-section']);
  });

  it('does not let a cut hidden inside an HTML comment clear the section', async () => {
    const repo = await repoWith({
      sneaky: fd('<!--\nnoldor:cut this reason is long enough to clear the floor\n-->'),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['stub-section']);
  });

  it('does not let a mermaid fence quoted inside an enclosing fence stand in for a real diagram', async () => {
    // A four-backtick block SHOWING the scaffold is example text: the section
    // scanner tags it all as one fence, so the kind reader must not count the
    // quoted inner opener.
    const quoted = ['````markdown', FENCE, '````'].join('\n');
    const repo = await repoWith({ example: fd(`${quoted}\n\n${PROSE}`) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['no-fence']);
  });

  it('does not let a four-space-indented fence sample stand in for a real diagram', async () => {
    // Indented code per CommonMark: the section SHOWS a fence without carrying
    // one, so the verdict is no-fence — the fenceKinds grammar must agree with
    // the section scanner about what a delimiter is.
    const sample = FENCE.split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
    const repo = await repoWith({ shown: fd(`${sample}\n\n${PROSE}`) });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['no-fence']);
  });

  it('counts backticked identifiers in prose rather than blanking them', async () => {
    // The whole visible sentence is 45 non-whitespace chars; blanking inline
    // code spans (what `stripCodeRegions` does) drops it under the floor and
    // would report a false stub on the prose style this repo actually writes.
    const ticked = 'The `supervisor` spawns one `child` per entry.';
    const repo = await repoWith({
      ticky: fd(`${FENCE}\n\n${ticked}`),
      thin: fd(`${FENCE}\n\n\`x\``),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/thin.md']);
  });

  it('ignores a Diagram heading that sits inside a fenced code block', async () => {
    const doc = [
      '---',
      'name: X',
      '---',
      '',
      '## Summary',
      '',
      '````markdown',
      '## Diagram',
      '',
      'this is documentation about the section, not the section',
      '````',
      '',
      '## Usage',
      '',
      'Run it.',
      '',
    ].join('\n');
    const repo = await repoWith({ meta: doc, real: fd('') });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/real.md']);
  });

  it('classifies on the first Diagram heading — a filled duplicate cannot mask a stub', async () => {
    const doc = [
      '---',
      'name: X',
      '---',
      '',
      '## Diagram',
      '',
      '## Diagram',
      '',
      FENCE,
      '',
      PROSE,
      '',
    ].join('\n');
    const repo = await repoWith({ twice: doc });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['stub-section']);
  });

  it('treats prose at the floor as filled and one character below it as a stub', async () => {
    const atFloor = 'a'.repeat(MIN_FD_DIAGRAM_PROSE_CHARS);
    const below = 'a'.repeat(MIN_FD_DIAGRAM_PROSE_CHARS - 1);
    const repo = await repoWith({
      exact: fd(`${FENCE}\n\n${atFloor}`),
      short: fd(`${FENCE}\n\n${below}`),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/short.md']);
  });

  it('accepts any declared mermaid kind and several fences as one, but not a kindless fence', async () => {
    const two = ['```mermaid', 'sequenceDiagram', '  a->>b: go', '```', '', FENCE].join('\n');
    const kindless = ['```mermaid', '```'].join('\n');
    const repo = await repoWith({
      multi: fd(`${two}\n\n${PROSE}`),
      empty: fd(`${kindless}\n\n${PROSE}`),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => [r.file, r.rule])).toEqual([['docs/features/empty.md', 'no-fence']]);
  });

  it('returns rows sorted by filename across many FDs', async () => {
    const repo = await repoWith({
      zebra: fd(FD_DIAGRAM_PLACEHOLDER),
      alpha: fd(PROSE),
      mango: fd(`${FENCE}\n\n${PROSE}`),
    });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/alpha.md', 'docs/features/zebra.md']);
  });

  it('returns an empty list for a repo with no features directory', async () => {
    expect(await detectFdDiagramStubs(await newTempRepo())).toEqual([]);
  });

  it('does not enrol an FD whose only Diagram heading sits inside an HTML comment', async () => {
    // Presence-gating is the whole no-retrospective guarantee: a commented-out
    // heading in a legacy FD must not put it in scope.
    const commented = [
      '---',
      'name: X',
      '---',
      '',
      '## Summary',
      '',
      'A thing.',
      '',
      '<!--',
      '## Diagram',
      '-->',
      '',
      '## Usage',
      '',
      'Run it.',
      '',
    ].join('\n');
    const repo = await repoWith({ legacy: commented, real: fd('') });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.file)).toEqual(['docs/features/real.md']);
  });

  it('does not let a fence inside a comment mis-tag the visible lines after it', async () => {
    // An unmatched ``` inside a comment used to leave the following prose
    // tagged as fenced, so it vanished from the density measure.
    const section = ['<!--', '```mermaid', '-->', '', FENCE, '', PROSE].join('\n');
    const repo = await repoWith({ tricky: fd(section) });
    expect(await detectFdDiagramStubs(repo)).toEqual([]);
  });

  it('is not blinded by an unterminated comment inside a fenced example', async () => {
    // An FD that quotes the scaffold in a fenced sample must still be scanned:
    // treating that `<!--` as a real comment blanked the rest of the file and
    // silently dropped the FD out of scope.
    const doc = [
      '---',
      'name: X',
      '---',
      '',
      '## Summary',
      '',
      'The scaffold looks like this:',
      '',
      '```markdown',
      '<!-- TODO: an example the author never closed',
      '```',
      '',
      '## Diagram',
      '',
      FD_DIAGRAM_PLACEHOLDER,
      '',
      '## Usage',
      '',
      'Run it.',
      '',
    ].join('\n');
    const repo = await repoWith({ quoting: doc });
    const rows = await detectFdDiagramStubs(repo);
    expect(rows.map((r) => r.rule)).toEqual(['placeholder-only']);
  });

  it('lets a well-formed cut win even when a bare marker precedes it', async () => {
    const section = [
      'noldor:cut',
      'noldor:cut a single pure function — the signature is the shape',
    ].join('\n');
    const repo = await repoWith({ ordered: fd(section) });
    expect(await detectFdDiagramStubs(repo)).toEqual([]);
  });
});

describe('FD_DIAGRAM_PLACEHOLDER', () => {
  it('carries the marker the detector reads, so the two halves cannot drift', () => {
    expect(FD_DIAGRAM_PLACEHOLDER).toContain(PLACEHOLDER_MARKER);
  });
});
