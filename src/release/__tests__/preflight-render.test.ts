// @tests: release-sweep-process-hardening
import { describe, expect, it } from 'vitest';

import { NOT_RUN_BY_PREFLIGHT, renderPreflight } from '../preflight-render.js';
import type { PreflightRow } from '../preflight-types.js';

const row = (over: Partial<PreflightRow> & Pick<PreflightRow, 'id' | 'status'>): PreflightRow => ({
  detail: 'detail',
  ...over,
});

describe('renderPreflight', () => {
  it('orders rows blocking → warn → ok → skipped', () => {
    const out = renderPreflight([
      row({ id: 'cr-gate', status: 'skipped' }),
      row({ id: 'branch', status: 'ok' }),
      row({ id: 'npm-name', status: 'warn', fix: 'w' }),
      row({ id: 'graph-freshness', status: 'blocking', fix: 'b' }),
    ]);
    const order = ['graph-freshness', 'npm-name', 'branch', 'cr-gate'].map((id) =>
      out.indexOf(`${id} `.trimEnd()),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('leads with a counts line covering all four statuses', () => {
    const out = renderPreflight([
      row({ id: 'branch', status: 'blocking', fix: 'x' }),
      row({ id: 'tree-clean', status: 'blocking', fix: 'x' }),
      row({ id: 'npm-name', status: 'warn', fix: 'x' }),
      row({ id: 'gh-auth', status: 'ok' }),
      row({ id: 'cr-gate', status: 'skipped' }),
    ]);
    expect(out.split('\n')[0]).toBe('preflight: 2 blocking, 1 warn, 1 ok, 1 skipped');
  });

  it('renders blocking rows under a FAIL label and prints their fix line', () => {
    const out = renderPreflight([
      row({ id: 'garden-receipt', status: 'blocking', detail: 'stale', fix: 'run /noldor-garden' }),
    ]);
    expect(out).toMatch(/FAIL\s+garden-receipt\s+stale/);
    expect(out).toMatch(/fix: run \/noldor-garden/);
  });

  it('prints the fix line for warn rows too', () => {
    const out = renderPreflight([
      row({ id: 'npm-name', status: 'warn', detail: 'unscoped', fix: 'prefer @scope/name' }),
    ]);
    expect(out).toMatch(/WARN\s+npm-name\s+unscoped/);
    expect(out).toMatch(/fix: prefer @scope\/name/);
  });

  it('never prints a fix line for ok or skipped rows', () => {
    const out = renderPreflight([
      row({ id: 'branch', status: 'ok', fix: 'should not appear' }),
      row({ id: 'cr-gate', status: 'skipped', fix: 'should not appear either' }),
    ]);
    expect(out).not.toMatch(/fix:/);
  });

  it('closes with the not-run line so the D1 coverage gap is stated, not implied', () => {
    const out = renderPreflight([row({ id: 'branch', status: 'ok' })]);
    const lines = out.split('\n');
    expect(lines[lines.length - 1]).toBe(
      `not run (not covered by preflight): ${NOT_RUN_BY_PREFLIGHT.join(' ')}`,
    );
    for (const script of ['typecheck', 'test', 'build', 'docs:build']) {
      expect(NOT_RUN_BY_PREFLIGHT).toContain(script);
    }
  });

  it('renders a fully green report without a FAIL label', () => {
    const out = renderPreflight([
      row({ id: 'branch', status: 'ok' }),
      row({ id: 'tree-clean', status: 'ok' }),
    ]);
    expect(out).not.toMatch(/FAIL/);
    expect(out.split('\n')[0]).toBe('preflight: 0 blocking, 0 warn, 2 ok, 0 skipped');
  });
});
