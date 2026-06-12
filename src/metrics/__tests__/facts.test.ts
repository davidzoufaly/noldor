// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFacts } from '../facts';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-facts-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  return dir;
}

describe('extractFacts', () => {
  it('extracts commits with trailers, features, releases, and intake recovery', async () => {
    const dir = scratchRepo();
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'roadmap.md'),
      '# Roadmap\n\n#### My Feature\n\n- area: tooling\n- since: 2026-01-01\n- size: L\n- parent: noldor\n\nBody.\n',
      'utf8',
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'docs: seed roadmap');
    writeFileSync(
      join(dir, 'docs', 'features', 'my-feature.md'),
      [
        '---',
        'area: tooling',
        'category: Tooling',
        'links:',
        '  code: []',
        'name: My Feature',
        'packages:',
        '  - scripts',
        'phase: done',
        'noldor-tier: full',
        'introduced: 1.0.0',
        '---',
        '',
        '## Summary',
        '',
        'x',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'docs', 'roadmap.md'), '# Roadmap\n', 'utf8');
    git(dir, 'add', '.');
    git(
      dir,
      'commit',
      '-q',
      '-m',
      'feat(my-feature): ship\n\nNoldor-FD: my-feature\nNoldor-Path: full-new',
    );
    git(dir, 'tag', 'v1.0.0');
    const facts = await extractFacts(dir);
    expect(facts.commits.some((c) => c.trailers['Noldor-FD'] === 'my-feature')).toBe(true);
    expect(facts.features).toHaveLength(1);
    expect(facts.features[0].slug).toBe('my-feature');
    expect(facts.releases).toEqual([{ version: '1.0.0', date: expect.any(String) }]);
    const intake = facts.intake.find((i) => i.slug === 'my-feature');
    expect(intake).toMatchObject({ since: '2026-01-01', size: 'L', parent: 'noldor' });
    expect(facts.drainState).toBeNull();
    expect(facts.agentEvents).toEqual([]);
  });

  it('is fail-open per source: malformed events line is skipped + warned', async () => {
    const dir = scratchRepo();
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'x', 'utf8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(
      join(dir, '.noldor', 'agent-events.jsonl'),
      '{"ts":"2026-06-12T00:00:00Z","runner":"claude","role":"drain-implementer","exitCode":0,"durationMs":5,"timedOut":false}\nNOT-JSON\n',
      'utf8',
    );
    const facts = await extractFacts(dir);
    expect(facts.agentEvents).toHaveLength(1);
    expect(facts.warnings.some((w) => w.includes('agent-events'))).toBe(true);
  });
});
