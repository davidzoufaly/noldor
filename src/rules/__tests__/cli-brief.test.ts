// @tests: rules-cascade-v1
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBriefArgs, runBrief } from '../cli-brief.js';

/**
 * A repo holding a FIXTURE rule store, never the live `.noldor/rules/`: Q-0069
 * exists to grow that store, so a test transcribing today's rule names would rot
 * the way the live-tree `score.test` did.
 */
function fixtureRepo(session?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-rules-brief-'));
  mkdirSync(join(dir, '.noldor', 'rules'), { recursive: true });
  const write = (id: string, fm: string, body: string) =>
    writeFileSync(join(dir, '.noldor', 'rules', `${id}.md`), `---\nid: ${id}\n${fm}---\n${body}\n`);

  write('binding-rule', 'applies-to: ["src/**/*.ts"]\nstage: [code]\nenforce: true\n', 'BINDING.');
  write('advisory-rule', 'applies-to: ["src/**/*.ts"]\nstage: [code]\n', 'ADVICE.');
  write('test-only-rule', 'applies-to: ["src/**/*.test.ts"]\nstage: [code]\n', 'TEST ADVICE.');
  write('release-rule', 'applies-to: ["src/**/*.ts"]\nstage: [release]\n', 'RELEASE ADVICE.');

  if (session) {
    writeFileSync(join(dir, '.noldor', 'session.json'), JSON.stringify(session), 'utf8');
  }
  return dir;
}

const readMarker = (dir: string): { injectedRules?: string[] } =>
  JSON.parse(readFileSync(join(dir, '.noldor', 'session.json'), 'utf8')) as {
    injectedRules?: string[];
  };

const FAST_TRACK = { path: 'fast-track', startedAt: '2026-08-12T00:00:00.000Z' };

afterEach(() => vi.restoreAllMocks());

describe('parseBriefArgs', () => {
  it('collects repeated --file and parses --stage / --json', () => {
    expect(
      parseBriefArgs(['--file', 'a.ts', '--file', 'b.ts', '--stage', 'code', '--json']),
    ).toEqual({ files: ['a.ts', 'b.ts'], stage: 'code', json: true });
  });

  it('rejects a stage that is not a real lifecycle stage', () => {
    expect(() => parseBriefArgs(['--file', 'a.ts', '--stage', 'coding'])).toThrow(/must be one of/);
  });

  it('rejects a missing value and an unknown flag', () => {
    expect(() => parseBriefArgs(['--file'])).toThrow(/needs a path/);
    expect(() => parseBriefArgs(['--file', 'a.ts', '--bogus'])).toThrow(/unknown flag/);
  });

  it('requires --file, and says why a stage-only brief is refused', () => {
    expect(() => parseBriefArgs(['--stage', 'code'])).toThrow(/--file is required/);
    expect(() => parseBriefArgs([])).toThrow(/never matches a stage-only query/);
  });
});

describe('runBrief', () => {
  it('prints the binding bucket first and omits rules scoped elsewhere', () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    expect(runBrief(['--file', 'src/a.ts', '--stage', 'code'], dir)).toBe(0);
    expect(out).toContain('binding-rule');
    expect(out).toContain('advisory-rule');
    // Scoped to *.test.ts and to the release stage respectively.
    expect(out).not.toContain('test-only-rule');
    expect(out).not.toContain('release-rule');
    expect(out.indexOf('binding-rule')).toBeLessThan(out.indexOf('advisory-rule'));
  });

  it('unions across repeated --file and lists no rule twice', () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    expect(
      runBrief(['--file', 'src/a.ts', '--file', 'src/a.test.ts', '--stage', 'code'], dir),
    ).toBe(0);
    expect(out).toContain('test-only-rule');
    expect(out.match(/### advisory-rule/g)).toHaveLength(1);
  });

  it('--json emits the resolved buckets with the queried files', () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    expect(runBrief(['--file', 'src/a.ts', '--stage', 'code', '--json'], dir)).toBe(0);
    const parsed = JSON.parse(out) as {
      files: string[];
      stage: string | null;
      enforce: Array<{ id: string }>;
    };
    expect(parsed.files).toEqual(['src/a.ts']);
    expect(parsed.stage).toBe('code');
    expect(parsed.enforce.map((r) => r.id)).toEqual(['binding-rule']);
  });

  it('exits 3 with the reason on stderr when --file is absent', () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    expect(runBrief([], fixtureRepo())).toBe(3);
    expect(err).toContain('--file is required');
  });

  it('stamps the surfaced ids onto an active session marker, unioning across calls', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const dir = fixtureRepo(FAST_TRACK);
    expect(runBrief(['--file', 'src/a.ts', '--stage', 'code'], dir)).toBe(0);
    expect(readMarker(dir).injectedRules).toEqual(['advisory-rule', 'binding-rule']);

    expect(runBrief(['--file', 'src/a.test.ts', '--stage', 'code'], dir)).toBe(0);
    expect(readMarker(dir).injectedRules).toEqual([
      'advisory-rule',
      'binding-rule',
      'test-only-rule',
    ]);
  });

  it('prints normally with no session marker at all', () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    expect(runBrief(['--file', 'src/a.ts', '--stage', 'code'], dir)).toBe(0);
    expect(out).toContain('binding-rule');
  });

  it('still prints when the marker is unstampable, noting it on stderr', () => {
    let out = '';
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    // A `specs-only-*` marker without `markerVersion: 2` — readSession's
    // superRefine throws on it, which is exactly the degraded session where
    // seeing the rules matters most.
    const dir = fixtureRepo({
      path: 'specs-only-new',
      slug: 'x',
      startedAt: '2026-08-12T00:00:00Z',
    });
    expect(runBrief(['--file', 'src/a.ts', '--stage', 'code'], dir)).toBe(0);
    expect(out).toContain('binding-rule');
    expect(err).toContain('unstampable');
  });
});
