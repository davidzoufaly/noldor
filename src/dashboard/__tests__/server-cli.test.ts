// @tests: dashboard-hot-zones-page, dashboard-roadmap-backlog-polish, dashboard-roadmap-drag-drop, dashboard-vision-surface, dashboard-wip-age-page, dashboard-worktree-health-page, framework-milestones-support-poc-mvp-100, outcome-telemetry-and-effectiveness-metrics, project-tracking-dashboard
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../server.js';

describe('dashboard server CLI parsing', () => {
  it('returns undefined port + undefined docsPath when no flags', () => {
    expect(parseCliArgs([])).toEqual({ port: undefined, docsPath: undefined });
  });

  it('parses --port as number', () => {
    expect(parseCliArgs(['--port', '5174'])).toEqual({ port: 5174, docsPath: undefined });
  });

  it('parses --docs', () => {
    expect(parseCliArgs(['--docs', '/tmp/foo'])).toEqual({ port: undefined, docsPath: '/tmp/foo' });
  });

  it('parses both flags in any order', () => {
    expect(parseCliArgs(['--port', '5174', '--docs', './x'])).toEqual({
      port: 5174,
      docsPath: './x',
    });
    expect(parseCliArgs(['--docs', './x', '--port', '5174'])).toEqual({
      port: 5174,
      docsPath: './x',
    });
  });
});
