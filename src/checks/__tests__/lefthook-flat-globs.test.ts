// @tests: feature-md-links-overhaul
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface Job {
  name?: string;
  glob?: string;
  group?: { jobs?: Job[] };
}

function preCommitGlobs(file: string): Map<string, string | undefined> {
  const doc = parse(readFileSync(join(process.cwd(), file), 'utf8')) as {
    'pre-commit': { jobs: Job[] };
  };
  const out = new Map<string, string | undefined>();
  const walk = (jobs: Job[]): void => {
    for (const j of jobs) {
      if (j.name !== undefined) out.set(j.name, j.glob);
      if (j.group?.jobs) walk(j.group.jobs);
    }
  };
  walk(doc['pre-commit'].jobs);
  return out;
}

// lefthook's default matcher reads `dir/**/*.md` as "at least one subdirectory",
// so it never matched a flat docs/features/<slug>.md or a live spec and these jobs
// skipped silently (found shipping PR #540).
describe.each(['lefthook/noldor.yml', 'templates/lefthook/noldor.yml'])('%s', (file) => {
  const globs = preCommitGlobs(file);

  it.each([
    ['fd-resources', 'docs/features/*.md'],
    ['code-links-auto-high', 'docs/features/*.md'],
    ['spec-links', 'docs/design/specs/*.md'],
  ])('%s globs the flat directory', (job, glob) => {
    expect(globs.get(job)).toBe(glob);
  });
});
