// @tests: noldor
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sidecarFilename, writeSidecar, readSidecar, type CrRecord } from '../sidecar.js';

const sample: CrRecord = { blockers: [], suggestions: [], summary: 'ok' };

describe('sidecarFilename', () => {
  it('gate lane: <tree>.codex.json', () => {
    expect(sidecarFilename({ kind: 'gate', tree: 'abc123' })).toBe('abc123.codex.json');
  });
  it('working lane: working-<tree>-<ts>.codex.json', () => {
    expect(sidecarFilename({ kind: 'working', tree: 'abc123', timestamp: 1700000000 })).toBe(
      'working-abc123-1700000000.codex.json',
    );
  });
  it('sha lane: <tree>.codex.json (treated like gate filename)', () => {
    expect(sidecarFilename({ kind: 'sha', tree: 'def456' })).toBe('def456.codex.json');
  });
  it('range lane: range-<from>-<to>.codex.json', () => {
    expect(sidecarFilename({ kind: 'range', from: 'aaa', to: 'bbb' })).toBe(
      'range-aaa-bbb.codex.json',
    );
  });
  it('paths lane: paths-<tree>-<hash>.codex.json', () => {
    expect(sidecarFilename({ kind: 'paths', tree: 'abc', pathsHash: 'p1' })).toBe(
      'paths-abc-p1.codex.json',
    );
  });
});

describe('writeSidecar / readSidecar', () => {
  it('round-trips a record through .noldor/cr-records/', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cr-sidecar-'));
    writeSidecar(cwd, 'abc.codex.json', sample);
    expect(readSidecar(cwd, 'abc.codex.json')).toEqual(sample);
  });

  it('rejects malformed JSON via Zod', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cr-sidecar-'));
    mkdirSync(join(cwd, '.noldor', 'cr-records'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'cr-records', 'bad.codex.json'),
      '{"blockers":"not-an-array"}',
    );
    expect(() => readSidecar(cwd, 'bad.codex.json')).toThrow(/blockers/);
  });
});
