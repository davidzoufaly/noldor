// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../server.js';

describe('dashboard server CLI parsing', () => {
  it('returns undefined port + docsPath + host when no flags', () => {
    expect(parseCliArgs([])).toEqual({ port: undefined, docsPath: undefined, host: undefined });
  });

  it('parses --port as number', () => {
    expect(parseCliArgs(['--port', '5174'])).toEqual({
      port: 5174,
      docsPath: undefined,
      host: undefined,
    });
  });

  it('parses --docs', () => {
    expect(parseCliArgs(['--docs', '/tmp/foo'])).toEqual({
      port: undefined,
      docsPath: '/tmp/foo',
      host: undefined,
    });
  });

  it('parses --host (the loopback opt-out)', () => {
    expect(parseCliArgs(['--host', '0.0.0.0'])).toEqual({
      port: undefined,
      docsPath: undefined,
      host: '0.0.0.0',
    });
  });

  it('parses all flags in any order', () => {
    expect(parseCliArgs(['--port', '5174', '--docs', './x', '--host', '0.0.0.0'])).toEqual({
      port: 5174,
      docsPath: './x',
      host: '0.0.0.0',
    });
    expect(parseCliArgs(['--docs', './x', '--port', '5174'])).toEqual({
      port: 5174,
      docsPath: './x',
      host: undefined,
    });
  });
});
