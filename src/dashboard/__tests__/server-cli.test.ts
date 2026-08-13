// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRoadmapWithHash, setDocRootsOverride } from '../data.js';
import { parseCliArgs } from '../server.js';

describe('dashboard server CLI parsing', () => {
  it('returns undefined port + rootPath + host when no flags', () => {
    expect(parseCliArgs([])).toEqual({
      port: undefined,
      rootPath: undefined,
      host: undefined,
      usedDeprecatedDocsFlag: false,
    });
  });

  it('parses --port as number', () => {
    expect(parseCliArgs(['--port', '5174'])).toEqual({
      port: 5174,
      rootPath: undefined,
      host: undefined,
      usedDeprecatedDocsFlag: false,
    });
  });

  it('parses --root as repository root', () => {
    expect(parseCliArgs(['--root', '/tmp/foo'])).toEqual({
      port: undefined,
      rootPath: '/tmp/foo',
      host: undefined,
      usedDeprecatedDocsFlag: false,
    });
  });

  it('accepts --docs as a deprecated alias for --root and flags it', () => {
    expect(parseCliArgs(['--docs', '/tmp/foo'])).toEqual({
      port: undefined,
      rootPath: '/tmp/foo',
      host: undefined,
      usedDeprecatedDocsFlag: true,
    });
  });

  it('prefers --root over --docs when both are present, without the deprecation flag', () => {
    expect(parseCliArgs(['--docs', '/tmp/old', '--root', '/tmp/new'])).toEqual({
      port: undefined,
      rootPath: '/tmp/new',
      host: undefined,
      usedDeprecatedDocsFlag: false,
    });
  });

  it('parses --host (the loopback opt-out)', () => {
    expect(parseCliArgs(['--host', '0.0.0.0'])).toEqual({
      port: undefined,
      rootPath: undefined,
      host: '0.0.0.0',
      usedDeprecatedDocsFlag: false,
    });
  });

  it('parses all flags in any order', () => {
    expect(parseCliArgs(['--port', '5174', '--root', './x', '--host', '0.0.0.0'])).toEqual({
      port: 5174,
      rootPath: './x',
      host: '0.0.0.0',
      usedDeprecatedDocsFlag: false,
    });
    expect(parseCliArgs(['--root', './x', '--port', '5174'])).toEqual({
      port: 5174,
      rootPath: './x',
      host: undefined,
      usedDeprecatedDocsFlag: false,
    });
  });
});

describe('--root path contract (repository root, not docs directory)', () => {
  // Scratch consumer with distinguishable sentinel content at the repository
  // root's docs/ vs a nested docs/docs/ — parsing the flag alone proves
  // nothing (Q-0104), so these tests drive a real roadmap load through the
  // override and assert which sentinel came back.
  let root: string;

  const entry = (name: string): string => `# Roadmap\n\n### ${name}\n\n- area: tooling\n\nBody.\n`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'noldor-root-flag-'));
    await mkdir(join(root, 'docs', 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'roadmap.md'), entry('Root Sentinel Entry'));
    await writeFile(join(root, 'docs', 'docs', 'roadmap.md'), entry('Nested Decoy Entry'));
  });

  afterEach(async () => {
    setDocRootsOverride(undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('resolves docs at <root>/docs when given the repository root', async () => {
    setDocRootsOverride(root);
    const { entries } = await loadRoadmapWithHash();
    expect(entries.map((e) => e.name)).toEqual(['Root Sentinel Entry']);
  });

  it('appends docs/ to whatever it is given — passing the docs directory resolves the nested decoy', async () => {
    setDocRootsOverride(join(root, 'docs'));
    const { entries } = await loadRoadmapWithHash();
    expect(entries.map((e) => e.name)).toEqual(['Nested Decoy Entry']);
  });
});
